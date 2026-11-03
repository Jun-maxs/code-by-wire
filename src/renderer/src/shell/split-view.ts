import { atom } from "nanostores";
import type { Session, Task } from "@shared/types";
import type { BoardTask } from "@shared/board";
import type { TurnActivity } from "@shared/turn-activity";
import type { Translations } from "../i18n/en";
import { isPlaceholderTitle, isUnsentSession } from "./session-list-model";

/**
 * Fork (2026-11-02): the middle column's split view — up to six sessions side by side, each with
 * its own task progress strip. The selected session is the focused pane; picking another session
 * (sidebar, Ctrl+Tab, HUD) while split puts it into the grid. Design: docs/plans/2026-11-02-split-view.md.
 */
export const MAX_SPLIT = 6;
/** Below this pane width the grid drops a column (a Claude Code TUI gets unreadable much narrower). */
export const MIN_PANE_WIDTH = 340;

export type ViewMode = "single" | "split";
export interface SplitState {
  mode: ViewMode;
  /** Session ids in pane order; never empty while split. */
  ids: string[];
}

const STORAGE_KEY = "cbw.splitView.v1";

function load(): SplitState {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const r = JSON.parse(raw) as Partial<SplitState>;
      const ids = Array.isArray(r.ids)
        ? r.ids.filter((id): id is string => typeof id === "string")
        : [];
      return {
        mode: r.mode === "split" && ids.length > 0 ? "split" : "single",
        ids: [...new Set(ids)].slice(0, MAX_SPLIT),
      };
    }
  } catch {
    // Unreadable or blocked storage: start single.
  }
  return { mode: "single", ids: [] };
}

export const $split = atom<SplitState>(
  typeof window === "undefined" ? { mode: "single", ids: [] } : load(),
);

$split.listen((state) => {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch {
    // Best effort; the view still works for this run.
  }
});

/** Put `id` into the grid: already there → unchanged; room left → appended; full → it takes the
 *  place of `replaceId` (the pane that was focused), else the last pane. */
export function placeInSplit(
  ids: string[],
  id: string,
  replaceId: string | null,
): string[] {
  if (ids.includes(id)) return ids;
  if (ids.length < MAX_SPLIT) return [...ids, id];
  const at = replaceId ? ids.indexOf(replaceId) : -1;
  const next = [...ids];
  next[at >= 0 ? at : next.length - 1] = id;
  return next;
}

const STATE_RANK: Record<Session["state"], number> = {
  waiting: 0,
  working: 1,
  idle: 2,
  ended: 3,
};

/** Running in-app sessions, the ones most worth watching first: waiting on you, then working, then
 *  idle; newest activity first within each. */
export function liveSessionsByUrgency(sessions: Session[]): Session[] {
  return sessions
    .filter((s) => s.management === "managed" && s.state !== "ended")
    .sort(
      (a, b) =>
        STATE_RANK[a.state] - STATE_RANK[b.state] ||
        b.lastActivityMs - a.lastActivityMs,
    );
}

/** The grid to open when switching to split: the remembered panes that still exist, with `current`
 *  in them; when that leaves at most one pane, the other running sessions fill in. */
export function enterSplit(
  remembered: string[],
  current: string,
  sessions: Session[],
): string[] {
  const known = new Set(sessions.map((s) => s.id));
  let ids = placeInSplit(
    remembered.filter((id) => known.has(id)),
    current,
    null,
  );
  if (ids.length <= 1) {
    for (const s of liveSessionsByUrgency(sessions)) {
      if (ids.length >= MAX_SPLIT) break;
      ids = placeInSplit(ids, s.id, null);
    }
  }
  return ids;
}

/** Drop panes whose session is gone (deleted, or never indexed). */
export function pruneSplit(ids: string[], known: Set<string>): string[] {
  const next = ids.filter((id) => known.has(id));
  return next.length === ids.length ? ids : next;
}

