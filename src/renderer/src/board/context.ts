import { createContext, useContext } from "react";
import type { BoardTask } from "@shared/board";
import type { ProductInfo } from "@shared/products";
import type { Session } from "@shared/types";
import type { BoardApi } from "./use-board";
import type { BoardStrings } from "./strings";

export interface BoardCtx extends BoardApi {
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
): { working: number; waiting: number; lastActivityMs?: number } {
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
