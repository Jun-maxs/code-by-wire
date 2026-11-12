import type {
  ContextBreakdown,
  ToolEvent,
  ToolResultDetail,
  TranscriptDoc,
  TranscriptEvent,
  TurnSummary,
} from "@shared/transcript";
import type { Usage } from "@shared/types";
import {
  pbAt,
  pbMessages,
  pbNum,
  pbParse,
  pbStr,
  type PbMessage,
} from "./protobuf";

/**
 * The Antigravity CLI's conversation store: `~/.gemini/antigravity-cli/conversations/<id>.db`, one
 * SQLite file per conversation whose rows hold protobuf blobs with no published schema. The field
 * numbers below were read off real conversations (agy 1.5.6) and cross-checked against agy's own
 * `-p --output-format json` usage totals:
 *
 * - `trajectory_metadata_blob` ('main'): 1.1 workspace file URI, 2.1/2.2 created seconds/nanos.
 * - `steps`: one row per step; `step_type` 14 is a user message (payload 19.2 its text), 15 a model
 *   turn (payload 20.1 its text, each 20.7 a tool call: 1 id, 2 name, 3 JSON args) and 132 a tool
 *   result (metadata 4.1 the call id, payload 140.2.1 the output). `status` 6 marks a failed step.
 *   A model turn's metadata 9 is its generation: 2 uncached input, 5 cache read, 3 output tokens.
 *   Every step's metadata 1.1/1.2 is its time.
 * - `gen_metadata`: 1.19 the model id, 1.21 its display name (e.g. "Gemini 3.8 Flash (Low)").
 *
 * Pure — the sqlite reads live in store.ts — and tolerant: an unknown step type or a blob that
 * doesn't parse is skipped, never thrown.
 */

export const STEP_USER = 14;
export const STEP_MODEL = 15;
export const STEP_TOOL_RESULT = 132;
const STATUS_FAILED = 6;

/** One `steps` row as stored. */
export interface AgyStepRow {
  idx: number;
  stepType: number;
  status: number;
  metadata: Uint8Array | null;
  payload: Uint8Array | null;
}

export interface AgyHead {
  cwd: string;
  createdMs: number;
}

