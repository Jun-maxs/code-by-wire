/**
 * Product tags for sessions (fork feature, 2026-10-26). The user runs ~5 products in parallel, almost
 * all from one folder, so the folder grouping can't tell sessions apart. A sibling tool (the
 * "workbench") keeps one markdown *product card* per product plus trigger patterns (URLs, product
 * names, paths) and records which product each session is about. This module is the JSX-free half:
 * card parsing, trigger matching, and the session → product decision. Main reads the files
 * (`src/main/products.ts`); the sidebar renders the result.
 */

export interface ProductTrigger {
  key: string;
  /** Regex sources (case-insensitive); the earliest match in the text decides. */
  include: string[];
  /** Regex sources that disqualify the product when they match. */
  exclude: string[];
}

export interface ProductInfo {
  key: string;
  name: string;
  color: string;
  /** Distinct hosts of the URLs in the card's 资料与位置 section; empty when the card lists none. */
  domains: string[];
  /** First line of 最近在做. */
  doing?: string;
  /** 没收尾的 lines. */
  loose: string[];
  /** 等你决定 lines. */
  decide: string[];
  /** Whether a card file exists. A topic with only trigger words still tags sessions; its card is
   *  generated later from Settings → Topics. */
  hasCard: boolean;
  /** The trigger words (regex sources) that pull a session into this topic. */
  keywords: string[];
  /** Folders the card generator reads (git log, status) for this topic. */
  repos: string[];
  /** Card file mtime (ms since epoch), null without a card. */
  updatedAt: number | null;
}

/** What Settings → Topics saves for one topic. `key` names the card file, so it is ascii. */
export interface TopicInput {
  key: string;
  name: string;
  color: string;
  keywords: string[];
  repos: string[];
}

export const TOPIC_KEY_RE = /^[a-z0-9_-]{1,40}$/;

/** One card generation run started from Settings (in-memory in main; lost on restart). */
export interface CardRun {
  key: string;
  startedAt: number;
  /** null while running. */
  ok: boolean | null;
  /** The generator's log lines for this topic (last few), shown under the topic. */
  message: string;
}

export interface ProductsData {
  products: Record<string, ProductInfo>;
  /** Session id → product key, as recorded by the workbench hook (may name keys without a card). */
  bySession: Record<string, string>;
  triggers: ProductTrigger[];
  /** Session id → the workbench's short task title (rewritten as the task changes). */
  titles: Record<string, string>;
  /** Card generation runs by topic key. */
  runs: Record<string, CardRun>;
}

const EMPTY_LINES = new Set(["无", "无。", "-", "（无）"]);

/** A card's `## 标题` sections, each as its non-empty bullet/plain lines with list markers stripped. */
function sections(md: string): Map<string, string[]> {
  const out = new Map<string, string[]>();
  let current: string[] | null = null;
  for (const raw of md.split(/\r?\n/)) {
    const heading = /^##\s+(.+?)\s*$/.exec(raw);
    if (heading) {
      current = [];
      out.set(heading[1], current);
      continue;
    }
    const line = raw
      .trim()
      .replace(/^[-*]\s+|^\d+\.\s+/, "")
      .trim();
    if (current && line && !EMPTY_LINES.has(line)) current.push(line);
  }
  return out;
}

const URL_RE = /https?:\/\/([a-z0-9.-]+\.[a-z]{2,})/gi;

export function parseProductCard(
  key: string,
  md: string,
  color?: string,
): Omit<ProductInfo, "hasCard" | "keywords" | "repos" | "updatedAt"> {
  const title = /^#\s+(.+)$/m.exec(md);
  const sec = sections(md);
  const where = (sec.get("资料与位置") ?? []).join("\n");
  const domains = [
    ...new Set([...where.matchAll(URL_RE)].map((m) => m[1].toLowerCase())),
  ];
  return {
    key,
    name: title ? title[1].trim() : key,
    color: colorForProduct(key, color),
    domains,
    doing: sec.get("最近在做")?.[0],
    loose: sec.get("没收尾的") ?? [],
    decide: sec.get("等你决定") ?? [],
  };
}

/** A trigger pattern as people read it: `cet\.yuanai\.best` → `cet.yuanai.best`,
 *  `均哥\s*ultra` → `均哥 ultra`, `\bhapi\b` → `hapi`. */
export function keywordLabel(pattern: string): string {
  return pattern
    .replace(/\\b/g, "")
    .replace(/\\s[*+?]?/g, " ")
    .replace(/\\(.)/g, "$1")
    .trim();
}

/** Plain words back into a pattern. A label left as it was keeps its original pattern (so word
 *  boundaries and hand-written regexes survive an edit); new words match literally, any spacing. */
export function keywordPattern(label: string, originals: string[]): string {
  const same = originals.find((p) => keywordLabel(p) === label);
  if (same !== undefined) return same;
  return label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/\s+/g, "\\s*");
}

/** A card title like "均哥Ultra（桌面整理）" cut to its first name, for tight spots (sidebar, menus). */
export function shortTopicName(name: string): string {
  return name.replace(/\s*[（(].*$/, "").slice(0, 10) || name.slice(0, 10);
}

function compile(source: string): RegExp | null {
  try {
    return new RegExp(source, "i");
  } catch {
    return null; // a bad pattern in the user's file disables just that pattern
  }
}

/** The product whose include pattern matches earliest in `text`, skipping excluded ones; null if none. */
export function classifyText(
  triggers: ProductTrigger[],
  text: string,
): string | null {
  let best: { key: string; at: number } | null = null;
  for (const t of triggers) {
    if (t.exclude.some((p) => compile(p)?.test(text))) continue;
    for (const p of t.include) {
      const m = compile(p)?.exec(text);
      if (m && (best === null || m.index < best.at))
        best = { key: t.key, at: m.index };
    }
  }
  return best?.key ?? null;
}

/** The product a session belongs to: the hook's record first (it saw the actual prompts), else the
 *  title classified by the triggers. Keys that are neither a card nor a trigger render untagged; an
 *  explicit empty record (the user cleared it) stays untagged. */
export function productForSession(
  data: ProductsData,
  session: { id: string; title: string },
): string | null {
  const recorded = data.bySession[session.id];
  if (recorded === "") return null;
  if (recorded && data.products[recorded]) return recorded;
  const guessed = classifyText(data.triggers, session.title);
  return guessed && data.products[guessed] ? guessed : null;
}

// Distinct, mid-saturation hues that read on both the light and dark sidebar.
const PALETTE = [
  "#3b82f6",
  "#10b981",
  "#f59e0b",
  "#ef4444",
  "#8b5cf6",
  "#ec4899",
  "#14b8a6",
  "#f97316",
];

export function colorForProduct(key: string, explicit?: string): string {
  if (explicit) return explicit;
  let h = 0;
  for (const ch of key) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return PALETTE[h % PALETTE.length];
}
