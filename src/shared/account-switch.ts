import type { RateLimit, Session } from "./types";

/**
 * Fork (2026-11-03): smart account switching. With two or more reclaude bindings, the app watches
 * each account's 5-hour window (from the statusLine captures written under that account's config
 * dir) and, before the default account runs out, makes the account with the most room the default;
 * idle sessions still on the full account are then ended and resumed on it. Pure decisions live
 * here; main/account-switch.ts owns the state and the reclaude calls.
 */

export const SMART_SWITCH_THRESHOLDS = [70, 80, 85, 90, 95] as const;
export const SMART_SWITCH_DEFAULT_THRESHOLD = 85;
/** A target must sit this far below the threshold, so two accounts can't hand the default back and
 *  forth over a point or two. */
export const SWITCH_HEADROOM = 15;
/** A target whose 7-day window is this full is skipped: it would stop soon whatever its 5h says. */
export const SEVEN_DAY_FULL = 95;
/** After the user picks an account by hand, automatic switching waits this long. */
export const MANUAL_QUIET_MS = 30 * 60_000;

/** One bound account and its last known windows. `n` is its badge number: 1, 2, … by device id,
 *  so it stays put across launches. */
export interface AccountQuota {
  deviceId: string;
  orgId: string;
  email: string;
  n: number;
  /** The default binding: new and resumed sessions run on it. */
  current: boolean;
  fiveHour?: RateLimit;
  sevenDay?: RateLimit;
  /** When these windows were captured (ms); absent when none was ever seen. */
  seenAt?: number;
}

/** The last automatic switch. */
export interface SwitchEvent {
  at: number;
  /** Device ids. */
  from: string;
  to: string;
  /** The 5h use that triggered it. */
  fromPct: number;
  /** Idle sessions moved onto `to` since. */
  moved: number;
}

export interface SmartSwitchPrefs {
  enabled: boolean;
  threshold: number;
}

export interface SmartSwitchState extends SmartSwitchPrefs {
  /** Two or more bound accounts. */
  available: boolean;
  last?: SwitchEvent;
  /** The default account is over the threshold and no other has room. */
  stuck: boolean;
}

export interface AccountsOverview {
  accounts: AccountQuota[];
  smart: SmartSwitchState;
}

/** Badge fills, by badge number (1 → first). Away from the state hues (amber waiting, red failure,
 *  green done, teal working) and dark enough for a white digit. */
export const ACCOUNT_COLORS = [
  "#2563eb",
  "#9333ea",
  "#4338ca",
  "#be185d",
  "#0e7490",
  "#57534e",
] as const;

export const accountColor = (n: number): string =>
  ACCOUNT_COLORS[(n - 1) % ACCOUNT_COLORS.length];

/** A window's use now: 0 once it has reset, null when nothing is known. */
export function windowPct(
  w: RateLimit | undefined,
  now: number,
): number | null {
  if (!w) return null;
  if (w.resetsAt <= now) return 0;
  return w.usedPct;
}

export function normalizePrefs(raw: unknown): SmartSwitchPrefs {
  const r = (raw && typeof raw === "object" ? raw : {}) as Record<
    string,
    unknown
  >;
  const threshold = (SMART_SWITCH_THRESHOLDS as readonly unknown[]).includes(
    r.threshold,
  )
    ? (r.threshold as number)
    : SMART_SWITCH_DEFAULT_THRESHOLD;
  return { enabled: r.enabled !== false, threshold };
}

/** Bindings numbered 1, 2, … in device-id order. */
export function numberAccounts<T extends { deviceId: string }>(
  bindings: T[],
): (T & { n: number })[] {
  return [...bindings]
    .sort((a, b) => Number(a.deviceId) - Number(b.deviceId))
    .map((b, i) => ({ ...b, n: i + 1 }));
}

/** The account to move to: the one with the least 5h use among those with room under the
 *  threshold (an account never seen counts as unused), or null when none has room. */
export function pickTarget(
  accounts: AccountQuota[],
  threshold: number,
  now: number,
): AccountQuota | null {
  const rows = accounts
    .filter((a) => !a.current)
    .map((a) => ({
      a,
      five: windowPct(a.fiveHour, now) ?? 0,
      seven: windowPct(a.sevenDay, now) ?? 0,
    }))
    .filter((r) => r.five <= threshold - SWITCH_HEADROOM)
    .filter((r) => r.seven < SEVEN_DAY_FULL)
    .sort((x, y) => x.five - y.five || x.seven - y.seven);
  return rows[0]?.a ?? null;
}

/** The default account's 5h use when it is at or over the threshold, else null. */
export function hotCurrent(
  accounts: AccountQuota[],
  threshold: number,
  now: number,
): { account: AccountQuota; pct: number } | null {
  const cur = accounts.find((a) => a.current);
  if (!cur) return null;
  const pct = windowPct(cur.fiveHour, now);
  return pct !== null && pct >= threshold ? { account: cur, pct } : null;
}

/** Where to switch the default to now, or null. */
export function decideSwitch(
  view: AccountsOverview,
  now: number,
  quietUntil: number,
): { to: AccountQuota; from: AccountQuota; pct: number } | null {
  const { smart, accounts } = view;
  if (!smart.enabled || !smart.available || now < quietUntil) return null;
  const hot = hotCurrent(accounts, smart.threshold, now);
  if (!hot) return null;
  const to = pickTarget(accounts, smart.threshold, now);
  return to ? { to, from: hot.account, pct: hot.pct } : null;
}

/** A session that could move to the default account now, and how long it has sat idle. */
export interface MoveCandidate {
  id: string;
  idleMs: number;
}

/**
 * Sessions to end and resume on the default account: Claude sessions this app runs, idle between
 * turns (never mid-turn or waiting on a permission), on an account over the threshold while the
 * default is not. Remote (phone) sessions stay where they are.
 */
export function moveCandidates(
  sessions: Session[],
  view: AccountsOverview,
  now: number,
): MoveCandidate[] {
  const { smart, accounts } = view;
  if (!smart.enabled || !smart.available) return [];
  const cur = accounts.find((a) => a.current);
  if (!cur || hotCurrent(accounts, smart.threshold, now)) return [];
  const full = new Set(
    accounts
      .filter(
        (a) =>
          !a.current && (windowPct(a.fiveHour, now) ?? 0) >= smart.threshold,
      )
      .map((a) => a.deviceId),
  );
  if (full.size === 0) return [];
  return sessions
    .filter(
      (s) =>
        s.agent === "claude" &&
        s.management === "managed" &&
        s.state === "idle" &&
        !s.remote &&
        s.accountDevice !== undefined &&
        full.has(s.accountDevice),
    )
    .map((s) => ({ id: s.id, idleMs: Math.max(0, now - s.lastActivityMs) }));
}

/** The renderer's last word on a candidate: the session the user is looking at waits longer, and
 *  any session typed into recently is left alone (its pending input would be lost). */
export function readyToMove(
  c: MoveCandidate,
  opts: { focused: boolean; sinceInputMs: number; sinceTriedMs: number },
): boolean {
  if (opts.sinceTriedMs < 5 * 60_000) return false;
  const wait = opts.focused ? 60_000 : 10_000;
  return c.idleMs >= wait && opts.sinceInputMs >= Math.max(wait, 20_000);
}
