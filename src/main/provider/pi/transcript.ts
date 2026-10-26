import type {
  ContextBreakdown,
  ToolEvent,
  ToolResultDetail,
  TranscriptDoc,
  TranscriptEvent,
  TurnSummary,
} from "@shared/transcript";
import type { Usage } from "@shared/types";

/**
 * Pi (pi-coding-agent) session files: `~/.pi/agent/sessions/<cwd-slug>/<iso>_<uuid>.jsonl`. The first
 * line is `{type: "session", id, cwd, timestamp}`; the conversation follows as `{type: "message",
 * message: {role, content, ...}}` lines — `user`, `assistant` (text / thinking / toolCall blocks, with
 * `usage` and `model`) and `toolResult` (keyed by `toolCallId`). Entries link into a tree by
 * `parentId`; a `context_edit` with a null `replacement` drops its target from the conversation (Pi
 * does this to a failed reply). This reader follows file order, skipping dropped entries. Tolerant like
 * the codex rollout parser: no line shape may throw, and a half-written tail line is fine.
 */

type Rec = Record<string, unknown>;
const rec = (v: unknown): Rec | null =>
  v && typeof v === "object" && !Array.isArray(v) ? (v as Rec) : null;
const num = (v: unknown): number =>
  typeof v === "number" && Number.isFinite(v) ? v : 0;
const str = (v: unknown): string => (typeof v === "string" ? v : "");

export interface PiSessionHead {
  id: string;
  cwd: string;
  startedMs: number;
}

/** The session line, from the file's first non-empty line. Null when it isn't Pi's session line. */
export function readPiHead(firstLine: string): PiSessionHead | null {
  let row: Rec | null;
  try {
    row = rec(JSON.parse(firstLine));
  } catch {
    return null;
  }
  if (row?.type !== "session" || typeof row.id !== "string") return null;
  const started = Date.parse(str(row.timestamp));
  return {
    id: row.id,
    cwd: str(row.cwd),
    startedMs: Number.isFinite(started) ? started : 0,
  };
}

interface Entry {
  id: string;
  tsMs: number;
  message: Rec;
}

/** The message entries in file order, minus those a `context_edit` removed. */
function messages(jsonl: string): Entry[] {
  const out: Entry[] = [];
  const dropped = new Set<string>();
  for (const line of jsonl.split("\n")) {
    if (!line.trim()) continue;
    let row: Rec | null;
    try {
      row = rec(JSON.parse(line));
    } catch {
      continue;
    }
    if (!row) continue;
    if (row.type === "context_edit" && row.replacement === null) {
      const target = str(row.targetId);
      if (target) dropped.add(target);
      continue;
    }
    const message = rec(row.message);
    if (row.type !== "message" || !message) continue;
    const ts = Date.parse(str(row.timestamp));
    out.push({
      id: str(row.id),
      tsMs: Number.isFinite(ts) ? ts : 0,
      message,
    });
  }
  return out.filter((e) => !e.id || !dropped.has(e.id));
}

function blocks(content: unknown): Rec[] {
  if (typeof content === "string") return [{ type: "text", text: content }];
  return Array.isArray(content)
    ? content.map(rec).filter((b): b is Rec => b !== null)
    : [];
}

const textOf = (content: unknown): string =>
  blocks(content)
    .filter((b) => b.type === "text")
    .map((b) => str(b.text))
    .filter(Boolean)
    .join("\n");

/** The first non-empty line, capped like the sidebar title. */
function promptLine(text: string): string {
  for (const line of text.split("\n")) {
    const t = line.trim();
    if (t) return t.slice(0, 120);
  }
  return "";
}

/** One-line summary of a tool call's arguments: the command, path or pattern it names, else JSON. */
export function toolInput(args: unknown): string {
  const a = rec(args);
  if (!a) return typeof args === "string" ? args : "";
  for (const key of [
    "command",
    "path",
    "file_path",
    "pattern",
    "url",
    "query",
  ]) {
    if (typeof a[key] === "string" && a[key]) return a[key];
  }
  return JSON.stringify(a);
}

const lineCount = (text: string): number =>
  text ? text.replace(/\n$/, "").split("\n").length : 0;

export interface PiSummary {
  title: string | null;
  modelRaw: string | null;
  usage: Usage;
  /** The last reply's prompt size (input + cache read): what the context holds now. */
  contextTokens: number;
}

