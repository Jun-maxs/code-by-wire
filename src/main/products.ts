import { spawn } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  renameSync,
  statSync,
  writeFileSync,
  appendFileSync,
} from "node:fs";
import { join } from "node:path";
import {
  colorForProduct,
  parseProductCard,
  TOPIC_KEY_RE,
  type CardRun,
  type ProductInfo,
  type ProductTrigger,
  type ProductsData,
  type TopicInput,
} from "@shared/products";

/**
 * Read the workbench's product cards for the sidebar's product tags (see `@shared/products`), and
 * edit its topics from Settings → Topics.
 *
 * Layout (owned by the workbench):
 * - `<cardsDir>/triggers.json` — `{ products: { <key>: { include: [...], exclude: [...] } } }`
 * - `<cardsDir>/sources.json` — `{ products: { <key>: { name, color?, repos?, ... } } }` (optional)
 * - `<cardsDir>/<key>.md` — one product card per product
 * - `<dataDir>/state/<sessionId>.json` — the hook's per-session state; `session_product` (or the
 *   first of `cards`) is the product that session is about
 * - `<dataDir>/session-products.jsonl` — durable session → product records (outlive the state file,
 *   which the hook deletes at SessionEnd); `manual` rows are this app's 归到主题
 * - `<dataDir>/session-titles.jsonl` — the hook's short task titles
 *
 * Returns null when the cards dir is missing, so the sidebar simply renders untagged. Anything
 * unreadable degrades to "no tag" for that item rather than failing the whole read.
 */
export function readProducts(
  cardsDir: string,
  stateDir: string,
): ProductsData | null {
  if (!cardsDir || !existsSync(cardsDir)) return null;
  const triggers = readTriggers(join(cardsDir, "triggers.json"));
  const sources = readSources(join(cardsDir, "sources.json"));
  const products: ProductsData["products"] = {};
  for (const name of safeList(cardsDir)) {
    const m = /^([a-z0-9_-]+)\.md$/.exec(name);
    if (!m) continue; // CARD_SPEC.md and other uppercase docs are not cards
    const key = m[1];
    try {
      const path = join(cardsDir, name);
      const md = readFileSync(path, "utf8");
      products[key] = {
        ...parseProductCard(key, md, sources[key]?.color),
        hasCard: true,
        keywords: [],
        repos: sources[key]?.repos ?? [],
        updatedAt: statSync(path).mtimeMs,
      };
    } catch {
      continue;
    }
  }
  // Topics with trigger words but no card yet still tag sessions (named from sources.json).
  for (const t of triggers) {
    const known = products[t.key];
    if (known) {
      known.keywords = t.include;
      continue;
    }
    products[t.key] = bareTopic(t.key, sources[t.key], t.include);
  }
  for (const [key, src] of Object.entries(sources))
    products[key] ??= bareTopic(key, src, []);
  const dataDir = join(stateDir, "..");
  return {
    products,
    bySession: {
      ...readSessionProducts(stateDir),
      ...readRecordedProducts(join(dataDir, "session-products.jsonl")),
    },
    triggers,
    titles: readTitles(join(dataDir, "session-titles.jsonl")),
    runs: Object.fromEntries(runs),
  };
}

interface Source {
  name?: string;
  color?: string;
  repos?: string[];
}

function bareTopic(
  key: string,
  src: Source | undefined,
  keywords: string[],
): ProductInfo {
  return {
    key,
    name: src?.name ?? key,
    color: colorForProduct(key, src?.color),
    domains: [],
    loose: [],
    decide: [],
    hasCard: false,
    keywords,
    repos: src?.repos ?? [],
    updatedAt: null,
  };
}

function safeList(dir: string): string[] {
  try {
    return readdirSync(dir);
  } catch {
    return [];
  }
}

function readJson(path: string): unknown {
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch {
    return null;
  }
}

function readLines(path: string): unknown[] {
  let text: string;
  try {
    text = readFileSync(path, "utf8");
  } catch {
    return [];
  }
  const out: unknown[] = [];
  for (const line of text.split(/\r?\n/)) {
    if (!line.trim()) continue;
    try {
      out.push(JSON.parse(line));
    } catch {
      continue;
    }
  }
  return out;
}