/** A /clear rotation keeps the pane, under the new id. */
export function renameInSplit(
  ids: string[],
  from: string,
  to: string,
): string[] {
  if (!ids.includes(from)) return ids;
  return [...new Set(ids.map((id) => (id === from ? to : id)))];
}

/** Columns for `count` panes in a column `width` px wide: 2 → side by side, 4 → 2×2, 5–6 → 3×2,
 *  then fewer when a pane would drop under MIN_PANE_WIDTH. Width 0 (not measured yet) → the ideal. */
export function splitColumns(count: number, width: number): number {
  const ideal = count <= 3 ? Math.max(1, count) : count === 4 ? 2 : 3;
  if (width <= 0) return ideal;
  return Math.max(1, Math.min(ideal, Math.floor(width / MIN_PANE_WIDTH)));
}

/** The pane to focus after `id` leaves the grid: its right neighbor, else its left one. */
export function neighborAfterRemove(ids: string[], id: string): string | null {
  const at = ids.indexOf(id);
  if (at < 0) return null;
  return ids[at + 1] ?? ids[at - 1] ?? null;
}

/** What a pane's top strip shows: Claude's own to-do list, else the board task's subtasks. */
export interface PaneProgress {
  done: number;
  total: number;
  /** The step under way (an in-progress to-do, else the first open subtask). */
  current?: string;
  source: "todo" | "board";
}

export function paneProgress(
  tasks: Task[] | null | undefined,
  boardTask: BoardTask | undefined,
): PaneProgress | null {
  if (tasks && tasks.length > 0)
    return {
      done: tasks.filter((t) => t.status === "completed").length,
      total: tasks.length,
      current: tasks.find((t) => t.status === "in_progress")?.subject,
      source: "todo",
    };
  const subtasks = boardTask?.subtasks ?? [];
  if (subtasks.length > 0)
    return {
      done: subtasks.filter((s) => s.done).length,
      total: subtasks.length,
      current: subtasks.find((s) => !s.done)?.text,
      source: "board",
    };
  return null;
}

/** A session's title as the sidebar shows it (unsent and placeholder titles read generically). */
export function sessionDisplayTitle(s: Session, t: Translations): string {
  if (isUnsentSession(s)) return t.shell.sessionRow.unsentTitle;
  if (isPlaceholderTitle(s.title)) return t.shell.sessionRow.placeholderTitle;
  return s.title;
}

/** How many sessions the add list offers: every running one, topped up with the latest ended. */
const CANDIDATE_LIMIT = 12;

/** Sessions worth adding to the grid, most urgent first: running ones (waiting → working → idle),
 *  then the most recently active of the rest. */
export function splitCandidates(sessions: Session[], inGrid: string[]) {
  const taken = new Set(inGrid);
  const live = liveSessionsByUrgency(sessions).filter((s) => !taken.has(s.id));
  const liveIds = new Set(live.map((s) => s.id));
  const rest = sessions
    .filter((s) => !taken.has(s.id) && !liveIds.has(s.id))
    .sort((a, b) => b.lastActivityMs - a.lastActivityMs);
  return [...live, ...rest].slice(0, Math.max(CANDIDATE_LIMIT, live.length));
}

export type StripTone = "accent" | "working" | "ok" | "neutral";

/** Everything a pane's top strip and title line say about where its session is. */
export interface PaneLine {
  /** Share done (0–1), or null for a full-width band when there is no list to measure. */
  pct: number | null;
  tone: StripTone;
  /** Working with no list to measure: a gliding segment instead of a fill. */
  indeterminate: boolean;
  /** What it is on now (a to-do, the last tool call, or a state word). */
  doing: string;
  /** The short figures at the right: "3/7", or steps and time. */
  meta: string;
  /** The strip's accessible name and tooltip. */
  label: string;
}

/** Where a pane's session is: its to-do (or board subtask) progress when it keeps a list, else the
 *  current task — amber waiting on you, a gliding teal segment while working, green when done. */
