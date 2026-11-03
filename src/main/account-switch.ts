import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import type { RateLimit, Session } from "@shared/types";
import type { StatusLineSample } from "@shared/statusline";
import {
  decideSwitch,
  hotCurrent,
  MANUAL_QUIET_MS,
  moveCandidates,
  numberAccounts,
  pickTarget,
  type AccountQuota,
  type AccountsOverview,
  type MoveCandidate,
  type SmartSwitchPrefs,
  type SwitchEvent,
} from "@shared/account-switch";
import type { ReclaudeBinding } from "./reclaude-accounts";

/**
 * Fork (2026-11-03): smart account switching (see shared/account-switch.ts for the rules). Keeps the
 * last known 5h / 7d windows of every reclaude binding — read from the statusLine captures each
 * account's sessions write, and kept in a file because captures of an account nobody uses get
 * pruned — and makes another binding the default when the current one nears its 5h limit.
 * Driven by the renderer's tick (no timers here).
 */
export interface AccountSwitcher {
  /** Fold the latest captures into each account's windows (every overview read). */
  observe(samples: StatusLineSample[]): void;
  /** The accounts with their windows and the switch state; null without reclaude bindings. */
  view(): AccountsOverview | null;
  /** Switch the default when it is due; answers with the accounts and the sessions to move. */
  tick(sessions: Session[]): {
    accounts: AccountsOverview | null;
    candidates: MoveCandidate[];
  };
  setPrefs(prefs: SmartSwitchPrefs): AccountsOverview | null;
  /** The user picked an account by hand: hold automatic switching for a while. */
  noteManualSwitch(): void;
  /** A session was moved onto the new default. */
  noteMoved(): void;
  /** Re-read the bindings (after a login, removal or switch). */
  refresh(): Promise<void>;
}

export interface AccountSwitcherDeps {
  /** `reclaude status --json`'s bindings. */
  readBindings: () => Promise<ReclaudeBinding[]>;
  /** The default binding's device id (`~/.rec/claude/current`). */
  currentDevice: () => string | null;
  /** The Claude login of a binding, when its config dir knows it. */
  claudeEmail: (deviceId: string) => string | null;
  /** Make `orgId` the default and point the app at it. */
  switchTo: (orgId: string) => Promise<void>;
  prefs: () => SmartSwitchPrefs;
  savePrefs: (prefs: SmartSwitchPrefs) => void;
  /** Where the windows and the last switch are kept. */
  statePath: string;
  now?: () => number;
  log?: (message: string, err?: unknown) => void;
}

interface Seen {
  fiveHour?: RateLimit;
  sevenDay?: RateLimit;
  at: number;
}

interface StateFile {
  seen: Record<string, Seen>;
  last?: SwitchEvent;
}

const DEVICE_DIR = /accounts[\\/](\d+)[\\/]config[\\/]?$/;
const BINDINGS_TTL_MS = 60_000;
const SAVE_EVERY_MS = 60_000;

function readState(path: string): StateFile {
  try {
    const v = JSON.parse(readFileSync(path, "utf8")) as Partial<StateFile>;
    return {
      seen: v.seen && typeof v.seen === "object" ? v.seen : {},
      last: v.last && typeof v.last === "object" ? v.last : undefined,
    };
  } catch {
    return { seen: {} };
  }
}

