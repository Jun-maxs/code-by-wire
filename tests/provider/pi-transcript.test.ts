import { describe, expect, it } from "vitest";
import {
  extractPiToolResult,
  parsePiEvents,
  readPiHead,
  summarizePiSession,
  toolInput,
} from "../../src/main/provider/pi/transcript";

const line = (o: unknown): string => JSON.stringify(o);
const usage = (input: number, output: number, cacheRead = 0) => ({
  input,
  output,
  cacheRead,
  cacheWrite: 0,
  totalTokens: input + output + cacheRead,
});

/** The shape of a real Pi session: a failed first reply that Pi dropped, then a tool round trip. */
const SESSION = [
  line({
    type: "session",
    version: 3,
    id: "01a17157",
    timestamp: "2026-10-25T04:35:45.900Z",
    cwd: "C:\\Users\\me",
  }),
  line({
    type: "model_change",
    id: "m1",
    provider: "relay",
    modelId: "deepseek-v4.1-flash",
  }),
  line({
    type: "message",
    id: "u1",
    timestamp: "2026-10-25T04:35:51.931Z",
    message: { role: "user", content: [{ type: "text", text: "hi\nthere" }] },
  }),
  line({
    type: "message",
    id: "a0",
    timestamp: "2026-10-25T04:35:54.711Z",
    message: {
      role: "assistant",
      content: [],
      stopReason: "error",
      usage: usage(0, 0),
    },
  }),
  line({ type: "context_edit", id: "e1", targetId: "a0", replacement: null }),
  line({
    type: "message",
    id: "a1",
    timestamp: "2026-10-25T04:36:00.000Z",
    message: {
      role: "assistant",
      model: "deepseek-v4.1-flash",
      content: [
        { type: "thinking", thinking: "Check the rules first." },
        {
          type: "toolCall",
          id: "call_1",
          name: "read",
          arguments: { path: "C:/a/AGENTS.md" },
        },
      ],
      usage: usage(1880, 96, 256),
    },
  }),
  line({
    type: "message",
    id: "t1",
    timestamp: "2026-10-25T04:36:01.000Z",
    message: {
      role: "toolResult",
      toolCallId: "call_1",
      toolName: "read",
      content: [{ type: "text", text: "# AGENTS\nline 2\n" }],
      isError: false,
    },
  }),
  line({
    type: "message",
    id: "a2",
    timestamp: "2026-10-25T04:36:05.000Z",
    message: {
      role: "assistant",
      model: "deepseek-v4.1-flash",
      content: [{ type: "text", text: "你好。" }],
      usage: usage(2000, 20, 1000),
    },
  }),
  '{"type":"message","id":"half',
].join("\n");

describe("readPiHead", () => {
  it("reads the session line", () => {
    expect(readPiHead(SESSION.split("\n")[0])).toEqual({
      id: "01a17157",
      cwd: "C:\\Users\\me",
      startedMs: Date.parse("2026-10-25T04:35:45.900Z"),
    });
    expect(readPiHead('{"type":"message"}')).toBeNull();
    expect(readPiHead("not json")).toBeNull();
  });
});

describe("summarizePiSession", () => {
  it("titles by the first prompt line and sums usage", () => {
    const s = summarizePiSession(SESSION);
    expect(s.title).toBe("hi");
    expect(s.modelRaw).toBe("deepseek-v4.1-flash");
    expect(s.usage.inputTokens).toBe(3880);
    expect(s.usage.outputTokens).toBe(116);
    expect(s.usage.cacheReadTokens).toBe(1256);
    expect(s.contextTokens).toBe(3000);
  });
});

describe("parsePiEvents", () => {
  it("renders the conversation, skipping the dropped reply", () => {
    const doc = parsePiEvents(SESSION);
    expect(doc.events).toEqual([
      { kind: "user", text: "hi\nthere" },
      { kind: "thinking", text: "Check the rules first." },
      {
        kind: "tool",
        name: "read",
        input: "C:/a/AGENTS.md",
        toolUseId: "call_1",
        status: "ok",
        outputLines: 2,
      },
      { kind: "assistant", text: "你好。" },
    ]);
    expect(doc.context).toEqual({
      input: 2000,
      cacheRead: 1000,
      cacheCreation: 0,
    });
  });

  it("opens a turn per prompt and runs it to the last entry", () => {
    const [turn] = parsePiEvents(SESSION).turns;
    expect(turn.prompt).toBe("hi");
    expect(turn.toolCount).toBe(1);
    expect(turn.durationMs).toBe(
      Date.parse("2026-10-25T04:36:05.000Z") -
        Date.parse("2026-10-25T04:35:51.931Z"),
    );
  });
});

describe("tool calls", () => {
  it("summarizes arguments by the command, path or pattern they name", () => {
    expect(toolInput({ command: "ls -la" })).toBe("ls -la");
    expect(toolInput({ pattern: "TODO", path: "src" })).toBe("src");
    expect(toolInput({ a: 1 })).toBe('{"a":1}');
  });

  it("extracts a call's arguments and output", () => {
    expect(extractPiToolResult(SESSION, "call_1")).toEqual({
      found: true,
      command: "C:/a/AGENTS.md",
      output: "# AGENTS\nline 2\n",
      status: "ok",
    });
    expect(extractPiToolResult(SESSION, "nope")).toEqual({ found: false });
  });
});
