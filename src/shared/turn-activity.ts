/**
 * Fork (2026-11-02): what a Claude session is doing in its current turn, read from the tail of its
 * transcript — the split view's progress line when the session keeps no to-do list. A "task" is one
 * thing the user asked: each typed prompt (task notifications and slash commands continue it).
 */
export interface TurnActivity {
  /** When the current (or last) task began: the latest prompt. null when the prompt lies beyond
   *  what was read (a very long task); `steps` is then a lower bound. */
  turnStartMs: number | null;
  /** Tool calls made since that prompt. */
  steps: number;
  /** The latest tool call: its name and a short target (file name, command, pattern…). */
  lastTool: { name: string; target: string } | null;
  /** The latest entry's time. */
  lastMs: number | null;
  /** Recent tasks, oldest first; the last one is the current task. */
  tasks: TaskEntry[];
  /** Messages typed while the session was busy and not yet taken up, oldest first. */
  queued: string[];
}

export interface TaskEntry {
  /** The prompt's first line, shortened. */
  text: string;
  startMs: number | null;
  /** The task's last entry so far. */
  endMs: number | null;
  steps: number;
  /** Messages the user sent while it ran, folded into it (shortened like `text`). */
  adds: string[];
}