function readTriggers(path: string): ProductTrigger[] {
  const raw = readJson(path) as {
    products?: Record<string, { include?: string[]; exclude?: string[] }>;
  } | null;
  return Object.entries(raw?.products ?? {}).map(([key, v]) => ({
    key,
    include: Array.isArray(v.include) ? v.include : [],
    exclude: Array.isArray(v.exclude) ? v.exclude : [],
  }));
}

function readSources(path: string): Record<string, Source> {
  const raw = readJson(path) as {
    products?: Record<string, Source>;
  } | null;
  const out: Record<string, Source> = {};
  for (const [key, v] of Object.entries(raw?.products ?? {})) {
    if (!v || typeof v !== "object") continue;
    out[key] = {
      name: typeof v.name === "string" ? v.name : undefined,
      color: typeof v.color === "string" ? v.color : undefined,
      repos: Array.isArray(v.repos)
        ? v.repos.filter((r) => typeof r === "string")
        : undefined,
    };
  }
  return out;
}

function readSessionProducts(stateDir: string): Record<string, string> {
  const out: Record<string, string> = {};
  if (!stateDir) return out;
  for (const name of safeList(stateDir)) {
    if (!name.endsWith(".json")) continue;
    const raw = readJson(join(stateDir, name)) as {
      session_product?: unknown;
      current_product?: unknown;
      cards?: unknown;
    } | null;
    const key =
      typeof raw?.current_product === "string"
        ? raw.current_product
        : typeof raw?.session_product === "string"
          ? raw.session_product
          : Array.isArray(raw?.cards) && typeof raw.cards[0] === "string"
            ? raw.cards[0]
            : null;
    if (key) out[name.slice(0, -".json".length)] = key;
  }
  return out;
}

// Same ranking as the workbench's wbcore.session_products: manual > prompt > scan, last one wins
// within a rank.
const RANK: Record<string, number> = { scan: 0, prompt: 1, manual: 2 };

function readRecordedProducts(path: string): Record<string, string> {
  const best: Record<string, { key: string; rank: number }> = {};
  for (const row of readLines(path)) {
    const r = row as { sid?: unknown; product?: unknown; by?: unknown };
    if (typeof r.sid !== "string" || typeof r.product !== "string") continue;
    const rank = RANK[typeof r.by === "string" ? r.by : "scan"] ?? 0;
    const old = best[r.sid];
    if (!old || rank >= old.rank) best[r.sid] = { key: r.product, rank };
  }
  return Object.fromEntries(
    Object.entries(best).map(([sid, v]) => [sid, v.key]),
  );
}

function readTitles(path: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const row of readLines(path)) {
    const r = row as { sid?: unknown; title?: unknown };
    if (typeof r.sid === "string" && typeof r.title === "string" && r.title)
      out[r.sid] = r.title;
  }
  return out;
}

/** Just the task titles, cached by file mtime: the session overview reads them on every poll. */
let titleCache: {
  path: string;
  mtime: number;
  titles: Record<string, string>;
} | null = null;
export function readTaskTitles(dataDir: string): Record<string, string> {
  const path = join(dataDir, "session-titles.jsonl");
  let mtime: number;
  try {
    mtime = statSync(path).mtimeMs;
  } catch {
    return {};
  }
  if (titleCache?.path !== path || titleCache.mtime !== mtime)
    titleCache = { path, mtime, titles: readTitles(path) };
  return titleCache.titles;
}

export function readCard(cardsDir: string, key: string): string | null {
  if (!TOPIC_KEY_RE.test(key)) return null;
  try {
    return readFileSync(join(cardsDir, `${key}.md`), "utf8");
  } catch {
    return null;
  }
}

/** Read a JSON file the workbench owns, change it, write it back (keeping the fields we don't know). */
function editJson(path: string, edit: (doc: Record<string, unknown>) => void) {
  const doc = (readJson(path) as Record<string, unknown> | null) ?? {
    v: 1,
    products: {},
  };
  if (!doc.products || typeof doc.products !== "object") doc.products = {};
  edit(doc);
  writeFileSync(path, JSON.stringify(doc, null, 2) + "\n", "utf8");
}

