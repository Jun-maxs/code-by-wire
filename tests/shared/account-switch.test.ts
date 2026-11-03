import { describe, expect, it } from "vitest";
import {
  decideSwitch,
  launchAccount,
  MANUAL_QUIET_MS,
  moveCandidates,
  pendingAccount,
  normalizePrefs,
  numberAccounts,
  pickTarget,
  readyToMove,
  windowPct,
  type AccountQuota,
  type AccountsOverview,
  type SessionAccountPin,
} from "../../src/shared/account-switch";
import type { Session } from "../../src/shared/types";

const NOW = 1_800_000_000_000;
const HOUR = 3_600_000;

const acct = (
  deviceId: string,
  five: number | null,
  extra: Partial<AccountQuota> = {},
): AccountQuota => ({
  deviceId,
  orgId: `o${deviceId}`,
  email: `${deviceId}@x`,
  n: 0,
  current: false,
  ...(five === null
    ? {}
    : { fiveHour: { usedPct: five, resetsAt: NOW + HOUR } }),
  ...extra,
});

const view = (
  accounts: AccountQuota[],
  smart: Partial<AccountsOverview["smart"]> = {},
): AccountsOverview => ({
  accounts,
  smart: {
    enabled: true,
    threshold: 85,
    available: accounts.length >= 2,
    stuck: false,
    ...smart,
  },
});

const session = (id: string, extra: Partial<Session> = {}): Session =>
  ({
    id,
    agent: "claude",
    management: "managed",
    state: "idle",
    lastActivityMs: NOW - 30_000,
    accountDevice: "1",
    ...extra,
  }) as Session;

describe("windowPct", () => {
  it("reads a reset window as unused and an unknown one as null", () => {
    expect(windowPct({ usedPct: 90, resetsAt: NOW - 1 }, NOW)).toBe(0);
    expect(windowPct({ usedPct: 90, resetsAt: NOW + 1 }, NOW)).toBe(90);
    expect(windowPct(undefined, NOW)).toBeNull();
  });
});

describe("normalizePrefs", () => {
  it("defaults to on at 85% and refuses thresholds off the list", () => {
    expect(normalizePrefs(undefined)).toEqual({ enabled: true, threshold: 85 });
    expect(normalizePrefs({ enabled: false, threshold: 77 })).toEqual({
      enabled: false,
      threshold: 85,
    });
    expect(normalizePrefs({ threshold: 90 }).threshold).toBe(90);
  });
});

describe("numberAccounts", () => {
  it("numbers by device id, not by listing order", () => {
    const out = numberAccounts([{ deviceId: "48389" }, { deviceId: "45797" }]);
    expect(out.map((a) => [a.deviceId, a.n])).toEqual([
      ["45797", 1],
      ["48389", 2],
    ]);
  });
});

describe("pickTarget / decideSwitch", () => {
  it("switches off a hot default to the account with the most room", () => {
    const v = view([
      acct("1", 88, { current: true }),
      acct("2", 60),
      acct("3", 20),
    ]);
    const due = decideSwitch(v, NOW, 0);
    expect(due?.to.deviceId).toBe("3");
    expect(due?.pct).toBe(88);
  });

  it("counts an account never seen as unused, and one past its reset as empty", () => {
    const v = view([
      acct("1", 90, { current: true }),
      acct("2", null),
      acct("3", 99, { fiveHour: { usedPct: 99, resetsAt: NOW - 5 } }),
    ]);
    expect(pickTarget(v.accounts, 85, NOW)?.deviceId).toMatch(/^[23]$/);
  });

  it("needs headroom under the threshold, and skips a nearly full week", () => {
    expect(
      pickTarget([acct("1", 90, { current: true }), acct("2", 75)], 85, NOW),
    ).toBeNull();
    expect(
      pickTarget(
        [
          acct("1", 90, { current: true }),
          acct("2", 10, { sevenDay: { usedPct: 97, resetsAt: NOW + HOUR } }),
        ],
        85,
        NOW,
      ),
    ).toBeNull();
  });

  it("does nothing below the threshold, when off, with one account, or while quiet", () => {
    const accounts = [acct("1", 84, { current: true }), acct("2", 0)];
    expect(decideSwitch(view(accounts), NOW, 0)).toBeNull();
    const hot = [acct("1", 95, { current: true }), acct("2", 0)];
    expect(decideSwitch(view(hot, { enabled: false }), NOW, 0)).toBeNull();
    expect(decideSwitch(view([hot[0]]), NOW, 0)).toBeNull();
    expect(decideSwitch(view(hot), NOW, NOW + 1)).toBeNull();
    expect(decideSwitch(view(hot), NOW, 0)?.to.deviceId).toBe("2");
  });
});

