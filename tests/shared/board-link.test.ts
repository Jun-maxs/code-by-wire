import { describe, expect, it } from "vitest";
import {
  emptyBoard,
  linkSession,
  tasksBySession,
  type BoardTask,
} from "@shared/board";

const task = (id: string, sessionIds: string[]): BoardTask =>
  ({ ...emptyBoard(), id, title: id, sessionIds }) as unknown as BoardTask;

describe("linkSession", () => {
  const doc = {
    ...emptyBoard(),
    tasks: [task("a", ["s1"]), task("b", []), task("c", ["s2"])],
  };

  it("moves a session to the chosen task and out of every other", () => {
    const next = linkSession(doc, "s1", "b");
    expect(next.tasks.map((t) => t.sessionIds)).toEqual([[], ["s1"], ["s2"]]);
    expect(tasksBySession(next).get("s1")?.id).toBe("b");
  });

  it("detaches with null and leaves unrelated tasks untouched", () => {
    const next = linkSession(doc, "s1", null);
    expect(next.tasks[0].sessionIds).toEqual([]);
    expect(next.tasks[2]).toBe(doc.tasks[2]);
  });
});
