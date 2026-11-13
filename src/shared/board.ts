/**
 * The work board (fork feature, 2026-10-28; refactored 2026-11-13):
 * focused on two things that need zero manual bookkeeping:
 *   1. Pending confirmations & queued execution tasks (`decide` / `doing` / `todo`), linked to live
 *      agent sessions and auto-synced with workbench product cards / STATUS milestones.
 *   2. Daily implementation digest (`dailyLog` + runtime `autoBriefs` from git commits, releases,
 *      and completed tasks), grouped by calendar day with one-click Markdown export.
 *
 * Persisted as `board.json` under userData. Legacy fields (`ideas`, `habits`, `estimateH`,
 * `capacityH`, `weekends`) remain normalized so older `board.json` files never lose data.
 */

export type TaskStatus = "todo" | "doing" | "decide" | "done";
export type Priority = "P0" | "P1" | "P2";

export const TASK_STATUSES: TaskStatus[] = ["todo", "doing", "decide", "done"];
export const PRIORITIES: Priority[] = ["P0", "P1", "P2"];

export interface Subtask {
  id: string;
  text: string;
  done: boolean;
}

export interface BoardTask {
  id: string;
  title: string;
  status: TaskStatus;
  priority: Priority;
  /** Product/topic key from the workbench cards, or null. */
  topic: string | null;
  tags: string[];
  /** One-line decision context (when `decide`) or implementation summary (when completed). */
  summary: string;
  /** Stable key for deduplicating items synced from workbench cards / STATUS.md, or null. */
  sourceKey: string | null;
  /** Legacy estimated hours (preserved for backward compatibility). */
  estimateH: number;
  /** Deadline, local `YYYY-MM-DD`. */
  due: string | null;
  /** Legacy planned date, local `YYYY-MM-DD`. */
  plannedDate: string | null;
  subtasks: Subtask[];
  /** Agent sessions working on this task. */
  sessionIds: string[];
  notes: string;
  createdAt: number;
  doneAt: number | null;
  /** Sort key inside a group (smaller first). */
  order: number;
}

export type BriefSource = "task" | "commit" | "deploy" | "session" | "manual";

export const BRIEF_SOURCES: BriefSource[] = [
  "task",
  "commit",
  "deploy",
  "session",
  "manual",
];

export interface DailyBrief {
  id: string;
  /** Local calendar day `YYYY-MM-DD`. */
  date: string;
  /** Product/topic key, or null. */
  topic: string | null;
  /** Concise one-line implementation summary. */
  text: string;
  source: BriefSource;
  /** Optional git short SHA or deployment target (e.g. `4a937cf` or `max.yuanhk.top`). */
  ref: string | null;
  /** Linked agent session id, if any. */
  sessionId: string | null;
  /** Originating board task id when `source === "task"`. */
  taskId: string | null;
  /** Stable key used to override or dismiss an auto-synced commit/release entry. */
  syncKey: string | null;
  createdAt: number;
}

export interface Idea {
  id: string;
  text: string;
  topic: string | null;
  createdAt: number;
  /** Set once the idea was turned into a task. */
  taskId: string | null;
}

export interface Habit {
  id: string;
  name: string;
  /** Planned minutes per day (0 = just a check). */
  minutes: number;
  /** Days checked off, local `YYYY-MM-DD`. */
  days: string[];
  createdAt: number;
}

export type RiskLevel = "high" | "mid" | "low";

export interface InsightRisk {
  level: RiskLevel;
  title: string;
  detail: string;
  action: string;
}

export interface Insight {
  at: number;
  trigger: "manual" | "auto";
  /** 0–100. */
  score: number;
  headline: string;
  summary: string;
  good: string[];
  risks: InsightRisk[];
  suggestions: { tag: string; title: string; detail: string }[];
}

/** Which model writes the insight: the Claude CLI (rec) or any OpenAI-compatible endpoint
 *  (local Ollama, the yuanjp gateway, …). The key stays in userData/board.json on this machine. */
export interface BoardAi {
  provider: "claude" | "openai";
  /** `--model` for the Claude CLI: an alias (haiku/sonnet/opus) or a full id. */
  claudeModel: string;
  /** e.g. http://127.0.0.1:11434/v1 */
  baseUrl: string;
  apiKey: string;
  model: string;
}

export interface AiTestResult {
  ok: boolean;
  message: string;
  ms: number;
}

