import { describe, expect, it, vi } from "vitest";
import {
  createWorkDispatcher,
  encodeWorkActionFrames,
  sanitizePastePayload,
  type PtyWriteFrame,
} from "../../src/main/terminal/work-input";

describe("encodeWorkActionFrames — ConPTY & TUI byte framing", () => {
  it("splits bracketed paste and trailing \\r into distinct timed frames and strips injected paste delimiters", () => {
    expect(sanitizePastePayload("line1\r\n\x1b[201~inject\x1b[200~line2")).toBe(
      "line1\ninjectline2",
    );

    const frames = encodeWorkActionFrames(
      { kind: "prompt", text: "Fix bug\nin src/app.ts" },
      "claude",
      true,
      "win32",
    );
    expect(frames).toEqual([
      { data: "\x1b[200~Fix bug\nin src/app.ts\x1b[201~", delayAfterMs: 45 },
      { data: "\r", delayAfterMs: 0 },
    ]);

    const fallback = encodeWorkActionFrames(
      { kind: "prompt", text: "Line A\nLine B" },
      "codex",
      false,
      "win32",
    );
    expect(fallback).toEqual([
      { data: "Line A Line B", delayAfterMs: 35 },
      { data: "\r", delayAfterMs: 0 },
    ]);
  });

  it("encodes single-select, multi-select, custom Other, multi-question review confirm, permissions, and OS image paste", () => {
    // Single-select on Claude uses direct 1-based digit for <= 9 options.
    expect(
      encodeWorkActionFrames(
        {
          kind: "question",
          toolUseId: "q1",
          answers: [{ selectedIndices: [1], optionCount: 3 }],
        },
        "claude",
        true,
      ),
    ).toEqual([{ data: "2", delayAfterMs: 0 }]);

    // Multi-question on Claude appends final \r for the "Review your answers -> Submit" screen.
    const multiQ = encodeWorkActionFrames(
      {
        kind: "question",
        toolUseId: "q_multi",
        answers: [
          { selectedIndices: [0], optionCount: 2 },
          { selectedIndices: [1], optionCount: 2 },
        ],
      },
      "claude",
      true,
    );
    expect(multiQ.map((f) => f.data)).toEqual(["1", "2", "\r"]);

    // Multi-select walks options with Space toggles onto Submit.
    const multiSelect = encodeWorkActionFrames(
      {
        kind: "question",
        toolUseId: "q_ms",
        answers: [
          {
            selectedIndices: [0, 2],
            optionCount: 3,
            multiSelect: true,
          },
        ],
      },
      "claude",
      true,
    );
    expect(multiSelect.filter((f) => f.data === " ")).toHaveLength(2);
    expect(multiSelect[multiSelect.length - 1]?.data).toBe("\r");

    // Custom "Other" free-text reply selects N+1 and pastes text + \r.
    const custom = encodeWorkActionFrames(
      {
        kind: "question",
        toolUseId: "q_other",
        answers: [
          {
            selectedIndices: [],
            optionCount: 2,
            customText: "Use SQLite WAL mode",
          },
        ],
      },
      "claude",
      true,
    );
    expect(custom.map((f) => f.data)).toEqual([
      "3",
      "\x1b[200~Use SQLite WAL mode\x1b[201~",
      "\r",
    ]);

    // Permissions per agent & platform image paste.
    expect(
      encodeWorkActionFrames(
        { kind: "permission", toolUseId: "p1", decision: "allow-session" },
        "claude",
        true,
      ),
    ).toEqual([{ data: "2", delayAfterMs: 0 }]);
    expect(
      encodeWorkActionFrames(
        { kind: "permission", toolUseId: "p2", decision: "allow-session" },
        "codex",
        true,
      ),
    ).toEqual([{ data: "a", delayAfterMs: 0 }]);
    expect(
      encodeWorkActionFrames(
        { kind: "permission", toolUseId: "p3", decision: "deny" },
        "claude",
        true,
      ),
    ).toEqual([{ data: "\x1b", delayAfterMs: 0 }]);
    expect(
      encodeWorkActionFrames({ kind: "paste-image" }, "claude", true, "win32"),
    ).toEqual([{ data: "\x1bv", delayAfterMs: 0 }]);
    expect(
      encodeWorkActionFrames({ kind: "paste-image" }, "claude", true, "darwin"),
    ).toEqual([{ data: "\x16", delayAfterMs: 0 }]);
  });
});

