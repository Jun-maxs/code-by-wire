import { execFile } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { dirname, join } from "node:path";
import { promisify } from "node:util";
import {
  addDays,
  blankTask,
  dayKey,
  normalizeBrief,
  normalizeBriefTextKey,
  type BoardDoc,
  type BoardTask,
  type DailyBrief,
  type Priority,
  type TaskStatus,
} from "@shared/board";
import { parseProductCard, TOPIC_KEY_RE } from "@shared/products";

const execFileAsync = promisify(execFile);

const GIT_CACHE_TTL_MS = 45_000;
const DIGEST_WINDOW_DAYS = 21;

export interface PendingSeed {
  sourceKey: string;
  title: string;
  summary: string;
  topic: string | null;
  status: Exclude<TaskStatus, "done">;
  priority: Priority;
  due: string | null;
}

export interface BoardWorkbench {
  /** Merge newly discovered workbench pending items into `doc` (respecting `dismissedSyncKeys`). */
  syncTasks(doc: BoardDoc): { doc: BoardDoc; changed: boolean };
  /** Read recent auto-collected daily implementation briefs (`releases.jsonl` + git log cache). */
  readAutoBriefs(today?: string): DailyBrief[];
  /** Force an async refresh of the multi-repo git log cache (used by tests / manual refresh). */
  refreshGitCacheNow(): Promise<void>;
}

/** Repo-hygiene or outdated branch-chore lines in older cards that `drift_audit` already handles. */
const STALE_CARD_LINE_RE =
  /未提交|工作树|worktree|STATUS\.md\s*未更新|分支.*未合并|合并.*分支.*时机|版本是否更新到\s*0\.1\.[0-5]\d|已结清|暂无阻断/i;

/** Noisy commit subjects that are bookkeeping rather than user-meaningful implementations. */
const SKIP_COMMIT_SUBJECT_RE =
  /^(?:merge\b|wip:\s*封存|结果标签\s+\d{4}-\d{2}-\d{2}|docs(?:\/|\()status\)?:|docs:\s*(?:status\b|.*上线记录$|.*提交号更正$)|chore:\s*v?0\.\d+\.\d+$|\d+\.\d+\.\d+[：:]\s*版本号$)/i;

/** Conventional-commit prefix stripped for cleaner human reading in the daily digest. */
const CONVENTIONAL_PREFIX_RE =
  /^(?:feat|fix|perf|refactor|style|chore|docs|data|test|build|sync)(?:\(([^)]+)\))?!?:\s*/i;

function shortHash(input: string): string {
  let h = 2166136261;
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0).toString(36);
}

/** Turn a raw commit subject into a concise implementation brief, or null if bookkeeping noise. */
export function cleanCommitSubject(raw: string): string | null {
  const s = raw.trim().replace(/\s+/g, " ");
  if (!s || SKIP_COMMIT_SUBJECT_RE.test(s)) return null;
  let body = s;
  const m = CONVENTIONAL_PREFIX_RE.exec(body);
  if (m) {
    body = body.slice(m[0].length).trim();
  }
  if (SKIP_COMMIT_SUBJECT_RE.test(body)) return null;
  // Drop trailing pure doc-path parentheticals like `（docs/2026-11-11-...）`
  body = body.replace(/[（(]docs\/[0-9a-zA-Z/_.,\s\-—]+[）)]\s*$/u, "").trim();
  if (!body || body.length < 3) return null;
  return body.length > 160 ? `${body.slice(0, 159)}…` : body;
}

/** Map a repository path or recorded product field to a canonical topic key. */
export function resolveRepoTopic(
  repo: string,
  recordedProduct: string | null,
  repoMap: ReadonlyMap<string, string>,
): string | null {
  if (
    recordedProduct &&
    recordedProduct !== "unclassified" &&
    TOPIC_KEY_RE.test(recordedProduct)
  ) {
    return recordedProduct;
  }
  const norm = repo.replaceAll("\\", "/").replace(/\/+$/, "").toLowerCase();
  for (const [prefix, key] of repoMap.entries()) {
    if (
      norm === prefix ||
      norm.startsWith(`${prefix}/`) ||
      norm.startsWith(`${prefix}-`)
    ) {
      return key;
    }
  }
  if (norm.includes("/04.英语学习/ciyu") || norm.includes("/ciyu-"))
    return "ciyu";
  if (norm.includes("/06.max")) return "shiyu";
  if (norm.includes("/09.zhiyu")) return "zhiyu";
  if (norm.includes("/deeptutor") || norm.includes("/teach")) return "teach";
  if (norm.includes("/07.桌面整理")) return "desktidy";
  if (norm.includes("/webhub-nido")) return "nido";
  if (
    norm.includes("/code-by-wire") ||
    norm.includes("/cbw-wt-") ||
    norm.endsWith("/workbench")
  ) {
    return "cockpit";
  }
  if (norm.includes("/平台整合规划")) return "platform";
  return null;
}

