import { useEffect } from "react";
import { pendingMoves } from "@shared/account-switch";
import type { Session } from "@shared/types";
import { sinceTerminalInput } from "../terminal/input-activity";

/** Fork (2026-11-01): ask App to end a session and resume it, so it starts on the account it should
 *  run on — its own (RECLAUDE_ORG) or the default (App owns the terminal store that ending and
 *  resuming go through). */
export const CONTINUE_ON_ACCOUNT_EVENT = "cbw:continue-on-account";

/** How a session's account can change from here (fork, 2026-11-03). */
export type AccountSwitchKind =
  /** Running in Jun-Code: ended and resumed on the new account (after this turn, if mid-turn). */
  | "live"
  /** Not running: the account is used when it is resumed. */
  | "ended"
  /** Running in a terminal of its own: Jun-Code can't restart it. */
  | "outside"
  /** Run through the phone remote, which picks the account itself. */
  | "remote";

export function accountSwitchKind(s: Session): AccountSwitchKind {
  if (s.remote) return "remote";
  if (s.state === "ended") return "ended";
  return s.management === "managed" ? "live" : "outside";
}

// When each session was last restarted for an account move: the click, the pending-move watcher
// and smart switching share it, so one move never ends a session twice.
const restartedAt = new Map<string, number>();
const RESTART_GAP_MS = 30_000;

/** End and resume `id` so it starts on its account; false when it was restarted for that a moment ago. */
export function restartOnAccount(id: string, now = Date.now()): boolean {
  if (now - (restartedAt.get(id) ?? -Infinity) < RESTART_GAP_MS) return false;
  restartedAt.set(id, now);
  window.dispatchEvent(
    new CustomEvent(CONTINUE_ON_ACCOUNT_EVENT, { detail: id }),
  );
  return true;
}

/** Whether the session still has background work running — shells it put in the background, or
 *  monitors. Ending it would stop them, so a move waits until they finish. A failed read counts as
 *  none. */
export async function backgroundBusy(id: string): Promise<boolean> {
  try {
    const [shells, monitors] = await Promise.all([
      window.api.readShells(id),
      window.api.readMonitors(id),
    ]);
    return (
      (shells.status === "changed" &&
        shells.shells.some((x) => x.status === "running")) ||
      (monitors.status === "changed" &&
        monitors.monitors.some((x) => x.status === "running"))
    );
  } catch {
    return false;
  }
}

/**
 * The user moves one session to `device`, leaving the default and every other session alone. An
 * idle session is restarted there at once; a working one — or one with background work still
 * running — waits (the pending watcher below); an ended one starts there when resumed. False when
 * main refused the account.
 */
export async function moveSessionAccount(
  s: Session,
  device: string,
): Promise<boolean> {
  const ok = await window.api.setSessionAccount(s.id, device, "manual");
  if (
    ok &&
    accountSwitchKind(s) === "live" &&
    s.state === "idle" &&
    s.accountDevice !== device &&
    !(await backgroundBusy(s.id))
  )
    restartOnAccount(s.id);
  return ok;
}

/** A move waits this long after the last keystroke in the session's terminal: ending it would drop
 *  what is being typed. */
const TYPING_GRACE_MS = 10_000;

// When each pending session's background work was last read, so a session waiting on a long
// background job is read every 15 seconds, not on every 3-second sync.
const backgroundReadAt = new Map<string, number>();
const BACKGROUND_READ_GAP_MS = 15_000;

/** Restart the idle sessions whose asked-for move is pending, unless someone typed into one in the
 *  last few seconds or it still has background work running. */
export async function restartPendingMoves(
  ids: string[],
  now = Date.now(),
): Promise<void> {
  for (const id of ids) {
    if (sinceTerminalInput(id, now) < TYPING_GRACE_MS) continue;
    if (now - (restartedAt.get(id) ?? -Infinity) < RESTART_GAP_MS) continue;
    if (now - (backgroundReadAt.get(id) ?? -Infinity) < BACKGROUND_READ_GAP_MS)
      continue;
    backgroundReadAt.set(id, now);
    if (await backgroundBusy(id)) continue;
    restartOnAccount(id, now);
  }
}

/**
 * Carries out the moves asked of running sessions as soon as the session list shows one idle
 * between turns (the smart switch's 15-second tick does the same while the window is hidden): it
 * is ended and resumed on its new account.
 */
export function usePendingAccountMoves(sessions: Session[]): void {
  useEffect(() => {
    void restartPendingMoves(pendingMoves(sessions));
  }, [sessions]);
}
