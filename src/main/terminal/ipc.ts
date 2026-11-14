import {
  app,
  dialog,
  ipcMain,
  type BrowserWindow,
  type IpcMainEvent,
} from "electron";
import { realpathSync } from "node:fs";
import type { Session } from "@shared/types";
import type { AgentId } from "@shared/agents";
import {
  normalizeModelId,
  type Family,
  type ModelSelection,
} from "@shared/models";
import {
  TERMINAL,
  type SpawnRequest,
  type ResumeRequest,
  type ResumeResult,
  type ForkRequest,
  type ForkResult,
  type ReattachSnapshot,
} from "@shared/terminal";
import {
  validateExtraArgs,
  extraArgsErrorMessage,
  resolveStoredExtraArgs,
} from "@shared/extra-args";
import { hydrate } from "../db/store";
import { projectFromCwd } from "../project-name";
import type { ManagedRegistry } from "../managed-registry";
import { createTerminalManager } from "./manager";
import { createPtyProcess } from "./pty-process";
import { createRecorder } from "./recorder";
import {
  gateResume,
  gateFork,
  gateRelaunch,
  type FreshLaunch,
  type ResumeTarget,
} from "./resume-gate";
import type { LaunchArgsStore } from "../launch-args";
import type { RemoteSessionStore } from "../remote-sessions";
import { logError } from "../log-buffer";

/** Resolve symlinks in the spawn cwd before recording it in the managed registry. The codex
 *  rollout-claim correlation (provider/codex/claim.ts) matches on this value against the cwd
 *  codex itself recorded — which is the physical path (codex resolves it via getcwd(3)) — so an
 *  unresolved cwd here (e.g. macOS's stock `/tmp` -> `/private/tmp`, a symlinked project root)
 *  would make a live spawn's rollout never match, silently duplicating the row. Falls back to the
 *  raw cwd on any fs error: the pty already spawned successfully in this directory, so a realpath
 *  failure here is unexpected, not a reason to lose the recorded cwd entirely. */
export function normalizeManagedCwd(cwd: string): string {
  try {
    return realpathSync(cwd);
  } catch {
    return cwd;
  }
}

/**
 * Build the optimistic Managed draft the renderer shows the instant a session is spawned, before
 * discovery has indexed the real process. Hydrated from zero usage so the derived display fields
 * (context %) are well-formed; the real row supersedes it on the next sync.
 */
function draftSession(
  id: string,
  cwd: string,
  model: ModelSelection,
  agent: AgentId,
): Session {
  const project = projectFromCwd(cwd);
  const family: Family =
    model === "default" ? normalizeModelId(undefined) : model;
  return hydrate({
    id,
    title: project,
    project,
    cwd,
    // A draft has only just spawned, so the spawn dir IS its origin.
    originCwd: cwd,
    branch: undefined,
    state: "working",
    management: "managed",
    agent,
    model: family,
    lastActivityMs: Date.now(),
    createdMs: Date.now(),
    awaitingUser: false,
    transcriptMtimeMs: 0,
    usage: {
      inputTokens: 0,
      outputTokens: 0,
      cacheReadTokens: 0,
      cacheCreationTokens: 0,
      cacheCreation5mTokens: 0,
      cacheCreation1hTokens: 0,
    },
    contextTokens: 0,
  });
}

/**
 * Register the Managed-terminal IPC against one window. The manager pushes batched output and exit to
 * that window's renderer; the registry learns each spawned id so the provider labels it Managed. Ptys
 * die with the window (Managed sessions don't outlive the app — see the plan's scope boundary).
 */