describe("createWorkDispatcher — anti-replay & ended auto-resume", () => {
  it("blocks duplicate or already-resolved toolUseId dispatches with reason: stale", async () => {
    const written: PtyWriteFrame[][] = [];
    let stillPending = true;
    const dispatch = createWorkDispatcher({
      hasPty: () => true,
      modes: () => Promise.resolve({ bracketedPasteMode: true }),
      writeFrames: (_id, frames) => {
        written.push(frames);
        return Promise.resolve(true);
      },
      waitForPromptReady: () => Promise.resolve(true),
      resumeSession: () => ({ ok: true }),
      agentOf: () => "claude",
      isToolStillPending: () => stillPending,
    });

    const first = await dispatch({
      id: "sess-1",
      action: { kind: "permission", toolUseId: "toolu_123", decision: "allow" },
    });
    expect(first).toEqual({ ok: true });
    expect(written).toHaveLength(1);

    // Duplicate replay of same toolUseId is rejected before touching the PTY.
    const replay = await dispatch({
      id: "sess-1",
      action: { kind: "permission", toolUseId: "toolu_123", decision: "allow" },
    });
    expect(replay).toEqual({ ok: false, reason: "stale" });
    expect(written).toHaveLength(1);

    // Transcript says tool already completed -> rejected as stale.
    stillPending = false;
    const resolved = await dispatch({
      id: "sess-1",
      action: { kind: "permission", toolUseId: "toolu_456", decision: "allow" },
    });
    expect(resolved).toEqual({ ok: false, reason: "stale" });
    expect(written).toHaveLength(1);
  });

  it("auto-resumes an ended session, waits for bracketed-paste prompt readiness, and delivers the prompt", async () => {
    let live = false;
    const written: PtyWriteFrame[][] = [];
    const resumeSession = vi.fn(() => {
      live = true;
      return { ok: true as const };
    });
    const waitForPromptReady = vi.fn(() => Promise.resolve(true));

    const dispatch = createWorkDispatcher({
      hasPty: () => live,
      modes: () => Promise.resolve(live ? { bracketedPasteMode: true } : null),
      writeFrames: (_id, frames) => {
        written.push(frames);
        return Promise.resolve(true);
      },
      waitForPromptReady,
      resumeSession,
      agentOf: () => "claude",
    });

    const res = await dispatch({
      id: "sess-ended",
      action: { kind: "prompt", text: "Continue phase 2 verification" },
      cols: 110,
      rows: 32,
    });

    expect(res).toEqual({ ok: true, resumed: true });
    expect(resumeSession).toHaveBeenCalledWith({
      id: "sess-ended",
      cols: 110,
      rows: 32,
    });
    expect(waitForPromptReady).toHaveBeenCalledWith("sess-ended");
    expect(written).toEqual([
      [
        {
          data: "\x1b[200~Continue phase 2 verification\x1b[201~",
          delayAfterMs: 45,
        },
        { data: "\r", delayAfterMs: 0 },
      ],
    ]);
  });

  it("drains a closing ConPTY handle when provider liveness already marks the session ended before auto-resuming", async () => {
    let ptyOpen = true; // ConPTY ClosePseudoConsole still draining even though CLI exited
    const events: string[] = [];
    const waitForPtyClosed = vi.fn(() => {
      events.push("drain-old-pty");
      ptyOpen = false;
      return Promise.resolve(true);
    });
    const resumeSession = vi.fn(() => {
      events.push("resume-new-pty");
      ptyOpen = true;
      return { ok: true as const };
    });
    const waitForPromptReady = vi.fn(() => {
      events.push("ready-new-pty");
      return Promise.resolve(true);
    });

    const dispatch = createWorkDispatcher({
      hasPty: () => ptyOpen,
      modes: () => Promise.resolve({ bracketedPasteMode: true }),
      writeFrames: () => {
        events.push("write-frames");
        return Promise.resolve(true);
      },
      waitForPromptReady,
      resumeSession,
      agentOf: () => "claude",
      isSessionEnded: (_id, expectResume) => Boolean(expectResume),
      waitForPtyClosed,
    });

    const res = await dispatch({
      id: "sess-conpty-drain",
      action: { kind: "prompt", text: "补充并发重放吊销回归单测" },
      expectResume: true,
    });

    expect(res).toEqual({ ok: true, resumed: true });
    expect(events).toEqual([
      "drain-old-pty",
      "resume-new-pty",
      "ready-new-pty",
      "write-frames",
    ]);
  });

  it("propagates alive refusal when an external terminal already owns the session", async () => {
    const dispatch = createWorkDispatcher({
      hasPty: () => false,
      modes: () => Promise.resolve(null),
      writeFrames: () => Promise.resolve(false),
      waitForPromptReady: () => Promise.resolve(false),
      resumeSession: () => ({ ok: false, reason: "alive" }),
      agentOf: () => "claude",
    });

    const res = await dispatch({
      id: "sess-external",
      action: { kind: "prompt", text: "Hello" },
    });
    expect(res).toEqual({ ok: false, reason: "alive" });
  });
});