export const DEFAULT_AI: BoardAi = {
  provider: "claude",
  claudeModel: "haiku",
  baseUrl: "",
  apiKey: "",
  model: "",
};

export function normalizeAi(v: unknown): BoardAi {
  const r = (v && typeof v === "object" ? v : {}) as Record<string, unknown>;
  const s = (x: unknown) => (typeof x === "string" ? x.trim() : "");
  return {
    provider: r.provider === "openai" ? "openai" : "claude",
    claudeModel: s(r.claudeModel) || DEFAULT_AI.claudeModel,
    baseUrl: s(r.baseUrl),
    apiKey: s(r.apiKey),
    model: s(r.model),
  };
}

/** Short label for the model in use: "Claude CLI · haiku" or "qwen2.5:7b · 127.0.0.1:11434". */
export function aiLabel(ai: BoardAi): string {
  if (ai.provider === "claude") return `Claude CLI · ${ai.claudeModel}`;
  let host = ai.baseUrl;
  try {
    host = new URL(ai.baseUrl).host;
  } catch {
    // keep the raw text
  }
  return `${ai.model || "?"} · ${host || "?"}`;
}

export interface BoardDoc {
  version: 1;
  tasks: BoardTask[];
  /** Persisted daily implementation briefs (task completions, manual jots, user edits). */
  dailyLog: DailyBrief[];
  /** Sync keys (`sourceKey` / `syncKey`) dismissed by the user so auto-sync never re-adds them. */
  dismissedSyncKeys: string[];
  /** Runtime-merged auto-synced commit/deploy briefs from workbench & git (not written to board.json). */
  autoBriefs?: DailyBrief[];
  ideas: Idea[];
  habits: Habit[];
  /** Newest first, at most {@link MAX_INSIGHTS}. */
  insights: Insight[];
  /** Legacy hours of task work per working day. */
  capacityH: number;
  /** Legacy weekend workday toggle. */
  weekends: boolean;
  /** Local hour the daily insight runs (while the app is open); null turns it off. */
  insightHour: number | null;
  ai: BoardAi;
}

export const MAX_INSIGHTS = 30;
export const MAX_DAILY_LOG = 1000;
export const MAX_DISMISSED_KEYS = 2000;

export function emptyBoard(): BoardDoc {
  return {
    version: 1,
    tasks: [],
    dailyLog: [],
    dismissedSyncKeys: [],
    ideas: [],
    habits: [],
    insights: [],
    capacityH: 6,
    weekends: false,
    insightHour: 21,
    ai: { ...DEFAULT_AI },
  };
}

export function newId(): string {
  return Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
}

/** A new task at the end of its group. */
export function blankTask(
  doc: BoardDoc,
  title: string,
  patch: Partial<BoardTask> = {},
): BoardTask {
  return {
    id: newId(),
    title,
    status: "todo",
    priority: "P1",
    topic: null,
    tags: [],
    summary: "",
    sourceKey: null,
    estimateH: 0,
    due: null,
    plannedDate: null,
    subtasks: [],
    sessionIds: [],
    notes: "",
    createdAt: Date.now(),
    doneAt: null,
    order: Math.max(0, ...doc.tasks.map((t) => t.order)) + 1,
    ...patch,
  };
}

/** A new daily implementation brief. */
export function blankBrief(
  date: string,
  text: string,
  patch: Partial<DailyBrief> = {},
): DailyBrief {
  return {
    id: newId(),
    date,
    topic: null,
    text: text.trim(),
    source: "manual",
    ref: null,
    sessionId: null,
    taskId: null,
    syncKey: null,
    createdAt: Date.now(),
    ...patch,
  };
}

// ---------------------------------------------------------------------------------------------
// Sanitizing (a hand-edited or older file must never crash the board)

const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;

function str(v: unknown, fallback = ""): string {
  return typeof v === "string" ? v : fallback;
}
function num(v: unknown, fallback = 0): number {
  return typeof v === "number" && Number.isFinite(v) ? v : fallback;
}
function day(v: unknown): string | null {
  return typeof v === "string" && DAY_RE.test(v) ? v : null;
}
function strs(v: unknown): string[] {
  return Array.isArray(v)
    ? v.filter((x): x is string => typeof x === "string")
    : [];
}
function arr(v: unknown): Record<string, unknown>[] {
  return Array.isArray(v)
    ? v.filter(
        (x): x is Record<string, unknown> => !!x && typeof x === "object",
      )
    : [];
}
function oneOf<T extends string>(v: unknown, all: readonly T[], d: T): T {
  return all.includes(v as T) ? (v as T) : d;
}

