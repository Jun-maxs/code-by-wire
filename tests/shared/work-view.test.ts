import { describe, expect, it, beforeEach } from "vitest";
import {
  fromTranscriptWire,
  projectWorkTurns,
  toTranscriptWire,
  type TranscriptDoc,
  type TranscriptEvent,
} from "../../src/shared/transcript";
import {
  $expandedSpines,
  $viewModes,
  $workDrafts,
  clearWorkDraft,
  getWorkDraft,
  isViewToggleKey,
  renameWorkViewState,
  resolveSessionViewMode,
  setSessionViewMode,
  setWorkDraft,
  toggleSessionViewMode,
  toggleSpineExpanded,
  workScrollSnapshots,
} from "../../src/renderer/src/workspace/view-mode";

describe("projectWorkTurns — recall & vertical compression", () => {
  it("preserves 100% of human prompts, mid-turn follow-ups, deliverables, merged diffs, failed tools, and waiting options", () => {
    const events: TranscriptEvent[] = [
      { kind: "user", text: "Audit auth token refresh and patch expiry check" },
      { kind: "thinking", text: "Checking token refresh flow in auth.ts..." },
      { kind: "assistant", text: "Let me inspect `src/auth.ts` first." },
      {
        kind: "tool",
        toolUseId: "tu_read_1",
        name: "Read",
        input: "src/auth.ts",
        status: "ok",
        outputLines: 120,
      },
      {
        kind: "diff",
        tool: "Edit",
        file: "src/auth.ts",
        hunk: {
          removed: ["const skew = 0;"],
          added: ["const skew = 30_000;"],
        },
        status: "ok",
      },
      {
        kind: "tool",
        toolUseId: "tu_test_fail",
        name: "Bash",
        input: "pnpm test auth",
        status: "error",
        outputLines: 18,
      },
      {
        kind: "diff",
        tool: "Edit",
        file: "src/auth.ts",
        hunk: {
          removed: ["return exp > now;"],
          added: ["return exp - skew > now;"],
        },
        status: "ok",
      },
      {
        kind: "tool",
        toolUseId: "tu_test_ok",
        name: "Bash",
        input: "pnpm test auth",
        status: "ok",
        outputLines: 6,
      },
      {
        kind: "assistant",
        text: "Patched `src/auth.ts` with a 30s clock-skew buffer and verified tests pass.",
      },
      {
        kind: "user",
        text: "Also check whether refresh rotation should be strict or grace-windowed",
        midTurn: true,
      },
      {
        kind: "assistant",
        text: "Which rotation policy should we enforce in production?",
      },
      {
        kind: "tool",
        toolUseId: "tu_ask_1",
        name: "AskUserQuestion",
        input: "Which rotation policy should we enforce?",
        status: "pending",
        outputLines: 0,
      },
    ];

    const doc: TranscriptDoc = {
      events,
      subagents: [],
      context: null,
      turns: [
        {
          index: 1,
          prompt: "Audit auth token refresh",
          startMs: 1_000,
          endMs: 15_000,
          durationMs: 14_000,
          toolCount: 4,
        },
        {
          index: 2,
          prompt: "Also check whether refresh rotation",
          startMs: 16_000,
          endMs: 19_000,
          durationMs: 3_000,
          toolCount: 1,
        },
      ],
      waitingReason: "AskUserQuestion",
      waitingPrompt: {
        kind: "question",
        toolUseId: "tu_ask_1",
        toolName: "AskUserQuestion",
        questions: [
          {
            header: "Rotation",
            question: "Which rotation policy should we enforce?",
            multiSelect: false,
            options: [
              {
                label: "Grace window (Recommended)",
                description: "Allow 10s replay tolerance for concurrent tabs",
              },
              {
                label: "Strict single-use",
                description: "Revoke entire token family on duplicate refresh",
              },
            ],
          },
        ],
      },
      queuedPrompts: ["Update CHANGELOG after confirming"],
    };

    const roundTripped = fromTranscriptWire(
      toTranscriptWire({ status: "changed", mtimeMs: 19_000, doc }),
    );
    const turns =
      roundTripped.status === "changed"
        ? (roundTripped.doc.workTurns ?? [])
        : [];
    expect(turns).toHaveLength(3);

    // Turn 1: full recall of prompt, deliverable, merged single-file diff (+2/-2 across 2 edits), and surfaced failed Bash tool.
    const t1 = turns[0];
    expect(t1.prompt).toBe("Audit auth token refresh and patch expiry check");
    expect(t1.midTurn).toBe(false);
    expect(t1.durationMs).toBe(14_000);
    expect(t1.deliverables).toEqual([
      "Patched `src/auth.ts` with a 30s clock-skew buffer and verified tests pass.",
    ]);
    expect(t1.files).toHaveLength(1);
    expect(t1.files[0]).toMatchObject({
      file: "src/auth.ts",
      added: 2,
      removed: 2,
      editCount: 2,
      status: "ok",
    });
    expect(t1.files[0].mergedDiff.hunk).toEqual({
      removed: ["const skew = 0;", "return exp > now;"],
      added: ["const skew = 30_000;", "return exp - skew > now;"],
    });
    expect(t1.errors).toHaveLength(1);
    expect(t1.errors[0]).toMatchObject({
      kind: "tool",
      event: { toolUseId: "tu_test_fail", name: "Bash", status: "error" },
    });

    // Turn 2: mid-turn follow-up promotes pre-AskUserQuestion explanation & attaches waitingPrompt.
    const t2 = turns[1];
    expect(t2.midTurn).toBe(true);
    expect(t2.deliverables).toEqual([
      "Which rotation policy should we enforce in production?",
    ]);
    expect(t2.waiting).toEqual(doc.waitingPrompt);

    // Turn 3: un-popped queued prompt visible at tail.
    const t3 = turns[2];
    expect(t3.queued).toBe(true);
    expect(t3.prompt).toBe("Update CHANGELOG after confirming");
  });

  it("compresses a 60-tool turn by >= 80% in default collapsed vertical items without losing deliverables or errors", () => {
    const events: TranscriptEvent[] = [
      { kind: "user", text: "Refactor 50 modules and run full verification" },
    ];
    for (let i = 0; i < 55; i++) {
      if (i % 5 === 0) {
        events.push({ kind: "thinking", text: `Step ${i} reasoning` });
        events.push({
          kind: "assistant",
          text: `Inspecting batch ${i}...`,
        });
      }
      events.push({
        kind: "tool",
        toolUseId: `tu_${i}`,
        name: i % 3 === 0 ? "Read" : i % 3 === 1 ? "Grep" : "Bash",
        input: `src/mod-${i}.ts`,
        status: i === 29 ? "error" : "ok",
        outputLines: 12,
      });
    }
    for (let f = 0; f < 5; f++) {
      events.push({
        kind: "diff",
        tool: "Edit",
        file: `src/core-${f}.ts`,
        hunk: { removed: [`old_${f}`], added: [`new_${f}`] },
        status: "ok",
      });
    }
    events.push({
      kind: "assistant",
      text: "Completed refactoring across all 5 core modules.",
    });

    const turns = projectWorkTurns({
      events,
      turns: [],
      waitingReason: null,
    });
    expect(turns).toHaveLength(1);
    const turn = turns[0];
    expect(turn.spine.stepCount).toBe(60);
    expect(turn.errors).toHaveLength(1);
    expect(turn.deliverables).toHaveLength(1);
    expect(turn.files).toHaveLength(5);

    // Raw TranscriptView vertical nodes = events.length (84 items).
    // Default collapsed WorkTurn vertical nodes = 1 prompt + 1 spine bar + 1 surfaced error + 1 deliverable + 1 file-capsule strip = 5 nodes.
    const rawVerticalNodes = events.length;
    const collapsedVerticalNodes =
      (turn.prompt ? 1 : 0) +
      (turn.spine.stepCount > 0 ? 1 : 0) +
      turn.errors.length +
      turn.deliverables.length +
      (turn.files.length > 0 ? 1 : 0);

    const compressionRatio = 1 - collapsedVerticalNodes / rawVerticalNodes;
    expect(compressionRatio).toBeGreaterThanOrEqual(0.8);
  });
});