/** Split a card bullet into a clean title + optional 1-line context summary. */
export function splitCardLine(raw: string): {
  title: string;
  summary: string;
  due: string | null;
} | null {
  let text = raw.trim();
  if (!text || STALE_CARD_LINE_RE.test(text)) return null;

  // Strip trailing citation stamps FIRST like `（2026-11-11）` or `（被额度中断，11-09）`
  // so citation dates are never mistaken for future deadlines.
  text = text
    .replace(/[（(][^（）()]{0,16}?(?:20\d{2}-)?\d{2}-\d{2}[）)]\s*$/u, "")
    .trim();
  if (!text || STALE_CARD_LINE_RE.test(text)) return null;

  let due: string | null = null;
  const dueMatch = /(?<![/\-.\w])(20\d{2}-\d{2}-\d{2})(?![/\-.\w])/.exec(text);
  if (dueMatch) due = dueMatch[1];

  // Split `标题：选项/详情` into crisp title + summary when descriptive
  const sep = text.indexOf("：");
  if (sep >= 4 && sep <= 28 && text.length > 18) {
    return {
      title: text.slice(0, sep).trim(),
      summary: text.slice(sep + 1).trim(),
      due,
    };
  }
  return {
    title: text.slice(0, 110),
    summary: text.length > 110 ? text.slice(110, 240) : "",
    due,
  };
}

function readJsonSafe(path: string): unknown {
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch {
    return null;
  }
}

interface CatalogTarget {
  repoMap: Map<string, string>;
  repos: { path: string; topic: string }[];
  statusFiles: { path: string; topic: string }[];
}

function discoverTargets(cardsDir: string): CatalogTarget {
  const repoMap = new Map<string, string>();
  const repoSeen = new Set<string>();
  const repos: { path: string; topic: string }[] = [];
  const statusFiles: { path: string; topic: string }[] = [];
  const statusSeen = new Set<string>();

  const addRepo = (rawPath: string, topic: string) => {
    const clean = rawPath.trim();
    if (!clean) return;
    const norm = clean.replaceAll("\\", "/").replace(/\/+$/, "").toLowerCase();
    if (!repoMap.has(norm)) repoMap.set(norm, topic);
    if (!repoSeen.has(norm) && existsSync(join(clean, ".git"))) {
      repoSeen.add(norm);
      repos.push({ path: clean, topic });
    }
  };

  const addStatus = (rawPath: string, topic: string) => {
    const clean = rawPath.trim();
    if (!clean) return;
    const norm = clean.replaceAll("\\", "/").toLowerCase();
    if (!statusSeen.has(norm) && existsSync(clean)) {
      statusSeen.add(norm);
      statusFiles.push({ path: clean, topic });
    }
  };

  const sources = readJsonSafe(join(cardsDir, "sources.json")) as {
    products?: Record<string, { status?: unknown; repos?: unknown }>;
  } | null;
  for (const [key, item] of Object.entries(sources?.products ?? {})) {
    if (!TOPIC_KEY_RE.test(key) || !item || typeof item !== "object") continue;
    if (typeof item.status === "string") addStatus(item.status, key);
    if (Array.isArray(item.repos)) {
      for (const r of item.repos) if (typeof r === "string") addRepo(r, key);
    }
  }

  const wbRoot = join(cardsDir, "..");
  const catalog = readJsonSafe(join(wbRoot, "products.json")) as {
    products?: Record<
      string,
      { status?: unknown; status_path?: unknown; git_repos?: unknown }
    >;
  } | null;
  for (const [key, item] of Object.entries(catalog?.products ?? {})) {
    if (!TOPIC_KEY_RE.test(key) || !item || typeof item !== "object") continue;
    const st = typeof item.status === "string" ? item.status : "";
    if (/冻结|不算产品线/.test(st)) continue;
    if (typeof item.status_path === "string" && item.status_path) {
      addStatus(item.status_path, key);
      addRepo(dirname(item.status_path), key);
    }
    if (Array.isArray(item.git_repos)) {
      for (const r of item.git_repos)
        if (typeof r === "string") addRepo(r, key);
    }
  }

  // Also include active sibling worktrees when on the user's machine (read-only git log).
  const extraCandidates: [string, string][] = [
    [wbRoot, "cockpit"],
    ["E:/0项目/开发临时用/cbw-wt-jun", "cockpit"],
    ["E:/0项目/04.英语学习/ciyu-wcj", "ciyu"],
  ];
  for (const [candidate, topic] of extraCandidates) {
    if (existsSync(join(candidate, ".git"))) addRepo(candidate, topic);
  }

  return { repoMap, repos, statusFiles };
}