export function normalizeBrief(
  raw: Record<string, unknown>,
): DailyBrief | null {
  const date = day(raw.date);
  const text = str(raw.text).trim();
  if (!date || !text) return null;
  return {
    id: str(raw.id) || newId(),
    date,
    topic: str(raw.topic) || null,
    text,
    source: oneOf(raw.source, BRIEF_SOURCES, "manual"),
    ref: str(raw.ref) || null,
    sessionId: str(raw.sessionId) || null,
    taskId: str(raw.taskId) || null,
    syncKey: str(raw.syncKey) || null,
    createdAt: num(raw.createdAt, Date.now()),
  };
}

export function normalizeBoard(raw: unknown): BoardDoc {
  const base = emptyBoard();
  if (!raw || typeof raw !== "object") return base;
  const r = raw as Record<string, unknown>;
  const tasks: BoardTask[] = arr(r.tasks).map((t, i) => ({
    id: str(t.id) || newId(),
    title: str(t.title),
    status: oneOf(t.status, TASK_STATUSES, "todo"),
    priority: oneOf(t.priority, PRIORITIES, "P1"),
    topic: str(t.topic) || null,
    tags: strs(t.tags),
    summary: str(t.summary),
    sourceKey: str(t.sourceKey) || null,
    estimateH: Math.max(0, num(t.estimateH)),
    due: day(t.due),
    plannedDate: day(t.plannedDate),
    subtasks: arr(t.subtasks).map((s) => ({
      id: str(s.id) || newId(),
      text: str(s.text),
      done: s.done === true,
    })),
    sessionIds: strs(t.sessionIds),
    notes: str(t.notes),
    createdAt: num(t.createdAt, Date.now()),
    doneAt: typeof t.doneAt === "number" ? t.doneAt : null,
    order: num(t.order, i),
  }));
  const dailyLog: DailyBrief[] = arr(r.dailyLog)
    .map(normalizeBrief)
    .filter((x): x is DailyBrief => x !== null)
    .slice(0, MAX_DAILY_LOG);
  const dismissedSyncKeys = [
    ...new Set(strs(r.dismissedSyncKeys).filter(Boolean)),
  ].slice(-MAX_DISMISSED_KEYS);
  const ideas: Idea[] = arr(r.ideas).map((x) => ({
    id: str(x.id) || newId(),
    text: str(x.text),
    topic: str(x.topic) || null,
    createdAt: num(x.createdAt, Date.now()),
    taskId: str(x.taskId) || null,
  }));
  const habits: Habit[] = arr(r.habits).map((h) => ({
    id: str(h.id) || newId(),
    name: str(h.name),
    minutes: Math.max(0, num(h.minutes)),
    days: strs(h.days).filter((d) => DAY_RE.test(d)),
    createdAt: num(h.createdAt, Date.now()),
  }));
  const insights = arr(r.insights)
    .map((x) => sanitizeInsight(x, num(x.at, 0), x.trigger === "auto"))
    .filter((x): x is Insight => x !== null)
    .slice(0, MAX_INSIGHTS);
  const cap = num(r.capacityH, base.capacityH);
  return {
    version: 1,
    tasks,
    dailyLog,
    dismissedSyncKeys,
    ideas,
    habits,
    insights,
    capacityH: cap > 0 && cap <= 24 ? cap : base.capacityH,
    weekends: r.weekends === true,
    insightHour:
      r.insightHour === null
        ? null
        : Math.min(23, Math.max(0, Math.round(num(r.insightHour, 21)))),
    ai: normalizeAi(r.ai),
  };
}

function sanitizeInsight(
  x: Record<string, unknown>,
  at: number,
  auto: boolean,
): Insight | null {
  const headline = str(x.headline).trim();
  if (!headline) return null;
  return {
    at,
    trigger: auto ? "auto" : "manual",
    score: Math.min(100, Math.max(0, Math.round(num(x.score, 0)))),
    headline,
    summary: str(x.summary),
    good: strs(x.good).slice(0, 6),
    risks: arr(x.risks)
      .map((k) => ({
        level: oneOf<RiskLevel>(k.level, ["high", "mid", "low"], "low"),
        title: str(k.title),
        detail: str(k.detail),
        action: str(k.action),
      }))
      .filter((k) => k.title)
      .slice(0, 8),
    suggestions: arr(x.suggestions)
      .map((s) => ({
        tag: str(s.tag),
        title: str(s.title),
        detail: str(s.detail),
      }))
      .filter((s) => s.title)
      .slice(0, 6),
  };
}

