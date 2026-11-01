import { autoUpdater } from "electron-updater";
import {
  initialUpdateState,
  nextUpdateState,
  releaseNoteLines,
  UPDATE_FEED_URL,
  type UpdateState,
  type UpdaterEvent,
} from "@shared/update";

/** The main-process update surface the IPC layer calls. */
export interface Updater {
  getState(): UpdateState;
  /** Trigger a check; resolves to the resulting state. A no-op (returns current state) in dev or while
   *  a check/download is already in flight. */
  check(): Promise<UpdateState>;
  /** Download the available update. No-op in dev or while already downloading. */
  download(): Promise<void>;
  /** Quit and install a downloaded update (the app quits). No-op in dev. */
  quitAndInstall(): void;
  /** Skip a release (it is not downloaded, installed on quit, or offered again); undefined un-skips. */
  skip(version: string | undefined): void;
}

/**
 * Owns electron-updater's autoUpdater, folds its events through the pure reducer, and pushes every new
 * state to the renderer via `deps.send`. In dev (`isPackaged === false`) it never touches autoUpdater
 * (which throws when unpacked) and stays in the `unsupported` phase, so the renderer hides the card.
 *
 * Jun-Code reads its own feed (UPDATE_FEED_URL, a generic electron-builder feed on mysg; CBW_UPDATE_FEED
 * overrides it). A found release downloads in the background straight away unless it is the skipped
 * one, and installs on the next quit (`autoInstallOnAppQuit`); `quitAndInstall()` applies it now,
 * silently, and relaunches. Stable channel only (`allowPrerelease = false`).
 */
export function createUpdater(deps: {
  send: (state: UpdateState) => void;
  isPackaged: boolean;
  currentVersion: string;
  skippedVersion?: string;
  /** Persist a skip (or un-skip) so it holds across launches. */
  saveSkipped?: (version: string | undefined) => void;
}): Updater {
  let state = initialUpdateState(deps.currentVersion, deps.isPackaged);
  if (deps.skippedVersion)
    state = nextUpdateState(state, {
      type: "skip",
      version: deps.skippedVersion,
    });
  const apply = (ev: UpdaterEvent): void => {
    state = nextUpdateState(state, ev);
    deps.send(state);
  };
  // Read through a function after awaits: updater event listeners mutate `state` while the promise is
  // pending, which TypeScript's local control-flow narrowing cannot otherwise observe.
  const checkIsInFlight = (): boolean => state.phase.kind === "checking";

  const isSkipped = (version: string) => version === state.skippedVersion;
  const download = async () => {
    try {
      await autoUpdater.downloadUpdate();
    } catch (err) {
      apply({ type: "error", message: friendlyError(err) });
    }
  };

  if (deps.isPackaged) {
    autoUpdater.setFeedURL({
      provider: "generic",
      url: process.env.CBW_UPDATE_FEED || UPDATE_FEED_URL,
    });
    autoUpdater.autoDownload = false;
    autoUpdater.autoInstallOnAppQuit = true;
    autoUpdater.allowPrerelease = false;
    autoUpdater.on("checking-for-update", () => apply({ type: "checking" }));
    autoUpdater.on("update-available", (info) => {
      apply({
        type: "available",
        version: info.version,
        releaseDate: info.releaseDate,
        notes: releaseNoteLines(info.releaseNotes),
        at: Date.now(),
      });
      if (!isSkipped(info.version)) void download();
    });
    autoUpdater.on("update-not-available", () =>
      apply({ type: "not-available", at: Date.now() }),
    );
    autoUpdater.on("download-progress", (p) =>
      apply({
        type: "progress",
        percent: p.percent,
        transferred: p.transferred,
        total: p.total,
      }),
    );
    autoUpdater.on("update-downloaded", (info) => {
      autoUpdater.autoInstallOnAppQuit = !isSkipped(info.version);
      apply({ type: "downloaded", version: info.version });
    });
    autoUpdater.on("error", (err) =>
      apply({ type: "error", message: friendlyError(err) }),
    );
  }

  return {
    getState: () => state,
    check: async () => {
      if (!deps.isPackaged) return state;
      if (state.phase.kind === "checking" || state.phase.kind === "downloading")
        return state;
      try {
        await autoUpdater.checkForUpdates();
      } catch (err) {
        // electron-updater emits `error` before rejecting. Usually the listener above already applied
        // it; only fall back here if no terminal event moved the state on. In particular, applying the
        // same error twice would replace an available phase restored from checking.prior.
        if (checkIsInFlight())
          apply({ type: "error", message: friendlyError(err) });
      }
      return state;
    },
    download: async () => {
      if (!deps.isPackaged || state.phase.kind !== "available") return;
      await download();
    },
    quitAndInstall: () => {
      // Silent (the one-click installer shows no wizard), then relaunch the new version.
      if (deps.isPackaged && state.phase.kind === "downloaded")
        autoUpdater.quitAndInstall(true, true);
    },
    skip: (version) => {
      apply({ type: "skip", version });
      deps.saveSkipped?.(version);
      if (!deps.isPackaged) return;
      const p = state.phase;
      if (p.kind === "downloaded")
        autoUpdater.autoInstallOnAppQuit = !isSkipped(p.version);
      // Un-skipping a release that was found but left alone: fetch it now.
      if (p.kind === "available" && !isSkipped(p.version)) void download();
    },
  };
}

/** A short, renderer-facing message from an updater error. */
function friendlyError(err: unknown): string {
  const msg = err instanceof Error ? err.message : String(err);
  // electron-updater prefixes some errors with a code line; keep the first line, trimmed.
  return msg.split("\n")[0].trim() || "Update failed.";
}
