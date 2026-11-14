import type { AgentId } from "./agents";
import type { AgyQuotaOverview } from "./agy-quota";
import { compareRanked, STATE_RANK } from "./session-order";
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
  /** "#n" for Claude, or "Ultra" / "A1" for Antigravity. */
  label: string;
  color: string;
  email: string;
  current: boolean;
  fiveHour: IslandWindow | null;
  sevenDay: IslandWindow | null;
  agent?: AgentId;
  tier?: string | null;
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
  /** Antigravity Tools accounts and Gemini/third-party rate windows, when installed. */
  agyAccounts?: AgyQuotaOverview | null;
  products: ProductsData | null;
  /** The phone remote (HAPI runner) is up. */
  remoteOnline: boolean;
  now: number;
}

/** At most this many sessions reach the island. */
export const ISLAND_MAX_SESSIONS = 30;
/** Ended sessions older than this are left out. */
const RECENT_MS = 24 * 60 * 60 * 1000;

/** The sidebar's order (shared/session-order, as renderer/shell/session-list-model sorts). */
const bySidebar = (a: Session, b: Session): number =>
  compareRanked(
    { ...a, rank: STATE_RANK[a.state] },
    { ...b, rank: STATE_RANK[b.state] },
  );

/** A window as the island shows it: null when nothing is known, 0% once it has reset. */
function islandWindow(
  w: RateLimit | undefined,
  now: number,
): IslandWindow | null {
  const pct = windowPct(w, now);
  // Whole numbers: the island reads them as integers (usage percentages and reset times can carry fractions).
  return w && pct !== null
    ? { usedPct: Math.round(pct), resetsAt: Math.round(w.resetsAt) }
    : null;
}

const AGY_COLORS = ["#1C7DFF", "#0EA5E9", "#6366F1", "#14B8A6"];

function formatAgyTier(raw: string | null | undefined): string | null {
  switch (raw?.trim().toUpperCase()) {
    case "ULTRA":
      return "Ultra";
    case "PRO":
      return "Pro";
    case "PLUS":
      return "Plus";
    default:
      return null;
  }
}

function agyIslandAccounts(
  agyAccounts: AgyQuotaOverview | null | undefined,
  now: number,
): IslandAccount[] {
  const list = agyAccounts?.accounts ?? [];
  if (list.length === 0) return [];
  return list.map((a, idx) => {
    const tier = formatAgyTier(a.tier);
    const label = list.length === 1 && tier ? tier : `A${a.n}`;
    const five = a.gemini.fiveHour ?? a.thirdParty.fiveHour;
    const seven = a.gemini.sevenDay ?? a.thirdParty.sevenDay;
    return {
      device: `agy:${a.id}`,
      label,
      color: AGY_COLORS[idx % AGY_COLORS.length],
      email: a.email,
      current: a.current,
      fiveHour: islandWindow(five, now),
      sevenDay: islandWindow(seven, now),
      agent: "agy",
      tier,
    };
  });
}

function islandAccounts(
  input: IslandSnapshotInput,
): IslandSnapshot["accounts"] {
  const { accounts, account, agyAccounts, now } = input;
  const agyItems = agyIslandAccounts(agyAccounts, now);
  if (accounts && accounts.accounts.length > 0)
    return {
      smartSwitch: accounts.smart.enabled && accounts.smart.available,
      items: [
        ...accounts.accounts.map((a) => ({
          device: a.deviceId,
          label: `#${a.n}`,
          color: accountColor(a.n),
          email: a.email,
          current: a.current,
          // An account never seen has no windows worth showing.
          fiveHour: a.seenAt === undefined ? null : islandWindow(a.fiveHour, now),
          sevenDay: a.seenAt === undefined ? null : islandWindow(a.sevenDay, now),
        })),
        ...agyItems,
      ],
    };
  // No bindings: the one account the main window shows.
  return {
    smartSwitch: false,
    items: [
      ...(account
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
        : []),
      ...agyItems,
    ],
  };
}

export function buildIslandSnapshot(
  input: IslandSnapshotInput,
): IslandSnapshot {
  const { products, now } = input;
  const allAccounts = islandAccounts(input);
  const currentAgyLabel =
    allAccounts.items.find((a) => a.agent === "agy" && a.current)?.label ??
    allAccounts.items.find((a) => a.agent === "agy")?.label ??
    null;
  const badge = new Map(
    (input.accounts?.accounts ?? []).map((a) => [a.deviceId, `#${a.n}`]),
  );
  const sessions = input.sessions
    // Agent threads sit under their parent in the sidebar; listed on their own they'd count twice.
    .filter((s) => !s.parentSessionId)
    .filter((s) => s.state !== "ended" || now - s.lastActivityMs <= RECENT_MS)
    .sort(bySidebar)
    .slice(0, ISLAND_MAX_SESSIONS)
    .map((s): IslandSession => {
      const key = products ? productForSession(products, s) : null;
      const topic = key ? products?.products[key] : undefined;
      const resolvedAccount =
        s.accountDevice !== undefined
          ? (badge.get(s.accountDevice) ?? null)
          : s.agent === "agy"
            ? currentAgyLabel
            : null;
      return {
        id: s.id,
        agent: s.agent,
        state: s.state,
        title: topic ? `${shortTopicName(topic.name)} · ${s.title}` : s.title,
        project: s.repoLabel ?? s.project,
        topicColor: topic?.color ?? null,
        // Codex/Pi take it from a file's mtime, which has a fraction on Windows; the island wants an integer.
        lastActivity: Math.round(s.lastActivityMs),
        account: resolvedAccount,
        remote: s.remote === true,
      };
    });
  return {
    version: 1,
    now: Math.round(now),
    sessions,
    accounts: allAccounts,
    remote: { online: input.remoteOnline },
  };
}
