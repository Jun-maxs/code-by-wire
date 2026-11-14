import { atom } from "nanostores";
import {
  pendingAccount,
  type AccountQuota,
  type AccountsOverview,
} from "@shared/account-switch";
import type { AgyQuotaOverview } from "@shared/agy-quota";
import type { AgentId } from "@shared/agents";
import type { Session } from "@shared/types";

/**
 * Fork (2026-11-03): the reclaude accounts with their 5h / 7d windows and the smart switch state,
 * from the overview poll and the smart switch's tick (whichever answered last). Read by the split
 * panes' account badges, the right sidebar and the account switcher.
 */
export const $accounts = atom<AccountsOverview | null>(null);

/** Antigravity Tools multi-account pool quotas (`gemini` and `thirdParty`), hydrated from OverviewData. */
export const $agyAccounts = atom<AgyQuotaOverview | null>(null);

/**
 * Resolve which agent owns the top sidebar quota panel at this moment. Only one quota family
 * (`claude` or `agy`) renders at once so Claude and Antigravity quotas never overlap.
 */
export function activeSplitQuotaAgent(
  agent: AgentId,
  claudeAccounts: AccountsOverview | null,
  agyAccounts: AgyQuotaOverview | null,
): "claude" | "agy" | null {
  if (agent === "claude" && claudeAccounts) return "claude";
  if (agent === "agy" && agyAccounts && agyAccounts.accounts.length > 0)
    return "agy";
  return null;
}

/** The account a session runs on, when it is known and there is more than one to tell apart. */
export function badgeAccount(
  view: AccountsOverview | null,
  deviceId: string | undefined,
): AccountQuota | null {
  if (!view || view.accounts.length < 2 || !deviceId) return null;
  return view.accounts.find((a) => a.deviceId === deviceId) ?? null;
}

/** The account a session runs on and, when it is to move — a running one once its turn ends, an
 *  ended one when resumed (only when it was given an account of its own) — the one it moves to.
 *  Null when there is nothing to tell apart. */
export function sessionMarks(
  view: AccountsOverview | null,
  session: Session,
): { on: AccountQuota | null; to: AccountQuota | null } | null {
  if (session.agent !== "claude") return null;
  const on = badgeAccount(view, session.accountDevice);
  const next =
    session.state === "ended"
      ? session.accountWant !== session.accountDevice
        ? session.accountWant
        : undefined
      : (pendingAccount(session) ?? undefined);
  const to = badgeAccount(view, next);
  return on || to ? { on, to } : null;
}

/** A Claude session with its account's freshest 5h / 7d windows: the account's newest capture
 *  (from any of its sessions) beats this session's own, which stops updating once it goes idle.
 *  A session with no capture yet is taken to run on the default account. */
export function withAccountWindows(
  session: Session,
  view: AccountsOverview | null,
): Session {
  if (session.agent !== "claude" || !view) return session;
  const account = session.accountDevice
    ? view.accounts.find((a) => a.deviceId === session.accountDevice)
    : view.accounts.find((a) => a.current);
  if (!account || (!account.fiveHour && !account.sevenDay)) return session;
  return {
    ...session,
    rateLimits: {
      ...session.rateLimits,
      ...(account.fiveHour ? { fiveHour: account.fiveHour } : {}),
      ...(account.sevenDay ? { sevenDay: account.sevenDay } : {}),
    },
  };
}