/** Extract dated milestones / explicit action items from `STATUS.md` `## 下一步`. */
export function parseStatusNextSteps(md: string, topic: string): PendingSeed[] {
  const out: PendingSeed[] = [];
  let inNext = false;
  for (const raw of md.split(/\r?\n/)) {
    const h = /^##\s+(.+?)\s*$/.exec(raw);
    if (h) {
      inNext = h[1].startsWith("下一步");
      continue;
    }
    if (!inNext) continue;
    const line = raw
      .trim()
      .replace(/^[-*]\s+|^\d+\.\s+/, "")
      .trim();
    if (!line || /^(?:无|暂无|—|-)$/.test(line)) continue;
    if (STALE_CARD_LINE_RE.test(line)) continue;
    // Only pull concrete dated milestones or explicit user confirmation items from STATUS.md
    // so routine developer backlog notes don't flood the queue.
    const dueMatch = /(?<![/\-.\w])(20\d{2}-\d{2}-\d{2})(?![/\-.\w])/.exec(
      line,
    );
    const isDecision = /待用户|待拍板|待确认/.test(line);
    if (!dueMatch && !isDecision) continue;
    const cleaned = line.replace(/^20\d{2}-\d{2}-\d{2}\s*/, "").trim();
    const split = splitCardLine(cleaned || line);
    if (!split) continue;
    out.push({
      sourceKey: `wb:status:${topic}:${shortHash(split.title)}`,
      title: split.title,
      summary: split.summary,
      topic,
      status: isDecision ? "decide" : "todo",
      priority: "P1",
      due: dueMatch ? dueMatch[1] : split.due,
    });
  }
  return out;
}

export function collectPendingSeeds(cardsDir: string): PendingSeed[] {
  if (!cardsDir || !existsSync(cardsDir)) return [];
  const seeds: PendingSeed[] = [];
  const seenKeys = new Set<string>();
  const push = (seed: PendingSeed) => {
    if (seenKeys.has(seed.sourceKey)) return;
    seenKeys.add(seed.sourceKey);
    seeds.push(seed);
  };

  let files: string[];
  try {
    files = readdirSync(cardsDir);
  } catch {
    files = [];
  }
  for (const name of files) {
    const m = /^([a-z0-9_-]+)\.md$/.exec(name);
    if (!m) continue;
    const topic = m[1];
    let md: string;
    try {
      md = readFileSync(join(cardsDir, name), "utf8");
    } catch {
      continue;
    }
    const card = parseProductCard(topic, md);
    for (const raw of card.decide) {
      const split = splitCardLine(raw);
      if (!split) continue;
      push({
        sourceKey: `wb:card:${topic}:decide:${shortHash(split.title)}`,
        title: split.title,
        summary: split.summary,
        topic,
        status: "decide",
        priority: "P1",
        due: split.due,
      });
    }
    for (const raw of card.loose) {
      const split = splitCardLine(raw);
      if (!split) continue;
      push({
        sourceKey: `wb:card:${topic}:todo:${shortHash(split.title)}`,
        title: split.title,
        summary: split.summary,
        topic,
        status: "todo",
        priority: "P1",
        due: split.due,
      });
    }
  }

  const { statusFiles } = discoverTargets(cardsDir);
  for (const sf of statusFiles) {
    try {
      const md = readFileSync(sf.path, "utf8");
      for (const seed of parseStatusNextSteps(md, sf.topic)) push(seed);
    } catch {
      continue;
    }
  }

  return seeds;
}

