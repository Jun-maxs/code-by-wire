import { createContext, useContext } from "react";
import type {
  BoardDoc,
  BoardTask,
  DailyBrief,
  TaskLiveSummary,
  TaskStatus,
} from "@shared/board";
import type { ProductInfo } from "@shared/products";
import type { Session } from "@shared/types";
import type { BoardApi } from "./use-board";
import type { BoardStrings } from "./strings";

export interface BoardCtx extends BoardApi {
  /** Full unfiltered board document (used for global counts & cross-topic lookups). */
  rawDoc: BoardDoc;
  /** Active topic filter (`"all"`, `"none"`, or a topic key). */
  topicFilter: string;
  s: BoardStrings;
  sessions: Session[];
  sessionsById: Map<string, Session>;
  topics: Record<string, ProductInfo>;
  /** Topic key of a session (workbench record, manual pick, or trigger words). */
  sessionTopic: (s: Session) => string | null;
  /** Display title of a session (workbench short title when there is one). */
  sessionTitle: (s: Session) => string;
  openSession: (id: string) => void;
  /** Spawn a session for the task and attach it; resolves to its id, or null on failure. */
  newSessionFor: (task: BoardTask) => Promise<string | null>;
  openTask: (id: string) => void;
  /** Complete task and log into today's implementation digest. */
  completeTask: (taskId: string) => void;
  /** Reopen a completed task to `status` (default `"todo"`). */
  reopenTaskById: (
    taskId: string,
    status?: Exclude<TaskStatus, "done">,
  ) => void;
  /** Dismiss a task and suppress its `sourceKey` so auto-sync won't resurrect it. */
  dismissTaskById: (taskId: string) => void;
  /** Add a manual daily brief for `date` (defaults to `today`). */
  addManualBrief: (text: string, topic?: string | null, date?: string) => void;
  /** Update the wording of any daily brief (creating an override when editing an auto item). */
  editBriefText: (brief: DailyBrief, nextText: string) => void;
  /** Hide/remove a daily brief (suppressing `syncKey` when auto-synced). */
  removeBrief: (
    brief: Pick<DailyBrief, "id" | "syncKey" | "date" | "topic" | "text">,
  ) => void;
  /** The topic the board is filtered to (new tasks and briefs land in it), or null. */
  defaultTopic: string | null;
}

export const BoardContext = createContext<BoardCtx | null>(null);

export function useBoardCtx(): BoardCtx {
  const v = useContext(BoardContext);
  if (!v) throw new Error("BoardContext missing");
  return v;
}

/** The live signal of a task's sessions: running beats waiting. */
export function taskLive(
  t: BoardTask,
  byId: Map<string, Session>,
): TaskLiveSummary {
  let working = 0;
  let waiting = 0;
  let last: number | undefined;
  for (const id of t.sessionIds) {
    const s = byId.get(id);
    if (!s) continue;
    if (s.state === "working") working++;
    else if (s.state === "waiting") waiting++;
    last = Math.max(last ?? 0, s.lastActivityMs);
  }
  return { working, waiting, lastActivityMs: last };
}

export function buildLiveByTask(
  tasks: BoardTask[],
  byId: Map<string, Session>,
): Map<string, TaskLiveSummary> {
  const map = new Map<string, TaskLiveSummary>();
  for (const t of tasks) {
    if (t.status === "done") continue;
    map.set(t.id, taskLive(t, byId));
  }
  return map;
}

export function taskMatches(
  t: BoardTask,
  q: string,
  topicNames?: Record<string, string>,
): boolean {
  const s = q.trim().toLowerCase();
  if (!s) return true;
  const topicLabel = t.topic
    ? (topicNames?.[t.topic] ?? t.topic).toLowerCase()
    : "";
  return (
    t.title.toLowerCase().includes(s) ||
    t.summary.toLowerCase().includes(s) ||
    topicLabel.includes(s) ||
    t.tags.some((x) => x.toLowerCase().includes(s)) ||
    t.notes.toLowerCase().includes(s)
  );
}