export function registerTerminalIpc({
  window,
  managed,
  resolveResumeTarget,
  agentOf,
  env,
  posixShell,
  launchArgs,
  remoteSessions,
  remoteCommand,
  accounts,
  agentEnv,
}: {
  window: BrowserWindow;
  managed: ManagedRegistry;
  resolveResumeTarget: (id: string) => ResumeTarget | null;
  /** id → agent (registry → sessions table → "claude"), resolved in main — never trusted from the
   *  renderer — so resume spawns the right CLI and fork can refuse non-claude sources. */
  agentOf: (id: string) => AgentId;
  /** Returns the env for spawned/resumed `claude` sessions. Omitted in production (Managed sessions no
   *  longer need a custom env — they spawn through the login shell, which resolves everything itself);
   *  omitted in most tests too, where the manager falls back to `process.env`. */
  env?: () => NodeJS.ProcessEnv;
  /** Real fs checks for resolving the POSIX login shell Managed sessions spawn through (darwin/linux
   *  only; unused on win32). Required in production. See manager.ts's TerminalManagerDeps.posixShell. */
  posixShell?: {
    isExecutable: (p: string) => boolean;
    findOnPath: (name: string, env: NodeJS.ProcessEnv) => string | null;
  };
  /** Durable per-session custom launch args: written at spawn, read back for resume/fork so the
   *  args survive the whole session lifecycle. Optional — tests that don't care omit it. */
  launchArgs?: LaunchArgsStore;
  /** Fork feature: which sessions were started with remote, so Resume and Fork keep them remote. */
  remoteSessions?: RemoteSessionStore;
  /** The remote command (claude-r by default); see remote-sessions.ts. */
  remoteCommand?: () => string;
  /** Fork (2026-11-03): the reclaude account each Claude launch starts on. `launch` answers the
   *  env for `id` (RECLAUDE_ORG when the session has its own account) and records where it started;
   *  `inherit` gives a fork its source's account. See session-accounts.ts. */
  accounts?: {
    launch(id: string, remote: boolean): Record<string, string>;
    inherit(from: string, to: string): void;
  };
  /** Extra env a non-Claude agent's spawn and resume start with (agy: the system proxy, see
   *  agy-proxy.ts). Claude's env comes from `accounts`. */
  agentEnv?: (agent: AgentId) => Record<string, string> | undefined;
}): { rename: (from: string, to: string) => void } {
  const manager = createTerminalManager({
    send: (id, data, offset) => {
      if (!window.isDestroyed())
        window.webContents.send(TERMINAL.data, id, data, offset);
    },
    notifyExit: (id, code) => {
      if (!window.isDestroyed())
        window.webContents.send(TERMINAL.exit, id, code);
    },
    onSpawned: (id, pid, info) =>
      managed.add(id, pid, {
        ...info,
        cwd: normalizeManagedCwd(info.cwd),
        spawnedAtMs: Date.now(),
      }),
    onClosed: (id) => managed.remove(id),
    // The composition root: this is the one place node-pty is injected, so the manager (and its tests)
    // stay free of the native addon.
    createPty: createPtyProcess,
    createRecorder,
    env,
    posixShell,
    remoteCommand,
  });

  // Fork (2026-11-05): what each claude session spawned this run was started with, so one that has not
  // taken a turn yet — no transcript for `--resume` to load — is started again under its own id when an
  // account move (or a Resume) restarts it. See gateRelaunch. Kept past the pty's exit: that is when
  // it is needed.
  const launches = new Map<string, FreshLaunch>();

  // A remote mark that fails to save only costs Resume its remote-ness; the spawn still goes ahead.
  function persistRemote(id: string, remote: boolean): void {
    try {
      remoteSessions?.set(id, remote);
    } catch (err) {
      logError(
        "remote-persist-failed",
        "remote mark persist failed; a later resume starts local",
        err,
      );
    }
  }

  // A launch-args write failure must not abort the spawn/fork itself — the pty the user is waiting
  // on still starts, it just won't have a saved entry to re-apply on a later resume. Mirrors the
  // swallow-and-log contract setSessionPinned/setLaunchPresets use for the same class of failure.
  function persistLaunchArgs(id: string, raw: string): void {
    try {
      launchArgs?.set(id, raw); // trims; empty clears — so a re-used id can't inherit stale args
    } catch (err) {
      logError(
        "launch-args-persist-failed",
        "launchArgs persist failed; session starts without a saved entry",
        err,
      );
    }
  }

  // The renderer mints the id and stands up its terminal BEFORE calling spawn, so the very first pty
  // bytes land on a live handle (no dropped output, no leaked flow-control credit). We spawn against
  // the id it sends and echo back the optimistic draft for that id.
  ipcMain.handle(TERMINAL.spawn, (_e, req: SpawnRequest): Session => {
    // Validate in MAIN even though the renderer pre-checked: this is the trust boundary, and the
    // reserved flags guard the pty↔Transcript correlation (a smuggled --session-id would break it).
    const raw = req.extraArgs ?? "";
    const check = validateExtraArgs(req.agent, raw);
    if (!check.ok) throw new Error(extraArgsErrorMessage(check));
    persistLaunchArgs(req.id, raw);
    const remote = req.remote === true && req.agent === "claude";
    persistRemote(req.id, remote);
    if (req.agent === "claude" || req.agent === "qoder")
      launches.set(req.id, {
        cwd: req.cwd,
        model: req.model,
        agent: req.agent,
      });
    manager.spawn({
      id: req.id,
      cwd: req.cwd,
      model: req.model,
      agent: req.agent,
      extraArgs: check.tokens,
      remote,
      env:
        req.agent === "claude"
          ? accounts?.launch(req.id, remote)
          : agentEnv?.(req.agent),
      cols: req.cols,
      rows: req.rows,
    });
    return draftSession(req.id, req.cwd, req.model, req.agent);
  });
  // Resume an Ended session: relaunch it under its own id, per agent. The liveness re-check here is
  // the guarantee behind the Ended-only state gate — a session that came back to life since the last
  // sync is refused, so two processes never share one Transcript. cwd (and, for codex, the rollout
  // claim binding) is resolved in main, not trusted from the renderer.
  ipcMain.handle(TERMINAL.resume, (_e, req: ResumeRequest): ResumeResult => {
    const agent = agentOf(req.id);
    const target = resolveResumeTarget(req.id);
    const stored = launchArgs?.get(req.id) ?? "";
    // A session that never took a turn has no transcript to resume: start it again as it was spawned
    // (gateRelaunch), on the account it is to run on now. Its draft rides back so the row stays put.
    const again = gateRelaunch(
      agent,
      target,
      launches.get(req.id),
      managed.has(req.id),
    );
    if (again) {
      if (!again.ok) return { ok: false, reason: again.reason };
      const { launch } = again;
      const remote =
        launch.agent === "claude" && remoteSessions?.has(req.id) === true;
      const extraArgs = resolveStoredExtraArgs(launch.agent, stored);
      const env =
        launch.agent === "claude"
          ? accounts?.launch(req.id, remote)
          : agentEnv?.(launch.agent);
      const size = { cols: req.cols, rows: req.rows };
      if (launch.fork)
        manager.fork({
          id: req.id,
          sourceId: launch.fork,
          model:
            launch.model === "default"
              ? normalizeModelId(undefined)
              : launch.model,
          cwd: launch.cwd,
          extraArgs,
          remote,
          env,
          ...size,
        });
      else
        manager.spawn({
          id: req.id,
          cwd: launch.cwd,
          model: launch.model,
          agent: launch.agent,
          extraArgs,
          remote,
          env,
          ...size,
        });
      return {
        ok: true,
        session: draftSession(req.id, launch.cwd, launch.model, launch.agent),
      };
    }
    const d = gateResume(agent, target);
    if (!d.ok) return { ok: false, reason: d.reason };
    const remote = d.agent === "claude" && remoteSessions?.has(req.id) === true;
    manager.resume({
      id: req.id,
      cwd: d.cwd,
      agent: d.agent,
      claimedRollout: d.claimedRollout,
      extraArgs: resolveStoredExtraArgs(d.agent, stored),
      remote,
      env:
        d.agent === "claude"
          ? accounts?.launch(req.id, remote)
          : agentEnv?.(d.agent),
      cols: req.cols,
      rows: req.rows,
    });
    return { ok: true };
  });
  // Fork a session: resume its conversation into a NEW id with --fork-session, so the source Transcript
  // is left untouched. No liveness gate — unlike resume, a fork writes its own Transcript, so it's safe
  // even while the source is still running. cwd is resolved in main from the source id, not trusted from
  // the renderer; the only refusal is an unresolvable source (no registry entry and no Transcript cwd).
  // A non-claude source is refused outright (gateFork) — fork is claude-only.
  ipcMain.handle(TERMINAL.fork, (_e, req: ForkRequest): ForkResult => {
    const d = gateFork(
      agentOf(req.sourceId),
      resolveResumeTarget(req.sourceId),
    );
    if (!d.ok) return { ok: false, reason: "unresolvable" };
    const stored = launchArgs?.get(req.sourceId) ?? "";
    if (stored) persistLaunchArgs(req.newId, stored);
    const remote = remoteSessions?.has(req.sourceId) === true;
    if (remote) persistRemote(req.newId, true);
    launches.set(req.newId, {
      cwd: d.cwd,
      model: req.model,
      agent: "claude",
      fork: req.sourceId,
    });
    try {
      accounts?.inherit(req.sourceId, req.newId);
    } catch (err) {
      logError(
        "session-account-inherit-failed",
        "fork could not take its source's account; it starts on the default",
        err,
      );
    }
    manager.fork({
      id: req.newId,
      sourceId: req.sourceId,
      model: req.model,
      cwd: d.cwd,
      extraArgs: resolveStoredExtraArgs("claude", stored),
      remote,
      env: accounts?.launch(req.newId, remote),
      cols: req.cols,
      rows: req.rows,
    });
    // Echo back a hydrated optimistic draft built the same way spawn's is (zero usage, fresh
    // timestamps), so a brand-new fork never shows the source's accumulated cost, context, or age. The
    // model rides in from the renderer only for this draft; --fork-session restores the real one.
    return {
      ok: true,
      session: draftSession(req.newId, d.cwd, req.model, "claude"),
    };
  });
  const onWrite = (_e: IpcMainEvent, id: string, data: string) =>
    manager.write(id, data);
  const onResize = (_e: IpcMainEvent, id: string, cols: number, rows: number) =>
    manager.resize(id, cols, rows);
  const onAck = (_e: IpcMainEvent, id: string, charCount: number) =>
    manager.ack(id, charCount);
  const onKill = (_e: IpcMainEvent, id: string) => manager.kill(id);
  ipcMain.on(TERMINAL.write, onWrite);
  ipcMain.on(TERMINAL.resize, onResize);
  ipcMain.on(TERMINAL.ack, onAck);
  ipcMain.on(TERMINAL.kill, onKill);
  ipcMain.handle(TERMINAL.pickDirectory, async (): Promise<string | null> => {
    const r = await dialog.showOpenDialog(window, {
      properties: ["openDirectory", "createDirectory"],
    });
    return r.canceled || r.filePaths.length === 0 ? null : r.filePaths[0];
  });
  ipcMain.handle(
    TERMINAL.reattach,
    async (
      _e,
      id: string,
      cols: number,
      rows: number,
    ): Promise<ReattachSnapshot | null> => {
      manager.resize(id, cols, rows); // size pty + recorder to the renderer's grid before serializing
      return manager.snapshot(id);
    },
  );

  // Also kill ptys on app quit: a quit can tear the main process down without ever emitting the
  // window's 'closed' event, which would otherwise orphan the spawned `claude` children.
  const onBeforeQuit = () => manager.disposeAll();
  app.on("before-quit", onBeforeQuit);

  // Follow a /clear: re-key the live pty to its new session id, then tell this window's renderer to move
  // its terminal handle and selection onto `to`. The managed-registry relabel is the caller's (the sync
  // reconcile), so by the next snapshot `to` reads Managed and `from` derives as an Ended ghost.
  const rename = (from: string, to: string): void => {
    manager.rename(from, to);
    // The pty runs on under `to` with no transcript yet; a restart of it starts a fresh session there
    // (not a fork again: a /clear meant a clean slate).
    const l = launches.get(from);
    if (l && !launches.has(to))
      launches.set(to, { cwd: l.cwd, model: l.model, agent: l.agent });
    if (!window.isDestroyed())
      window.webContents.send(TERMINAL.rename, from, to);
  };

  window.on("closed", () => {
    manager.disposeAll();
    app.removeListener("before-quit", onBeforeQuit);
    ipcMain.removeHandler(TERMINAL.spawn);
    ipcMain.removeHandler(TERMINAL.resume);
    ipcMain.removeHandler(TERMINAL.fork);
    ipcMain.removeHandler(TERMINAL.pickDirectory);
    ipcMain.removeHandler(TERMINAL.reattach);
    ipcMain.removeListener(TERMINAL.write, onWrite);
    ipcMain.removeListener(TERMINAL.resize, onResize);
    ipcMain.removeListener(TERMINAL.ack, onAck);
    ipcMain.removeListener(TERMINAL.kill, onKill);
  });

  return { rename };
}