export function parseReleasesJsonl(
  text: string,
  cutoffDay: string,
  repoMap: ReadonlyMap<string, string>,
): DailyBrief[] {
  const out: DailyBrief[] = [];
  for (const line of text.split(/\r?\n/)) {
    if (!line.trim()) continue;
    let row: Record<string, unknown>;
    try {
      const parsed: unknown = JSON.parse(line);
      if (!parsed || typeof parsed !== "object") continue;
      row = parsed as Record<string, unknown>;
    } catch {
      continue;
    }
    const ts = typeof row.ts === "string" ? row.ts : "";
    const dateMatch = /^(\d{4}-\d{2}-\d{2})/.exec(ts);
    if (!dateMatch) continue;
    const date = dateMatch[1];
    if (date < cutoffDay) continue;

    const rawSubject = typeof row.subject === "string" ? row.subject : "";
    const cleaned = cleanCommitSubject(rawSubject);
    if (!cleaned) continue;

    const repo = typeof row.repo === "string" ? row.repo : "";
    const prod = typeof row.product === "string" ? row.product : null;
    const topic = resolveRepoTopic(repo, prod, repoMap);
    const kind = row.kind === "deploy" ? "deploy" : "commit";
    const sha = typeof row.ref === "string" ? row.ref.slice(0, 8) : null;
    const target =
      typeof row.target === "string" && row.target.trim()
        ? row.target.trim()
        : null;
    const ref = kind === "deploy" ? (target ?? sha) : sha;
    const createdAt = Number.isFinite(Date.parse(ts))
      ? Date.parse(ts)
      : Date.now();
    const syncKey = `wb:rel:${kind}:${topic ?? "none"}:${sha ?? shortHash(cleaned + date)}`;
    out.push({
      id: syncKey,
      date,
      topic,
      text: cleaned,
      source: kind,
      ref,
      sessionId: null,
      taskId: null,
      syncKey,
      createdAt,
    });
  }
  return out;
}

