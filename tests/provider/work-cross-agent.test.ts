import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { parseTranscriptEvents } from "../../src/main/provider/claude/transcript-events";
import { parseRolloutEvents } from "../../src/main/provider/codex/transcript-events";
import { scanRolloutTelemetry } from "../../src/main/provider/codex/usage";
import {
  parseAgyEvents,
  summarizeAgySteps,
  type AgyStepRow,
} from "../../src/main/provider/agy/conversation";
import { createParseRequestHandler } from "../../src/main/parse-worker/protocol";
import {
  fromTranscriptWire,
  type TranscriptReadWire,
} from "../../src/shared/transcript";

type Field = [number, number | string | Field[]];
function varint(n: number): number[] {
  const out: number[] = [];
  do {
    let b = n % 128;
    n = Math.floor(n / 128);
    if (n > 0) b |= 0x80;
    out.push(b);
  } while (n > 0);
  return out;
}
function pb(fields: Field[]): Uint8Array {
  const out: number[] = [];
  for (const [f, v] of fields) {
    if (typeof v === "number") {
      out.push(...varint(f * 8), ...varint(v));
    } else {
      const bytes = typeof v === "string" ? new TextEncoder().encode(v) : pb(v);
      out.push(...varint(f * 8 + 2), ...varint(bytes.length), ...bytes);
    }
  }
  return Uint8Array.from(out);
}
const at = (sec: number): Field => [1, [[1, sec]]];

