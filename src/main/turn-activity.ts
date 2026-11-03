import { closeSync, fstatSync, openSync, readSync } from "node:fs";
import { basename } from "node:path";
import type { TaskEntry, TurnActivity } from "@shared/turn-activity";
import type { TurnActivityRead } from "@shared/ipc";

/**
 * Fork (2026-11-02): the split view's per-pane progress line and task list. Summarizes a Claude
 * transcript — the current task (latest prompt, tool calls since, the last one), the recent tasks
 * before it, and messages still queued — without rereading the file each poll: the first read takes
 * the tail (the whole file once, only when the current task began before it), later reads parse just
 * the bytes appended since.
 */
const TAIL_BYTES = 1024 * 1024;
/** Past this the task start is left unknown rather than scanning the whole file. */
const FULL_SCAN_LIMIT = 64 * 1024 * 1024;
const MAX_CURSORS = 64;
/** Recent tasks kept per session (the current one included). */
const MAX_TASKS = 20;
const TASK_TEXT_MAX = 120;

interface Acc {
  turnStartMs: number | null;
  steps: number;
  lastTool: TurnActivity["lastTool"];
  lastMs: number | null;
  sawPrompt: boolean;
  /** Finished tasks, oldest first; the current one lives in the fields above plus `currentText`. */
  done: TaskEntry[];
  currentText: string | null;
  currentAdds: string[];
  queue: string[];
}

interface Cursor {
  /** Byte offset just past the last complete line parsed. */
  offset: number;
  acc: Acc;
}

const cursors = new Map<string, Cursor>();

const fresh = (): Acc => ({
  turnStartMs: null,
  steps: 0,
  lastTool: null,
  lastMs: null,
  sawPrompt: false,
  done: [],
  currentText: null,
  currentAdds: [],
  queue: [],
});

export function readTurnActivity(
  path: string | null,
  sinceMtimeMs?: number,
): TurnActivityRead {
  if (!path) return { status: "absent" };
  let fd: number;
  try {
    fd = openSync(path, "r");
  } catch {
    return { status: "absent" };
  }
  try {
    const { size, mtimeMs } = fstatSync(fd);
    if (mtimeMs === sinceMtimeMs) return { status: "unchanged", mtimeMs };
    let cur = cursors.get(path);
    if (!cur || size < cur.offset) {
      const start = Math.max(0, size - TAIL_BYTES);
      cur = scan(fd, start, size, fresh(), start > 0);
      if (!cur.acc.sawPrompt && start > 0 && size <= FULL_SCAN_LIMIT)
        cur = scan(fd, 0, size, fresh(), false);
      remember(path, cur);
    } else if (size > cur.offset) {
      cur = scan(fd, cur.offset, size, cur.acc, false);
      remember(path, cur);
    }
    return { status: "changed", mtimeMs, activity: snapshot(cur.acc) };
  } catch {
    return { status: "error" };
  } finally {
    closeSync(fd);
  }
}

function remember(path: string, cur: Cursor): void {
  cursors.delete(path);
  cursors.set(path, cur);
  if (cursors.size > MAX_CURSORS) {
    const oldest = cursors.keys().next();
    if (!oldest.done) cursors.delete(oldest.value);
  }
}

/** Parse the complete lines in [from, to) into `acc`. `midLine` = `from` was picked by size, not a
 *  cursor, so the first line is partial and skipped. */
function scan(
  fd: number,
  from: number,
  to: number,
  acc: Acc,
  midLine: boolean,
): Cursor {
  const buf = Buffer.alloc(to - from);
  readSync(fd, buf, 0, buf.length, from);
  let start = 0;
  if (midLine) {
    const nl = buf.indexOf(0x0a);
    start = nl < 0 ? buf.length : nl + 1;
  }
  const end = buf.lastIndexOf(0x0a) + 1;
  if (end > start) feed(acc, buf.toString("utf8", start, end));
  return { offset: from + Math.max(start, end), acc };
}

function snapshot(acc: Acc): TurnActivity {
  const tasks = [...acc.done];
  if (acc.currentText !== null)
    tasks.push({
      text: acc.currentText,
      startMs: acc.turnStartMs,
      endMs: acc.lastMs,
      steps: acc.steps,
      adds: acc.currentAdds,
    });
  return {
    turnStartMs: acc.turnStartMs,
    steps: acc.steps,
    lastTool: acc.lastTool,
    lastMs: acc.lastMs,
    tasks,
    queued: acc.queue.filter(isHumanText),
  };
}

/** Summarize the transcript `text` (JSONL) — the pure core, exported for tests. `cut` = the text
 *  starts mid-file, so a missing prompt means it lies further back. */
export function summarize(text: string, cut = false): TurnActivity {
  const acc = fresh();
  feed(acc, text);
  if (!acc.sawPrompt && cut) acc.turnStartMs = null;
  return snapshot(acc);
}

interface Line {
  type?: string;
  operation?: string;
  content?: unknown;
  isMeta?: boolean;
  isSidechain?: boolean;
  isCompactSummary?: boolean;
  timestamp?: string;
  message?: { content?: unknown };
  attachment?: { type?: string; prompt?: unknown };
}