export function createBoardWorkbench(deps: {
  userDataDir: string;
  cardsDir: string;
  syncGit?: boolean;
}): BoardWorkbench {
  const gitCacheFile = join(deps.userDataDir, "board-git-cache.json");
  let releasesCache: {
    mtimeMs: number;
    cutoff: string;
    items: DailyBrief[];
  } | null = null;
  let gitMemCache: {
    mtimeMs: number;
    updatedAt: number;
    items: DailyBrief[];
  } | null = null;
  let seedsCache: { at: number; seeds: PendingSeed[] } | null = null;
  let refreshing = false;

  function readGitCacheSync(): { updatedAt: number; items: DailyBrief[] } {
    let mtimeMs: number;
    try {
      mtimeMs = statSync(gitCacheFile).mtimeMs;
    } catch {
      return { updatedAt: 0, items: [] };
    }
    if (gitMemCache && gitMemCache.mtimeMs === mtimeMs) {
      return { updatedAt: gitMemCache.updatedAt, items: gitMemCache.items };
    }
    const raw = readJsonSafe(gitCacheFile) as {
      updatedAt?: unknown;
      items?: unknown;
    } | null;
    const updatedAt = typeof raw?.updatedAt === "number" ? raw.updatedAt : 0;
    const items = Array.isArray(raw?.items)
      ? raw.items
          .filter(
            (x): x is Record<string, unknown> => !!x && typeof x === "object",
          )
          .map(normalizeBrief)
          .filter((x): x is DailyBrief => x !== null)
      : [];
    gitMemCache = { mtimeMs, updatedAt, items };
    return { updatedAt, items };
  }

  async function refreshGitCacheNow(): Promise<void> {
    if (refreshing || !deps.cardsDir || !existsSync(deps.cardsDir)) return;
    refreshing = true;
    try {
      const { repos } = discoverTargets(deps.cardsDir);
      const items: DailyBrief[] = [];
      await Promise.all(
        repos.map(async ({ path, topic }) => {
          try {
            const { stdout } = await execFileAsync(
              "git",
              [
                "log",
                `--since=${DIGEST_WINDOW_DAYS}.days`,
                "--no-merges",
                "--date=short",
                "--format=%h%x09%ct%x09%ad%x09%s",
                "-n",
                "45",
              ],
              {
                cwd: path,
                windowsHide: true,
                timeout: 6000,
                maxBuffer: 512 * 1024,
              },
            );
            for (const line of stdout.split(/\r?\n/)) {
              if (!line.trim()) continue;
              const [sha, epochSec, ad, ...rest] = line.split("\t");
              const rawSubject = rest.join("\t");
              if (!sha || !ad || !/^\d{4}-\d{2}-\d{2}$/.test(ad)) continue;
              const cleaned = cleanCommitSubject(rawSubject);
              if (!cleaned) continue;
              const createdAt = (Number(epochSec) || 0) * 1000;
              const syncKey = `wb:git:${topic}:${sha.slice(0, 8)}`;
              items.push({
                id: syncKey,
                date: ad,
                topic,
                text: cleaned,
                source: "commit",
                ref: sha.slice(0, 8),
                sessionId: null,
                taskId: null,
                syncKey,
                createdAt,
              });
            }
          } catch {
            // Skip unreadable or non-git directories gracefully.
          }
        }),
      );
      mkdirSync(deps.userDataDir, { recursive: true });
      const payload = { updatedAt: Date.now(), items };
      writeFileSync(gitCacheFile, JSON.stringify(payload) + "\n", "utf8");
      gitMemCache = null;
    } finally {
      refreshing = false;
    }
  }

  function readReleasesSync(cutoffDay: string): DailyBrief[] {
    if (!deps.cardsDir || !existsSync(deps.cardsDir)) return [];
    const releasesFile = join(deps.cardsDir, "..", "data", "releases.jsonl");
    let mtimeMs: number;
    try {
      mtimeMs = statSync(releasesFile).mtimeMs;
    } catch {
      return [];
    }
    if (
      releasesCache &&
      releasesCache.mtimeMs === mtimeMs &&
      releasesCache.cutoff === cutoffDay
    ) {
      return releasesCache.items;
    }
    try {
      const text = readFileSync(releasesFile, "utf8");
      const { repoMap } = discoverTargets(deps.cardsDir);
      const items = parseReleasesJsonl(text, cutoffDay, repoMap);
      releasesCache = { mtimeMs, cutoff: cutoffDay, items };
      return items;
    } catch {
      return [];
    }
  }

  function readAutoBriefs(today = dayKey(new Date())): DailyBrief[] {
    if (!deps.cardsDir || !existsSync(deps.cardsDir)) return [];
    const cutoff = addDays(today, -(DIGEST_WINDOW_DAYS - 1));
    const rels = readReleasesSync(cutoff);
    const git = readGitCacheSync();
    if (
      deps.syncGit !== false &&
      Date.now() - git.updatedAt > GIT_CACHE_TTL_MS
    ) {
      void refreshGitCacheNow();
    }
    // Combine releases (deploys + hook commits) with git-log commits, preferring deploys over commits.
    const all = [...rels, ...git.items.filter((x) => x.date >= cutoff)];
    all.sort((a, b) => {
      if (a.date !== b.date) return a.date > b.date ? -1 : 1;
      if (a.source !== b.source)
        return a.source === "deploy" ? -1 : b.source === "deploy" ? 1 : 0;
      return b.createdAt - a.createdAt;
    });

    const seenSha = new Set<string>();
    const seenText = new Set<string>();
    const deduped: DailyBrief[] = [];
    for (const item of all) {
      const shaKey =
        item.source === "commit" && item.ref
          ? `${item.topic ?? ""}\u0000${item.ref}`
          : null;
      if (shaKey && seenSha.has(shaKey)) continue;
      const textKey = `${item.date}\u0000${item.topic ?? ""}\u0000${normalizeBriefTextKey(item.text)}`;
      if (seenText.has(textKey)) continue;
      if (shaKey) seenSha.add(shaKey);
      seenText.add(textKey);
      deduped.push(item);
    }
    return deduped;
  }

  function syncTasks(doc: BoardDoc): { doc: BoardDoc; changed: boolean } {
    if (!deps.cardsDir || !existsSync(deps.cardsDir)) {
      return { doc, changed: false };
    }
    const now = Date.now();
    if (!seedsCache || now - seedsCache.at > 15_000) {
      seedsCache = { at: now, seeds: collectPendingSeeds(deps.cardsDir) };
    }
    if (seedsCache.seeds.length === 0) return { doc, changed: false };

    const dismissed = new Set(doc.dismissedSyncKeys);
    const existingKeys = new Set(
      doc.tasks.map((t) => t.sourceKey).filter((k): k is string => !!k),
    );
    const existingTitles = new Set(
      doc.tasks.map(
        (t) => `${t.topic ?? ""}\u0000${normalizeBriefTextKey(t.title)}`,
      ),
    );

    const added: BoardTask[] = [];
    let workingDoc = doc;
    for (const seed of seedsCache.seeds) {
      if (dismissed.has(seed.sourceKey) || existingKeys.has(seed.sourceKey)) {
        continue;
      }
      const titleKey = `${seed.topic ?? ""}\u0000${normalizeBriefTextKey(seed.title)}`;
      if (existingTitles.has(titleKey)) continue;
      existingKeys.add(seed.sourceKey);
      existingTitles.add(titleKey);
      const task = blankTask(workingDoc, seed.title, {
        summary: seed.summary,
        sourceKey: seed.sourceKey,
        topic: seed.topic,
        status: seed.status,
        priority: seed.priority,
        due: seed.due,
      });
      added.push(task);
      workingDoc = { ...workingDoc, tasks: [...workingDoc.tasks, task] };
    }

    if (added.length === 0) return { doc, changed: false };
    return { doc: workingDoc, changed: true };
  }

  return {
    syncTasks,
    readAutoBriefs,
    refreshGitCacheNow,
  };
}