// ---------------------------------------------------------------------------------------------
// Dates (all local; the board thinks in the user's calendar days)

export function dayKey(d: Date): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

export function parseDay(key: string): Date {
  const [y, m, d] = key.split("-").map(Number);
  return new Date(y, m - 1, d);
}

export function addDays(key: string, n: number): string {
  const d = parseDay(key);
  d.setDate(d.getDate() + n);
  return dayKey(d);
}

/** Whole days from `a` to `b` (b − a). */
export function daysBetween(a: string, b: string): number {
  return Math.round((parseDay(b).getTime() - parseDay(a).getTime()) / 864e5);
}

export function isWorkday(key: string, weekends: boolean): boolean {
  if (weekends) return true;
  const w = parseDay(key).getDay();
  return w !== 0 && w !== 6;
}

// ---------------------------------------------------------------------------------------------
// Pending confirmations & queued execution tasks

export interface TaskLiveSummary {
  working: number;
  waiting: number;
  lastActivityMs?: number;
}

const PRIORITY_RANK: Record<Priority, number> = { P0: 0, P1: 1, P2: 2 };

export interface PendingQueueGroups {
  /** Tasks needing user confirmation (`status === "decide"` or a linked session is `waiting`). */
  confirm: BoardTask[];
  /** Tasks queued or running (`doing` and `todo` without a waiting session). */
  execute: BoardTask[];
  /** Completed tasks, newest `doneAt` first. */
  done: BoardTask[];
}

export function splitPendingQueue(
  tasks: BoardTask[],
  today: string,
  liveByTask?: ReadonlyMap<string, TaskLiveSummary>,
): PendingQueueGroups {
  const confirm: BoardTask[] = [];
  const execute: BoardTask[] = [];
  const done: BoardTask[] = [];

  for (const t of tasks) {
    if (t.status === "done") {
      done.push(t);
      continue;
    }
    const live = liveByTask?.get(t.id);
    if (t.status === "decide" || (live?.waiting ?? 0) > 0) {
      confirm.push(t);
    } else {
      execute.push(t);
    }
  }

  confirm.sort((a, b) => {
    const aw = (liveByTask?.get(a.id)?.waiting ?? 0) > 0 ? 0 : 1;
    const bw = (liveByTask?.get(b.id)?.waiting ?? 0) > 0 ? 0 : 1;
    if (aw !== bw) return aw - bw;
    const ao = a.due && a.due <= today ? 0 : 1;
    const bo = b.due && b.due <= today ? 0 : 1;
    if (ao !== bo) return ao - bo;
    if (a.priority !== b.priority)
      return PRIORITY_RANK[a.priority] - PRIORITY_RANK[b.priority];
    const ad = a.due ?? "9999-99-99";
    const bd = b.due ?? "9999-99-99";
    if (ad !== bd) return ad < bd ? -1 : 1;
    return a.order - b.order;
  });

  execute.sort((a, b) => {
    const aw = (liveByTask?.get(a.id)?.working ?? 0) > 0 ? 0 : 1;
    const bw = (liveByTask?.get(b.id)?.working ?? 0) > 0 ? 0 : 1;
    if (aw !== bw) return aw - bw;
    const as = a.status === "doing" ? 0 : 1;
    const bs = b.status === "doing" ? 0 : 1;
    if (as !== bs) return as - bs;
    const ao = a.due && a.due < today ? 0 : 1;
    const bo = b.due && b.due < today ? 0 : 1;
    if (ao !== bo) return ao - bo;
    if (a.priority !== b.priority)
      return PRIORITY_RANK[a.priority] - PRIORITY_RANK[b.priority];
    const ad = a.due ?? "9999-99-99";
    const bd = b.due ?? "9999-99-99";
    if (ad !== bd) return ad < bd ? -1 : 1;
    return a.order - b.order;
  });

  done.sort((a, b) => (b.doneAt ?? b.createdAt) - (a.doneAt ?? a.createdAt));

  return { confirm, execute, done };
}

