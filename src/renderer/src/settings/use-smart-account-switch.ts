import { useEffect, useRef } from "react";
import { readyToMove } from "@shared/account-switch";
import { sinceTerminalInput } from "../terminal/input-activity";
import { $accounts } from "./accounts-store";
import { CONTINUE_ON_ACCOUNT_EVENT } from "./ClaudeAccounts";

const TICK_MS = 15_000;

/**
 * Fork (2026-11-03): drives smart account switching. Every 15 seconds — also while the window is
 * hidden, since the user is often away in a game while sessions run — main checks the default
 * account's 5h window and switches when it is due; this then moves at most one idle session still
 * on the full account onto the new default (ended and resumed, like "continue on the current
 * account"). Sessions on screen wait longer, and one typed into recently is left alone.
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
        const next = r.candidates.find((c) =>
          readyToMove(c, {
            focused: visible.current.has(c.id),
            sinceInputMs: sinceTerminalInput(c.id, now),
            sinceTriedMs: now - (tried.get(c.id) ?? -Infinity),
          }),
        );
        if (next) {
          tried.set(next.id, now);
          window.dispatchEvent(
            new CustomEvent(CONTINUE_ON_ACCOUNT_EVENT, { detail: next.id }),
          );
          void window.api.accountSwitchMoved();
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
