import { describe, expect, it } from "vitest";
import type { Session } from "@shared/types";
import {
  enterSplit,
  neighborAfterRemove,
  paneTaskGroups,
  placeInSplit,
  pruneSplit,
  renameInSplit,
  splitColumns,
} from "../../src/renderer/src/shell/split-view";

/** Only the fields the split helpers read. */
function s(
  id: string,
  state: Session["state"],
  lastActivityMs = 0,
  management: Session["management"] = "managed",
): Session {
  return { id, state, management, lastActivityMs } as Session;
}

describe("placeInSplit", () => {
  it("keeps a session that is already in the grid where it is", () => {
    expect(placeInSplit(["a", "b"], "b", "a")).toEqual(["a", "b"]);
  });
  it("appends while there is room", () => {
    expect(placeInSplit(["a"], "b", "a")).toEqual(["a", "b"]);
  });
  it("replaces the focused pane once six are open", () => {
    const full = ["a", "b", "c", "d", "e", "f"];
    expect(placeInSplit(full, "g", "c")).toEqual([
      "a",
      "b",
      "g",
      "d",
      "e",
      "f",
    ]);
    expect(placeInSplit(full, "g", null)[5]).toBe("g");
  });
});

describe("enterSplit", () => {
  const sessions = [
    s("cur", "idle", 1),
    s("work", "working", 5),
    s("wait", "waiting", 2),
    s("done", "ended", 9),
    s("elsewhere", "working", 9, "observed"),
  ];
  it("fills in running sessions, waiting first, when nothing is remembered", () => {
    expect(enterSplit([], "cur", sessions)).toEqual(["cur", "wait", "work"]);
  });
  it("restores the remembered grid and drops sessions that are gone", () => {
    expect(enterSplit(["work", "gone", "done"], "cur", sessions)).toEqual([
      "work",
      "done",
      "cur",
    ]);
  });
});

describe("pane bookkeeping", () => {
  it("prunes vanished sessions and keeps the same array when nothing changed", () => {
    const ids = ["a", "b"];
    expect(pruneSplit(ids, new Set(["a", "b"]))).toBe(ids);
    expect(pruneSplit(ids, new Set(["b"]))).toEqual(["b"]);
  });
  it("follows a /clear rotation", () => {
    expect(renameInSplit(["a", "b"], "a", "a2")).toEqual(["a2", "b"]);
  });
  it("focuses the right neighbor, else the left one", () => {
    expect(neighborAfterRemove(["a", "b", "c"], "b")).toBe("c");
    expect(neighborAfterRemove(["a", "b", "c"], "c")).toBe("b");
  });
});

describe("splitColumns", () => {
  it("uses the ideal shape when wide", () => {
    expect([1, 2, 3, 4, 5, 6].map((n) => splitColumns(n, 3000))).toEqual([
      1, 2, 3, 2, 3, 3,
    ]);
  });
  it("drops columns when panes would get too narrow", () => {
    expect(splitColumns(6, 900)).toBe(2);
    expect(splitColumns(3, 500)).toBe(1);
  });
});

describe("paneTaskGroups", () => {
  const activity = {
    turnStartMs: 10,
    steps: 3,
    lastTool: null,
    lastMs: 20,
    tasks: [
      { text: "first", startMs: 0, endMs: 5, steps: 2, adds: [] },
      { text: "second", startMs: 10, endMs: 20, steps: 3, adds: ["more"] },
    ],
    queued: ["later"],
  };
  it("puts the latest prompt under way while the session works", () => {
    const g = paneTaskGroups(s("a", "working"), activity, []);
    expect(g.now.map((x) => x.text)).toEqual(["second"]);
    expect(g.queued.map((x) => x.text)).toEqual(["later"]);
    expect(g.done.map((x) => x.text)).toEqual(["first"]);
  });
  it("counts every prompt as done once the session is idle, newest first", () => {
    const g = paneTaskGroups(s("a", "idle"), activity, [
      { id: "1", subject: "todo", status: "pending" },
    ]);
    expect(g.now).toEqual([]);
    expect(g.queued.map((x) => x.text)).toEqual(["todo", "later"]);
    expect(g.done.map((x) => x.text)).toEqual(["second", "first"]);
  });
});
