import { describe, expect, it } from "vitest";
import { cleanupSettings, pickCleanup } from "@shared/session-cleanup";

const DAY = 86_400_000;
const now = 100 * DAY;
const none = { board: new Set<string>(), renamed: new Set<string>() };

describe("pickCleanup", () => {
  it("takes only ended sessions idle past the cutoff, oldest first", () => {
    const pick = pickCleanup(
      [
        { id: "live-old", state: "idle", lastActivityMs: now - 90 * DAY },
        { id: "recent", state: "ended", lastActivityMs: now - 5 * DAY },
        { id: "old", state: "ended", lastActivityMs: now - 40 * DAY },
        { id: "older", state: "ended", lastActivityMs: now - 80 * DAY },
        { id: "unknown-time", state: "ended", lastActivityMs: 0 },
      ],
      30,
      now,
      none,
    );
    expect(pick.ids).toEqual(["older", "old"]);
  });

  it("keeps pinned, board-attached and renamed sessions and counts them", () => {
    const old = now - 60 * DAY;
    const pick = pickCleanup(
      [
        { id: "p", state: "ended", lastActivityMs: old, pinnedAtMs: 1 },
        { id: "b", state: "ended", lastActivityMs: old },
        { id: "r", state: "ended", lastActivityMs: old },
        { id: "x", state: "ended", lastActivityMs: old },
      ],
      30,
      now,
      { board: new Set(["b"]), renamed: new Set(["r"]) },
    );
    expect(pick.ids).toEqual(["x"]);
    expect(pick.kept).toEqual({ pinned: 1, board: 1, renamed: 1 });
  });
});

describe("cleanupSettings", () => {
  it("is off at 30 days when missing or malformed", () => {
    expect(cleanupSettings(undefined)).toEqual({ enabled: false, days: 30 });
    expect(cleanupSettings({ enabled: true, days: -3 })).toEqual({
      enabled: true,
      days: 30,
    });
  });
});
