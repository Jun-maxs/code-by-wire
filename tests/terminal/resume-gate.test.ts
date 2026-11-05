import { describe, it, expect } from "vitest";
import {
  gateRelaunch,
  gateResume,
  type FreshLaunch,
} from "../../src/main/terminal/resume-gate";

const launch: FreshLaunch = {
  cwd: "/w/app",
  model: "default",
  agent: "claude",
};

describe("gateRelaunch (a session that never took a turn has no transcript)", () => {
  it("relaunches a dead claude session spawned this run when it has no transcript", () => {
    expect(
      gateRelaunch(
        "claude",
        { alive: false, cwd: "/w/app", transcript: false },
        launch,
        false,
      ),
    ).toEqual({ ok: true, launch });
  });

  it("relaunches when nothing resolves the id any more (registry reaped, no transcript)", () => {
    expect(gateRelaunch("claude", null, launch, false)).toEqual({
      ok: true,
      launch,
    });
  });

  it("stands aside once the session has a transcript — that is a normal resume", () => {
    expect(
      gateRelaunch(
        "claude",
        { alive: false, cwd: "/w/app", transcript: true },
        launch,
        false,
      ),
    ).toBeNull();
  });

  it("stands aside when the provider does not say whether a transcript exists", () => {
    expect(
      gateRelaunch("claude", { alive: false, cwd: "/w/app" }, launch, false),
    ).toBeNull();
  });

  it("stands aside for an id this run did not spawn (nothing to start it with)", () => {
    expect(
      gateRelaunch(
        "claude",
        { alive: false, cwd: "/w/app", transcript: false },
        undefined,
        false,
      ),
    ).toBeNull();
  });

  it("stands aside for other agents", () => {
    expect(
      gateRelaunch(
        "codex",
        { alive: false, cwd: "/w/app", transcript: false },
        { ...launch, agent: "codex" },
        false,
      ),
    ).toBeNull();
  });

  it("refuses while the registry still shows the process alive", () => {
    expect(
      gateRelaunch(
        "claude",
        { alive: true, cwd: "/w/app", transcript: false },
        launch,
        false,
      ),
    ).toEqual({ ok: false, reason: "alive" });
  });

  it("refuses while the manager still holds the session's pty", () => {
    expect(gateRelaunch("claude", null, launch, true)).toEqual({
      ok: false,
      reason: "alive",
    });
  });

  it("carries a fork's source so the relaunch forks again under the same id", () => {
    const fork: FreshLaunch = { ...launch, model: "opus", fork: "src-1" };
    expect(gateRelaunch("claude", null, fork, false)).toEqual({
      ok: true,
      launch: fork,
    });
  });
});

describe("gateResume", () => {
  it("still refuses an id nothing resolves", () => {
    expect(gateResume("claude", null)).toEqual({
      ok: false,
      reason: "unresolvable",
    });
  });
});