/** Complete a task AND record its one-line implementation summary into `dailyLog` for `today`. */
export function completeTaskWithBrief(
  doc: BoardDoc,
  taskId: string,
  today: string,
  now = Date.now(),
): BoardDoc {
  const target = doc.tasks.find((t) => t.id === taskId);
  if (!target) return doc;
  const tasks = doc.tasks.map((t) =>
    t.id === taskId
      ? { ...t, status: "done" as const, doneAt: t.doneAt ?? now }
      : t,
  );
  const text = (target.summary.trim() || target.title.trim()).slice(0, 240);
  if (!text) return { ...doc, tasks };
  const existingIdx = doc.dailyLog.findIndex((b) => b.taskId === taskId);
  const nextBrief: DailyBrief =
    existingIdx >= 0
      ? {
          ...doc.dailyLog[existingIdx],
          date: today,
          topic: target.topic,
          text,
          sessionId:
            target.sessionIds[0] ?? doc.dailyLog[existingIdx].sessionId,
        }
      : blankBrief(today, text, {
          topic: target.topic,
          source: "task",
          taskId,
          sessionId: target.sessionIds[0] ?? null,
          syncKey: target.sourceKey,
          createdAt: now,
        });
  const dailyLog =
    existingIdx >= 0
      ? doc.dailyLog.map((b, i) => (i === existingIdx ? nextBrief : b))
      : [nextBrief, ...doc.dailyLog].slice(0, MAX_DAILY_LOG);
  return { ...doc, tasks, dailyLog };
}

/** Reopen a completed task and drop its auto-created task completion brief if unchanged. */
export function reopenTask(
  doc: BoardDoc,
  taskId: string,
  status: Exclude<TaskStatus, "done"> = "todo",
): BoardDoc {
  return {
    ...doc,
    tasks: doc.tasks.map((t) =>
      t.id === taskId ? { ...t, status, doneAt: null } : t,
    ),
    dailyLog: doc.dailyLog.filter(
      (b) => !(b.taskId === taskId && b.source === "task"),
    ),
  };
}

/** Remove a task and remember `sourceKey` in `dismissedSyncKeys` so auto-sync never resurrects it. */
export function dismissTask(doc: BoardDoc, taskId: string): BoardDoc {
  const target = doc.tasks.find((t) => t.id === taskId);
  if (!target) return doc;
  const dismissedSyncKeys =
    target.sourceKey && !doc.dismissedSyncKeys.includes(target.sourceKey)
      ? [...doc.dismissedSyncKeys, target.sourceKey].slice(-MAX_DISMISSED_KEYS)
      : doc.dismissedSyncKeys;
  return {
    ...doc,
    tasks: doc.tasks.filter((t) => t.id !== taskId),
    ideas: doc.ideas.map((i) =>
      i.taskId === taskId ? { ...i, taskId: null } : i,
    ),
    dismissedSyncKeys,
  };
}

// ---------------------------------------------------------------------------------------------
// Daily implementation digest (persisted `dailyLog` + runtime `autoBriefs`)

export function normalizeBriefTextKey(text: string): string {
  return text
    .toLowerCase()
    .replace(/\s+/g, "")
    .replace(/[，。；：！？、“”‘’（）()[\]【】·—\-.,;:!?]/g, "");
}

/** Update wording of any brief (persisting an override in `dailyLog` when editing an auto item). */
export function upsertBriefText(
  doc: BoardDoc,
  brief: DailyBrief,
  nextText: string,
): BoardDoc {
  const trimmed = nextText.trim();
  if (!trimmed) return dismissBrief(doc, brief);
  const idx = doc.dailyLog.findIndex(
    (b) => b.id === brief.id || (brief.syncKey && b.syncKey === brief.syncKey),
  );
  const dailyLog =
    idx >= 0
      ? doc.dailyLog.map((b, i) => (i === idx ? { ...b, text: trimmed } : b))
      : [{ ...brief, text: trimmed }, ...doc.dailyLog].slice(0, MAX_DAILY_LOG);
  return { ...doc, dailyLog };
}

export function briefSuppressKey(
  b: Pick<DailyBrief, "date" | "topic" | "text">,
): string {
  return `brief:${b.date}:${b.topic ?? ""}:${normalizeBriefTextKey(b.text)}`;
}

/** Remove a brief from `dailyLog` and suppress its `syncKey` + text fingerprint if auto-synced. */
export function dismissBrief(
  doc: BoardDoc,
  brief: Pick<DailyBrief, "id" | "syncKey" | "date" | "topic" | "text">,
): BoardDoc {
  const keysToAdd = [
    ...(brief.syncKey ? [brief.syncKey] : []),
    briefSuppressKey(brief),
  ].filter((k) => !doc.dismissedSyncKeys.includes(k));
  const dismissedSyncKeys =
    keysToAdd.length > 0
      ? [...doc.dismissedSyncKeys, ...keysToAdd].slice(-MAX_DISMISSED_KEYS)
      : doc.dismissedSyncKeys;
  return {
    ...doc,
    dailyLog: doc.dailyLog.filter(
      (b) =>
        b.id !== brief.id && !(brief.syncKey && b.syncKey === brief.syncKey),
    ),
    dismissedSyncKeys,
  };
}

