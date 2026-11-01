import { describe, expect, it } from "vitest";
import { topicSiblings } from "../../src/renderer/src/shell/session-nav";
import type { Session } from "@shared/types";

const mk = (o: Partial<Session>): Session =>
  ({
    id: "s",
    title: "Session",
    state: "idle",
    management: "managed",
    lastActivityMs: 0,
    createdMs: 0,
    ...o,
  }) as Session;

describe("topicSiblings", () => {
  const now = 10 * 24 * 60 * 60 * 1000;
  const topic: Record<string, string> = {
    me: "cockpit",
    run: "cockpit",
    ask: "cockpit",
    old: "cockpit",
    stale: "cockpit",
    other: "ciyu",
    child: "cockpit",
  };
  const sessions = [
    mk({ id: "me", state: "working" }),
    mk({ id: "run", state: "working", lastActivityMs: now - 10 }),
    mk({ id: "ask", state: "waiting", lastActivityMs: now - 50 }),
    mk({ id: "old", state: "ended", lastActivityMs: now - 1000 }),
    mk({ id: "stale", state: "ended", lastActivityMs: 1 }),
    mk({ id: "other", state: "waiting", lastActivityMs: now }),
    mk({ id: "child", state: "working", parentSessionId: "run" }),
  ];

  it("lists the same topic's other root sessions, most urgent first, recent only", () => {
    expect(
      topicSiblings(sessions[0], sessions, (s) => topic[s.id] ?? null, now).map(
        (s) => s.id,
      ),
    ).toEqual(["ask", "run", "old"]);
  });

  it("offers nothing for an untagged session", () => {
    expect(topicSiblings(mk({ id: "x" }), sessions, () => null, now)).toEqual(
      [],
    );
  });
});