export function paneLine(
  s: Session,
  progress: PaneProgress | null,
  activity: TurnActivity | null | undefined,
  now: number,
  t: Translations,
): PaneLine {
  const tx = t.shell.split;
  const tool = activity?.lastTool
    ? activity.lastTool.target || activity.lastTool.name
    : "";
  const duration = t.time.duration;
  if (progress) {
    const pct = progress.done / progress.total;
    return {
      pct,
      tone:
        s.state === "waiting"
          ? "accent"
          : s.state === "working"
            ? "working"
            : pct >= 1
              ? "ok"
              : "neutral",
      indeterminate: false,
      doing: progress.current ?? tool,
      meta: `${progress.done}/${progress.total}`,
      label:
        progress.source === "todo"
          ? tx.todoProgress(progress.done, progress.total)
          : tx.boardProgress(progress.done, progress.total),
    };
  }
  const steps = activity?.steps ?? 0;
  const start = activity?.turnStartMs ?? null;
  const stepsText =
    steps === 0
      ? ""
      : start === null
        ? tx.stepsAtLeast(steps)
        : tx.steps(steps);
  const join = (...parts: string[]) => parts.filter(Boolean).join(" · ");
  switch (s.state) {
    case "working":
      return {
        pct: null,
        tone: "working",
        indeterminate: true,
        doing: tool || tx.running,
        meta: join(
          stepsText,
          start === null ? "" : tx.runningFor(duration(now - start)),
        ),
        label: tx.running,
      };
    case "waiting":
      return {
        pct: null,
        tone: "accent",
        indeterminate: false,
        doing: tool ? `${tx.waiting} · ${tool}` : tx.waiting,
        meta: stepsText,
        label: tx.waiting,
      };
    case "idle":
      if (steps > 0)
        return {
          pct: null,
          tone: "ok",
          indeterminate: false,
          doing: tx.turnDone,
          meta: join(
            stepsText,
            start !== null && activity?.lastMs
              ? tx.tookFor(duration(activity.lastMs - start))
              : "",
          ),
          label: tx.turnDone,
        };
      break;
    case "ended":
      return {
        pct: 0,
        tone: "neutral",
        indeterminate: false,
        doing: tx.ended,
        meta: "",
        label: tx.ended,
      };
  }
  return {
    pct: 0,
    tone: "neutral",
    indeterminate: false,
    doing: "",
    meta: "",
    label: tx.noProgress,
  };
}

/** One row of a pane's task card. */
export interface PaneTaskItem {
  text: string;
  /** A to-do from Claude's list, a prompt the user sent, or a message still queued. */
  kind: "todo" | "prompt" | "queued";
  steps?: number;
  startMs?: number | null;
  endMs?: number | null;
  /** Messages sent while the task ran, folded into it. */
  adds?: string[];
}

/** The pane's task card, grouped: what is under way, what waits its turn, what is done (newest
 *  first). A prompt is under way only while the session works or waits on you. */
export function paneTaskGroups(
  s: Session,
  activity: TurnActivity | null | undefined,
  todos: Task[] | null | undefined,
): { now: PaneTaskItem[]; queued: PaneTaskItem[]; done: PaneTaskItem[] } {
  const list = todos ?? [];
  const todo = (t: Task): PaneTaskItem => ({ text: t.subject, kind: "todo" });
  const prompts = activity?.tasks ?? [];
  const live = s.state === "working" || s.state === "waiting";
  const current = live ? prompts[prompts.length - 1] : undefined;
  const finished = (current ? prompts.slice(0, -1) : prompts).slice().reverse();
  return {
    now: [
      ...list.filter((t) => t.status === "in_progress").map(todo),
      ...(current ? [{ ...current, kind: "prompt" as const }] : []),
    ],
    queued: [
      ...list
        .filter((t) => t.status === "pending" || t.status === "blocked")
        .map(todo),
      ...(activity?.queued ?? []).map(
        (text): PaneTaskItem => ({ text, kind: "queued" }),
      ),
    ],
    done: [
      ...list.filter((t) => t.status === "completed").map(todo),
      ...finished.map((p): PaneTaskItem => ({ ...p, kind: "prompt" })),
    ],
  };
}
