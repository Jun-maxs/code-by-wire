import {
  parseWaitingQuestions,
  type ContextBreakdown,
  type DiffEvent,
  type DiffHunk,
  type ToolEvent,
  type TranscriptDoc,
  type TranscriptEvent,
  type TurnSummary,
  type WaitingPrompt,
} from "@shared/transcript";
import { asRecord } from "./rollout";
import { breakdownFromTokenUsage } from "./usage";

/** Exact prefixes of injected-context user items (codex's environment_context / user_instructions
 *  protocol constants, plus the plugin advertisement): machine context, never a typed prompt. A
 *  real prompt that merely starts with "<" is kept — this is a closed list, not a "<" heuristic. */
const CONTEXT_PREFIXES = [
  "<environment_context>",
  "<user_instructions>",
  "<recommended_plugins>",
] as const;

/** response_item payload types that open a tool row → the rendered tool name; null means "use the
 *  payload's own `name`" (function_call / custom_tool_call carry one). */
export const TOOL_CALL_NAMES = new Map<string, string | null>([
  ["function_call", null],
  ["custom_tool_call", null],
  ["local_shell_call", "shell"],
  ["web_search_call", "web_search"],
  ["tool_search_call", "tool_search"],
  ["image_generation_call", "image_generation"],
]);

/** response_item payload types that close a tool row, paired by call_id. local_shell_call_output
 *  is Responses-API-defined but absent from codex's enum — accepting it is harmless. */
export const TOOL_OUTPUT_TYPES = new Set([
  "function_call_output",
  "custom_tool_call_output",
  "local_shell_call_output",
  "tool_search_output",
]);

const num = (v: unknown): number =>
  typeof v === "number" && Number.isFinite(v) ? v : 0;

/** The object literal passed to tools.exec_command({...}) inside a custom exec script — the modern
 *  encoding wraps the real command in a JS harness call. Null when absent or unparseable. Scans to
 *  the matching close brace (string- and escape-aware) and JSON.parses the slice. */
function execCommandArgs(script: string): Record<string, unknown> | null {
  const call = script.indexOf("tools.exec_command(");
  if (call === -1) return null;
  const start = script.indexOf("{", call);
  if (start === -1) return null;
  let depth = 0;
  let quote: string | null = null;
  for (let i = start; i < script.length; i++) {
    const ch = script[i];
    if (quote !== null) {
      if (ch === "\\") i++;
      else if (ch === quote) quote = null;
    } else if (ch === '"' || ch === "'") quote = ch;
    else if (ch === "{") depth++;
    else if (ch === "}" && --depth === 0) {
      try {
        return asRecord(JSON.parse(script.slice(start, i + 1)));
      } catch {
        return null;
      }
    }
  }
  return null;
}

/** The human command behind a tool call, per encoding; falls back to the raw input text and never
 *  throws. Shared by the row's input summary and the modal's command bar (same sharing rule as
 *  claude's tellingField) so the two can't name a call differently. */
export function toolCommand(payload: Record<string, unknown>): string {
  const joined = (command: unknown): string | null =>
    Array.isArray(command)
      ? command.filter((c): c is string => typeof c === "string").join(" ")
      : null;
  if (payload.type === "function_call") {
    const raw = typeof payload.arguments === "string" ? payload.arguments : "";
    try {
      const command = joined(asRecord(JSON.parse(raw))?.command);
      if (command !== null) return command;
    } catch {
      // not JSON — fall through to raw
    }
    return raw;
  }
  if (payload.type === "custom_tool_call") {
    const script = typeof payload.input === "string" ? payload.input : "";
    const args = execCommandArgs(script);
    if (args && typeof args.cmd === "string") return args.cmd;
    return script;
  }
  if (payload.type === "local_shell_call") {
    return joined(asRecord(payload.action)?.command) ?? "";
  }
  // web_search / tool_search / image_generation: compact JSON of whatever arguments exist
  const extra = payload.action ?? payload.arguments ?? payload.query ?? null;
  if (typeof extra === "string") return extra;
  if (extra !== null) {
    try {
      return JSON.stringify(extra);
    } catch {
      return "";
    }
  }
  return "";
}

