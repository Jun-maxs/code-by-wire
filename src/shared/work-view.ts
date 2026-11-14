import type {
  DiffEvent,
  ToolEvent,
  TranscriptDoc,
  TranscriptEvent,
  TurnSummary,
  WaitingPrompt,
} from "./transcript";

export type WorkPhase =
  | "thinking"
  | "reading"
  | "searching"
  | "editing"
  | "running"
  | "subagent"
  | "working";

export interface WorkActiveStep {
  phase: WorkPhase;
  toolName: string;
  target: string;
}

export interface WorkFileChange {
  file: string;
  added: number;
  removed: number;
  status: "ok" | "error" | "pending";
  mergedDiff: DiffEvent;
  editCount: number;
}

export type WorkErrorItem =
  | { kind: "tool"; event: ToolEvent }
  | { kind: "diff"; event: DiffEvent };

export interface WorkSpine {
  /** Count of tool + diff + subagent steps in this turn. */
  stepCount: number;
  thinkingCount: number;
  readCount: number;
  searchCount: number;
  editCount: number;
  commandCount: number;
  subagentCount: number;
  addedLines: number;
  removedLines: number;
  hasPending: boolean;
  activeStep: WorkActiveStep | null;
  /** Intermediate process events (tools, diffs, thinking, subagents, pre-tool chatter) for on-demand expansion. */
  steps: TranscriptEvent[];
}

export interface WorkTurn {
  /** 1-based turn number in conversation order (0 only for orphan pre-prompt events). */
  index: number;
  /** Full user prompt text, or null for orphan pre-prompt events. */
  prompt: string | null;
  /** True when injected mid-turn via queued_command while a turn was running. */
  midTurn: boolean;
  /** True when queued in the CLI input buffer and not yet absorbed into the turn stream. */
  queued?: boolean;
  startMs: number;
  endMs: number;
  durationMs: number;
  spine: WorkSpine;
  /** Aggregated file changes for this turn, in order of first edit. */
  files: WorkFileChange[];
  /** Failed tool/diff steps surfaced automatically even when the spine is collapsed. */
  errors: WorkErrorItem[];
  /** High-value assistant deliverable markdown blocks surfaced directly on the turn card. */
  deliverables: string[];
  /** Structured waiting prompt (question options or permission) when attached to the active tail turn. */
  waiting: WaitingPrompt | null;
}

const READ_TOOLS = new Set([
  "Read",
  "read_file",
  "view_file",
  "view_file_outline",
  "view_code_item",
  "NotebookRead",
]);

const SEARCH_TOOLS = new Set([
  "Grep",
  "Glob",
  "LS",
  "WebSearch",
  "WebFetch",
  "ToolSearch",
  "grep_search",
  "find_by_name",
  "list_dir",
  "search_web",
  "read_url_content",
  "web_search",
  "tool_search",
]);

const EDIT_TOOLS = new Set([
  "Edit",
  "Write",
  "MultiEdit",
  "NotebookEdit",
  "apply_patch",
  "edit_file",
  "write_file",
  "replace_file_content",
  "multi_replace_file_content",
  "write_to_file",
]);

const COMMAND_TOOLS = new Set([
  "Bash",
  "exec",
  "js",
  "shell",
  "run_command",
  "command_status",
  "send_command_input",
]);

const QUESTION_TOOLS = new Set([
  "AskUserQuestion",
  "request_user_input",
  "request_user_input_async",
  "ask_question",
]);

export function classifyToolPhase(toolName: string): WorkPhase {
  if (READ_TOOLS.has(toolName)) return "reading";
  if (SEARCH_TOOLS.has(toolName)) return "searching";
  if (EDIT_TOOLS.has(toolName)) return "editing";
  if (COMMAND_TOOLS.has(toolName)) return "running";
  return "working";
}

function shortTarget(raw: string): string {
  const firstLine = raw.split(/\r?\n/)[0]?.trim() ?? "";
  if (!firstLine) return "";
  return firstLine.length > 96 ? firstLine.slice(0, 95) + "…" : firstLine;
}

