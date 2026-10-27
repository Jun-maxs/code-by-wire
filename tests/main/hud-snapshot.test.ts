import { describe, expect, it } from "vitest";
import { buildHudSnapshot, hourlyTimeline } from "../../src/main/hud/snapshot";
import type { Account, Session } from "../../src/shared/types";

const NOW = Date.parse("2026-10-26T12:30:00Z");
const HOUR = 3_600_000;

function session(over: Partial<Session>): Session {
  return {
    id: "s",
    title: "t",
    project: "p",
    state: "idle",
    management: "observed",
    agent: "claude",
    resumable: false,
    model: "opus",
    contextPct: 12,
    contextWindow: 200_000,
    usage: {
      inputTokens: 10,
      outputTokens: 20,
      cacheReadTokens: 30,
      cacheCreationTokens: 40,
      cacheCreation5mTokens: 0,
      cacheCreation1hTokens: 0,
    },
    lastActivityMs: NOW - 60_000,
    createdMs: NOW - HOUR,
    awaitingUser: false,
    ...over,
  } as Session;
}

const account: Account = {
  billingMode: "subscription",
  email: "me@example.com",
  fiveHour: { usedPct: 35, resetsAt: NOW + HOUR },
  sevenDay: { usedPct: 92, resetsAt: NOW + 2 * 86_400_000 },
};

const base = {
  account: null,
  timeline: [],
  now: NOW,
  language: "zh" as const,
  appearance: "dark" as const,
};

describe("buildHudSnapshot", () => {
  it("turns Claude's account windows into quotas with Agent HUD's levels", () => {
    const snap = buildHudSnapshot({ ...base, sessions: [], account });
    expect(snap.quotas.map((q) => [q.id, q.usedPercent, q.status])).toEqual([
      ["claude:fiveHour", 35, "normal"],
      ["claude:sevenDay", 92, "critical"],
    ]);
    expect(snap.quotas[0].windowDurationSeconds).toBe(5 * 3600);
    expect(snap.accounts?.[0].label).toBe("me@example.com");
  });

  it("falls back to the newest Claude row's windows when the usage API has none", () => {
    const old = session({
      id: "a",
      lastActivityMs: NOW - HOUR,
      rateLimits: { fiveHour: { usedPct: 50, resetsAt: NOW + HOUR } },
    });
    const fresh = session({
      id: "b",
      rateLimits: { fiveHour: { usedPct: 4, resetsAt: NOW + HOUR } },
    });
    const snap = buildHudSnapshot({
      ...base,
      sessions: [old, fresh],
      account: { billingMode: "subscription" },
    });
    expect(snap.quotas.map((q) => [q.id, q.usedPercent])).toEqual([
      ["claude:fiveHour", 4],
    ]);
  });

  it("leaves out an agent turned off on Settings → Agents", () => {
    const snap = buildHudSnapshot({
      ...base,
      sessions: [session({ id: "c", agent: "codex" }), session({ id: "a" })],
      account,
      disabledAgents: ["claude"],
    });
    expect(snap.sessions.map((s) => s.id)).toEqual(["c"]);
    expect(snap.quotas).toEqual([]);
    expect(snap.providers.find((p) => p.id === "claude")?.enabled).toBe(false);
  });

  it("reads Codex windows and relay usage off the agent's rows", () => {
    const codex = session({
      id: "c1",
      agent: "codex",
      rateLimits: {
        fiveHour: { usedPct: 10, resetsAt: NOW - 1, windowMinutes: 300 },
      },
      relayUsage: { host: "relay.io", spent: 0.12, currency: "CNY" },
    });
    const pi = session({
      id: "p1",
      agent: "pi",
      relayUsage: {
        host: "relay.io",
        spent: 1,
        remaining: 3,
        usedPct: 25,
        currency: "USD",
      },
    });
    const snap = buildHudSnapshot({ ...base, sessions: [codex, pi] });
    expect(snap.quotas).toHaveLength(1);
    expect(snap.quotas[0].status).toBe("stale");
    expect(
      snap.billing.map((b) => [b.vendor, b.label, b.amount, b.currency]),
    ).toEqual([
      ["codex", "relay.io 已用", 0.12, "CNY"],
      ["pi", "relay.io 已用", 1, "USD"],
      ["pi", "relay.io 剩余", 3, "USD"],
    ]);
    expect(
      snap.providers.find((p) => p.id === "pi")?.accountStatus?.status,
    ).toBe("ready");
  });

  it("lists sessions newest first in Agent HUD's state vocabulary", () => {
    const snap = buildHudSnapshot({
      ...base,
      sessions: [
        session({ id: "old", state: "ended", lastActivityMs: NOW - HOUR }),
        session({ id: "live", state: "working", agent: "pi" }),
      ],
    });
    expect(snap.sessions.map((s) => [s.id, s.state, s.source])).toEqual([
      ["live", "running", "pi"],
      ["old", "idle", "claude"],
    ]);
    expect(snap.sessions[0].tokens).toBe(100);
    expect(snap.providers.find((p) => p.id === "claude")?.sessions).toBe(0);
    expect(snap.providers.find((p) => p.id === "pi")?.sessions).toBe(1);
  });
});

describe("hourlyTimeline", () => {
  it("fills every hour of the window, oldest first", () => {
    const last = Math.floor(NOW / HOUR);
    const points = hourlyTimeline(
      [{ hour: last - 1, input: 1, output: 2, cache: 3 }],
      NOW,
      3,
    );
    expect(points.map((p) => p.tokens)).toEqual([0, 6, 0]);
    expect(points[2].timestamp).toBe(new Date(last * HOUR).toISOString());
  });
});