describe("Cross-agent Work projection & parse-worker protocol", () => {
  it("Claude: extracts string & block-array queued_command, filters internal notifications, tracks queue-operation, and parses AskUserQuestion options", () => {
    const rows = [
      JSON.stringify({
        type: "user",
        timestamp: "2026-11-14T01:00:00.000Z",
        message: { role: "user", content: "Build the Work view spine" },
      }),
      JSON.stringify({
        type: "attachment",
        timestamp: "2026-11-14T01:00:02.000Z",
        attachment: {
          type: "queued_command",
          prompt:
            "<task-notification><task-id>bg1</task-id></task-notification>",
        },
      }),
      JSON.stringify({
        type: "attachment",
        timestamp: "2026-11-14T01:00:03.000Z",
        attachment: {
          type: "queued_command",
          prompt: [
            { type: "text", text: "Keep TerminalView alive in terminalStore" },
          ],
        },
      }),
      JSON.stringify({
        type: "queue-operation",
        operation: "enqueue",
        content: "Run ui-audit after building",
      }),
      JSON.stringify({
        type: "assistant",
        timestamp: "2026-11-14T01:00:05.000Z",
        message: {
          id: "msg_1",
          role: "assistant",
          model: "claude-opus-4-6",
          content: [
            {
              type: "text",
              text: "How should Split panes display the toggle?",
            },
            {
              type: "tool_use",
              id: "toolu_ask_split",
              name: "AskUserQuestion",
              input: {
                questions: [
                  {
                    header: "Split UI",
                    question: "Choose Split pane header toggle style",
                    multiSelect: false,
                    options: [
                      {
                        label: "Compact CLI/Work pill",
                        description: "1-click toggle with active mode label",
                      },
                      {
                        label: "Icon-only button",
                        description: "Saves 24px in narrow panes",
                      },
                    ],
                  },
                ],
              },
            },
          ],
          usage: { input_tokens: 500, output_tokens: 80 },
        },
      }),
    ].join("\n");

    const doc = parseTranscriptEvents(rows);
    const userEvents = doc.events.filter((e) => e.kind === "user");
    expect(userEvents).toEqual([
      { kind: "user", text: "Build the Work view spine" },
      {
        kind: "user",
        text: "Keep TerminalView alive in terminalStore",
        midTurn: true,
      },
    ]);
    expect(doc.queuedPrompts).toEqual(["Run ui-audit after building"]);
    expect(doc.waitingPrompt).toEqual({
      kind: "question",
      toolUseId: "toolu_ask_split",
      toolName: "AskUserQuestion",
      questions: [
        {
          header: "Split UI",
          question: "Choose Split pane header toggle style",
          options: [
            {
              label: "Compact CLI/Work pill",
              description: "1-click toggle with active mode label",
            },
            {
              label: "Icon-only button",
              description: "Saves 24px in narrow panes",
            },
          ],
        },
      ],
    });
  });

  it("Codex: extracts per-file DiffEvents from apply_patch, back-patches failed patches, detects request_user_input waiting state, and runs in parse-worker", () => {
    const dir = mkdtempSync(join(tmpdir(), "cbw-codex-work-"));
    try {
      const rolloutPath = join(dir, "rollout-test.jsonl");
      const patchText = [
        "*** Begin Patch",
        "*** Update File: src/work.ts",
        "@@",
        "-export const mode = 'old';",
        "+export const mode = 'work';",
        "*** Add File: src/helper.ts",
        "+export const ok = true;",
        "*** End Patch",
      ].join("\n");

      const lines = [
        JSON.stringify({
          timestamp: "2026-11-14T02:00:00.000Z",
          type: "event_msg",
          payload: { type: "task_started" },
        }),
        JSON.stringify({
          timestamp: "2026-11-14T02:00:01.000Z",
          type: "response_item",
          payload: {
            type: "message",
            role: "user",
            content: [{ type: "input_text", text: "Apply Work mode patch" }],
          },
        }),
        JSON.stringify({
          timestamp: "2026-11-14T02:00:02.000Z",
          type: "response_item",
          payload: {
            type: "custom_tool_call",
            call_id: "call_patch_1",
            name: "apply_patch",
            input: patchText,
          },
        }),
        JSON.stringify({
          timestamp: "2026-11-14T02:00:03.000Z",
          type: "response_item",
          payload: {
            type: "custom_tool_call_output",
            call_id: "call_patch_1",
            output: JSON.stringify({
              output: "Success. Updated 2 files.",
              metadata: { exit_code: 0 },
            }),
          },
        }),
        JSON.stringify({
          timestamp: "2026-11-14T02:00:03.500Z",
          type: "response_item",
          payload: {
            type: "custom_tool_call",
            call_id: "call_exec_err",
            name: "js",
            input: 'await tools.exec_command({"cmd":"pnpm test:smoke"});',
          },
        }),
        JSON.stringify({
          timestamp: "2026-11-14T02:00:03.800Z",
          type: "response_item",
          payload: {
            type: "custom_tool_call_output",
            call_id: "call_exec_err",
            output: JSON.stringify({
              output: "FAIL smoke.test.ts",
              metadata: { exit_code: 1 },
            }),
          },
        }),
        JSON.stringify({
          timestamp: "2026-11-14T02:00:04.000Z",
          type: "response_item",
          payload: {
            type: "function_call",
            call_id: "call_ask_codex",
            name: "request_user_input",
            arguments: JSON.stringify({
              questions: [
                {
                  header: "Target",
                  question: "Deploy after tests pass?",
                  options: [
                    { label: "Local only", description: "Skip remote deploy" },
                    { label: "Staging", description: "Push to staging" },
                  ],
                },
              ],
            }),
          },
        }),
      ].join("\n");

      writeFileSync(rolloutPath, lines, "utf8");

      const telemetry = scanRolloutTelemetry(lines);
      expect(telemetry.awaitingUser).toBe(true);

      const parsed = parseRolloutEvents(lines);
      const diffs = parsed.events.filter((e) => e.kind === "diff");
      expect(diffs).toHaveLength(2);
      expect(diffs[0]).toMatchObject({
        kind: "diff",
        tool: "apply_patch",
        file: "src/work.ts",
        status: "ok",
        hunk: {
          removed: ["export const mode = 'old';"],
          added: ["export const mode = 'work';"],
        },
      });
      expect(diffs[1]).toMatchObject({
        kind: "diff",
        tool: "apply_patch",
        file: "src/helper.ts",
        status: "ok",
        hunk: { removed: [], added: ["export const ok = true;"] },
      });
      expect(parsed.waitingPrompt).toMatchObject({
        kind: "question",
        toolUseId: "call_ask_codex",
        toolName: "request_user_input",
      });

      // Verify parse-worker protocol produces pre-folded workTurns.
      const handler = createParseRequestHandler();
      const workerResp = handler({
        seq: 1,
        op: "readCodexTranscript",
        rolloutPath,
      });
      expect(workerResp.ok).toBe(true);
      const decoded = fromTranscriptWire(
        (workerResp as { ok: true; result: TranscriptReadWire }).result,
      );
      expect(decoded.status).toBe("changed");
      if (decoded.status === "changed") {
        expect(decoded.doc.workTurns).toHaveLength(1);
        expect(decoded.doc.workTurns?.[0].files.map((f) => f.file)).toEqual([
          "src/work.ts",
          "src/helper.ts",
        ]);
        expect(decoded.doc.workTurns?.[0].errors).toHaveLength(1);
        expect(decoded.doc.workTurns?.[0].errors[0]).toMatchObject({
          kind: "tool",
          event: { toolUseId: "call_exec_err", status: "error" },
        });
      }
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("Antigravity (agy): extracts edit_file/write_file DiffEvents, invoke_subagent, ask_question waitingPrompt, and runs in parse-worker", () => {
    const steps: AgyStepRow[] = [
      {
        idx: 0,
        stepType: 14,
        status: 3,
        metadata: pb([at(200)]),
        payload: pb([[19, [[2, "Wire AGY into Work view"]]]]),
      },
      {
        idx: 1,
        stepType: 15,
        status: 3,
        metadata: pb([
          at(202),
          [
            9,
            [
              [2, 2000],
              [3, 120],
            ],
          ],
        ]),
        payload: pb([
          [
            20,
            [
              [1, "Updating the AGY conversation parser now."],
              [
                7,
                [
                  [1, "agy_edit_1"],
                  [2, "edit_file"],
                  [
                    3,
                    JSON.stringify({
                      Path: "E:/repo/agy.ts",
                      Target: "const old = 1;",
                      Replacement: "const old = 2;\nconst extra = true;",
                    }),
                  ],
                ],
              ],
              [
                7,
                [
                  [1, "agy_sub_1"],
                  [2, "invoke_subagent"],
                  [
                    3,
                    JSON.stringify({
                      TypeName: "research",
                      Role: "Protocol Auditor",
                    }),
                  ],
                ],
              ],
              [
                7,
                [
                  [1, "agy_cmd_err"],
                  [2, "run_command"],
                  [
                    3,
                    JSON.stringify({
                      CommandLine: "pnpm lint",
                    }),
                  ],
                ],
              ],
            ],
          ],
        ]),
      },
      {
        idx: 2,
        stepType: 132,
        status: 3,
        metadata: pb([at(204), [4, [[1, "agy_edit_1"]]]]),
        payload: pb([[140, [[2, [[1, "Edited file"]]]]]]),
      },
      {
        idx: 3,
        stepType: 132,
        status: 3,
        metadata: pb([at(205), [4, [[1, "agy_sub_1"]]]]),
        payload: pb([[140, [[2, [[1, "Audit complete"]]]]]]),
      },
      {
        idx: 4,
        stepType: 132,
        status: 5,
        metadata: pb([at(206), [4, [[1, "agy_cmd_err"]]]]),
        payload: pb([[140, [[2, [[1, "Command exited with code 1"]]]]]]),
      },
      {
        idx: 5,
        stepType: 15,
        status: 3,
        metadata: pb([
          at(207),
          [
            9,
            [
              [2, 1200],
              [3, 60],
            ],
          ],
        ]),
        payload: pb([
          [
            20,
            [
              [1, "Need one confirmation on multi-select behavior."],
              [
                7,
                [
                  [1, "agy_ask_1"],
                  [2, "ask_question"],
                  [
                    3,
                    JSON.stringify({
                      questions: [
                        {
                          question: "Which export formats should we keep?",
                          is_multi_select: true,
                          options: ["(Recommended) JSONL", "Markdown"],
                        },
                      ],
                    }),
                  ],
                ],
              ],
            ],
          ],
        ]),
      },
    ];

    const summary = summarizeAgySteps(steps);
    expect(summary.awaitingUser).toBe(true);

    const doc = parseAgyEvents(steps);
    expect(doc.events.some((e) => e.kind === "diff")).toBe(true);
    expect(doc.events.some((e) => e.kind === "subagent")).toBe(true);
    expect(doc.waitingPrompt).toEqual({
      kind: "question",
      toolUseId: "agy_ask_1",
      toolName: "ask_question",
      questions: [
        {
          question: "Which export formats should we keep?",
          multiSelect: true,
          options: [{ label: "(Recommended) JSONL" }, { label: "Markdown" }],
        },
      ],
    });

    const handler = createParseRequestHandler();
    const workerResp = handler({
      seq: 2,
      op: "parseAgyTranscript",
      mtimeMs: 207_000,
      steps,
    });
    expect(workerResp.ok).toBe(true);
    const decoded = fromTranscriptWire(
      (workerResp as { ok: true; result: TranscriptReadWire }).result,
    );
    expect(decoded.status).toBe("changed");
    if (decoded.status === "changed") {
      expect(decoded.doc.workTurns).toHaveLength(1);
      expect(decoded.doc.workTurns?.[0].files[0]).toMatchObject({
        file: "E:/repo/agy.ts",
        added: 2,
        removed: 1,
      });
      expect(decoded.doc.workTurns?.[0].spine.subagentCount).toBe(1);
      expect(decoded.doc.workTurns?.[0].errors).toHaveLength(1);
      expect(decoded.doc.workTurns?.[0].errors[0]).toMatchObject({
        kind: "tool",
        event: {
          toolUseId: "agy_cmd_err",
          name: "run_command",
          status: "error",
        },
      });
    }
  });
});