function activeStepFromEvent(ev: TranscriptEvent): WorkActiveStep | null {
  switch (ev.kind) {
    case "thinking":
      return { phase: "thinking", toolName: "thinking", target: "" };
    case "diff":
      return {
        phase: "editing",
        toolName: ev.tool,
        target: shortTarget(ev.file),
      };
    case "subagent":
      return {
        phase: "subagent",
        toolName: ev.agentType,
        target: shortTarget(ev.description || ev.agentType),
      };
    case "tool":
      if (QUESTION_TOOLS.has(ev.name)) return null;
      return {
        phase: classifyToolPhase(ev.name),
        toolName: ev.name,
        target: shortTarget(ev.input),
      };
    default:
      return null;
  }
}

function mergeFileStatus(
  prev: "ok" | "error" | "pending",
  next: "ok" | "error" | "pending",
): "ok" | "error" | "pending" {
  if (prev === "error" || next === "error") return "error";
  if (prev === "pending" || next === "pending") return "pending";
  return "ok";
}

function buildTurn(
  index: number,
  prompt: string | null,
  midTurn: boolean,
  body: TranscriptEvent[],
  summary: TurnSummary | undefined,
  waiting: WaitingPrompt | null,
): WorkTurn {
  let lastToolIdx = -1;
  for (let i = 0; i < body.length; i++) {
    const k = body[i].kind;
    if (k === "tool" || k === "diff" || k === "subagent") {
      lastToolIdx = i;
    }
  }

  const postToolAssistants: number[] = [];
  const preToolAssistants: number[] = [];
  for (let i = 0; i < body.length; i++) {
    if (body[i].kind !== "assistant") continue;
    if (i > lastToolIdx) postToolAssistants.push(i);
    else preToolAssistants.push(i);
  }

  // Surface every assistant block after the last tool call as deliverables. If a turn ended on a
  // tool call (e.g. a final verification command or an AskUserQuestion) with no post-tool prose,
  // promote the last pre-tool assistant block so its explanation/answer is never hidden inside the spine.
  const deliverableIndices = new Set<number>(postToolAssistants);
  if (deliverableIndices.size === 0 && preToolAssistants.length > 0) {
    deliverableIndices.add(preToolAssistants[preToolAssistants.length - 1]);
  }

  const deliverables: string[] = [];
  const steps: TranscriptEvent[] = [];
  const errors: WorkErrorItem[] = [];
  const fileMap = new Map<string, WorkFileChange>();

  let stepCount = 0;
  let thinkingCount = 0;
  let readCount = 0;
  let searchCount = 0;
  let editCount = 0;
  let commandCount = 0;
  let subagentCount = 0;
  let addedLines = 0;
  let removedLines = 0;
  let hasPending = false;
  let lastPendingStep: WorkActiveStep | null = null;
  let lastAnyStep: WorkActiveStep | null = null;

  for (let i = 0; i < body.length; i++) {
    const ev = body[i];
    if (ev.kind === "assistant") {
      if (deliverableIndices.has(i)) {
        deliverables.push(ev.text);
      } else {
        steps.push(ev);
      }
      continue;
    }

    steps.push(ev);
    const candidateActive = activeStepFromEvent(ev);
    if (candidateActive) lastAnyStep = candidateActive;

    if (ev.kind === "thinking") {
      thinkingCount++;
      continue;
    }

    if (ev.kind === "subagent") {
      stepCount++;
      subagentCount++;
      continue;
    }

    if (ev.kind === "diff") {
      stepCount++;
      editCount++;
      const add = ev.hunk.added.length;
      const rem = ev.hunk.removed.length;
      addedLines += add;
      removedLines += rem;
      if (ev.status === "pending") {
        hasPending = true;
        if (candidateActive) lastPendingStep = candidateActive;
      } else if (ev.status === "error") {
        errors.push({ kind: "diff", event: ev });
      }
      const key = ev.file || ev.tool;
      const existing = fileMap.get(key);
      if (!existing) {
        fileMap.set(key, {
          file: ev.file,
          added: add,
          removed: rem,
          status: ev.status,
          mergedDiff: {
            kind: "diff",
            tool: ev.tool,
            file: ev.file,
            hunk: {
              removed: [...ev.hunk.removed],
              added: [...ev.hunk.added],
            },
            status: ev.status,
          },
          editCount: 1,
        });
      } else {
        existing.added += add;
        existing.removed += rem;
        existing.status = mergeFileStatus(existing.status, ev.status);
        existing.editCount++;
        existing.mergedDiff = {
          ...existing.mergedDiff,
          status: existing.status,
          hunk: {
            removed: [...existing.mergedDiff.hunk.removed, ...ev.hunk.removed],
            added: [...existing.mergedDiff.hunk.added, ...ev.hunk.added],
          },
        };
      }
      continue;
    }

    if (ev.kind === "tool") {
      stepCount++;
      const phase = classifyToolPhase(ev.name);
      if (phase === "reading") readCount++;
      else if (phase === "searching") searchCount++;
      else if (phase === "editing") editCount++;
      else if (phase === "running") commandCount++;

      if (ev.status === "pending") {
        hasPending = true;
        if (candidateActive) lastPendingStep = candidateActive;
      } else if (ev.status === "error") {
        errors.push({ kind: "tool", event: ev });
      }
    }
  }

  return {
    index,
    prompt,
    midTurn,
    startMs: summary?.startMs ?? 0,
    endMs: summary?.endMs ?? 0,
    durationMs: summary?.durationMs ?? 0,
    spine: {
      stepCount,
      thinkingCount,
      readCount,
      searchCount,
      editCount,
      commandCount,
      subagentCount,
      addedLines,
      removedLines,
      hasPending,
      activeStep: lastPendingStep ?? lastAnyStep,
      steps,
    },
    files: [...fileMap.values()],
    errors,
    deliverables,
    waiting,
  };
}