describe("view-mode store & shortcuts", () => {
  beforeEach(() => {
    $viewModes.set({});
    $workDrafts.set({});
    $expandedSpines.set({});
    workScrollSnapshots.clear();
  });

  it("defaults live managed sessions to CLI and ended/observed sessions to Work, while honoring explicit toggles", () => {
    const liveManaged = {
      id: "s-live",
      management: "managed" as const,
      state: "working" as const,
    };
    const ended = {
      id: "s-ended",
      management: "observed" as const,
      state: "ended" as const,
    };
    expect(resolveSessionViewMode(liveManaged, $viewModes.get(), true)).toBe(
      "cli",
    );
    expect(resolveSessionViewMode(ended, $viewModes.get(), true)).toBe("work");
    expect(resolveSessionViewMode(ended, $viewModes.get(), false)).toBe("cli");

    expect(toggleSessionViewMode(liveManaged, true)).toBe("work");
    expect(resolveSessionViewMode(liveManaged, $viewModes.get(), true)).toBe(
      "work",
    );
  });

  it("migrates view mode, unsent draft, attachments, and scroll snapshot on /clear session rename", () => {
    setSessionViewMode("old-id", "work");
    setWorkDraft("old-id", {
      text: "keep this draft",
      attachments: ["C:/shot.png"],
    });
    toggleSpineExpanded("old-id", 1);
    workScrollSnapshots.set("old-id", { scrollTop: 420, pinned: false });

    renameWorkViewState("old-id", "new-id");

    expect($viewModes.get()["new-id"]).toBe("work");
    expect(getWorkDraft($workDrafts.get(), "new-id")).toEqual({
      text: "keep this draft",
      attachments: ["C:/shot.png"],
    });
    expect(workScrollSnapshots.get("new-id")).toEqual({
      scrollTop: 420,
      pinned: false,
    });

    clearWorkDraft("new-id");
    expect(getWorkDraft($workDrafts.get(), "new-id")).toEqual({
      text: "",
      attachments: [],
    });
  });

  it("matches Ctrl+Shift+E on Windows/Linux and Cmd+Shift+E on macOS", () => {
    expect(
      isViewToggleKey(
        {
          code: "KeyE",
          key: "E",
          ctrlKey: true,
          metaKey: false,
          shiftKey: true,
          altKey: false,
        },
        false,
      ),
    ).toBe(true);
    expect(
      isViewToggleKey(
        {
          code: "KeyE",
          key: "e",
          ctrlKey: false,
          metaKey: true,
          shiftKey: true,
          altKey: false,
        },
        true,
      ),
    ).toBe(true);
    expect(
      isViewToggleKey(
        {
          code: "KeyE",
          key: "e",
          ctrlKey: true,
          metaKey: false,
          shiftKey: false,
          altKey: false,
        },
        false,
      ),
    ).toBe(false);
  });
});
