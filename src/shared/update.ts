/** Where Jun-Code's updates are published (latest.yml + the installer and its blockmap), on mysg;
 *  `scripts/publish-update.sh` uploads there. CBW_UPDATE_FEED overrides it for testing. */
export const UPDATE_FEED_URL = "https://hub.yuanhk.top/jun-code/";

/** A release newer than the running app, including everything needed to keep rendering it while a
 *  re-check is in flight. Named separately so `checking.prior` does not make UpdatePhase recursive. */
export interface AvailableUpdatePhase {
  kind: "available";
  version: string;
  releaseDate?: string;
  /** The release notes, one line per change (empty when the release has none). */
  notes: string[];
  checkedAt: number;
}

/** The update lifecycle, as a discriminated union the renderer renders directly.
 *  `unsupported` is the dev/unpacked state (electron-updater can't run unpacked). */
export type UpdatePhase =
  | { kind: "unsupported" }
  | { kind: "idle" }
  | { kind: "checking"; prior?: AvailableUpdatePhase }
  | { kind: "upToDate"; checkedAt: number }
  | AvailableUpdatePhase
  | {
      kind: "downloading";
      version: string;
      notes?: string[];
      percent: number;
      transferred: number;
      total: number;
    }
  | { kind: "downloaded"; version: string; notes?: string[] }
  | { kind: "error"; message: string };

/** The whole update surface: the running version plus the current phase. `skippedVersion` is the
 *  release the user chose to skip: it is neither downloaded, installed on quit, nor offered again. */
export interface UpdateState {
  currentVersion: string;
  phase: UpdatePhase;
  skippedVersion?: string;
}

/** About-open checks are intentionally sparse: a GitHub update check may use several requests. */
export const UPDATE_AUTO_CHECK_THROTTLE_MS = 5 * 60 * 1000;

/** Events the main-process controller feeds the reducer, translated from electron-updater's emitter.
 *  Electron-free so the reducer stays pure and testable. Timestamps are stamped by the controller
 *  (never read inside the reducer), so tests can pin them. */
export type UpdaterEvent =
  | { type: "checking" }
  | {
      type: "available";
      version: string;
      releaseDate?: string;
      notes?: string[];
      at: number;
    }
  | { type: "not-available"; at: number }
  | { type: "progress"; percent: number; transferred: number; total: number }
  | { type: "downloaded"; version: string }
  | { type: "error"; message: string }
  | { type: "skip"; version: string | undefined };

/** electron-updater's `releaseNotes` (a string, possibly HTML or markdown, or one entry per version)
 *  as plain lines: tags and list markers stripped, blank lines dropped. */
export function releaseNoteLines(raw: unknown): string[] {
  const text = Array.isArray(raw)
    ? raw
        .map((n: { note?: unknown }) =>
          typeof n?.note === "string" ? n.note : "",
        )
        .join("\n")
    : typeof raw === "string"
      ? raw
      : "";
  return text
    .replace(/<\/(p|li|div|h\d)>|<br\s*\/?>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .split(/\r?\n/)
    .map((l) => l.replace(/^\s*(?:[-*+]|\d+[.)])\s+/, "").trim())
    .filter(Boolean);
}

/** The version (and notes) the update dialog is about, or null when there is nothing to offer:
 *  no update in flight, or the update is the skipped one. */
export function offeredUpdate(
  state: UpdateState,
): { version: string; notes: string[] } | null {
  const p = state.phase.kind === "checking" ? state.phase.prior : state.phase;
  if (
    !p ||
    (p.kind !== "available" &&
      p.kind !== "downloading" &&
      p.kind !== "downloaded")
  )
    return null;
  if (!p.version || p.version === state.skippedVersion) return null;
  return { version: p.version, notes: p.notes ?? [] };
}

/** Whether an update is pending — found, downloading, or awaiting restart. Drives the sidebar
 *  gear badge and the Settings About-row dot; clears only when the update installs (the new
 *  version relaunches into `idle`). */