/** Normalize an *_output payload's untagged `output` — plain string or content-item array — to
 *  text, unwrapping the classic shell wrapper `{output, metadata:{exit_code}}` when present (the
 *  only place codex records a structured failure signal). */
export function normalizeOutput(output: unknown): {
  text: string;
  error: boolean;
} {
  if (typeof output !== "string")
    return { text: contentText(output), error: false };
  try {
    const wrapper = asRecord(JSON.parse(output));
    const inner = wrapper?.output;
    if (typeof inner === "string") {
      const meta = asRecord(wrapper?.metadata);
      return { text: inner, error: num(meta?.exit_code) !== 0 };
    }
  } catch {
    // not JSON — the raw string is the output
  }
  return { text: output, error: false };
}

/** Exact rendered line count of an output text (a trailing newline adds no phantom line). */
const outputLineCount = (text: string): number =>
  text ? text.replace(/\n$/, "").split("\n").length : 0;

/** Join the text of a content value: a bare string passes through; an array contributes every
 *  item's `text` (input_text / output_text / summary_text / reasoning_text all carry one). */
function contentText(content: unknown): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  const parts: string[] = [];
  for (const item of content) {
    const r = asRecord(item);
    if (r && typeof r.text === "string" && r.text) parts.push(r.text);
  }
  return parts.join("\n");
}

/** Single-line turn label: the prompt's first non-empty line, capped like the sidebar title. */
function promptLine(text: string): string {
  for (const line of text.split("\n")) {
    const t = line.trim();
    if (t) return t.slice(0, 120);
  }
  return "";
}

const QUESTION_TOOL_NAMES = new Set([
  "request_user_input",
  "request_user_input_async",
]);

function parseJsonObject(raw: unknown): Record<string, unknown> | null {
  if (raw && typeof raw === "object" && !Array.isArray(raw))
    return raw as Record<string, unknown>;
  if (typeof raw !== "string" || !raw.trim()) return null;
  try {
    return asRecord(JSON.parse(raw));
  } catch {
    return null;
  }
}

/** Extract per-file hunks from Codex V4A `*** Begin Patch` blocks (either direct `apply_patch` input
 *  or an `apply_patch` heredoc inside an `exec` / `shell` command). */
export function parseApplyPatchBlocks(
  raw: string,
): { file: string; hunk: DiffHunk }[] {
  if (!raw.includes("*** Begin Patch")) return [];
  const results: { file: string; hunk: DiffHunk }[] = [];
  let inPatch = false;
  let currentFile: string | null = null;
  let mode: "add" | "delete" | "update" | null = null;
  let removed: string[] = [];
  let added: string[] = [];

  const flushFile = (): void => {
    if (currentFile !== null) {
      results.push({
        file: currentFile,
        hunk: { removed, added },
      });
    }
    currentFile = null;
    mode = null;
    removed = [];
    added = [];
  };

  for (const rawLine of raw.split(/\r?\n/)) {
    if (rawLine.startsWith("*** Begin Patch")) {
      flushFile();
      inPatch = true;
      continue;
    }
    if (!inPatch) continue;
    if (rawLine.startsWith("*** End Patch")) {
      flushFile();
      inPatch = false;
      continue;
    }
    if (rawLine.startsWith("*** Add File:")) {
      flushFile();
      currentFile = rawLine.slice("*** Add File:".length).trim();
      mode = "add";
      continue;
    }
    if (rawLine.startsWith("*** Delete File:")) {
      flushFile();
      currentFile = rawLine.slice("*** Delete File:".length).trim();
      mode = "delete";
      continue;
    }
    if (rawLine.startsWith("*** Update File:")) {
      flushFile();
      currentFile = rawLine.slice("*** Update File:".length).trim();
      mode = "update";
      continue;
    }
    if (rawLine.startsWith("*** Move to:")) {
      const moved = rawLine.slice("*** Move to:".length).trim();
      if (moved) currentFile = moved;
      continue;
    }
    if (
      rawLine.startsWith("@@") ||
      rawLine.startsWith("*** End of File") ||
      currentFile === null
    ) {
      continue;
    }
    if (mode === "add") {
      added.push(rawLine.startsWith("+") ? rawLine.slice(1) : rawLine);
    } else if (mode === "delete") {
      if (rawLine.startsWith("-")) removed.push(rawLine.slice(1));
    } else if (mode === "update") {
      if (rawLine.startsWith("+") && !rawLine.startsWith("+++")) {
        added.push(rawLine.slice(1));
      } else if (rawLine.startsWith("-") && !rawLine.startsWith("---")) {
        removed.push(rawLine.slice(1));
      }
    }
  }
  flushFile();
  return results;
}

