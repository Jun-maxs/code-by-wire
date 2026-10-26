/**
 * Move an ended session's files to the OS trash (fork feature, 2026-10-26): Code-by-wire had no way to
 * remove a session, and transcripts pile up (gigabytes across a few weeks). Trash, not unlink, so a
 * mistaken delete is recoverable from the Recycle Bin.
 *
 * A Claude transcript `<dir>/<id>.jsonl` may have a sibling `<dir>/<id>/` holding its subagent
 * transcripts; both go. A Codex rollout is a single file.
 */
export interface SessionTrashDeps {
  resolveTranscriptPath: (id: string) => string | null;
  /** Electron's shell.trashItem in production. */
  trash: (path: string) => Promise<void>;
  exists: (path: string) => boolean;
}

export type TrashResult =
  | { ok: true; trashed: string[] }
  | { ok: false; reason: "live" | "not-found" | "failed"; detail?: string };

export async function trashSessionFiles(
  deps: SessionTrashDeps,
  id: string,
  live: boolean,
): Promise<TrashResult> {
  if (live) return { ok: false, reason: "live" };
  const exists = deps.exists;
  const transcript = deps.resolveTranscriptPath(id);
  if (!transcript || !exists(transcript))
    return { ok: false, reason: "not-found" };
  const targets = [transcript];
  const sidecar = transcript.replace(/\.jsonl$/i, "");
  if (sidecar !== transcript && exists(sidecar)) targets.push(sidecar);
  const trashed: string[] = [];
  try {
    for (const path of targets) {
      await deps.trash(path);
      trashed.push(path);
    }
  } catch (err) {
    return {
      ok: false,
      reason: "failed",
      detail: err instanceof Error ? err.message : String(err),
    };
  }
  return { ok: true, trashed };
}
