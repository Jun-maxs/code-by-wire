import { createContext } from "react";
import type { Session } from "@shared/types";
import { STATE_RANK } from "./session-list-model";

/** Every session the app knows and how to open one — what the header's topic tabs need. */
export const SessionNavContext = createContext<{
  sessions: Session[];
  select: (id: string) => void;
} | null>(null);

/** How many sibling tabs fit beside the title. */
const MAX_TABS = 3;
/** Ended siblings older than this stay in the sidebar only. */
const RECENT_MS = 3 * 24 * 60 * 60 * 1000;

/** The other sessions on the same topic, most urgent first (waiting, working, idle, then recently
 *  ended), so the parallel work on one product sits one click away instead of a scroll away. */
export function topicSiblings(
  session: Session,
  sessions: Session[],
  topicOf: (s: Session) => string | null,
  now = Date.now(),
): Session[] {
  const topic = topicOf(session);
  if (!topic) return [];
  return sessions
    .filter(
      (s) =>
        s.id !== session.id &&
        !s.parentSessionId &&
        (s.state !== "ended" || now - s.lastActivityMs < RECENT_MS) &&
        topicOf(s) === topic,
    )
    .sort(
      (a, b) =>
        STATE_RANK[a.state] - STATE_RANK[b.state] ||
        b.lastActivityMs - a.lastActivityMs,
    )
    .slice(0, MAX_TABS);
}