describe("moveCandidates", () => {
  const after = view([acct("1", 90), acct("2", 5, { current: true })]);

  it("offers idle managed Claude sessions left on the full account", () => {
    const out = moveCandidates(
      [
        session("a"),
        session("busy", { state: "working" }),
        session("asking", { state: "waiting" }),
        session("outside", { management: "observed" }),
        session("phone", { remote: true }),
        session("codex", { agent: "codex" }),
        session("onNew", { accountDevice: "2" }),
        session("unknown", { accountDevice: undefined }),
      ],
      after,
      NOW,
    );
    expect(out).toEqual([{ id: "a", idleMs: 30_000, to: "2" }]);
  });

  it("moves each session to the account with the most room, not just the default", () => {
    const three = view([
      acct("1", 90, { current: true }),
      acct("2", 60),
      acct("3", 10),
    ]);
    const out = moveCandidates(
      [session("a"), session("b", { accountDevice: "2" })],
      three,
      NOW,
    );
    // a sits on a full account (even though it is the default); b's account still has room.
    expect(out).toEqual([{ id: "a", idleMs: 30_000, to: "3" }]);
  });

  it("leaves a session the user moved by hand a moment ago, and one whose move is pending", () => {
    const pins: Record<string, SessionAccountPin> = {
      hand: { device: "1", org: "o1", by: "manual", at: NOW - 60_000 },
      old: {
        device: "1",
        org: "o1",
        by: "manual",
        at: NOW - MANUAL_QUIET_MS - 1,
      },
      auto: { device: "1", org: "o1", by: "auto", at: NOW - 60_000 },
    };
    const out = moveCandidates(
      [
        session("hand"),
        session("old"),
        session("auto"),
        session("pending", { accountWant: "2" }),
      ],
      after,
      NOW,
      (id) => pins[id],
    );
    expect(out.map((c) => c.id)).toEqual(["old", "auto"]);
  });

  it("moves nothing when no other account has room, or switching is off", () => {
    const stuck = view([acct("1", 90), acct("2", 92, { current: true })]);
    expect(moveCandidates([session("a")], stuck, NOW)).toEqual([]);
    const off = { ...after, smart: { ...after.smart, enabled: false } };
    expect(moveCandidates([session("a")], off, NOW)).toEqual([]);
  });
});

describe("launchAccount", () => {
  const pin = (
    device: string,
    extra: Partial<SessionAccountPin> = {},
  ): SessionAccountPin => ({
    device,
    org: `o${device}`,
    by: "auto",
    at: NOW - 2 * MANUAL_QUIET_MS,
    ...extra,
  });

  it("starts a session on its own account while that has room", () => {
    const v = view([acct("1", 40, { current: true }), acct("2", 50)]);
    expect(launchAccount(pin("2"), v, NOW)).toEqual({
      account: v.accounts[1],
      moved: false,
    });
  });

  it("starts it where there is room once its account is at the switch point", () => {
    const v = view([acct("1", 20, { current: true }), acct("2", 88)]);
    expect(launchAccount(pin("2"), v, NOW)?.account.deviceId).toBe("1");
    expect(launchAccount(pin("2"), v, NOW)?.moved).toBe(true);
  });

  it("keeps a fresh hand-picked account, a full one with nowhere to go, and one when switching is off", () => {
    const v = view([acct("1", 20, { current: true }), acct("2", 88)]);
    expect(
      launchAccount(pin("2", { by: "manual", at: NOW - 1000 }), v, NOW)?.moved,
    ).toBe(false);
    const full = view([acct("1", 80, { current: true }), acct("2", 88)]);
    expect(launchAccount(pin("2"), full, NOW)?.account.deviceId).toBe("2");
    const off = view([acct("1", 20), acct("2", 88)], { enabled: false });
    expect(launchAccount(pin("2"), off, NOW)?.account.deviceId).toBe("2");
  });

  it("has no answer when the account is gone", () => {
    expect(launchAccount(pin("9"), view([acct("1", 0)]), NOW)).toBeNull();
  });
});

describe("pendingAccount", () => {
  it("is the account a running managed session waits to move to", () => {
    expect(pendingAccount(session("a", { accountWant: "2" }))).toBe("2");
    expect(pendingAccount(session("a", { accountWant: "1" }))).toBeNull();
    expect(pendingAccount(session("a"))).toBeNull();
    expect(
      pendingAccount(session("a", { accountWant: "2", state: "ended" })),
    ).toBeNull();
    expect(
      pendingAccount(
        session("a", { accountWant: "2", management: "observed" }),
      ),
    ).toBeNull();
  });
});

describe("readyToMove", () => {
  const c = { id: "a", idleMs: 30_000, to: "2" };
  it("waits longer for a session on screen and leaves a typed-into one alone", () => {
    const quiet = { sinceInputMs: Infinity, sinceTriedMs: Infinity };
    expect(readyToMove(c, { ...quiet, focused: false })).toBe(true);
    expect(readyToMove(c, { ...quiet, focused: true })).toBe(false);
    expect(
      readyToMove({ ...c, idleMs: 90_000 }, { ...quiet, focused: true }),
    ).toBe(true);
    expect(
      readyToMove(c, {
        focused: false,
        sinceInputMs: 5_000,
        sinceTriedMs: Infinity,
      }),
    ).toBe(false);
    expect(
      readyToMove(c, {
        focused: false,
        sinceInputMs: Infinity,
        sinceTriedMs: 60_000,
      }),
    ).toBe(false);
  });
});
