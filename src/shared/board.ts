/**
 * The work board (fork feature, 2026-10-28): tasks the user is pushing, each able to carry several
 * agent sessions, plus ideas, daily habits and AI insight runs. One JSON document under userData
 * (`board.json`) — durable user data, never the rebuildable SQLite index. This module is the JSX-free
 * half: the document shape, its sanitizer, and the derived numbers every board page reads (remaining
 * hours, risk, the 14-day load, the finish estimate, today's focus).
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
  /** Estimated hours for the whole task. */
  estimateH: number;
  /** Deadline, local `YYYY-MM-DD`. */
  due: string | null;
  /** The day the user plans to work on it, local `YYYY-MM-DD`. */
  plannedDate: string | null;
  subtasks: Subtask[];
  /** Agent sessions working on this task. */
  sessionIds: string[];
  notes: string;
  createdAt: number;
  doneAt: number | null;
  /** Sort key inside a column (smaller first). */
  order: number;
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

export interface BoardDoc {
  version: 1;
  tasks: BoardTask[];
  ideas: Idea[];
  habits: Habit[];
  /** Newest first, at most {@link MAX_INSIGHTS}. */
  insights: Insight[];
  /** Hours of task work per working day. */
  capacityH: number;
  /** Whether Saturday/Sunday count as working days. */
  weekends: boolean;
  /** Local hour the daily insight runs (while the app is open); null turns it off. */
  insightHour: number | null;
}

export const MAX_INSIGHTS = 30;

export function emptyBoard(): BoardDoc {
  return {
    version: 1,
    tasks: [],
    ideas: [],
    habits: [],
    insights: [],
    capacityH: 6,
    weekends: false,
    insightHour: 21,
  };
}

export function newId(): string {
  return Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
}

/** A new task at the end of its column. */
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
    ideas,
    habits,
    insights,
    capacityH: cap > 0 && cap <= 24 ? cap : base.capacityH,
    weekends: r.weekends === true,
    insightHour:
      r.insightHour === null
        ? null
        : Math.min(23, Math.max(0, Math.round(num(r.insightHour, 21)))),
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
// Derived numbers

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

/**
 * Why a task needs attention, most serious first; empty when it's fine.
 * - overdue: past its deadline and not done.
 * - tight: what's left exceeds the working hours before the deadline.
 * - stale: in progress but none of its sessions moved for 3 days (only when it has sessions).
 */
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
  /** Hours the open tasks ask of this day. */
  hours: number;
  /** Task ids contributing to this day. */
  taskIds: string[];
}

/**
 * The next `span` days' demand: each open task's remaining hours spread evenly over the working days
 * from today to its deadline (an overdue task lands on today in full); a task with only a planned day
 * puts its hours there; a task with neither isn't on the calendar.
 */
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

/** The day all open work would be finished at full capacity, starting today. */
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

const PRIORITY_RANK: Record<Priority, number> = { P0: 0, P1: 1, P2: 2 };

/** Open tasks in the order to work them: overdue first, then priority, then nearest deadline. */
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

/** Consecutive checked days ending today (or yesterday, when today isn't checked yet). */
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
// AI insight: the prompt and the reply parser

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
  const name = (k: string | null) => (k ? (topicNames[k] ?? k) : "");
  const tasks = doc.tasks
    .filter(
      (t) => t.status !== "done" || (t.doneAt ?? 0) > Date.now() - 7 * 864e5,
    )
    .map((t) => ({
      标题: t.title,
      状态: {
        todo: "待办",
        doing: "进行中",
        decide: "等我决定",
        done: "已完成",
      }[t.status],
      优先级: t.priority,
      主题: name(t.topic),
      预估小时: t.estimateH,
      剩余小时: Math.round(remainingH(t) * 10) / 10,
      截止: t.due,
      子任务: `${t.subtasks.filter((s) => s.done).length}/${t.subtasks.length}`,
      风险: taskRisks(t, today, doc),
      挂着的会话数: t.sessionIds.length,
    }));
  const habits = doc.habits.map((h) => ({
    名称: h.name,
    近7天打卡: Array.from({ length: 7 }, (_, i) => addDays(today, -i)).filter(
      (d) => h.days.includes(d),
    ).length,
    连续天数: habitStreak(h, today),
  }));
  const recent = sessions
    .filter((s) => Date.now() - s.lastActivityMs < 2 * 864e5)
    .slice(0, 30)
    .map((s) => ({
      标题: s.title,
      状态: s.state,
      主题: name(s.topic),
      距上次活动小时: Math.round((Date.now() - s.lastActivityMs) / 36e5),
    }));
  const load = loadDays(doc, today, 7).map((d) => ({
    日期: d.date,
    需求小时: Math.round(d.hours * 10) / 10,
    工作日: d.workday,
  }));
  return [
    `今天是 ${today}。你是用户的工作复盘助手。用户是一个人同时推进多条产品线的程序员，用 AI 编程助手（会话）干活。`,
    `每日容量 ${doc.capacityH} 小时。根据下面的数据写一份今天的复盘，只输出一个 JSON 对象，不要代码块、不要别的文字。`,
    `JSON 结构：{"score":0-100 的整数,"headline":"不超过 20 字的一句话结论","summary":"2-3 句总结","good":["做得不错的点，最多 4 条"],"risks":[{"level":"high|mid|low","title":"不超过 10 字","detail":"一句话说明，点名具体任务","action":"一句话建议动作"}],"suggestions":[{"tag":"工作|节奏|习惯|主题名","title":"不超过 10 字","detail":"一句话"}]}`,
    `要求：简体中文；具体到任务名，不说空话；没有数据支撑的不写；风险按严重程度排序，最多 5 条；建议最多 4 条。`,
    `任务：${JSON.stringify(tasks)}`,
    `近 7 天负荷：${JSON.stringify(load)}`,
    `日常习惯：${JSON.stringify(habits)}`,
    `近两天的会话：${JSON.stringify(recent)}`,
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
