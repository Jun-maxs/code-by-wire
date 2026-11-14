import type { Family, ModelSelection } from "./models";
import type { Session } from "./types";
import type { AgentId } from "./agents";

/** Terminal IPC channels. `data` and `exit` are PUSH channels (main → renderer via webContents.send);
 *  the rest are renderer-initiated (invoke for a reply, send for fire-and-forget). */
export const TERMINAL = {
  spawn: "terminal:spawn",
  write: "terminal:write",
  resize: "terminal:resize",
  ack: "terminal:ack",
  kill: "terminal:kill",
  resume: "terminal:resume",
  fork: "terminal:fork",
  pickDirectory: "terminal:pick-directory",
  data: "terminal:data",
  exit: "terminal:exit",
  rename: "terminal:rename",
  reattach: "terminal:reattach",
  dispatchWork: "terminal:dispatch-work",
} as const;

/**
 * Renderer→pty backpressure tunables, mirroring VSCode's FlowControlConstants (scaled). The pty host
 * pauses node-pty once `highWaterChars` are in flight unacknowledged and resumes once the backlog
 * drains below `lowWaterChars`; the renderer acks consumed output in `ackChars` chunks (one IPC per
 * chunk, not per write), each ack tied to xterm finishing its write so credit reflects render speed.
 *
 * INVARIANT: lowWaterChars >= ackChars. The renderer only acks whole `ackChars` chunks and holds the
 * sub-chunk remainder back, so after a burst fully drains the unacked count floors at
 * `(total mod ackChars)`, which is always < `ackChars`. Resume fires only below `lowWaterChars`, so if
 * `lowWaterChars` were < `ackChars` a paused pty could wedge forever with a remainder stuck above the
 * resume line and no flush. Keeping them equal (5000) is what guarantees a paused pty always resumes.
 */
export const FLOW = {
  highWaterChars: 100_000,
  lowWaterChars: 5_000,
  ackChars: 5_000,
} as const;

// Enforce the invariant in code, not just prose: a future tweak that drops lowWaterChars below ackChars
// would silently wedge a paused pty, so fail loudly at import instead.
if (FLOW.lowWaterChars < FLOW.ackChars) {
  throw new Error(
    "FLOW invariant violated: lowWaterChars must be >= ackChars (a paused pty would never resume)",
  );
}

/** A fresh pinned session id (uuid v4) — the id the app correlates to the session's Transcript at
 *  `projects/<cwd-slug>/<id>.jsonl`. Minted in the renderer so its terminal is standing before spawn. */
export function newSessionId(): string {
  return crypto.randomUUID();
}

/**
 * A screen snapshot for replay after a window refresh. `offset` is the cumulative count of output chars
 * the snapshot already reflects (its position in the session's output stream). The renderer uses it to
 * drop the queued live chunks the snapshot already contains, so reattach doesn't render them twice — see
 * `TerminalApi.onData`, whose per-chunk offset is measured on the same stream.
 */
export interface ReattachSnapshot {
  data: string;
  offset: number;
}

export interface SpawnRequest {
  /** The pinned session id, minted by the caller so the renderer can stand up its terminal first. */
  id: string;
  /** Absolute project directory the session runs in. */
  cwd: string;
  model: ModelSelection;
  /** Which agent to spawn. `model` is Claude-only and documented-ignored for any other agent. */
  agent: AgentId;
  /** Raw custom launch-args string as typed (tokenized + validated in MAIN — the renderer's live
   *  check is UX only, never the enforcement). Omitted/empty means today's exact spawn. */
  extraArgs?: string;
  /** Fork feature: start "with remote" (claude-r → HAPI) so the session can be continued from the phone.
   *  Claude only; remembered for the session's Resume and Fork. */
  remote?: boolean;
  /** Initial terminal size; the renderer's first fit corrects it. */
  cols: number;
  rows: number;
}

/**
 * Resume an Ended session: relaunch it under its own id in a Managed pty. The working directory is resolved
 * in main from the session's registry/Transcript, so the renderer sends only the id and its initial
 * terminal size (the view's first fit corrects the size).
 */
export interface ResumeRequest {
  id: string;
  cols: number;
  rows: number;
}

/**
 * Result of a Resume attempt. Refused when the session is actually alive (the liveness re-check that
 * guards the one-process-per-Transcript invariant) or when no working directory can be resolved.
 */
export type ResumeResult =
  /** `session`: the optimistic draft (built the way spawn's is) when the id was started again as a
   *  fresh session because it had no transcript to resume — see terminal/resume-gate.ts gateRelaunch. */
  | { ok: true; session?: Session }
  | { ok: false; reason: "alive" | "unresolvable" };

