/**
 * Automatic session cleanup (fork feature, 2026-10-28): ended sessions nobody has touched for a
 * while go to the OS trash on a schedule, the same way the sidebar's "Delete" does. Pinned
 * sessions, sessions a board task carries and sessions the user renamed are kept — those are the
 * ones someone meant to come back to.
 */

export interface SessionCleanupSettings {
  enabled: boolean;
  /** Ended and idle for at least this many days. */
  days: number;
}

export const CLEANUP_DAY_CHOICES = [7, 14, 30, 60, 90] as const;

export const DEFAULT_CLEANUP: SessionCleanupSettings = {
  enabled: false,
  days: 30,
};

export function cleanupSettings(
  raw: Partial<SessionCleanupSettings> | undefined,
): SessionCleanupSettings {
  const days = Number(raw?.days);
  return {
    enabled: raw?.enabled === true,
    days:
      Number.isFinite(days) && days >= 1
        ? Math.round(days)
        : DEFAULT_CLEANUP.days,
  };
}

export interface CleanupCandidateInput {
  id: string;
  state: string;
  lastActivityMs: number;
  pinnedAtMs?: number;
}

export type KeepReason = "pinned" | "board" | "renamed";

export interface CleanupPick {
  /** Ids to trash, oldest first. */
  ids: string[];
  /** Old enough but kept, by reason. */
  kept: Record<KeepReason, number>;
}

/** Which sessions a run would trash. Pure: the caller supplies the protected sets and the clock. */
export function pickCleanup(
  sessions: CleanupCandidateInput[],
  days: number,
  now: number,
  keep: { board: ReadonlySet<string>; renamed: ReadonlySet<string> },
): CleanupPick {
  const cutoff = now - days * 86_400_000;
  const kept: Record<KeepReason, number> = {
    pinned: 0,
    board: 0,
    renamed: 0,
  };
  const old = sessions
    .filter((s) => s.state === "ended" && s.lastActivityMs > 0)
    .filter((s) => s.lastActivityMs < cutoff)
    .sort((a, b) => a.lastActivityMs - b.lastActivityMs);
  const ids: string[] = [];
  for (const s of old) {
    if (s.pinnedAtMs) kept.pinned++;
    else if (keep.board.has(s.id)) kept.board++;
    else if (keep.renamed.has(s.id)) kept.renamed++;
    else ids.push(s.id);
  }
  return { ids, kept };
}

export interface CleanupRun {
  at: number;
  trashed: number;
  bytes: number;
  failed: number;
  trigger: "auto" | "manual";
}

/** What the Settings card shows: the rule, what it would take right now, and the last run. */
export interface SessionCleanupView {
  settings: SessionCleanupSettings;
  preview: { count: number; bytes: number; kept: Record<KeepReason, number> };
  lastRun: CleanupRun | null;
  running: boolean;
}