type Block = {
  type?: string;
  name?: string;
  text?: string;
  input?: Record<string, unknown>;
};

function feed(acc: Acc, text: string): void {
  for (const raw of text.split("\n")) {
    if (!raw.trim()) continue;
    let line: Line;
    try {
      line = JSON.parse(raw) as Line;
    } catch {
      continue;
    }
    if (line.isSidechain) continue;
    if (line.type === "queue-operation") {
      queueOp(acc, line);
      continue;
    }
    // A message sent mid-turn reaches the model as a queued_command attachment: part of the task.
    const added =
      line.attachment?.type === "queued_command"
        ? line.attachment.prompt
        : null;
    if (
      typeof added === "string" &&
      isHumanText(added) &&
      acc.currentText !== null
    ) {
      acc.currentAdds.push(shorten(added));
      continue;
    }
    const ts = line.timestamp ? Date.parse(line.timestamp) : NaN;
    const prompt = promptText(line);
    if (prompt !== null) {
      if (acc.currentText !== null) {
        acc.done.push({
          text: acc.currentText,
          startMs: acc.turnStartMs,
          endMs: acc.lastMs,
          steps: acc.steps,
          adds: acc.currentAdds,
        });
        if (acc.done.length > MAX_TASKS - 1) acc.done.shift();
      }
      // A queued message that has now been sent is no longer waiting.
      const queued = acc.queue.findIndex((q) => shorten(q) === prompt);
      if (queued >= 0) acc.queue.splice(queued, 1);
      acc.sawPrompt = true;
      acc.currentText = prompt;
      acc.currentAdds = [];
      acc.turnStartMs = Number.isFinite(ts) ? ts : null;
      acc.steps = 0;
      acc.lastTool = null;
    }
    if (Number.isFinite(ts)) acc.lastMs = ts;
    if (prompt !== null || line.type !== "assistant") continue;
    const content = line.message?.content;
    if (!Array.isArray(content)) continue;
    for (const block of content as Block[]) {
      if (block?.type !== "tool_use" || typeof block.name !== "string")
        continue;
      acc.steps++;
      acc.lastTool = { name: block.name, target: toolTarget(block) };
    }
  }
}

/** Claude Code's input queue: enqueue appends, dequeue takes the head, remove drops a given entry,
 *  popAll empties it. */
function queueOp(acc: Acc, line: Line): void {
  const content = typeof line.content === "string" ? line.content : null;
  switch (line.operation) {
    case "enqueue":
      if (content !== null) acc.queue.push(content);
      break;
    case "dequeue":
      acc.queue.shift();
      break;
    case "remove": {
      const at = content === null ? 0 : acc.queue.indexOf(content);
      if (at >= 0) acc.queue.splice(at, 1);
      break;
    }
    case "popAll":
      acc.queue = [];
      break;
  }
}

/** The task a user line starts — its first line, shortened — or null when the line is not a typed
 *  prompt: tool results, meta rows, compactions, task notifications and other injected `<…>`
 *  messages, slash commands and interruption notices don't start a task. */
function promptText(line: Line): string | null {
  if (line.type !== "user" || line.isMeta || line.isCompactSummary) return null;
  const content = line.message?.content;
  if (typeof content === "string")
    return isHumanText(content) ? shorten(content) : null;
  if (!Array.isArray(content)) return null;
  const blocks = content as Block[];
  if (blocks.some((b) => b?.type === "tool_result")) return null;
  const text = blocks.find(
    (b) => b?.type === "text" && typeof b.text === "string",
  )?.text;
  return text !== undefined && isHumanText(text) ? shorten(text) : null;
}

function isHumanText(text: string): boolean {
  const t = text.trimStart();
  return (
    t.length > 0 && !t.startsWith("<") && !t.startsWith("[Request interrupted")
  );
}

/** The first non-empty line, without pasted-image markers, cut to TASK_TEXT_MAX characters. */
function shorten(text: string): string {
  const lines = text
    .split("\n")
    .map((l) => l.replace(/\[Image #\d+\]/g, "").trim())
    .filter(Boolean);
  const first = lines[0] ?? text.trim();
  return first.length > TASK_TEXT_MAX
    ? `${first.slice(0, TASK_TEXT_MAX - 1)}…`
    : first;
}

/** A few words saying what a tool call was about. */
function toolTarget(block: Block): string {
  const input = block.input ?? {};
  const str = (key: string) => {
    const v = input[key];
    return typeof v === "string" ? v : "";
  };
  const file = str("file_path") || str("notebook_path") || str("path");
  let target =
    str("description") ||
    (file ? basename(file) : "") ||
    str("command") ||
    str("pattern") ||
    str("query") ||
    str("url") ||
    str("skill") ||
    str("prompt");
  if (
    /^(Edit|Write|Read|MultiEdit|NotebookEdit)$/.test(block.name ?? "") &&
    file
  )
    target = basename(file);
  target = target.split("\n")[0].trim();
  return target.length > 80 ? `${target.slice(0, 79)}…` : target;
}