export type ProjectableTranscript = Pick<
  TranscriptDoc,
  "events" | "turns" | "waitingReason"
> & {
  waitingPrompt?: WaitingPrompt | null;
  queuedPrompts?: string[];
};

/**
 * Pure turn-by-turn reduction of a flat `TranscriptDoc` into `WorkTurn[]` for the `Work` view.
 * Runs inside `parse-worker` (via `toTranscriptWire`) so the renderer receives pre-folded turns
 * with zero main-thread parsing cost, and remains callable directly in unit tests or fallbacks.
 */
export function projectWorkTurns(doc: ProjectableTranscript): WorkTurn[] {
  const out: WorkTurn[] = [];
  const summaries = doc.turns ?? [];
  let currentPrompt: string | null = null;
  let currentMidTurn = false;
  let currentBody: TranscriptEvent[] = [];
  let userTurnOrdinal = 0;

  const flush = (isTail: boolean): void => {
    if (currentPrompt === null && currentBody.length === 0) return;
    const index = currentPrompt === null ? 0 : userTurnOrdinal;
    const summary = index > 0 ? summaries[index - 1] : undefined;
    const waiting = isTail ? resolveWaitingPrompt(doc) : null;
    out.push(
      buildTurn(
        index,
        currentPrompt,
        currentMidTurn,
        currentBody,
        summary,
        waiting,
      ),
    );
    currentBody = [];
  };

  for (const ev of doc.events) {
    if (ev.kind === "user") {
      flush(false);
      userTurnOrdinal++;
      currentPrompt = ev.text;
      currentMidTurn = ev.midTurn === true;
    } else {
      currentBody.push(ev);
    }
  }
  flush(true);

  // If the session is waiting before any user event or on an empty doc, attach waiting to a synthetic tail turn.
  if (out.length === 0) {
    const waiting = resolveWaitingPrompt(doc);
    if (waiting) {
      out.push(buildTurn(0, null, false, [], undefined, waiting));
    }
  }

  // Append any un-popped queued user prompts at the tail so the user sees queued instructions immediately.
  if (doc.queuedPrompts && doc.queuedPrompts.length > 0) {
    for (const q of doc.queuedPrompts) {
      if (!q.trim()) continue;
      userTurnOrdinal++;
      out.push({
        ...buildTurn(userTurnOrdinal, q, true, [], undefined, null),
        queued: true,
      });
    }
  }

  return out;
}

function resolveWaitingPrompt(
  doc: ProjectableTranscript,
): WaitingPrompt | null {
  if (doc.waitingPrompt) return doc.waitingPrompt;
  if (!doc.waitingReason) return null;
  return {
    kind: "permission",
    toolUseId: "",
    toolName: "",
    summary: doc.waitingReason,
  };
}