export function saveTopic(cardsDir: string, topic: TopicInput): void {
  if (!TOPIC_KEY_RE.test(topic.key)) throw new Error("bad topic key");
  const keywords = topic.keywords.map((k) => k.trim()).filter(Boolean);
  editJson(join(cardsDir, "triggers.json"), (doc) => {
    const products = doc.products as Record<string, Record<string, unknown>>;
    products[topic.key] = {
      ...products[topic.key],
      include: keywords,
      exclude: products[topic.key]?.exclude ?? [],
    };
  });
  editJson(join(cardsDir, "sources.json"), (doc) => {
    const products = doc.products as Record<string, Record<string, unknown>>;
    const old = products[topic.key] ?? {};
    products[topic.key] = {
      status: null,
      memory: [],
      ...old,
      name: topic.name.trim() || topic.key,
      color: topic.color,
      repos: topic.repos.map((r) => r.trim()).filter(Boolean),
    };
  });
}

/** Drop the topic from the trigger and source lists; its card moves to `cards/.trash/` (not deleted). */
export function deleteTopic(cardsDir: string, key: string): void {
  if (!TOPIC_KEY_RE.test(key)) throw new Error("bad topic key");
  for (const file of ["triggers.json", "sources.json"])
    editJson(join(cardsDir, file), (doc) => {
      delete (doc.products as Record<string, unknown>)[key];
    });
  const card = join(cardsDir, `${key}.md`);
  if (existsSync(card)) {
    const trash = join(cardsDir, ".trash");
    mkdirSync(trash, { recursive: true });
    renameSync(card, join(trash, `${key}-${Date.now()}.md`));
  }
}

/** Put a session under a topic by hand ("" = no topic). Wins over the hook's and the scan's guesses. */
export function assignSession(dataDir: string, sid: string, key: string): void {
  mkdirSync(dataDir, { recursive: true });
  const row = {
    sid,
    product: key,
    by: "manual",
    ts: new Date().toISOString(),
  };
  appendFileSync(
    join(dataDir, "session-products.jsonl"),
    JSON.stringify(row) + "\n",
    "utf8",
  );
}

const runs = new Map<string, CardRun>();

/**
 * Write the topic's card now: the workbench's refresh_cards.py for just this topic (Sonnet reads the
 * topic's recent sessions, git log and memories). Runs in the background; `readProducts().runs`
 * reports progress, and the card file appears when it passes the generator's checks.
 */
export function generateCard(
  cardsDir: string,
  key: string,
  python = process.env.CBW_PYTHON ?? "python",
): CardRun {
  if (!TOPIC_KEY_RE.test(key)) throw new Error("bad topic key");
  const running = runs.get(key);
  if (running && running.ok === null) return running;
  const run: CardRun = {
    key,
    startedAt: Date.now(),
    ok: null,
    message: "",
  };
  runs.set(key, run);
  const wbRoot = join(cardsDir, "..");
  const script = join(wbRoot, "bin", "refresh_cards.py");
  const done = (ok: boolean, fallback: string) => {
    const lines = logLinesFor(
      join(wbRoot, "data", "cards.log"),
      key,
      run.startedAt,
    );
    run.ok = ok && !lines.some((l) => /失败|没过检查|跳过|还在跑/.test(l));
    run.message = lines.join("\n") || fallback;
  };
  try {
    const child = spawn(
      python,
      [
        "-X",
        "utf8",
        script,
        "--only",
        key,
        "--force",
        "--no-upload",
        "--quiet",
      ],
      { cwd: wbRoot, windowsHide: true, stdio: "ignore" },
    );
    child.on("error", (err) => done(false, String(err)));
    child.on("exit", (code) => done(code === 0, `exit ${code}`));
  } catch (err) {
    done(false, String(err));
  }
  return run;
}

/** The generator's log lines since `since` that mention this topic or are run-wide notices. */
function logLinesFor(path: string, key: string, since: number): string[] {
  let text: string;
  try {
    text = readFileSync(path, "utf8");
  } catch {
    return [];
  }
  const out: string[] = [];
  for (const line of text.split(/\r?\n/).slice(-200)) {
    const m = /^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}) (.*)$/.exec(line);
    if (!m || new Date(m[1]).getTime() < since - 2000) continue;
    if (m[2].startsWith(`${key}:`)) out.push(m[2].slice(key.length + 1).trim());
    else if (/还在跑/.test(m[2])) out.push(m[2]);
  }
  return out.slice(-4);
}