export function createAccountSwitcher(
  deps: AccountSwitcherDeps,
): AccountSwitcher {
  const now = deps.now ?? (() => Date.now());
  const log = deps.log ?? (() => {});
  const state = readState(deps.statePath);
  let bindings: ReclaudeBinding[] | null = null;
  // Each binding's Claude login, read with the bindings (its .claude.json is ~100 KB; views run on
  // every overview poll).
  let emails = new Map<string, string>();
  let bindingsAt = 0;
  let refreshing: Promise<void> | null = null;
  let switching = false;
  let quietUntil = 0;
  let dirty = false;
  let savedAt = 0;

  const save = (force = false) => {
    if (!dirty && !force) return;
    if (!force && now() - savedAt < SAVE_EVERY_MS) return;
    try {
      mkdirSync(dirname(deps.statePath), { recursive: true });
      writeFileSync(deps.statePath, JSON.stringify(state));
      dirty = false;
      savedAt = now();
    } catch (err) {
      log("account-switch: saving state failed", err);
    }
  };

  const refresh = (): Promise<void> => {
    refreshing ??= deps
      .readBindings()
      .then((list) => {
        bindings = list;
        emails = new Map(
          list.map((b) => [
            b.deviceId,
            deps.claudeEmail(b.deviceId) || b.email || b.orgName,
          ]),
        );
      })
      .catch((err: unknown) =>
        log("account-switch: reading bindings failed", err),
      )
      .finally(() => {
        bindingsAt = now();
        refreshing = null;
      });
    return refreshing;
  };

  const view = (): AccountsOverview | null => {
    if (!bindings || bindings.length === 0) return null;
    const current = deps.currentDevice();
    const prefs = deps.prefs();
    const accounts: AccountQuota[] = numberAccounts(bindings).map((b) => {
      const seen = state.seen[b.deviceId];
      return {
        deviceId: b.deviceId,
        orgId: b.orgId,
        email: emails.get(b.deviceId) ?? (b.email || b.orgName),
        n: b.n,
        current: b.deviceId === current,
        ...(seen?.fiveHour ? { fiveHour: seen.fiveHour } : {}),
        ...(seen?.sevenDay ? { sevenDay: seen.sevenDay } : {}),
        ...(seen ? { seenAt: seen.at } : {}),
      };
    });
    const available = accounts.length >= 2;
    const t = now();
    const stuck =
      available &&
      prefs.enabled &&
      hotCurrent(accounts, prefs.threshold, t) !== null &&
      pickTarget(accounts, prefs.threshold, t) === null;
    return {
      accounts,
      smart: {
        ...prefs,
        available,
        stuck,
        ...(state.last ? { last: state.last } : {}),
      },
    };
  };

  return {
    observe(samples) {
      for (const s of samples) {
        const device = DEVICE_DIR.exec(s.configDir ?? "")?.[1];
        const rl = s.rateLimits;
        if (!device || !rl || (!rl.fiveHour && !rl.sevenDay)) continue;
        const prev = state.seen[device];
        if (prev && prev.at >= s.capturedMtimeMs) continue;
        state.seen[device] = {
          ...(rl.fiveHour ? { fiveHour: rl.fiveHour } : {}),
          ...(rl.sevenDay ? { sevenDay: rl.sevenDay } : {}),
          at: s.capturedMtimeMs,
        };
        dirty = true;
      }
      save();
    },
    view,
    tick(sessions) {
      if (!refreshing && now() - bindingsAt > BINDINGS_TTL_MS) void refresh();
      const v = view();
      if (!v) return { accounts: null, candidates: [] };
      const due = switching ? null : decideSwitch(v, now(), quietUntil);
      if (due) {
        switching = true;
        void deps
          .switchTo(due.to.orgId)
          .then(() => {
            state.last = {
              at: now(),
              from: due.from.deviceId,
              to: due.to.deviceId,
              fromPct: Math.round(due.pct),
              moved: 0,
            };
            save(true);
            return refresh();
          })
          .catch((err: unknown) => {
            log("account-switch: switching failed", err);
            // Don't hammer reclaude with a switch that keeps failing.
            quietUntil = now() + 5 * 60_000;
          })
          .finally(() => {
            switching = false;
          });
      }
      return { accounts: v, candidates: moveCandidates(sessions, v, now()) };
    },
    setPrefs(prefs) {
      deps.savePrefs(prefs);
      return view();
    },
    noteManualSwitch() {
      quietUntil = now() + MANUAL_QUIET_MS;
      void refresh();
    },
    noteMoved() {
      if (!state.last) return;
      state.last = { ...state.last, moved: state.last.moved + 1 };
      save(true);
    },
    refresh,
  };
}
