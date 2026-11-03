import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  launchAccount,
  type AccountsOverview,
  type SessionAccountPin,
} from "@shared/account-switch";
import { readTextOrNull } from "./claude-config";
import { currentDevice } from "./reclaude-accounts";

/**
 * Fork (2026-11-03): each Claude session's own reclaude account (see SessionAccountPin), kept in
 * userData/session-accounts.json beside remote-sessions.json so a resume after a restart still
 * starts where the session was put. Also remembers, in memory, which account every pty of this run
 * was started on: until a session writes its first statusLine capture there, that is the only
 * record of where it runs.
 */
export interface SessionAccountStore {
  /** Every pin, by session id. {} when the file is absent or corrupt. */
  read(): Record<string, SessionAccountPin>;
  get(id: string): SessionAccountPin | undefined;
  set(id: string, pin: SessionAccountPin): void;
  /** A fork starts where its source runs: copy the source's pin, if any. */
  copy(from: string, to: string): void;
  /** Follow a session-id re-key (/clear rotation): the pty runs on under `to`, so the pin is copied
   *  and the launch record carried over; `from` keeps its pin for its own resume. */
  follow(from: string, to: string): void;
  /** Record the account a pty was just started on (null: unknown). */
  noteLaunch(id: string, device: string | null, at: number): void;
  launchOf(id: string): { device: string; at: number } | undefined;
}

/** Pins of sessions untouched this long are dropped on the next write. */
const KEEP_MS = 90 * 24 * 3_600_000;

const isPin = (v: unknown): v is SessionAccountPin => {
  const p = v as Partial<SessionAccountPin> | null;
  return (
    !!p &&
    typeof p.device === "string" &&
    /^\d+$/.test(p.device) &&
    typeof p.org === "string" &&
    /^\d+$/.test(p.org) &&
    (p.by === "manual" || p.by === "auto") &&
    typeof p.at === "number" &&
    Number.isFinite(p.at)
  );
};

export function createSessionAccountStore(deps: {
  dir: string;
  now?: () => number;
}): SessionAccountStore {
  const file = join(deps.dir, "session-accounts.json");
  const now = deps.now ?? Date.now;
  const launches = new Map<string, { device: string; at: number }>();

  function read(): Record<string, SessionAccountPin> {
    const raw = readTextOrNull(file);
    if (raw === null) return {};
    try {
      const v: unknown = JSON.parse(raw);
      if (!v || typeof v !== "object" || Array.isArray(v)) return {};
      const out: Record<string, SessionAccountPin> = {};
      for (const [k, pin] of Object.entries(v)) if (isPin(pin)) out[k] = pin;
      return out;
    } catch {
      return {}; // a corrupt file reads as "every session follows the default"
    }
  }

  function write(next: Record<string, SessionAccountPin>): void {
    const cutoff = now() - KEEP_MS;
    for (const [id, pin] of Object.entries(next))
      if (pin.at < cutoff) delete next[id];
    mkdirSync(deps.dir, { recursive: true });
    writeFileSync(file, JSON.stringify(next, null, 2) + "\n");
  }

  function copy(from: string, to: string): void {
    const next = read();
    if (!next[from] || from === to || next[to]) return;
    next[to] = next[from];
    write(next);
  }

  return {
    read,
    get: (id) => read()[id],
    set(id, pin) {
      const next = read();
      next[id] = pin;
      write(next);
    },
    copy,
    follow(from, to) {
      if (from === to) return;
      const launch = launches.get(from);
      if (launch && !launches.has(to)) launches.set(to, launch);
      copy(from, to);
    },
    noteLaunch(id, device, at) {
      if (device) launches.set(id, { device, at });
      else launches.delete(id);
    },
    launchOf: (id) => launches.get(id),
  };
}

/**
 * The env a Claude launch of `id` needs, and the account it lands on. A session with its own
 * account starts there through RECLAUDE_ORG (reclaude then runs it in that binding's config dir,
 * whatever CLAUDE_CONFIG_DIR the app holds) — or on the account with room when launchAccount moves
 * it, the pin moving along. One without starts on the default, as before; so does one whose account
 * is gone. Before the bindings are read (`view` null) a pin is taken at its word.
 */
export function accountLaunch(
  id: string,
  deps: {
    store: SessionAccountStore;
    view: AccountsOverview | null;
    /** The default binding's device id. */
    current: string | null;
    now: number;
  },
): { env: Record<string, string>; device: string | null } {
  const { store, view, current, now } = deps;
  const pin = store.get(id);
  if (pin && !view)
    return { env: { RECLAUDE_ORG: pin.org }, device: pin.device };
  const at = pin && view ? launchAccount(pin, view, now) : null;
  if (!at) return { env: {}, device: current };
  if (at.moved)
    store.set(id, {
      device: at.account.deviceId,
      org: at.account.orgId,
      by: "auto",
      at: now,
    });
  return {
    env: { RECLAUDE_ORG: at.account.orgId },
    device: at.account.deviceId,
  };
}

/** What the terminal layer asks at every Claude launch (terminal/ipc.ts `accounts`). */
export interface TerminalAccounts {
  launch(id: string, remote: boolean): Record<string, string>;
  inherit(from: string, to: string): void;
}

/** TerminalAccounts over the pin store. A remote (phone) session is launched by the remote command,
 *  which picks its own account, so it gets no RECLAUDE_ORG and no launch record. Never throws: a
 *  failure here costs the session its own account, not its launch. */
export function createTerminalAccounts(
  store: SessionAccountStore,
  view: () => AccountsOverview | null,
  deps: {
    current?: () => string | null;
    now?: () => number;
    log?: (message: string, err: unknown) => void;
  } = {},
): TerminalAccounts {
  const current = deps.current ?? (() => currentDevice());
  const now = deps.now ?? Date.now;
  return {
    launch(id, remote) {
      const at = now();
      try {
        if (remote) {
          store.noteLaunch(id, null, at);
          return {};
        }
        const r = accountLaunch(id, {
          store,
          view: view(),
          current: current(),
          now: at,
        });
        store.noteLaunch(id, r.device, at);
        return r.env;
      } catch (err) {
        deps.log?.("session account: launch lookup failed", err);
        return {};
      }
    },
    inherit: (from, to) => store.copy(from, to),
  };
}
