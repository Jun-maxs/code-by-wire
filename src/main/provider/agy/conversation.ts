import type { TokenSpeed } from "@shared/metrics";
import {
  parseWaitingQuestions,
  type ContextBreakdown,
  type DiffEvent,
  type DiffHunk,
  type ToolEvent,
  type ToolResultDetail,
  type TranscriptDoc,
  type TranscriptEvent,
  type TurnSummary,
  type WaitingPrompt,
} from "@shared/transcript";
import type { TaskEntry, TurnActivity } from "@shared/turn-activity";
import type { ModelUsage, Usage } from "@shared/types";
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
export const STEP_COMPACTION = 23;
export const STEP_TOOL_RESULT = 132;
const STATUS_PENDING = 1;
const STATUS_RUNNING = 2;
const STATUS_FAILED = 6;
const STATUS_CANCELLED = 7;
const STATUS_GENERATING = 8;

const ACTIVE_STEP_STATUSES = new Set([
  STATUS_PENDING,
  STATUS_RUNNING,
  STATUS_GENERATING,
]);

/** One `steps` row as stored. */
export interface AgyStepRow {
  idx: number;
  stepType: number;
  status: number;
  metadata: Uint8Array | null;
  payload: Uint8Array | null;
  hasPermissions?: boolean;
}

