import { describe, expect, it } from "vitest";
import { appendFileSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readTurnActivity, summarize } from "../../src/main/turn-activity";

const at = (s: number) =>
  new Date(Date.UTC(2026, 10, 2, 9, 0, s)).toISOString();
const jsonl = (...rows: unknown[]) =>
  rows.map((r) => JSON.stringify(r)).join("\n");
const prompt = (s: number, text: string) => ({
  type: "user",
  timestamp: at(s),
  message: { content: text },
});
const tools = (s: number, ...blocks: unknown[]) => ({
  type: "assistant",
  timestamp: at(s),
  message: { content: blocks },
});
const result = (s: number) => ({
  type: "user",
  timestamp: at(s),
  message: { content: [{ type: "tool_result", tool_use_id: "x" }] },
});

describe("summarize", () => {
  it("counts the tool calls since the latest prompt and names the last one", () => {
    const a = summarize(
      jsonl(
        prompt(0, "first"),
        tools(1, { type: "tool_use", name: "Bash", input: { command: "ls" } }),
        prompt(10, "second"),
        tools(11, {
          type: "tool_use",
          name: "Read",
          input: { file_path: "E:\\repo\\src\\App.tsx" },
        }),
        result(12),
        tools(
          13,
          { type: "text", text: "ok" },
          {
            type: "tool_use",
            name: "Bash",
            input: { command: "pnpm test\n--run", description: "Run tests" },
          },
        ),
      ),
    );
    expect(a.turnStartMs).toBe(Date.parse(at(10)));
    expect(a.steps).toBe(2);
    expect(a.lastTool).toEqual({ name: "Bash", target: "Run tests" });
    expect(a.lastMs).toBe(Date.parse(at(13)));
  });

  it("does not start a turn on tool results, meta rows or local command output", () => {
    const a = summarize(
      jsonl(
        prompt(0, "go"),
        result(1),
        { ...prompt(2, "caveat"), isMeta: true },
        prompt(3, "<local-command-stdout>done</local-command-stdout>"),
        tools(4, {
          type: "tool_use",
          name: "Edit",
          input: { file_path: "/a/b.ts" },
        }),
      ),
    );
    expect(a.turnStartMs).toBe(Date.parse(at(0)));
    expect(a.lastTool).toEqual({ name: "Edit", target: "b.ts" });
  });

  it("leaves the start unknown when a cut tail holds no prompt", () => {
    const a = summarize(
      jsonl(
        tools(5, { type: "tool_use", name: "Grep", input: { pattern: "foo" } }),
      ),
      true,
    );
    expect(a.turnStartMs).toBeNull();
    expect(a.steps).toBe(1);
  });

  it("lists past tasks and what is still queued; notifications continue the task", () => {
    const queue = (operation: string, content?: string) => ({
      type: "queue-operation",
      operation,
      ...(content === undefined ? {} : { content }),
    });
    const a = summarize(
      jsonl(
        prompt(0, "fix the login page\nmore detail"),
        tools(1, { type: "tool_use", name: "Bash", input: { command: "ls" } }),
        prompt(10, "[Image #1] add a dark theme"),
        queue("enqueue", "then update the docs"),
        queue("enqueue", "<task-notification>done</task-notification>"),
        queue("remove", "<task-notification>done</task-notification>"),
        prompt(20, "<task-notification>done</task-notification>"),
        tools(21, {
          type: "tool_use",
          name: "Read",
          input: { file_path: "a" },
        }),
        queue("enqueue", "and ship it"),
        queue("dequeue"),
        {
          type: "attachment",
          attachment: { type: "queued_command", prompt: "also check mobile" },
        },
      ),
    );
    expect(a.tasks.map((x) => [x.text, x.steps])).toEqual([
      ["fix the login page", 1],
      ["add a dark theme", 1],
    ]);
    expect(a.tasks[0].endMs).toBe(Date.parse(at(1)));
    expect(a.queued).toEqual(["and ship it"]);
    expect(a.tasks[1].adds).toEqual(["also check mobile"]);
  });
});

const NL = "\n";

describe("readTurnActivity", () => {
  it("follows appended lines and finds a prompt that lies before the tail", () => {
    const dir = mkdtempSync(join(tmpdir(), "turn-activity-"));
    const file = join(dir, "s.jsonl");
    try {
      const bash = (s: number) =>
        tools(s, { type: "tool_use", name: "Bash", input: { command: "ls" } });
      // Over 256 KB of tool calls after the prompt, so the first tail read misses it.
      const filler = Array.from({ length: 3000 }, (_, i) => bash(i % 50));
      writeFileSync(file, jsonl(prompt(0, "go"), ...filler) + NL);
      const first = readTurnActivity(file);
      if (first.status !== "changed") throw new Error(first.status);
      expect(first.activity.turnStartMs).toBe(Date.parse(at(0)));
      expect(first.activity.steps).toBe(3000);

      appendFileSync(file, jsonl(bash(51)) + NL);
      const second = readTurnActivity(file);
      if (second.status !== "changed") throw new Error(second.status);
      expect(second.activity.steps).toBe(3001);

      appendFileSync(file, jsonl(prompt(52, "next")) + NL);
      const third = readTurnActivity(file);
      if (third.status !== "changed") throw new Error(third.status);
      expect(third.activity).toMatchObject({
        turnStartMs: Date.parse(at(52)),
        steps: 0,
        lastTool: null,
      });
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