/**
 * Merge persisted `dailyLog` + runtime `autoBriefs`, honoring `dismissedSyncKeys`, user wording
 * overrides, deploy-over-commit priority, and `(date, topic, normalizedText)` deduplication.
 */
export function mergedDailyBriefs(
  doc: Pick<BoardDoc, "dailyLog" | "autoBriefs" | "dismissedSyncKeys">,
  opts: { topic?: string; query?: string } = {},
): DailyBrief[] {
  const dismissed = new Set(doc.dismissedSyncKeys);
  const overriddenSyncKeys = new Set(
    doc.dailyLog.map((b) => b.syncKey).filter((k): k is string => !!k),
  );

  // Order candidates so user entries come first, then deploys, then commits/sessions.
  const sourceRank: Record<BriefSource, number> = {
    manual: 0,
    task: 1,
    deploy: 2,
    session: 3,
    commit: 4,
  };

  const isDismissed = (b: DailyBrief) =>
    (!!b.syncKey && dismissed.has(b.syncKey)) ||
    dismissed.has(briefSuppressKey(b));

  const candidates: DailyBrief[] = [
    ...doc.dailyLog.filter((b) => !isDismissed(b)),
    ...(doc.autoBriefs ?? []).filter(
      (b) =>
        !isDismissed(b) && !(b.syncKey && overriddenSyncKeys.has(b.syncKey)),
    ),
  ].sort(
    (a, b) =>
      (a.date === b.date ? 0 : a.date > b.date ? -1 : 1) ||
      sourceRank[a.source] - sourceRank[b.source] ||
      b.createdAt - a.createdAt,
  );

  const seenText = new Set<string>();
  const topicFilter = opts.topic ?? "all";
  const q = (opts.query ?? "").trim().toLowerCase();
  const out: DailyBrief[] = [];

  for (const b of candidates) {
    if (
      topicFilter !== "all" &&
      (topicFilter === "none" ? !!b.topic : b.topic !== topicFilter)
    ) {
      continue;
    }
    const textKey = `${b.date}\u0000${b.topic ?? ""}\u0000${normalizeBriefTextKey(b.text)}`;
    if (seenText.has(textKey)) continue;
    seenText.add(textKey);

    if (q) {
      const hay = `${b.text} ${b.ref ?? ""} ${b.topic ?? ""}`.toLowerCase();
      if (!hay.includes(q)) continue;
    }
    out.push(b);
  }

  return out.sort(
    (a, b) =>
      (a.date === b.date ? 0 : a.date > b.date ? -1 : 1) ||
      b.createdAt - a.createdAt,
  );
}

export interface DayBriefGroup {
  date: string;
  items: DailyBrief[];
}

export function groupBriefsByDay(briefs: DailyBrief[]): DayBriefGroup[] {
  const map = new Map<string, DailyBrief[]>();
  for (const b of briefs) {
    const list = map.get(b.date);
    if (list) list.push(b);
    else map.set(b.date, [b]);
  }
  return [...map.entries()]
    .sort((a, b) => (a[0] === b[0] ? 0 : a[0] > b[0] ? -1 : 1))
    .map(([date, items]) => ({ date, items }));
}

export function formatDayMarkdown(
  date: string,
  items: DailyBrief[],
  topicNames: Record<string, string>,
  headingLabel = "任务实现简述清单",
): string {
  const lines = [`### ${date} ${headingLabel}`];
  for (const item of items) {
    const tag = item.topic ? `[${topicNames[item.topic] ?? item.topic}] ` : "";
    const suffix =
      item.source === "deploy" && item.ref ? `（上线 ${item.ref}）` : "";
    lines.push(`- ${tag}${item.text}${suffix}`);
  }
  return lines.join("\n");
}

// ---------------------------------------------------------------------------------------------
// Legacy derived helpers (kept for backward compatibility & existing unit tests)

