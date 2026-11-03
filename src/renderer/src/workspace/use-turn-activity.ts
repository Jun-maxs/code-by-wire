import type { TurnActivity } from "@shared/turn-activity";
import { usePolledRead, type Read } from "./use-polled-read";

const readActivity = (
  id: string,
  since?: number,
): Promise<Read<TurnActivity>> =>
  window.api
    .readTurnActivity(id, since)
    .then((r) =>
      r.status === "changed"
        ? { status: "changed", mtimeMs: r.mtimeMs, data: r.activity }
        : r,
    );

/** Fork (2026-11-02): poll what a session's current turn is doing (split-view panes). */
export function useTurnActivity(
  sessionId: string,
  enabled = true,
): TurnActivity | null | undefined {
  return usePolledRead(sessionId, readActivity, enabled);
}