/**
 * Fork a session: resume its conversation into a brand-new id with `--fork-session`. The renderer mints
 * `newId` (so it can stand up the fork's terminal first, like spawn) and names the `sourceId` to resume;
 * the working directory is resolved in main from the source's registry/Transcript.
 */
export interface ForkRequest {
  sourceId: string;
  newId: string;
  /** The source's model family, so main can hydrate the optimistic draft the way spawn does. The fork
   *  itself restores the model via --fork-session; this rides along only for the pre-discovery draft. */
  model: Family;
  cols: number;
  rows: number;
}

/**
 * Result of a Fork attempt. On success it carries the optimistic Managed draft, built in main from the
 * resolved cwd and the source's model exactly like spawn's, so the renderer shows it until discovery
 * indexes the fork's own Transcript. Refused only when no working directory can be resolved for the
 * source. Unlike Resume there is no `"alive"` refusal, since a fork writes its own Transcript and stays
 * safe even while the source is still running.
 */
export type ForkResult =
  | { ok: true; session: Session }
  | { ok: false; reason: "unresolvable" };

/** One question's answer inside a structured `Work` view decision submission. */
export interface WorkQuestionAnswer {
  /** 0-based indices of selected predefined options. */
  selectedIndices: number[];
  /** Count of predefined options on this question (before the TUI's built-in "Other" entry). */
  optionCount: number;
  /** True when multiple options can be toggled via Space before confirming. */
  multiSelect?: boolean;
  /** Custom free-text answer (selects "Other" and pastes text). */
  customText?: string;
}

export type WorkDispatchAction =
  | { kind: "prompt"; text: string }
  | { kind: "interrupt" }
  | { kind: "paste-image" }
  | {
      kind: "permission";
      toolUseId: string;
      decision: "allow" | "allow-session" | "deny";
    }
  | {
      kind: "question";
      toolUseId: string;
      answers: WorkQuestionAnswer[];
    };

export interface WorkDispatchRequest {
  id: string;
  action: WorkDispatchAction;
  /** True when the renderer observed `session.state === "ended"` (main still verifies provider liveness). */
  expectResume?: boolean;
  /** Initial terminal dimensions used when auto-resuming an `ended` session on prompt send. */
  cols?: number;
  rows?: number;
}

export type WorkDispatchResult =
  | { ok: true; resumed?: boolean; session?: Session }
  | {
      ok: false;
      reason: "not-live" | "stale" | "alive" | "unresolvable" | "empty";
    };

/**
 * The Managed-terminal control + push surface, exposed on `window.api.terminal`. Spawning returns an
 * optimistic Managed draft Session the renderer shows until discovery indexes the real process.
 */
export interface TerminalApi {
  spawn(req: SpawnRequest): Promise<Session>;
  /** Resume an Ended session by relaunching it under its own id. Refused if it is actually alive. */
  resume(req: ResumeRequest): Promise<ResumeResult>;
  /** Fork a session by resuming it into a new id. Refused only if the source's cwd can't be resolved. */
  fork(req: ForkRequest): Promise<ForkResult>;
  /** State-gated structured dispatch from `Work` view (prompt with split-frame paste, permission/question
   *  with anti-replay token guard, interrupt, or automatic `gateResume` + prompt readiness wait on `ended`). */
  dispatchWork(req: WorkDispatchRequest): Promise<WorkDispatchResult>;
  write(id: string, data: string): void;
  resize(id: string, cols: number, rows: number): void;
  ack(id: string, charCount: number): void;
  kill(id: string): void;
  /** After a window refresh, fetch the current screen for a still-live managed session so the renderer
   *  can replay it into its fresh xterm. Resolves to the serialized screen plus the output offset it
   *  covers, or null if no live pty exists for `id` (e.g. the session ended). Resizes the live pty +
   *  recorder to (cols, rows) first so the serialized frame matches the renderer's grid. */
  reattach(
    id: string,
    cols: number,
    rows: number,
  ): Promise<ReattachSnapshot | null>;
  /** Open a native directory picker; resolves to the chosen path, or null if cancelled. */
  pickDirectory(): Promise<string | null>;
  /** Subscribe to batched output for ANY Managed session. The chunk carries its id and `offset`, the
   *  cumulative count of output chars through the end of this chunk — the renderer uses it to dedupe a
   *  reattach snapshot against in-flight output. Returns unsubscribe. */
  onData(cb: (id: string, data: string, offset: number) => void): () => void;
  /** Subscribe to process-exit for ANY Managed session. Returns unsubscribe. */
  onExit(cb: (id: string, exitCode: number) => void): () => void;
  /** Subscribe to a session-id rotation (a `/clear`): the live pty moved from `from` to `to`. The
   *  renderer follows it onto the new id. Returns unsubscribe. */
  onRename(cb: (from: string, to: string) => void): () => void;
}