/** 0–1. Done is 1; otherwise the share of finished subtasks (0 without subtasks). */
export function taskProgress(t: BoardTask): number {
  if (t.status === "done") return 1;
  if (t.subtasks.length === 0) return 0;
  return t.subtasks.filter((s) => s.done).length / t.subtasks.length;
}

export function remainingH(t: BoardTask): number {
  return t.estimateH * (1 - taskProgress(t));
}

export type TaskRisk = "overdue" | "tight" | "stale";

export function taskRisks(
  t: BoardTask,
  today: string,
  doc: Pick<BoardDoc, "capacityH" | "weekends">,
  lastActivityMs?: number,
  now = Date.now(),
): TaskRisk[] {
  if (t.status === "done") return [];
  const out: TaskRisk[] = [];
  if (t.due && t.due < today) out.push("overdue");
  else if (t.due) {
    let hours = 0;
    for (let d = today; d <= t.due; d = addDays(d, 1))
      if (isWorkday(d, doc.weekends)) hours += doc.capacityH;
    if (remainingH(t) > hours * 0.6) out.push("tight");
  }
  if (
    t.status === "doing" &&
    lastActivityMs !== undefined &&
    now - lastActivityMs > 3 * 864e5
  )
    out.push("stale");
  return out;
}

export interface LoadDay {
  date: string;
  workday: boolean;
  hours: number;
  taskIds: string[];
}

export function loadDays(doc: BoardDoc, today: string, span = 14): LoadDay[] {
  const days: LoadDay[] = [];
  for (let i = 0; i < span; i++) {
    const date = addDays(today, i);
    days.push({
      date,
      workday: isWorkday(date, doc.weekends),
      hours: 0,
      taskIds: [],
    });
  }
  const index = new Map(days.map((d, i) => [d.date, i]));
  const put = (date: string, h: number, id: string) => {
    const i = index.get(date);
    if (i === undefined || h <= 0) return;
    days[i].hours += h;
    if (!days[i].taskIds.includes(id)) days[i].taskIds.push(id);
  };
  for (const t of doc.tasks) {
    if (t.status === "done") continue;
    const left = remainingH(t);
    if (left <= 0) continue;
    if (t.due) {
      if (t.due < today) {
        put(today, left, t.id);
        continue;
      }
      const slots: string[] = [];
      for (let d = today; d <= t.due; d = addDays(d, 1))
        if (isWorkday(d, doc.weekends)) slots.push(d);
      if (slots.length === 0) slots.push(t.due);
      for (const d of slots) put(d, left / slots.length, t.id);
    } else if (t.plannedDate) {
      put(t.plannedDate < today ? today : t.plannedDate, left, t.id);
    }
  }
  return days;
}

export function finishEstimate(doc: BoardDoc, today: string): string {
  let left = doc.tasks.reduce(
    (s, t) => s + (t.status === "done" ? 0 : remainingH(t)),
    0,
  );
  let d = today;
  for (let guard = 0; left > 0 && guard < 3650; guard++) {
    if (isWorkday(d, doc.weekends)) left -= doc.capacityH;
    if (left <= 0) break;
    d = addDays(d, 1);
  }
  return d;
}

export function focusOrder(tasks: BoardTask[], today: string): BoardTask[] {
  return tasks
    .filter((t) => t.status !== "done")
    .sort((a, b) => {
      const ao = a.due && a.due < today ? 0 : 1;
      const bo = b.due && b.due < today ? 0 : 1;
      if (ao !== bo) return ao - bo;
      if (a.priority !== b.priority)
        return PRIORITY_RANK[a.priority] - PRIORITY_RANK[b.priority];
      return (a.due ?? "9999") < (b.due ?? "9999") ? -1 : 1;
    });
}

export function habitStreak(h: Habit, today: string): number {
  const set = new Set(h.days);
  let d = set.has(today) ? today : addDays(today, -1);
  let n = 0;
  while (set.has(d)) {
    n++;
    d = addDays(d, -1);
  }
  return n;
}

// ---------------------------------------------------------------------------------------------
// AI insight: evaluates pending confirmations, queued tasks, and real daily implementation digest

export interface InsightSessionFact {
  title: string;
  state: string;
  lastActivityMs: number;
  topic: string | null;
}

