import type { SessionState } from "./types";

/** How urgent a session is, most urgent first: waiting on you, running, idle, ended. The sidebar and
 *  DeskTidy's island (island-feed.ts) both sort by it. */
export const STATE_RANK: Record<SessionState, number> = {
  waiting: 0,
  working: 1,
  idle: 2,
  ended: 3,
};

/** Within one rank: waiting and running sessions keep their creation order (newest first), so a
 *  running row doesn't hop on every tick of its activity clock; idle and ended ones go by when they
 *  were last touched. */
export function compareRanked(
  a: { rank: number; createdMs: number; lastActivityMs: number },
  b: { rank: number; createdMs: number; lastActivityMs: number },
): number {
  if (a.rank !== b.rank) return a.rank - b.rank;
  return a.rank <= STATE_RANK.working
    ? b.createdMs - a.createdMs
    : b.lastActivityMs - a.lastActivityMs;
}
