import type { AgentId } from "./agents";
import {
  accountColor,
  windowPct,
  type AccountsOverview,
} from "./account-switch";
import {
  productForSession,
  shortTopicName,
  type ProductsData,
} from "./products";
import type { Account, RateLimit, Session } from "./types";

/**
 * Fork (2026-11-09): what DeskTidy's top island reads from this app over loopback (see
 * main/island-feed.ts). The island took over from the HUD overlay; it gets a small snapshot, already
 * titled and ordered, not the HUD's whole protocol. The shape is a contract the island parses — add
 * fields, never rename or drop one. Pure: main passes everything in.
 */

export type IslandState = "working" | "waiting" | "idle" | "ended";

export interface IslandWindow {
  usedPct: number;
  resetsAt: number;
}

export interface IslandSession {
  id: string;
  agent: AgentId;
  state: IslandState;
  /** "short topic name · title", or just the title outside any topic. */
  title: string;
  /** The sidebar folder's label, else the project. */
  project: string;
  topicColor: string | null;
  lastActivity: number;
  /** The account's badge ("#2") the session runs on; null when unknown. */
  account: string | null;
  remote: boolean;
}

export interface IslandAccount {
  device: string;
  /** "#n", the badge the main window shows. */
  label: string;
  color: string;
  email: string;
  current: boolean;
  fiveHour: IslandWindow | null;
  sevenDay: IslandWindow | null;
}

export interface IslandSnapshot {
  version: 1;
  now: number;
  sessions: IslandSession[];
  accounts: { smartSwitch: boolean; items: IslandAccount[] };
  remote: { online: boolean };
}

export interface IslandSnapshotInput {
  sessions: Session[];
  /** The account switcher's view; null without reclaude bindings. */
  accounts: AccountsOverview | null;
  /** The single account (overview().account), shown when there are no bindings. */
  account: Account | null;
  products: ProductsData | null;
  /** The phone remote (HAPI runner) is up. */
  remoteOnline: boolean;
  now: number;
}

/** At most this many sessions reach the island. */
export const ISLAND_MAX_SESSIONS = 30;
/** Ended sessions older than this are left out. */
const RECENT_MS = 24 * 60 * 60 * 1000;

/** The sidebar's order (renderer/shell/session-list-model's sortSessions): waiting on you, then
 *  running, then idle, then ended; waiting and running rows by creation (newest first) so they don't
 *  hop as they work, idle and ended ones by last activity. */
const RANK: Record<IslandState, number> = {
  waiting: 0,
  working: 1,
  idle: 2,
  ended: 3,
};
function bySidebar(a: Session, b: Session): number {
  const ra = RANK[a.state];
  const rb = RANK[b.state];
  if (ra !== rb) return ra - rb;
  return ra <= RANK.working
    ? b.createdMs - a.createdMs
    : b.lastActivityMs - a.lastActivityMs;
}

/** A window as the island shows it: null when nothing is known, 0% once it has reset. */
function islandWindow(
  w: RateLimit | undefined,
  now: number,
): IslandWindow | null {
  const pct = windowPct(w, now);
  return w && pct !== null ? { usedPct: pct, resetsAt: w.resetsAt } : null;
}

function islandAccounts(
  input: IslandSnapshotInput,
): IslandSnapshot["accounts"] {
  const { accounts, account, now } = input;
  if (accounts && accounts.accounts.length > 0)
    return {
      smartSwitch: accounts.smart.enabled && accounts.smart.available,
      items: accounts.accounts.map((a) => ({
        device: a.deviceId,
        label: `#${a.n}`,
        color: accountColor(a.n),
        email: a.email,
        current: a.current,
        // An account never seen has no windows worth showing.
        fiveHour: a.seenAt === undefined ? null : islandWindow(a.fiveHour, now),
        sevenDay: a.seenAt === undefined ? null : islandWindow(a.sevenDay, now),
      })),
    };
  // No bindings: the one account the main window shows.
  return {
    smartSwitch: false,
    items: account
      ? [
          {
            device: "",
            label: "#1",
            color: accountColor(1),
            email: account.email ?? "",
            current: true,
            fiveHour: islandWindow(account.fiveHour, now),
            sevenDay: islandWindow(account.sevenDay, now),
          },
        ]
      : [],
  };
}

export function buildIslandSnapshot(
  input: IslandSnapshotInput,
): IslandSnapshot {
  const { products, now } = input;
  const badge = new Map(
    (input.accounts?.accounts ?? []).map((a) => [a.deviceId, `#${a.n}`]),
  );
  const sessions = input.sessions
    .filter((s) => s.state !== "ended" || now - s.lastActivityMs <= RECENT_MS)
    .sort(bySidebar)
    .slice(0, ISLAND_MAX_SESSIONS)
    .map((s): IslandSession => {
      const key = products ? productForSession(products, s) : null;
      const topic = key ? products?.products[key] : undefined;
      return {
        id: s.id,
        agent: s.agent,
        state: s.state,
        title: topic ? `${shortTopicName(topic.name)} · ${s.title}` : s.title,
        project: s.repoLabel ?? s.project,
        topicColor: topic?.color ?? null,
        lastActivity: s.lastActivityMs,
        account:
          s.accountDevice !== undefined
            ? (badge.get(s.accountDevice) ?? null)
            : null,
        remote: s.remote === true,
      };
    });
  return {
    version: 1,
    now,
    sessions,
    accounts: islandAccounts(input),
    remote: { online: input.remoteOnline },
  };
}
