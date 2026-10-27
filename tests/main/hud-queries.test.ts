import { describe, expect, it } from "vitest";
import {
  statisticsResponse,
  type TurnBucketRow,
} from "../../src/main/hud/queries";
import type { StatisticsQuery } from "../../src/shared/hud-protocol";

const HOUR = 3_600_000;
const NOW = Date.parse("2026-10-27T10:30:00Z");
const hour = Math.floor(NOW / HOUR);

const row = (over: Partial<TurnBucketRow>): TurnBucketRow => ({
  bucket: hour,
  agent: "claude",
  model: "claude-opus-5-5",
  input: 10,
  output: 5,
  cacheRead: 100,
  cacheWrite: 0,
  ...over,
});

const query: StatisticsQuery = {
  from: new Date((hour - 2) * HOUR).toISOString(),
  to: new Date(NOW).toISOString(),
  bucketMinutes: 60,
  tokenKinds: ["input", "output"],
  timeZone: "UTC",
};
const agents = [
  { id: "claude", name: "Claude Code" },
  { id: "codex", name: "Codex" },
];

describe("statisticsResponse", () => {
  it("splits each bucket by model and sums each agent's series", () => {
    const rows = [
      row({}),
      row({ bucket: hour - 1, agent: "codex", model: "gpt-6", input: 40 }),
    ];
    const r = statisticsResponse(query, rows, agents, NOW, {
      hours: rows,
      days: [],
    });
    expect(r.totals.selectedTokens).toBe(60);
    expect(r.buckets.map((b) => b.selectedTokens)).toEqual([0, 45, 15]);
    expect(r.buckets[2].models).toEqual({ "claude:claude-opus-5-5": 15 });
    expect(r.providers.map((p) => [p.id, p.selectedTokens, p.series])).toEqual([
      ["codex", 45, [0, 45, 0]],
      ["claude", 15, [0, 0, 15]],
    ]);
    expect(r.recent.find((p) => p.id === "7d")?.totals.selectedTokens).toBe(60);
    expect(r.heatmap.tokens.flat().reduce((a, b) => a + b, 0)).toBe(60);
  });

  it("keeps only the agents and models the query names", () => {
    const rows = [row({}), row({ agent: "codex", model: "gpt-6" })];
    const r = statisticsResponse(
      { ...query, providers: ["codex"] },
      rows,
      agents,
      NOW,
    );
    expect(r.providers.map((p) => p.id)).toEqual(["codex"]);
    expect(r.models.map((m) => m.id)).toEqual(["codex:gpt-6"]);
  });
});