/** What the session row shows: its first prompt, last model, summed usage and current context. */
export function summarizePiSession(jsonl: string): PiSummary {
  let title: string | null = null;
  let modelRaw: string | null = null;
  let contextTokens = 0;
  const usage: Usage = {
    inputTokens: 0,
    outputTokens: 0,
    cacheReadTokens: 0,
    cacheCreationTokens: 0,
    cacheCreation5mTokens: 0,
    cacheCreation1hTokens: 0,
  };
  for (const { message } of messages(jsonl)) {
    if (message.role === "user" && title === null) {
      const line = promptLine(textOf(message.content));
      if (line) title = line;
    }
    if (message.role !== "assistant") continue;
    if (typeof message.model === "string" && message.model)
      modelRaw = message.model;
    const u = rec(message.usage);
    if (!u) continue;
    usage.inputTokens += num(u.input);
    usage.outputTokens += num(u.output);
    usage.cacheReadTokens += num(u.cacheRead);
    usage.cacheCreationTokens += num(u.cacheWrite);
    const prompt = num(u.input) + num(u.cacheRead) + num(u.cacheWrite);
    if (prompt > 0) contextTokens = prompt;
  }
  return { title, modelRaw, usage, contextTokens };
}

/**
 * The session as render-ready events — Pi's analog of parseRolloutEvents, targeting the same shared
 * doc. A turn opens at each user prompt and runs to the last entry before the next one.
 */
export function parsePiEvents(jsonl: string): Omit<TranscriptDoc, "subagents"> {
  const events: TranscriptEvent[] = [];
  const byCallId = new Map<string, ToolEvent>();
  const turns: TurnSummary[] = [];
  let open: TurnSummary | null = null;
  let context: ContextBreakdown | null = null;

  for (const { tsMs, message } of messages(jsonl)) {
    if (open && tsMs > open.endMs) {
      open.endMs = tsMs;
      open.durationMs = Math.max(0, open.endMs - open.startMs);
    }
    if (message.role === "user") {
      const text = textOf(message.content).trim();
      if (!text) continue;
      events.push({ kind: "user", text });
      if (open) turns.push(open);
      open = {
        index: turns.length + 1,
        prompt: promptLine(text),
        startMs: tsMs,
        endMs: tsMs,
        durationMs: 0,
        toolCount: 0,
      };
    } else if (message.role === "assistant") {
      for (const b of blocks(message.content)) {
        if (b.type === "thinking" && str(b.thinking).trim()) {
          events.push({ kind: "thinking", text: str(b.thinking) });
        } else if (b.type === "text" && str(b.text).trim()) {
          events.push({ kind: "assistant", text: str(b.text) });
        } else if (b.type === "toolCall") {
          if (open) open.toolCount++;
          const event: ToolEvent = {
            kind: "tool",
            name: str(b.name) || "tool",
            input: toolInput(b.arguments),
            toolUseId: str(b.id),
            status: "pending",
            outputLines: 0,
          };
          events.push(event);
          if (event.toolUseId) byCallId.set(event.toolUseId, event);
        }
      }
      const u = rec(message.usage);
      if (u && num(u.input) + num(u.cacheRead) > 0) {
        context = {
          input: num(u.input),
          cacheRead: num(u.cacheRead),
          cacheCreation: num(u.cacheWrite),
        };
      }
    } else if (message.role === "toolResult") {
      const event = byCallId.get(str(message.toolCallId));
      if (event) {
        event.status = message.isError === true ? "error" : "ok";
        event.outputLines = lineCount(textOf(message.content));
      }
    }
  }
  if (open) turns.push(open);
  return { events, waitingReason: null, turns, context };
}

/** One tool call's arguments and output, for the drill-in modal. */
export function extractPiToolResult(
  jsonl: string,
  toolUseId: string,
): ToolResultDetail {
  let command: string | null = null;
  for (const { message } of messages(jsonl)) {
    if (message.role === "assistant" && command === null) {
      const call = blocks(message.content).find(
        (b) => b.type === "toolCall" && b.id === toolUseId,
      );
      if (call) command = toolInput(call.arguments);
    } else if (
      message.role === "toolResult" &&
      message.toolCallId === toolUseId &&
      command !== null
    ) {
      return {
        found: true,
        command,
        output: textOf(message.content),
        status: message.isError === true ? "error" : "ok",
      };
    }
  }
  return command === null
    ? { found: false }
    : { found: true, command, output: "", status: "pending" };
}
