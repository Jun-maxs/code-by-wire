import { describe, expect, it } from "vitest";
import type { Session } from "../../src/shared/types";
import { isUnsentSession } from "../../src/renderer/src/shell/session-list-model";

function mk(over: Partial<Session>): Session {
  return {
    id: "s1",
    title: "开发临时用",
    project: "开发临时用",
    state: "idle",
    resumable: false,
    ...over,
  } as Session;
}

describe("isUnsentSession", () => {
  it("is true for a live session with no transcript yet, titled by its folder", () => {
    expect(isUnsentSession(mk({}))).toBe(true);
  });
  it("is false once the session has a transcript (resumable)", () => {
    expect(isUnsentSession(mk({ resumable: true }))).toBe(false);
  });
  it("is false for an ended session", () => {
    expect(isUnsentSession(mk({ state: "ended" }))).toBe(false);
  });
  it("is false when the title is a real one (renamed or derived)", () => {
    expect(isUnsentSession(mk({ title: "词屿发音" }))).toBe(false);
  });
});
