import { describe, expect, it } from "vitest";
import { hydrate } from "../../src/main/db/store";
import { windowForUsage } from "@shared/models";
import { applyLearnedWindows, type StatusLineSample } from "@shared/statusline";
import type { PersistedSession, Session } from "@shared/types";

function persisted(over: Partial<PersistedSession>): PersistedSession {
  return {
    id: "s1",
    title: "t",
    project: "p",
    cwd: "",
    originCwd: "",
    state: "idle",
    management: "observed",
    agent: "claude",
    model: "opus",
    modelRaw: "claude-opus-5-5",
    lastActivityMs: 0,
    createdMs: 0,
    awaitingUser: false,
    transcriptMtimeMs: 0,
    usage: {
      inputTokens: 0,
      outputTokens: 0,
      cacheReadTokens: 0,
      cacheCreationTokens: 0,
      cacheCreation5mTokens: 0,
      cacheCreation1hTokens: 0,
    },
    contextTokens: 0,
    ...over,
  };
}

function sample(
  id: string,
  contextWindow: number | null,
  modelId: string | null,
): StatusLineSample {
  return {
    sessionId: id,
    capturedMtimeMs: 0,
    costUsd: null,
    linesAdded: null,
    linesRemoved: null,
    contextPct: null,
    contextWindow,
    liveContext: null,
    modelId,
    modelDisplayName: null,
    sessionName: null,
    version: null,
    effortLevel: null,
    cwd: null,
    sessionClockMs: null,
    apiDurationMs: null,
    pr: null,
    rateLimits: null,
  };
}

describe("windowForUsage", () => {
  it("keeps the assumed window while usage fits", () => {
    expect(windowForUsage(200_000, 150_000)).toBe(200_000);
  });
  it("steps up to 1M when usage already exceeds the assumed window", () => {
    expect(windowForUsage(200_000, 227_000)).toBe(1_000_000);
  });
  it("never shrinks a window that is already larger", () => {
    expect(windowForUsage(2_000_000, 1_500_000)).toBe(2_000_000);
  });
});

describe("hydrate: an uncaptured session whose usage exceeds 200k", () => {
  it("is measured against 1M, not pinned at 100%", () => {
    const s = hydrate(persisted({ contextTokens: 227_000 }));
    expect(s.contextWindow).toBe(1_000_000);
    expect(s.contextPct).toBe(23);
  });
  it("stays at the family default while usage fits", () => {
    const s = hydrate(persisted({ contextTokens: 50_000 }));
    expect(s.contextWindow).toBe(200_000);
    expect(s.contextPct).toBe(25);
  });
});

describe("applyLearnedWindows", () => {
  const captured = {
    ...hydrate(persisted({ id: "a", contextTokens: 100_000 })),
    contextWindow: 1_000_000,
    contextPct: 10,
  };
  const uncaptured = hydrate(persisted({ id: "b", contextTokens: 60_000 }));
  const otherModel = hydrate(
    persisted({
      id: "c",
      modelRaw: "claude-sonnet-5-5",
      contextTokens: 60_000,
    }),
  );

  it("gives an uncaptured session the window a capture reported for the same model", () => {
    const byId = new Map([["a", sample("a", 1_000_000, "claude-opus-5-5")]]);
    const [, b, c] = applyLearnedWindows(
      [captured, uncaptured, otherModel],
      byId,
    ) as Session[];
    expect(b.contextWindow).toBe(1_000_000);
    expect(b.contextPct).toBe(6);
    expect(c.contextWindow).toBe(200_000);
  });
  it("leaves sessions alone when no capture reported a window", () => {
    const byId = new Map([["a", sample("a", null, "claude-opus-5-5")]]);
    const out = applyLearnedWindows([uncaptured], byId);
    expect(out[0]).toBe(uncaptured);
  });
  it("never shrinks: a learned smaller window does not override a larger inferred one", () => {
    const big = hydrate(persisted({ id: "d", contextTokens: 300_000 }));
    const byId = new Map([["a", sample("a", 200_000, "claude-opus-5-5")]]);
    expect(applyLearnedWindows([big], byId)[0].contextWindow).toBe(1_000_000);
  });
});
