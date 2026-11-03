import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  createSessionAccountStore,
  createTerminalAccounts,
} from "../../src/main/session-accounts";
import type {
  AccountQuota,
  AccountsOverview,
} from "../../src/shared/account-switch";

const NOW = 1_800_000_000_000;
const HOUR = 3_600_000;

const acct = (
  deviceId: string,
  five: number,
  current = false,
): AccountQuota => ({
  deviceId,
  orgId: `9${deviceId}`,
  email: `${deviceId}@x`,
  n: Number(deviceId),
  current,
  fiveHour: { usedPct: five, resetsAt: NOW + HOUR },
});

const view = (accounts: AccountQuota[]): AccountsOverview => ({
  accounts,
  smart: { enabled: true, threshold: 85, available: true, stuck: false },
});

const store = () =>
  createSessionAccountStore({
    dir: mkdtempSync(join(tmpdir(), "session-accounts-")),
    now: () => NOW,
  });

describe("session account store", () => {
  it("keeps pins across reads, gives a fork its source's, and follows a /clear", () => {
    const s = store();
    s.set("a", { device: "2", org: "92", by: "manual", at: NOW });
    expect(s.get("a")).toEqual({
      device: "2",
      org: "92",
      by: "manual",
      at: NOW,
    });
    s.copy("a", "fork");
    expect(s.get("fork")?.device).toBe("2");
    s.noteLaunch("a", "2", NOW);
    s.follow("a", "cleared");
    expect(s.get("cleared")?.device).toBe("2");
    expect(s.get("a")?.device).toBe("2"); // its own resume still starts there
    expect(s.launchOf("cleared")).toEqual({ device: "2", at: NOW });
  });

  it("drops malformed entries and pins untouched for months", () => {
    const dir = mkdtempSync(join(tmpdir(), "session-accounts-"));
    writeFileSync(
      join(dir, "session-accounts.json"),
      JSON.stringify({
        ok: { device: "2", org: "92", by: "auto", at: NOW },
        bad: { device: "../x", org: "92", by: "auto", at: NOW },
        stale: {
          device: "2",
          org: "92",
          by: "auto",
          at: NOW - 100 * 24 * HOUR,
        },
      }),
    );
    const s = createSessionAccountStore({ dir, now: () => NOW });
    expect(Object.keys(s.read()).sort()).toEqual(["ok", "stale"]);
    s.set("new", { device: "1", org: "91", by: "manual", at: NOW });
    const saved = JSON.parse(
      readFileSync(join(dir, "session-accounts.json"), "utf8"),
    ) as Record<string, unknown>;
    expect(Object.keys(saved).sort()).toEqual(["new", "ok"]);
  });
});

describe("terminal accounts", () => {
  it("launches a session with its own account through RECLAUDE_ORG and records it", () => {
    const s = store();
    const v = view([acct("1", 10, true), acct("2", 20)]);
    const t = createTerminalAccounts(s, () => v, {
      current: () => "1",
      now: () => NOW,
    });
    s.set("a", { device: "2", org: "92", by: "manual", at: NOW });
    expect(t.launch("a", false)).toEqual({ RECLAUDE_ORG: "92" });
    expect(s.launchOf("a")).toEqual({ device: "2", at: NOW });
    // No account of its own: the default, as before.
    expect(t.launch("b", false)).toEqual({});
    expect(s.launchOf("b")).toEqual({ device: "1", at: NOW });
  });

  it("starts a pinned session where there is room when its own account is full", () => {
    const s = store();
    const v = view([acct("1", 10, true), acct("2", 90)]);
    const t = createTerminalAccounts(s, () => v, {
      current: () => "1",
      now: () => NOW,
    });
    s.set("a", { device: "2", org: "92", by: "auto", at: NOW - 2 * HOUR });
    expect(t.launch("a", false)).toEqual({ RECLAUDE_ORG: "91" });
    expect(s.get("a")).toMatchObject({ device: "1", org: "91", by: "auto" });
  });

  it("trusts a pin before the accounts are read, and leaves remote launches alone", () => {
    const s = store();
    const t = createTerminalAccounts(s, () => null, {
      current: () => "1",
      now: () => NOW,
    });
    s.set("a", { device: "2", org: "92", by: "auto", at: NOW });
    expect(t.launch("a", false)).toEqual({ RECLAUDE_ORG: "92" });
    expect(t.launch("a", true)).toEqual({});
    expect(s.launchOf("a")).toBeUndefined();
  });

  it("never throws: a broken lookup launches on the default", () => {
    const s = store();
    const t = createTerminalAccounts(
      s,
      () => {
        throw new Error("boom");
      },
      { current: () => "1", now: () => NOW },
    );
    s.set("a", { device: "2", org: "92", by: "auto", at: NOW });
    expect(t.launch("a", false)).toEqual({});
  });
});