export function isUpdatePending(phase: UpdatePhase): boolean {
  return (
    phase.kind === "available" ||
    (phase.kind === "checking" && phase.prior !== undefined) ||
    phase.kind === "downloading" ||
    phase.kind === "downloaded"
  );
}

/** Pure policy for the automatic check when Settings -> About opens. Manual checks bypass it. */
export function shouldAutoCheck(
  state: UpdateState,
  autoCheck: boolean | null,
  lastCheckAt: number | null,
  now: number,
): boolean {
  if (autoCheck !== true) return false;
  const completedAt =
    state.phase.kind === "upToDate" || state.phase.kind === "available"
      ? state.phase.checkedAt
      : null;
  const throttleAt = Math.max(
    lastCheckAt ?? -Infinity,
    completedAt ?? -Infinity,
  );
  if (now - throttleAt < UPDATE_AUTO_CHECK_THROTTLE_MS) return false;

  switch (state.phase.kind) {
    case "idle":
    case "upToDate":
    case "available":
    case "error":
      return true;
    case "unsupported":
    case "checking":
    case "downloading":
    case "downloaded":
      return false;
  }
}

/** State before any check: `unsupported` in dev (electron-updater can't run unpacked), else `idle`. */
export function initialUpdateState(
  currentVersion: string,
  packaged: boolean,
): UpdateState {
  return {
    currentVersion,
    phase: packaged ? { kind: "idle" } : { kind: "unsupported" },
  };
}

/** The version an in-flight download is for, carried from the prior available/downloading phase
 *  (electron-updater's download-progress event carries no version). */
function versionInFlight(prev: UpdateState): string {
  const p = prev.phase;
  if (
    p.kind === "available" ||
    p.kind === "downloading" ||
    p.kind === "downloaded"
  )
    return p.version;
  return "";
}

/** The notes carried with the version in flight, so the dialog keeps them through the download. */
function notesInFlight(prev: UpdateState): string[] | undefined {
  const p = prev.phase;
  if (
    p.kind === "available" ||
    p.kind === "downloading" ||
    p.kind === "downloaded"
  )
    return p.notes;
  return undefined;
}

/** Pure reducer: fold one updater event into the next state. `unsupported` is sticky (a dev build never
 *  leaves it); `currentVersion` is always carried forward. */
export function nextUpdateState(
  prev: UpdateState,
  ev: UpdaterEvent,
): UpdateState {
  if (prev.phase.kind === "unsupported") return prev;
  const base = {
    currentVersion: prev.currentVersion,
    ...(prev.skippedVersion ? { skippedVersion: prev.skippedVersion } : {}),
  };
  switch (ev.type) {
    case "skip":
      return {
        currentVersion: prev.currentVersion,
        phase: prev.phase,
        ...(ev.version ? { skippedVersion: ev.version } : {}),
      };
    case "checking":
      // A check firing mid-download (shouldn't happen) must not wipe progress.
      if (prev.phase.kind === "downloading") return prev;
      return {
        ...base,
        phase: {
          kind: "checking",
          prior: prev.phase.kind === "available" ? prev.phase : undefined,
        },
      };
    case "available":
      return {
        ...base,
        phase: {
          kind: "available",
          version: ev.version,
          releaseDate: ev.releaseDate,
          notes: ev.notes ?? [],
          checkedAt: ev.at,
        },
      };
    case "not-available":
      return { ...base, phase: { kind: "upToDate", checkedAt: ev.at } };
    case "progress":
      return {
        ...base,
        phase: {
          kind: "downloading",
          version: versionInFlight(prev),
          notes: notesInFlight(prev),
          percent: Math.max(0, Math.min(100, ev.percent)),
          transferred: ev.transferred,
          total: ev.total,
        },
      };
    case "downloaded":
      return {
        ...base,
        phase: {
          kind: "downloaded",
          version: ev.version,
          notes: notesInFlight(prev),
        },
      };
    case "error":
      if (prev.phase.kind === "checking" && prev.phase.prior)
        return { ...base, phase: prev.phase.prior };
      return { ...base, phase: { kind: "error", message: ev.message } };
  }
}
