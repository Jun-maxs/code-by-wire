import { useEffect, useRef } from "react";
import { readyToMove } from "@shared/account-switch";
import { sinceTerminalInput } from "../terminal/input-activity";
import { $accounts } from "./accounts-store";
import {
  backgroundBusy,
  restartOnAccount,
  restartPendingMoves,
} from "./session-account";

const TICK_MS = 15_000;

/**
 * Fork (2026-11-03): drives smart account switching. Every 15 seconds — also while the window is
 * hidden, since the user is often away in a game while sessions run — main checks the default
 * account's 5h window and switches when it is due; this then moves at most one idle session off a
 * full account, to the account main picked for it (it gets that account as its own, then is ended
 * and resumed there). Sessions on screen wait longer, and one typed into recently is left alone.
 */
export function useSmartAccountSwitch(visibleIds: string[]): void {
  const visible = useRef(new Set<string>());
  visible.current = new Set(visibleIds);
  useEffect(() => {
    const tried = new Map<string, number>();
    let busy = false;
    const tick = async () => {
      if (busy) return;
      busy = true;
      try {
        const r = await window.api.accountSwitchTick();
        $accounts.set(r.accounts);
        const now = Date.now();
        // Moves the user asked for go first; the window's own session list stops syncing while it
        // is hidden, so they are carried out from here too.
        await restartPendingMoves(r.pending, now);
        const next = r.candidates.find((c) =>
          readyToMove(c, {
            focused: visible.current.has(c.id),
            sinceInputMs: sinceTerminalInput(c.id, now),
            sinceTriedMs: now - (tried.get(c.id) ?? -Infinity),
          }),
        );
        // A session with background work running stays put: ending it would stop that work.
        if (next) {
          tried.set(next.id, now);
          if (
            !(await backgroundBusy(next.id)) &&
            (await window.api.setSessionAccount(next.id, next.to, "auto"))
          )
            restartOnAccount(next.id);
        }
      } catch {
        // the next tick tries again
      } finally {
        busy = false;
      }
    };
    const first = setTimeout(() => void tick(), 5_000);
    const timer = setInterval(() => void tick(), TICK_MS);
    return () => {
      clearTimeout(first);
      clearInterval(timer);
    };
  }, []);
}