/** One `gen_metadata` row as stored. */
export interface AgyGenRow {
  idx: number;
  data: Uint8Array | null;
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

export interface AgyGenMeta {
  model: { id: string; label: string } | null;
  /** TTFT (1.11) + streaming duration (1.12) in ms, from Google Duration messages. */
  durationMs: number;
  lastStepIndex: number | null;
  parentCascadeId: string;
  subagentType: string;
}

/** Decode one `gen_metadata` row: model identity, request duration, and parent cascade metadata. */
export function readAgyGenMeta(blob: Uint8Array | null): AgyGenMeta {
  const m = pbAt(pbParse(blob), 1);
  const id = pbStr(m, 19);
  const label = pbStr(m, 21);
  const ttftMs = timeMs(pbAt(m, 11));
  const streamMs = timeMs(pbAt(m, 12));
  let lastStepIndex: number | null = null;
  let parentCascadeId = "";
  let subagentType = "";
  for (const kv of pbMessages(m, 20)) {
    const key = pbStr(kv, 1);
    const val = pbStr(kv, 2);
    if (key === "last_step_index") {
      const n = Number(val);
      if (Number.isInteger(n) && n >= 0) lastStepIndex = n;
    } else if (key === "parent_cascade_id" && val) {
      parentCascadeId = val;
    } else if (key === "subagent_type" && val) {
      subagentType = val;
    }
  }
  return {
    model: id || label ? { id, label: label || id } : null,
    durationMs: Math.max(0, ttftMs + streamMs),
    lastStepIndex,
    parentCascadeId,
    subagentType,
  };
}

/** The model a generation ran on, from one `gen_metadata` row. */
export function readAgyModel(
  blob: Uint8Array | null,
): { id: string; label: string } | null {
  return readAgyGenMeta(blob).model;
}

interface Generation {
  input: number;
  cacheRead: number;
  output: number;
}

function generationOf(meta: PbMessage): Generation | null {
  const g = pbAt(meta, 9);
  const gen = {
    input: pbNum(g, 2),
    cacheRead: pbNum(g, 5),
    output: pbNum(g, 3),
  };
  return gen.input + gen.cacheRead + gen.output > 0 ? gen : null;
}

interface Interval {
  start: number;
  end: number;
}

function stepRequestInterval(
  meta: PbMessage,
  gm?: AgyGenMeta,
): Interval | null {
  const start = timeMs(pbAt(meta, 1));
  if (start <= 0) return null;
  const t6 = timeMs(pbAt(meta, 6));
  const t7 = timeMs(pbAt(meta, 7));
  const t8 = timeMs(pbAt(meta, 8));
  let end = start;
  if (t7 >= start) end = t7;
  else if (gm && gm.durationMs > 0) end = start + gm.durationMs;
  else if (t8 >= start) end = t8;
  else if (t6 >= start) end = t6;
  return { start, end: Math.max(start, end) };
}

function mergedDurationMs(intervals: Interval[]): number {
  if (intervals.length === 0) return 0;
  const sorted = [...intervals].sort((a, b) => a.start - b.start);
  let total = 0;
  let curStart = -1;
  let curEnd = -1;
  for (const iv of sorted) {
    if (iv.start > curEnd) {
      if (curEnd > curStart) total += curEnd - curStart;
      curStart = iv.start;
      curEnd = iv.end;
    } else if (iv.end > curEnd) {
      curEnd = iv.end;
    }
  }
  if (curEnd > curStart) total += curEnd - curStart;
  return total;
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

function isAgyToolFailure(
  status: number,
  toolName: string,
  output: string,
): boolean {
  if (status === STATUS_FAILED) return true;
  if (
    toolName === "run_command" &&
    /^Command exited with code (?!0\b)\d+/m.test(output)
  ) {
    return true;
  }
  return false;
}

const splitLines = (v: unknown): string[] =>
  typeof v === "string" && v.length ? v.split("\n") : [];

const strField = (obj: Record<string, unknown>, key: string): string => {
  const v = obj[key];
  return typeof v === "string" ? v : "";
};

function parseArgsObject(args: string): Record<string, unknown> | null {
  try {
    const v: unknown = JSON.parse(args);
    if (v && typeof v === "object" && !Array.isArray(v))
      return v as Record<string, unknown>;
  } catch {
    // malformed JSON
  }
  return null;
}

const AGY_DIFF_TOOLS = new Set([
  "edit_file",
  "write_file",
  "replace_file_content",
  "multi_replace_file_content",
  "write_to_file",
]);

function agyDiffHunk(
  tool: string,
  a: Record<string, unknown>,
): { file: string; hunk: DiffHunk } {
  if (tool === "edit_file") {
    return {
      file: strField(a, "Path"),
      hunk: {
        removed: splitLines(a.Target),
        added: splitLines(a.Replacement),
      },
    };
  }
  if (tool === "write_file") {
    return {
      file: strField(a, "Path"),
      hunk: { removed: [], added: splitLines(a.Content) },
    };
  }
  if (tool === "replace_file_content") {
    return {
      file: strField(a, "TargetFile"),
      hunk: {
        removed: splitLines(a.TargetContent),
        added: splitLines(a.ReplacementContent),
      },
    };
  }
  if (tool === "multi_replace_file_content") {
    const removed: string[] = [];
    const added: string[] = [];
    const chunks = Array.isArray(a.ReplacementChunks)
      ? a.ReplacementChunks
      : [];
    for (const c of chunks) {
      if (c && typeof c === "object") {
        const chunk = c as Record<string, unknown>;
        removed.push(...splitLines(chunk.TargetContent));
        added.push(...splitLines(chunk.ReplacementContent));
      }
    }
    return {
      file: strField(a, "TargetFile"),
      hunk: { removed, added },
    };
  }
  return {
    file: strField(a, "TargetFile"),
    hunk: { removed: [], added: splitLines(a.CodeContent) },
  };
}

export interface AgySummary {
  title: string | null;
  usage: Usage;
  usageByModel: ModelUsage[];
  /** The last generation's prompt (uncached input + cache read): what the context holds now. */
  contextTokens: number;
  /** That prompt's split, for the Context panel. Null before the first generation. */
  context: ContextBreakdown | null;
  compactionCount: number;
  /** Sum of merged API generation intervals across completed steps (ms). */
  apiDurationMs: number;
  /** Start epoch ms of a currently generating STEP_MODEL (status === 8), when live. */
  inFlightStartMs: number | null;
  firstStepMs: number | null;
  lastStepMs: number | null;
  hasInFlightStep: boolean;
  awaitingPermission: boolean;
  /** True when the latest model turn left an `ask_question` call unanswered. */
  awaitingUser?: boolean;
  hasUnansweredWork: boolean;
  parentSessionId?: string;
  subagentType?: string;
}

const emptyUsage = (): Usage => ({
  inputTokens: 0,
  outputTokens: 0,
  cacheReadTokens: 0,
  cacheCreationTokens: 0,
  cacheCreation5mTokens: 0,
  cacheCreation1hTokens: 0,
});

/** What the session row shows. Reads only step metadata, plus the payload of the first user step. */
export function summarizeAgySteps(
  steps: AgyStepRow[],
  genMeta: AgyGenRow[] = [],
): AgySummary {
  const usage = emptyUsage();
  const byModel = new Map<string, { modelRaw: string | null; usage: Usage }>();
  const parsedMeta = genMeta.map((row) => readAgyGenMeta(row.data));

  let title: string | null = null;
  let context: ContextBreakdown | null = null;
  let compactionCount = 0;
  let genCursor = 0;
  let lastModelRaw: string | null = null;
  let firstStepMs: number | null = null;
  let lastStepMs: number | null = null;
  let inFlightStartMs: number | null = null;
  let hasInFlightStep = false;
  let awaitingPermission = false;
  let hasUnansweredWork = false;
  let parentSessionId: string | undefined;
  let subagentType: string | undefined;
  const intervals: Interval[] = [];
  const pendingAskIds = new Set<string>();

  for (const gm of parsedMeta) {
    if (!parentSessionId && gm.parentCascadeId)
      parentSessionId = gm.parentCascadeId;
    if (!subagentType && gm.subagentType) subagentType = gm.subagentType;
  }

  for (const step of steps) {
    const meta = pbParse(step.metadata);
    const ts = timeMs(pbAt(meta, 1));
    const t7 = timeMs(pbAt(meta, 7));
    const t8 = timeMs(pbAt(meta, 8));
    if (ts > 0) {
      if (firstStepMs === null || ts < firstStepMs) firstStepMs = ts;
      lastStepMs = Math.max(lastStepMs ?? 0, ts, t7, t8);
    }

    if (step.hasPermissions && ACTIVE_STEP_STATUSES.has(step.status))
      awaitingPermission = true;
    else if (ACTIVE_STEP_STATUSES.has(step.status)) hasInFlightStep = true;

    if (step.stepType === STEP_USER) {
      pendingAskIds.clear();
      if (title === null && step.payload) {
        const line = promptLine(userText(pbParse(step.payload)));
        if (line) title = line;
      }
    }

    if (step.stepType === STEP_COMPACTION) {
      compactionCount++;
    } else if (
      step.stepType === STEP_USER ||
      step.stepType === STEP_TOOL_RESULT
    ) {
      hasUnansweredWork = true;
      if (step.stepType === STEP_TOOL_RESULT) {
        const callId = pbStr(pbAt(meta, 4), 1);
        if (callId) pendingAskIds.delete(callId);
      }
    }

    if (step.stepType !== STEP_MODEL) continue;

    if (step.payload) {
      for (const call of toolCalls(pbParse(step.payload))) {
        if (call.name === "ask_question" && call.id) pendingAskIds.add(call.id);
      }
    }

    const gm = parsedMeta[genCursor++];
    const modelRaw = gm?.model?.id || gm?.model?.label || lastModelRaw || null;
    if (gm?.model) lastModelRaw = gm.model.id || gm.model.label || lastModelRaw;

    const gen = generationOf(meta);
    const iv = stepRequestInterval(meta, gm);
    if (iv && iv.end > iv.start) intervals.push(iv);

    if (step.status === STATUS_GENERATING && !gen && ts > 0)
      inFlightStartMs = ts;
    else if (
      step.status === STATUS_GENERATING ||
      step.status === STATUS_PENDING ||
      step.status === STATUS_RUNNING
    )
      hasUnansweredWork = true;
    else if (step.status === STATUS_FAILED || step.status === STATUS_CANCELLED)
      hasUnansweredWork = false;
    else hasUnansweredWork = false;

    if (!gen) continue;
    usage.inputTokens += gen.input;
    usage.cacheReadTokens += gen.cacheRead;
    usage.outputTokens += gen.output;

    const modelKey = modelRaw ?? "__unknown__";
    let modelAcc = byModel.get(modelKey);
    if (!modelAcc) {
      modelAcc = { modelRaw, usage: emptyUsage() };
      byModel.set(modelKey, modelAcc);
    }
    modelAcc.usage.inputTokens += gen.input;
    modelAcc.usage.cacheReadTokens += gen.cacheRead;
    modelAcc.usage.outputTokens += gen.output;

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
    usageByModel: [...byModel.values()],
    contextTokens: context ? context.input + context.cacheRead : 0,
    context,
    compactionCount,
    apiDurationMs: mergedDurationMs(intervals),
    inFlightStartMs,
    firstStepMs,
    lastStepMs,
    hasInFlightStep,
    awaitingPermission,
    ...(pendingAskIds.size > 0 ? { awaitingUser: true } : {}),
    hasUnansweredWork,
    ...(parentSessionId ? { parentSessionId } : {}),
    ...(subagentType ? { subagentType } : {}),
  };
}

/**
 * Rolling-window token throughput across `STEP_MODEL` intervals (`[latest - windowMs, latest]`).
 * Merges overlapping spans so parallel child generations never double-count the duration denominator.
 */
export function computeAgyTokenSpeed(
  steps: AgyStepRow[],
  genMeta: AgyGenRow[] = [],
  windowMs = 60_000,
): TokenSpeed | null {
  const parsedMeta = genMeta.map((r) => readAgyGenMeta(r.data));
  const samples: (Interval & { input: number; output: number })[] = [];
  let genCursor = 0;
  let latest = 0;

  for (const step of steps) {
    if (step.stepType !== STEP_MODEL) continue;
    const gm = parsedMeta[genCursor++];
    const meta = pbParse(step.metadata);
    const gen = generationOf(meta);
    const iv = stepRequestInterval(meta, gm);
    if (!gen || !iv || iv.end <= iv.start) continue;
    samples.push({
      start: iv.start,
      end: iv.end,
      input: gen.input,
      output: gen.output,
    });
    if (iv.end > latest) latest = iv.end;
  }

  if (samples.length === 0) return null;
  const windowStart = windowMs > 0 ? latest - windowMs : -Infinity;
  const inWindow = samples
    .filter((s) => s.end >= windowStart)
    .map((s) => ({ ...s, start: Math.max(s.start, windowStart) }));
  if (inWindow.length === 0) return null;

  const durMs = mergedDurationMs(inWindow);
  if (durMs <= 0) return null;
  const sec = durMs / 1000;
  const input = inWindow.reduce((sum, s) => sum + s.input, 0);
  const output = inWindow.reduce((sum, s) => sum + s.output, 0);
  return {
    inputTps: input / sec,
    outputTps: output / sec,
    totalTps: (input + output) / sec,
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
  const byCallId = new Map<string, ToolEvent | DiffEvent>();
  const pendingQuestions = new Map<
    string,
    { reason: string; prompt: WaitingPrompt }
  >();
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
      pendingQuestions.clear();
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
      const thinking = pbStr(pbAt(payload, 20), 3);
      if (thinking.trim()) events.push({ kind: "thinking", text: thinking });
      const text = pbStr(pbAt(payload, 20), 1);
      if (text.trim()) events.push({ kind: "assistant", text });
      for (const call of toolCalls(payload)) {
        if (open) open.toolCount++;
        const toolName = call.name || "tool";
        const parsedArgs = parseArgsObject(call.args);

        if (toolName === "ask_question") {
          const questions = parseWaitingQuestions(parsedArgs?.questions);
          const reason = questions.length
            ? questions.map((q) => q.question).join(" · ")
            : "Waiting on a question";
          const key = call.id || `ask_${events.length}`;
          pendingQuestions.set(key, {
            reason,
            prompt: {
              kind: "question",
              toolUseId: call.id,
              toolName,
              questions:
                questions.length > 0
                  ? questions
                  : [{ question: reason, options: [] }],
            },
          });
        }

        if (toolName === "invoke_subagent") {
          events.push({
            kind: "subagent",
            agentType:
              (parsedArgs && strField(parsedArgs, "TypeName")) || "subagent",
            description:
              (parsedArgs &&
                (strField(parsedArgs, "Role") ||
                  strField(parsedArgs, "Prompt"))) ||
              "",
            toolUseId: call.id,
          });
          continue;
        }

        if (AGY_DIFF_TOOLS.has(toolName) && parsedArgs) {
          const { file, hunk } = agyDiffHunk(toolName, parsedArgs);
          const diffEv: DiffEvent = {
            kind: "diff",
            tool: toolName,
            file,
            hunk,
            status: "pending",
          };
          events.push(diffEv);
          if (call.id) byCallId.set(call.id, diffEv);
          continue;
        }

        const event: ToolEvent = {
          kind: "tool",
          name: toolName,
          input: agyToolInput(call.args),
          toolUseId: call.id,
          status: "pending",
          outputLines: 0,
        };
        events.push(event);
        if (call.id) byCallId.set(call.id, event);
      }
      const gen = generationOf(meta);
      if (gen && gen.input + gen.cacheRead > 0)
        context = {
          input: gen.input,
          cacheRead: gen.cacheRead,
          cacheCreation: 0,
        };
    } else if (step.stepType === STEP_TOOL_RESULT) {
      const callId = pbStr(pbAt(meta, 4), 1);
      if (callId) pendingQuestions.delete(callId);
      const event = byCallId.get(callId);
      if (event) {
        const out = resultOutput(payload);
        const toolName = event.kind === "tool" ? event.name : event.tool;
        event.status = isAgyToolFailure(step.status, toolName, out)
          ? "error"
          : "ok";
        if (event.kind === "tool") {
          event.outputLines = lineCount(out);
        }
      }
    }
  }
  if (open) turns.push(open);

  let activeQuestion: { reason: string; prompt: WaitingPrompt } | undefined;
  for (const q of pendingQuestions.values()) activeQuestion = q;

  return {
    events,
    waitingReason: activeQuestion?.reason ?? null,
    turns,
    context,
    ...(activeQuestion ? { waitingPrompt: activeQuestion.prompt } : {}),
  };
}

/** One tool call's arguments and output, for the drill-in modal. */
export function extractAgyToolResult(
  steps: AgyStepRow[],
  toolUseId: string,
): ToolResultDetail {
  let command: string | null = null;
  let toolName = "tool";
  for (const step of steps) {
    if (step.stepType === STEP_MODEL && command === null) {
      const call = toolCalls(pbParse(step.payload)).find(
        (c) => c.id === toolUseId,
      );
      if (call) {
        command = agyToolInput(call.args);
        toolName = call.name || "tool";
      }
    } else if (step.stepType === STEP_TOOL_RESULT && command !== null) {
      const meta = pbParse(step.metadata);
      if (pbStr(pbAt(meta, 4), 1) !== toolUseId) continue;
      const output = resultOutput(pbParse(step.payload));
      return {
        found: true,
        command,
        output,
        status: isAgyToolFailure(step.status, toolName, output)
          ? "error"
          : "ok",
      };
    }
  }
  return command === null
    ? { found: false }
    : { found: true, command, output: "", status: "pending" };
}

const MAX_ACTIVITY_TASKS = 20;

/** Compact a tool target for the split pane progress strip: basename on paths, bounded single line. */
function compactTarget(raw: string): string {
  const first = promptLine(raw);
  if (!first) return "";
  if (/^(?:[A-Za-z]:)?[/\\]/.test(first)) {
    const parts = first.split(/[\\/]/).filter(Boolean);
    const tail = parts[parts.length - 1];
    if (tail) return tail.slice(0, 60);
  }
  return first.slice(0, 80);
}

/** Current-turn progress and recent task list for split-pane activity headers. */
export function extractAgyTurnActivity(steps: AgyStepRow[]): TurnActivity {
  const tasks: TaskEntry[] = [];
  let current: TaskEntry | null = null;
  let turnStartMs: number | null = null;
  let turnSteps = 0;
  let lastTool: TurnActivity["lastTool"] = null;
  let lastMs: number | null = null;

  for (const step of steps) {
    const meta = pbParse(step.metadata);
    const ts = timeMs(pbAt(meta, 1));
    const endTs = Math.max(ts, timeMs(pbAt(meta, 7)), timeMs(pbAt(meta, 8)));
    if (endTs > 0) lastMs = endTs;

    if (step.stepType === STEP_USER) {
      const text = promptLine(userText(pbParse(step.payload)));
      if (!text) continue;
      if (current) tasks.push(current);
      const start = ts > 0 ? ts : null;
      current = {
        text,
        startMs: start,
        endMs: endTs > 0 ? endTs : start,
        steps: 0,
        adds: [],
      };
      turnStartMs = start;
      turnSteps = 0;
    } else if (step.stepType === STEP_MODEL) {
      for (const call of toolCalls(pbParse(step.payload))) {
        turnSteps++;
        if (current) current.steps++;
        lastTool = {
          name: call.name || "tool",
          target: compactTarget(agyToolInput(call.args)),
        };
      }
      if (current && endTs > 0) current.endMs = endTs;
    } else if (current && endTs > 0) {
      current.endMs = endTs;
    }
  }

  if (current) tasks.push(current);
  return {
    turnStartMs,
    steps: turnSteps,
    lastTool,
    lastMs,
    tasks: tasks.slice(-MAX_ACTIVITY_TASKS),
    queued: [],
  };
}