function extractPatchText(
  name: string,
  payload: Record<string, unknown>,
  commandText: string,
): string {
  if (name === "apply_patch") {
    if (typeof payload.input === "string" && payload.input)
      return payload.input;
    const args = parseJsonObject(payload.arguments);
    if (args) {
      const patch = args.patch ?? args.input ?? args.diff;
      if (typeof patch === "string") return patch;
    }
  }
  return commandText;
}

/**
 * Project a rollout's JSONL into render-ready events — the codex analog of claude's
 * parseTranscriptEvents, targeting the same shared doc so the renderer needs no codex wiring.
 *
 * Renders from response_item lines only: in legacy history mode every user prompt and assistant
 * message ALSO lands as an event_msg (user_message / agent_message), so rendering both streams
 * would double the conversation. event_msg lines feed only the turn timeline (task_started / task_complete,
 * plus their turn_* aliases) and the context split (the last token_count). session_meta, turn_context,
 * world_state, compacted, inter_agent_* and unknown line types are skipped. Tolerant by design, like the
 * head parser in rollout.ts: no line shape may throw, and a half-written trailing line during an append is fine.
 */
export function parseRolloutEvents(
  jsonl: string,
): Omit<TranscriptDoc, "subagents"> {
  const events: TranscriptEvent[] = [];
  // Tool and diff events keyed by call_id so the matching *_output line can back-patch status + output size.
  const byCallId = new Map<string, ToolEvent>();
  const diffsByCallId = new Map<string, DiffEvent[]>();
  const pendingQuestions = new Map<
    string,
    { reason: string; prompt: WaitingPrompt }
  >();
  // Timeline: task_started opens a turn, task_complete closes it. A started-but-uncompleted tail
  // turn (still running, or aborted) finalizes as-is — endMs stays startMs, durationMs 0, the
  // shared type's in-flight rule. Older files without these events simply yield no turns.
  const turns: TurnSummary[] = [];
  let open: TurnSummary | null = null;
  let context: ContextBreakdown | null = null;

  const finalizeOpen = (): void => {
    if (open) {
      turns.push(open);
      open = null;
    }
  };

  for (const line of jsonl.split("\n")) {
    if (!line.trim()) continue;
    let row: Record<string, unknown> | null;
    try {
      row = asRecord(JSON.parse(line));
    } catch {
      continue; // malformed / half-written line
    }
    if (!row) continue;
    const payload = asRecord(row.payload);
    if (!payload) continue;
    const ts =
      typeof row.timestamp === "string" ? Date.parse(row.timestamp) : NaN;
    const tsMs = Number.isFinite(ts) ? ts : 0;

    if (row.type === "event_msg") {
      const kind = payload.type;
      if (kind === "task_started" || kind === "turn_started") {
        pendingQuestions.clear();
        finalizeOpen();
        open = {
          index: turns.length + 1,
          prompt: "",
          startMs: tsMs,
          endMs: tsMs,
          durationMs: 0,
          toolCount: 0,
        };
      } else if (kind === "task_complete" || kind === "turn_complete") {
        pendingQuestions.clear();
        if (open) {
          open.endMs = Math.max(open.endMs, tsMs);
          const reported = num(payload.duration_ms);
          open.durationMs =
            reported > 0 ? reported : Math.max(0, open.endMs - open.startMs);
          finalizeOpen();
        }
      } else if (kind === "token_count") {
        const info = asRecord(payload.info);
        const last = asRecord(info?.last_token_usage);
        if (last) context = breakdownFromTokenUsage(last);
      }
      // user_message / agent_message / everything else: response_item duplicates, or
      // non-conversational telemetry — never rendered.
      continue;
    }

    if (row.type !== "response_item") continue;

    const kind = payload.type;
    if (kind === "message") {
      if (payload.role === "user") {
        const text = contentText(payload.content).trim();
        if (!text || CONTEXT_PREFIXES.some((p) => text.startsWith(p))) continue;
        pendingQuestions.clear();
        events.push({ kind: "user", text });
        if (open && !open.prompt) open.prompt = promptLine(text);
      } else if (payload.role === "assistant") {
        const text = contentText(payload.content);
        if (text.trim()) events.push({ kind: "assistant", text });
      }
      // developer (permissions / multi-agent role prompts) and unknown roles: injected context
      continue;
    }
    if (kind === "reasoning") {
      // Summary + optional plaintext content; encrypted_content alone renders nothing.
      const text = [contentText(payload.summary), contentText(payload.content)]
        .filter(Boolean)
        .join("\n");
      if (text.trim()) events.push({ kind: "thinking", text });
      continue;
    }
    if (typeof kind === "string" && TOOL_CALL_NAMES.has(kind)) {
      if (open) open.toolCount++;
      const callId = typeof payload.call_id === "string" ? payload.call_id : "";
      const name =
        TOOL_CALL_NAMES.get(kind) ??
        (typeof payload.name === "string" && payload.name
          ? payload.name
          : "tool");
      const cmdText = toolCommand(payload);

      if (QUESTION_TOOL_NAMES.has(name)) {
        const args = parseJsonObject(payload.arguments ?? payload.input);
        const questions = parseWaitingQuestions(args?.questions);
        const reason = questions.length
          ? questions.map((q) => q.question).join(" · ")
          : "Waiting on a question";
        const key = callId || `q_${events.length}`;
        pendingQuestions.set(key, {
          reason,
          prompt: {
            kind: "question",
            toolUseId: callId,
            toolName: name,
            questions:
              questions.length > 0
                ? questions
                : [{ question: reason, options: [] }],
          },
        });
      }

      const patches = parseApplyPatchBlocks(
        extractPatchText(name, payload, cmdText),
      );
      if (patches.length > 0) {
        const diffEvents: DiffEvent[] = patches.map((p) => ({
          kind: "diff",
          tool: name === "apply_patch" ? "apply_patch" : name,
          file: p.file,
          hunk: p.hunk,
          status: "pending",
        }));
        events.push(...diffEvents);
        if (callId) diffsByCallId.set(callId, diffEvents);
        continue;
      }

      const event: ToolEvent = {
        kind: "tool",
        name,
        input: cmdText,
        toolUseId: callId,
        status: "pending",
        outputLines: 0,
      };
      events.push(event);
      if (callId) byCallId.set(callId, event);
      continue;
    }
    if (typeof kind === "string" && TOOL_OUTPUT_TYPES.has(kind)) {
      const callId = typeof payload.call_id === "string" ? payload.call_id : "";
      if (callId) pendingQuestions.delete(callId);
      const { text, error } = normalizeOutput(payload.output);
      const event = callId ? byCallId.get(callId) : undefined;
      if (event) {
        event.status = error ? "error" : "ok";
        event.outputLines = outputLineCount(text);
      }
      const diffs = callId ? diffsByCallId.get(callId) : undefined;
      if (diffs) {
        const isPatchErr =
          error ||
          text.startsWith("patch failed") ||
          text.startsWith("apply_patch verification failed");
        for (const d of diffs) d.status = isPatchErr ? "error" : "ok";
      }
      // orphan outputs (no matching call): ignored
    }
    // compaction / context_compaction / agent_message / unknown payloads: skipped
  }
  finalizeOpen();

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
