import { describe, expect, it } from "vitest";
import { extractText } from "../../src/main/content-text";

describe("extractText", () => {
  it("keeps Claude prompts, replies and tool inputs, drops tool output and injected context", () => {
    expect(
      extractText({
        type: "user",
        message: {
          content:
            "<system-reminder>ctx</system-reminder>打开 https://hub.yuanhk.top",
        },
      }),
    ).toEqual(["打开 https://hub.yuanhk.top"]);
    expect(
      extractText({
        type: "assistant",
        message: {
          content: [
            { type: "text", text: "好的" },
            { type: "tool_use", input: { file_path: "src/a.ts", old: "x" } },
          ],
        },
      }),
    ).toEqual(["好的", "src/a.ts"]);
    expect(
      extractText({
        type: "user",
        message: { content: [{ type: "tool_result", content: "huge" }] },
      }),
    ).toEqual([]);
  });

  it("reads Codex messages and function-call arguments", () => {
    expect(
      extractText({
        payload: {
          type: "message",
          role: "user",
          content: [
            { type: "input_text", text: "<environment_context>x" },
            { type: "input_text", text: "修复登录" },
          ],
        },
      }),
    ).toEqual(["修复登录"]);
    expect(
      extractText({
        payload: {
          type: "function_call",
          arguments: JSON.stringify({ command: "git status" }),
        },
      }),
    ).toEqual(["git status"]);
  });
});
