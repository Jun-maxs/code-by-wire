import { atom } from "nanostores";
import type { AccountQuota, AccountsOverview } from "@shared/account-switch";
import type { Session } from "@shared/types";

/**
 * Fork (2026-11-03): the reclaude accounts with their 5h / 7d windows and the smart switch state,
 * from the overview poll and the smart switch's tick (whichever answered last). Read by the split
 * panes' account badges, the right sidebar and the account switcher.
 */
export const $accounts = atom<AccountsOverview | null>(null);

/** The account a session runs on, when it is known and there is more than one to tell apart. */
export function badgeAccount(
  view: AccountsOverview | null,
  deviceId: string | undefined,
): AccountQuota | null {
  if (!view || view.accounts.length < 2 || !deviceId) return null;
  return view.accounts.find((a) => a.deviceId === deviceId) ?? null;
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