export function buildInsightPrompt(
  doc: BoardDoc,
  today: string,
  sessions: InsightSessionFact[],
  topicNames: Record<string, string>,
): string {
  const name = (k: string | null) => (k ? (topicNames[k] ?? k) : "未分类");
  const { confirm, execute } = splitPendingQueue(doc.tasks, today);
  const mapTask = (t: BoardTask) => ({
    标题: t.title,
    说明: t.summary || undefined,
    状态: {
      todo: "待定执行",
      doing: "执行中",
      decide: "待确认",
      done: "已完成",
    }[t.status],
    优先级: t.priority,
    主题: name(t.topic),
    截止: t.due,
    子任务:
      t.subtasks.length > 0
        ? `${t.subtasks.filter((s) => s.done).length}/${t.subtasks.length}`
        : undefined,
    关联会话数: t.sessionIds.length,
  });
  const cutoff = addDays(today, -6);
  const recentBriefs = mergedDailyBriefs(doc)
    .filter((b) => b.date >= cutoff)
    .slice(0, 60)
    .map((b) => ({
      日期: b.date,
      产品: name(b.topic),
      实现简述: b.text,
      来源: b.source,
    }));
  const recentSessions = sessions
    .filter((s) => Date.now() - s.lastActivityMs < 2 * 864e5)
    .slice(0, 25)
    .map((s) => ({
      标题: s.title,
      状态: s.state,
      产品: name(s.topic),
      距上次活动小时: Math.round((Date.now() - s.lastActivityMs) / 36e5),
    }));
  return [
    `今天是 ${today}。你是用户的工作台复盘助手。用户独立推进多条产品线，通过 AI 编程会话并行交付，不手工填工时。`,
    `请基于「待确认事项」「待定执行队列」「近 7 天每日实现简述清单」和「近两天会话状态」给出一份简明复盘，只输出一个 JSON 对象，不要代码块或额外文字。`,
    `JSON 结构：{"score":0-100 的推进健康度整数,"headline":"不超过 22 字的一句话结论","summary":"2-3 句总结近期实际产出与当前焦点","good":["近几日真实落地的亮点，最多 4 条"],"risks":[{"level":"high|mid|low","title":"不超过 12 字","detail":"点名具体待确认或卡住的事项","action":"一句话建议动作"}],"suggestions":[{"tag":"拍板|收敛|推进|产品名","title":"不超过 12 字","detail":"一句话可执行建议"}]}`,
    `要求：简体中文；依据实际每日实现简述与待确认队列评价，严禁编造工时或指责未填预估小时；风险最多 4 条，建议最多 4 条。`,
    `待确认事项（${confirm.length} 项）：${JSON.stringify(confirm.slice(0, 20).map(mapTask))}`,
    `待定执行队列（${execute.length} 项）：${JSON.stringify(execute.slice(0, 25).map(mapTask))}`,
    `近 7 天每日实现简述（${recentBriefs.length} 条）：${JSON.stringify(recentBriefs)}`,
    `近两天的会话：${JSON.stringify(recentSessions)}`,
  ].join("\n");
}

/** Pull the insight JSON out of a model reply (tolerates code fences and chatter around it). */
export function parseInsightReply(
  text: string,
  at: number,
  trigger: Insight["trigger"],
): Insight | null {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start < 0 || end <= start) return null;
  try {
    const v: unknown = JSON.parse(text.slice(start, end + 1));
    if (!v || typeof v !== "object") return null;
    return sanitizeInsight(
      v as Record<string, unknown>,
      at,
      trigger === "auto",
    );
  } catch {
    return null;
  }
}

/** State of the background insight run, served by main. */
export interface InsightRunState {
  running: boolean;
  startedAt: number | null;
  /** Last failure message, cleared on the next start. */
  error: string | null;
}

/** Put a session under one task (or none): it leaves every other task first, so a session belongs to
 *  at most one task — what the sidebar shows as its task. Unknown task ids just detach it. */
export function linkSession(
  doc: BoardDoc,
  sessionId: string,
  taskId: string | null,
): BoardDoc {
  return {
    ...doc,
    tasks: doc.tasks.map((t) => {
      const has = t.sessionIds.includes(sessionId);
      if (t.id === taskId)
        return has ? t : { ...t, sessionIds: [...t.sessionIds, sessionId] };
      return has
        ? { ...t, sessionIds: t.sessionIds.filter((id) => id !== sessionId) }
        : t;
    }),
  };
}

/** session id → the task that carries it (the first, if an older board has it under several). */
export function tasksBySession(doc: BoardDoc): Map<string, BoardTask> {
  const out = new Map<string, BoardTask>();
  for (const t of doc.tasks)
    for (const id of t.sessionIds) if (!out.has(id)) out.set(id, t);
  return out;
}