/** `file:///C:/a%20b/c` → `C:\a b\c` on Windows, `/a b/c` elsewhere. "" when it isn't a file URI. */
export function fileUriToPath(
  uri: string,
  platform: NodeJS.Platform = process.platform,
): string {
  if (!uri.startsWith("file://")) return "";
  let path: string;
  try {
    path = decodeURIComponent(uri.slice("file://".length));
  } catch {
    return "";
  }
  if (/^\/[A-Za-z]:/.test(path)) path = path.slice(1);
  if (platform === "win32") {
    path = path.replace(/\//g, "\\");
    if (/^[a-z]:/.test(path)) path = path[0].toUpperCase() + path.slice(1);
    if (/^[A-Za-z]:$/.test(path)) path += "\\";
  }
  return path;
}

const timeMs = (m: PbMessage): number =>
  pbNum(m, 1) * 1000 + Math.floor(pbNum(m, 2) / 1e6);

/** The conversation's workspace and start time, from its 'main' trajectory metadata. */
export function readAgyHead(
  blob: Uint8Array | null,
  platform: NodeJS.Platform = process.platform,
): AgyHead | null {
  const m = pbParse(blob);
  const cwd = fileUriToPath(pbStr(pbAt(m, 1), 1), platform);
  if (!cwd) return null;
  return { cwd, createdMs: timeMs(pbAt(m, 2)) };
}

/** The model a generation ran on, from one `gen_metadata` row. */
export function readAgyModel(
  blob: Uint8Array | null,
): { id: string; label: string } | null {
  const m = pbAt(pbParse(blob), 1);
  const id = pbStr(m, 19);
  const label = pbStr(m, 21);
  return id || label ? { id, label: label || id } : null;
}

interface Generation {
  input: number;
  cacheRead: number;
  output: number;
}

function generationOf(step: AgyStepRow): Generation | null {
  if (step.stepType !== STEP_MODEL) return null;
  const g = pbAt(pbParse(step.metadata), 9);
  const gen = {
    input: pbNum(g, 2),
    cacheRead: pbNum(g, 5),
    output: pbNum(g, 3),
  };
  return gen.input + gen.cacheRead + gen.output > 0 ? gen : null;
}

const userText = (payload: PbMessage): string => pbStr(pbAt(payload, 19), 2);

interface ToolCall {
  id: string;
  name: string;
  args: string;
}

function toolCalls(payload: PbMessage): ToolCall[] {
  return pbMessages(pbAt(payload, 20), 7).map((c) => ({
    id: pbStr(c, 1),
    name: pbStr(c, 2),
    args: pbStr(c, 3),
  }));
}

/** One-line summary of a tool call's JSON arguments: the command, path or query it names. */
export function agyToolInput(args: string): string {
  let a: Record<string, unknown> | null = null;
  try {
    const v: unknown = JSON.parse(args);
    if (v && typeof v === "object" && !Array.isArray(v))
      a = v as Record<string, unknown>;
  } catch {
    return args;
  }
  if (!a) return args;
  for (const key of [
    "CommandLine",
    "Path",
    "AbsolutePath",
    "TargetFile",
    "DirectoryPath",
    "SearchPath",
    "Pattern",
    "Query",
    "Url",
    "toolSummary",
  ]) {
    const v = a[key];
    if (typeof v === "string" && v) return v;
  }
  return JSON.stringify(a);
}

/** The first non-empty line, capped like the sidebar title. */
function promptLine(text: string): string {
  for (const line of text.split("\n")) {
    const t = line.trim();
    if (t) return t.slice(0, 120);
  }
  return "";
}

const lineCount = (text: string): number =>
  text ? text.replace(/\n$/, "").split("\n").length : 0;

export interface AgySummary {
  title: string | null;
  usage: Usage;
  /** The last generation's prompt (uncached input + cache read): what the context holds now. */
  contextTokens: number;
  /** That prompt's split, for the Context panel. Null before the first generation. */
  context: ContextBreakdown | null;
}

/** What the session row shows. Reads only step metadata, plus the payload of the first user step. */
export function summarizeAgySteps(steps: AgyStepRow[]): AgySummary {
  const usage: Usage = {
    inputTokens: 0,
    outputTokens: 0,
    cacheReadTokens: 0,
    cacheCreationTokens: 0,
    cacheCreation5mTokens: 0,
    cacheCreation1hTokens: 0,
  };
  let title: string | null = null;
  let context: ContextBreakdown | null = null;
  for (const step of steps) {
    if (title === null && step.stepType === STEP_USER && step.payload) {
      const line = promptLine(userText(pbParse(step.payload)));
      if (line) title = line;
    }
    const gen = generationOf(step);
    if (!gen) continue;
    usage.inputTokens += gen.input;
    usage.cacheReadTokens += gen.cacheRead;
    usage.outputTokens += gen.output;
    if (gen.input + gen.cacheRead > 0)
      context = {
        input: gen.input,
        cacheRead: gen.cacheRead,
        cacheCreation: 0,
      };
  }
  return {
    title,
    usage,
    contextTokens: context ? context.input + context.cacheRead : 0,
    context,
  };
}

const resultOutput = (payload: PbMessage): string =>
  pbStr(pbAt(payload, 140, 2), 1);

/** The conversation as render-ready events, on the shared transcript doc. A turn opens at each user
 *  message and runs to the last step before the next one. */
export function parseAgyEvents(
  steps: AgyStepRow[],
): Omit<TranscriptDoc, "subagents"> {
  const events: TranscriptEvent[] = [];
  const byCallId = new Map<string, ToolEvent>();
  const turns: TurnSummary[] = [];
  let open: TurnSummary | null = null;
  let context: ContextBreakdown | null = null;

  for (const step of steps) {
    const meta = pbParse(step.metadata);
    const tsMs = timeMs(pbAt(meta, 1));
    if (open && tsMs > open.endMs) {
      open.endMs = tsMs;
      open.durationMs = Math.max(0, open.endMs - open.startMs);
    }
    const payload = pbParse(step.payload);
    if (step.stepType === STEP_USER) {
      const text = userText(payload).trim();
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
    } else if (step.stepType === STEP_MODEL) {
      const text = pbStr(pbAt(payload, 20), 1);
      if (text.trim()) events.push({ kind: "assistant", text });
      for (const call of toolCalls(payload)) {
        if (open) open.toolCount++;
        const event: ToolEvent = {
          kind: "tool",
          name: call.name || "tool",
          input: agyToolInput(call.args),
          toolUseId: call.id,
          status: "pending",
          outputLines: 0,
        };
        events.push(event);
        if (call.id) byCallId.set(call.id, event);
      }
      const gen = generationOf(step);
      if (gen && gen.input + gen.cacheRead > 0)
        context = {
          input: gen.input,
          cacheRead: gen.cacheRead,
          cacheCreation: 0,
        };
    } else if (step.stepType === STEP_TOOL_RESULT) {
      const event = byCallId.get(pbStr(pbAt(meta, 4), 1));
      if (event) {
        event.status = step.status === STATUS_FAILED ? "error" : "ok";
        event.outputLines = lineCount(resultOutput(payload));
      }
    }
  }
  if (open) turns.push(open);
  return { events, waitingReason: null, turns, context };
}

/** One tool call's arguments and output, for the drill-in modal. */
export function extractAgyToolResult(
  steps: AgyStepRow[],
  toolUseId: string,
): ToolResultDetail {
  let command: string | null = null;
  for (const step of steps) {
    if (step.stepType === STEP_MODEL && command === null) {
      const call = toolCalls(pbParse(step.payload)).find(
        (c) => c.id === toolUseId,
      );
      if (call) command = agyToolInput(call.args);
    } else if (step.stepType === STEP_TOOL_RESULT && command !== null) {
      const meta = pbParse(step.metadata);
      if (pbStr(pbAt(meta, 4), 1) !== toolUseId) continue;
      return {
        found: true,
        command,
        output: resultOutput(pbParse(step.payload)),
        status: step.status === STATUS_FAILED ? "error" : "ok",
      };
    }
  }
  return command === null
    ? { found: false }
    : { found: true, command, output: "", status: "pending" };
}
