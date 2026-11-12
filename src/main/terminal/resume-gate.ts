import type { AgentId } from "@shared/agents";
import type { ModelSelection } from "@shared/models";

/** The resume target as the provider resolves it (see Provider.resolveResumeTarget). */
export interface ResumeTarget {
  alive: boolean;
  cwd: string;
  rolloutPath?: string;
  /** Whether the session has written a transcript — what `--resume` loads. False for a session that
   *  never took a turn (the claude provider reports it; others leave it undefined). */
  transcript?: boolean;
}

export type ResumeDecision =
  | { ok: false; reason: "unresolvable" | "alive" }
  | { ok: true; cwd: string; agent: AgentId; claimedRollout?: string };

/**
 * The pure decision behind the terminal:resume handler — extracted so the refusal semantics are
 * unit-testable (terminal/ipc.ts value-imports electron and the native pty stack, so it can't load
 * under vitest). Refusals: no target (nothing resolves the id) or a live one (the liveness re-check
 * that guarantees two processes never share one transcript). A codex resume carries its rollout
 * path out as the claim binding the registry applies at registration (ResumeSpawn.claimedRollout).
 */
export function gateResume(
  agent: AgentId,
  target: ResumeTarget | null,
): ResumeDecision {
  if (!target) return { ok: false, reason: "unresolvable" };
  if (target.alive) return { ok: false, reason: "alive" };
  return {
    ok: true,
    cwd: target.cwd,
    agent,
    claimedRollout:
      agent === "codex" || agent === "agy" ? target.rolloutPath : undefined,
  };
}

/** What a claude session spawned this run was started with, kept so it can be started again under
 *  its own id (gateRelaunch). `fork` names the source a fork was taken from. */
export interface FreshLaunch {
  cwd: string;
  model: ModelSelection;
  agent: AgentId;
  fork?: string;
}

export type RelaunchDecision =
  | { ok: true; launch: FreshLaunch }
  | { ok: false; reason: "alive" }
  | null;

/**
 * Fork (2026-11-05): a session that has not taken a turn yet has no transcript, so `claude --resume
 * <id>` dies with "No conversation found with session ID". An account move restarts a session by
 * ending and resuming it, which lost such a blank session: its row vanished and the view fell back to
 * an older session. When this run spawned the id, it is started again the way it was spawned (same
 * cwd, model and args, under the same id) — for a blank session that is the move. Null hands the
 * decision to gateResume: the session has a transcript (or the provider can't say), this run didn't
 * spawn it, or it isn't a claude session. `live` is the manager's word that the id's pty still runs.
 */
export function gateRelaunch(
  agent: AgentId,
  target: ResumeTarget | null,
  launch: FreshLaunch | undefined,
  live: boolean,
): RelaunchDecision {
  if (agent !== "claude" || !launch) return null;
  if (target && target.transcript !== false) return null;
  if (target?.alive || live) return { ok: false, reason: "alive" };
  return { ok: true, launch };
}

export type ForkDecision =
  | { ok: false; reason: "unresolvable" }
  | { ok: true; cwd: string };

/**
 * The pure decision behind terminal:fork. Fork is claude-only — a non-claude source is refused
 * outright (belt-and-braces behind the renderer's canFork gate: a codex id reaching the handler
 * would otherwise spawn a broken `claude --resume <codexId> --fork-session`). No liveness gate —
 * a fork writes its own transcript, so it's safe even while the source is still running.
 */
export function gateFork(
  agent: AgentId,
  target: ResumeTarget | null,
): ForkDecision {
  if (agent !== "claude" || !target)
    return { ok: false, reason: "unresolvable" };
  return { ok: true, cwd: target.cwd };
}
