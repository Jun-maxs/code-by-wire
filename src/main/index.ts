import {
  app,
  BrowserWindow,
  ipcMain,
  nativeTheme,
  net,
  powerSaveBlocker,
  safeStorage,
  session,
  shell,
} from "electron";
import { applyLegacyDockIconIfNeeded } from "./dock-icon";
import { isHttpUrl } from "./open-external";
import { join } from "node:path";
import { homedir } from "node:os";
import { openDb } from "./db/sqlite";
import type { SqliteDb } from "./db/driver";
import { migrate, getSessionAgent } from "./db/store";
import { migrateAnalytics } from "./db/analytics";
import { createClaudeProvider } from "./provider/claude";
import { createCodexProvider } from "./provider/codex";
import { createPiProvider, resolvePiDir } from "./provider/pi";
import { createAgyProvider, scanClaimableAgy } from "./provider/agy";
import { createAgyQuotaReader } from "./provider/agy/quota";
import { resolveAgyDir } from "./provider/agy/store";
import { createQoderProvider, resolveQoderDir } from "./provider/qoder";
import { createAgyProxy } from "./agy-proxy";
import { createCodexLimitsService } from "./provider/codex/limits";
import {
  createRelayUsageService,
  locateCodexRelay,
  locatePiRelay,
} from "./usage/relay";
import { createCodexThreadMetadataService } from "./provider/codex/thread-metadata";
import { resolveCodexDir } from "./provider/codex/config";
import { listRollouts, readRolloutHead } from "./provider/codex/rollout";
import { applyClaims, scanClaimableRollouts } from "./provider/codex/claim";
import { createCompositeProvider } from "./provider/composite";
import type { Provider } from "./provider/types";
import { AGENT_IDS, type AgentId } from "@shared/agents";
import { createManagedRegistry } from "./managed-registry";
import type { ManagedRegistry } from "./managed-registry";
import { applyRotations } from "./provider/claude/rotation";
import { readSessionFiles } from "./provider/claude/discover";
import { readParentMap } from "./process-tree";
import { registerIpc } from "./ipc";
import { createSettingsManager } from "./settings/manager";
import { createStatusLineReader } from "./statusline/reader";
import { createParseWorkerClient } from "./parse-worker/client";
import { createRemoteClaudeReads } from "./parse-worker/remote";
import { registerTerminalIpc } from "./terminal/ipc";
import type { ResumeTarget } from "./terminal/resume-gate";
import { registerShellTerminalIpc } from "./terminal/shell-ipc";
import {
  buildShellEnv,
  isExecutableFile,
  findOnPath,
} from "./terminal/shell-command";
import { readAccountEmail } from "./settings/account-email";
import { readModelDefaults } from "./settings/model-defaults";
import { readSessionWindowMs } from "./settings/session-window";
import type { ModelDefaults } from "@shared/models";
import { resolveClaudeDir } from "./claude-config";
import { createAppSettingsStore } from "./app-settings";
import { createCaffeinate } from "./caffeinate";
import { createSessionTitleStore } from "./session-titles";
import { createSessionPinStore } from "./session-pins";
import { createBoardStore } from "./board-store";
import { createJunAccount } from "./jun-account";
import { createTopicJudge } from "./topic-judge";
import { readProducts } from "./products";
import { createLaunchArgsStore } from "./launch-args";
import {
  createRemoteSessionStore,
  remoteCommand,
  type RemoteSessionStore,
} from "./remote-sessions";
import type { LaunchArgsStore } from "./launch-args";
import {
  createSessionAccountStore,
  createTerminalAccounts,
  type TerminalAccounts,
} from "./session-accounts";
import { createLaunchPresetStore } from "./launch-presets";
import { createProjectStateStore } from "./project-state";
import { createCliStatusController } from "./cli-check";
import { createUpdater } from "./updater";
import { createUsageService } from "./usage/fetch";
import { createTokenReader } from "./usage/credentials";
import { configurePrPath } from "./git/read-pr";
import {
  probeShellEnv,
  resolveShellPath,
  shouldCorrectPath,
} from "./terminal/shell-path";
import { restoreWindowsPath } from "./terminal/windows-path";
import { startIslandFeed, type IslandFeed } from "./island-feed";
import { remoteStatus } from "./remote-status";
import { buildIslandSnapshot, type IslandSnapshot } from "@shared/island-feed";
import type { ProductsData } from "@shared/products";
import { adoptReclaude, detectReclaude } from "./reclaude";
import {
  authorize,
  bindingConfigDir,
  currentDevice,
  listAccounts,
  logoutOrg,
  readBindings,
  reclaudeCli,
  reclaudeConfigDirs,
  useOrg,
} from "./reclaude-accounts";
import { createAccountSwitcher, type AccountSwitcher } from "./account-switch";
import { normalizePrefs, type AccountsOverview } from "@shared/account-switch";
import { HEADER_HEIGHT_PX, MAC_TRAFFIC_LIGHT_POSITION } from "@shared/chrome";
import { IPC, type ClaudeAccountsView, type LoginItem } from "@shared/ipc";
import { logError, logWarn } from "./log-buffer";
import { createContentSearch } from "./content-search";

/** Fork: a screenshot run — main window off-screen and unfocused. */
const OFFSCREEN = process.env.CBW_OFFSCREEN === "1";

// Pin the whole app to the sRGB color profile. Without this, the packaged build inherits the
// display's profile (Display P3 on modern Macs) and Chromium stretches our sRGB-authored palette
// toward that wider gamut, oversaturating colors like the Claude Code mascot orange. Dev already
// renders sRGB, so this only changes the packaged build, making it match dev. Must run before the
// 'ready' event (before the GPU process starts), so it lives at module top level.
app.commandLine.appendSwitch("force-color-profile", "srgb");

// A stripped launch environment can leave PATH without System32 or the user's own folders, so a
// session's cmd.exe can't find `claude`. Restore it before anything spawns (see windows-path.ts).
if (process.platform === "win32") restoreWindowsPath();

// A second copy of the app (a dev build beside the installed one) keeps its own userData when
// CBW_USER_DATA_DIR names one: the session index prunes every row its own providers didn't list, so
// two builds that know different agents sharing one index.db would keep deleting each other's rows.
if (process.env.CBW_USER_DATA_DIR)
  app.setPath("userData", process.env.CBW_USER_DATA_DIR);
// Renamed to Jun-Code (2026-10-30) but the data stays where Code-by-wire kept it: the product
// name decides the default userData folder, so pin it to the old one.
else app.setPath("userData", join(app.getPath("appData"), "Code-by-wire"));

// reclaude's selected account, unless CLAUDE_CONFIG_DIR is already set: sessions are read from its
// config dir and launched through rec.exe (see reclaude.ts). Before anything resolves claudeDir.
adoptReclaude();

/** agy sessions start with the system proxy (agy-proxy.ts). Made on first use: the session that
 *  answers proxy lookups exists only once the app is ready. */
let agyProxyHolder: ReturnType<typeof createAgyProxy> | null = null;
const agyProxy = (): ReturnType<typeof createAgyProxy> =>
  (agyProxyHolder ??= createAgyProxy({
    resolve: (url) => session.defaultSession.resolveProxy(url),
  }));

/** The BrowserWindow's native background, painted before the page loads — must match the
 *  persisted app theme or the window flashes the wrong color on launch. Native window chrome, so
 *  it lives here rather than in index.css. */
const WINDOW_BACKGROUND: Record<"dark" | "light", string> = {
  dark: "#000000",
  light: "#ffffff",
};

function createWindow(
  managed: ManagedRegistry,
  resolveResumeTarget: (id: string) => ResumeTarget | null,
  agentOf: (id: string) => AgentId,
  isToolStillPending: (id: string, toolUseId: string) => Promise<boolean>,
  launchArgs: LaunchArgsStore,
  remoteSessions: RemoteSessionStore,
  accounts: TerminalAccounts,
  registerRename: (rename: (from: string, to: string) => void) => void,
  shellEnv: () => NodeJS.ProcessEnv,
  appTheme: "dark" | "light",
): void {
  // The renderer header is a fixed HEADER_HEIGHT_PX tall and doubles as the title bar. On macOS we hide
  // the native title bar but KEEP the traffic lights (titleBarStyle 'hidden', never frame:false — the
  // same choice VS Code makes), float them into the header, and offset native sheets (the directory
  // picker) below the header so they don't clip under it. Windows/Linux keep their default frame.
  const isMac = process.platform === "darwin";
  const win = new BrowserWindow({
    width: 1100,
    height: 720,
    // Fork: CBW_OFFSCREEN=1 (screenshots over CDP) parks the window off every display, unfocused and
    // off the taskbar, so a check never takes the owner's screen.
    ...(OFFSCREEN ? { x: -4000, y: 0, show: false, skipTaskbar: true } : {}),
    backgroundColor: WINDOW_BACKGROUND[appTheme],
    ...(isMac
      ? {
          titleBarStyle: "hidden" as const,
          trafficLightPosition: MAC_TRAFFIC_LIGHT_POSITION,
        }
      : {}),
    webPreferences: {
      preload: join(__dirname, "../preload/index.js"),
      sandbox: false,
      ...(OFFSCREEN ? { backgroundThrottling: false } : {}),
    },
  });
  if (isMac) win.setSheetOffset(HEADER_HEIGHT_PX);
  if (OFFSCREEN) win.showInactive();

  // No in-app browser, anywhere: this app has no setWindowOpenHandler by default, so anything that
  // would otherwise spawn a new window (a stray target="_blank", a future window.open()) falls
  // through to Electron's default action — a bare, chromeless BrowserWindow inside the app (see the
  // comment in xterm/web-links.ts, which routes around this the hard way). Deny every new-window
  // request outright and hand http(s) targets to the OS default browser instead, same guard the
  // shell:openExternal IPC handler uses (ipc.ts).
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (isHttpUrl(url)) void shell.openExternal(url);
    return { action: "deny" };
  });
  // Belt-and-suspenders: the app is a single-page renderer that never legitimately navigates itself
  // to a new document (only in-page routing) — a top-level "will-navigate" means some link or
  // redirect skipped the openExternal path. Let the initial load and same-URL reloads through;
  // deny anything else and, for http(s), forward it to the OS browser.
  win.webContents.on("will-navigate", (event, url) => {
    if (url === win.webContents.getURL()) return;
    event.preventDefault();
    if (isHttpUrl(url)) void shell.openExternal(url);
  });

  // Let the renderer slide the wordmark into the corner when the traffic lights vacate it: push the
  // window's native fullscreen state on every change, and re-push on each load so a dev reload re-syncs
  // the fresh renderer. macOS-only — the lights are the only reason the header insets at all.
  if (isMac) {
    const sendFullscreen = (): void => {
      if (!win.isDestroyed())
        win.webContents.send(IPC.fullscreen, win.isFullScreen());
    };
    win.on("enter-full-screen", sendFullscreen);
    win.on("leave-full-screen", sendFullscreen);
    win.webContents.on("did-finish-load", sendFullscreen);
  }

  // Managed-terminal IPC is per-window: the manager pushes pty output to this window's renderer and
  // kills its ptys when the window closes. Its `rename` (the /clear follow) is handed to the sync
  // reconcile and revoked when the window closes.
  const { rename } = registerTerminalIpc({
    window: win,
    managed,
    resolveResumeTarget,
    agentOf,
    launchArgs,
    remoteSessions,
    remoteCommand: () => remoteCommand(),
    accounts,
    agentEnv: (agent) => (agent === "agy" ? agyProxy().env() : undefined),
    posixShell: { isExecutable: isExecutableFile, findOnPath },
    isToolStillPending,
  });
  registerRename(rename);

  // The footer shell terminal: a second manager on its own channels. No registry, no resume/fork —
  // plain interactive shells that die with the window.
  registerShellTerminalIpc({ window: win, env: shellEnv });

  win.on("closed", () => registerRename(() => {}));

  if (process.env.ELECTRON_RENDERER_URL) {
    void win.loadURL(process.env.ELECTRON_RENDERER_URL);
  } else {
    void win.loadFile(join(__dirname, "../renderer/index.html"));
  }
}

app
  .whenReady()
  .then(async () => {
    // Purely cosmetic (pre-Tahoe Dock icon shape); a failure here must never cost the user a window,
    // and this runs before openWindow() below so an unguarded throw would be worse than the guarded
    // calls further down that at least run after the window is up.
    try {
      applyLegacyDockIconIfNeeded(app);
    } catch (err) {
      logError(
        "dock-icon-apply-failed",
        "could not apply the pre-Tahoe Dock icon",
        err,
      );
    }
    const indexDbPath = join(app.getPath("userData"), "index.db");
    const db = openDb(indexDbPath);
    migrate(db); // bring the index schema up to date before the first sync
    // The durable, non-pruned analytics store (#107). A separate file with its own user_version, so a
    // live-index schema bump (which DROPs and rebuilds index.db) never touches all-time history. It's
    // optional by contract — when it can't be opened (corrupt file, locked, bad permissions) stats:read
    // serves zeros — so guard the open: a failure here must never cost the user a window (same principle
    // as the statusLine install below).
    const analyticsDbPath = join(app.getPath("userData"), "analytics.db");
    let analyticsDb: SqliteDb | undefined;
    try {
      analyticsDb = openDb(analyticsDbPath);
      migrateAnalytics(analyticsDb);
    } catch (err) {
      logError(
        "analytics-store-unavailable",
        "analytics store unavailable; stats will show zeros",
        err,
      );
      analyticsDb = undefined;
    }
    // The registry of app-spawned ids, shared by reference: the terminal IPC writes it on spawn, the
    // provider reads it to label discovered sessions Managed.
    const managed = createManagedRegistry();
    // Created here (not down with the other settings reads, after the window) because createWindow
    // needs the persisted app theme for its initial backgroundColor/nativeTheme, and unlike
    // claudeDir/shellEnv this store has no slow probe to wait on — hoisting it costs nothing against
    // the "window opens before the slow login-shell probe" invariant below.
    const appSettings = createAppSettingsStore({
      dir: app.getPath("userData"),
    });
    // Pin the native macOS traffic-light buttons to the persisted app theme at launch; the
    // appearance:setAppTheme IPC handler (ipc.ts) keeps this in sync for later in-app changes.
    nativeTheme.themeSource = appSettings.read().appTheme ?? "dark";
    // The live window's terminal-rename hook, set when a window opens and revoked when it closes. The
    // reconcile (below) calls through it to follow a /clear, so it's a no-op before the first window.
    let renameInWindow: (from: string, to: string) => void = () => {};
    const registerRename = (
      rename: (from: string, to: string) => void,
    ): void => {
      renameInWindow = rename;
    };
    // Env for user shells in the footer terminal: process.env with the recovered PATH (packaged,
    // Finder-launched) run through buildShellEnv's scrub/declare. Does NOT pin CLAUDE_CONFIG_DIR — a
    // user's interactive shell keeps their own config (hermes parity). `correctedPath` is populated by
    // the startup probe below; this closure is only ever invoked after that probe has run.
    const shellTermEnv = (): NodeJS.ProcessEnv =>
      buildShellEnv({
        baseEnv: correctedPath
          ? { ...process.env, PATH: correctedPath }
          : process.env,
        appVersion: app.getVersion(),
      });
    // provider + cliStatus are wired below, AFTER the window. The window's closures only read them on a
    // later spawn/resume (never during createWindow), so a holder populated a few lines down is enough —
    // and it lets the window open before claudeDir, which needs the synchronous login-shell probe.
    const services: {
      provider?: Provider;
      cliStatus?: ReturnType<typeof createCliStatusController>;
      agentOf?: (id: string) => AgentId;
    } = {};
    // Stand the window up FIRST, before the synchronous login-shell probe + claudeDir-dependent wiring
    // below. The probe (and the initial sync) run in this same synchronous turn, so the renderer's first
    // overview() invoke just queues until registerIpc runs a few lines down — but the window has already
    // painted, so a slow login shell no longer blanks the screen on launch. Mirrors the lazy
    // correctedPath/shellTermEnv closure above and the setTimeout'd CLI check below.
    // Per-session custom launch args: written by the spawn handler, read back on resume/fork.
    const launchArgs = createLaunchArgsStore({ dir: app.getPath("userData") });
    // Fork feature: sessions started with remote (claude-r → HAPI), kept remote across Resume/Fork.
    const remoteSessions = createRemoteSessionStore({
      dir: app.getPath("userData"),
    });
    // Fork (2026-11-03): each session's own reclaude account. Launches read the accounts' windows
    // through `accountView`, which the account switcher (wired further down) fills in.
    const sessionAccounts = createSessionAccountStore({
      dir: app.getPath("userData"),
    });
    let accountView: () => AccountsOverview | null = () => null;
    const terminalAccounts = createTerminalAccounts(
      sessionAccounts,
      () => accountView(),
      { log: (msg, err) => logError("session-account", msg, err) },
    );
    // Fork feature: the sidebar's search-by-content index, in its own file beside the others.
    const contentSearch = createContentSearch(
      join(app.getPath("userData"), "content-search.db"),
    );
    app.on("will-quit", () => contentSearch.close());
    // Ask for the system proxy now, so the first agy session already starts with it.
    agyProxy();
    const openWindow = (): void =>
      createWindow(
        managed,
        (id) => services.provider?.resolveResumeTarget(id) ?? null,
        (id) => services.agentOf?.(id) ?? "claude",
        async (id, toolUseId) => {
          if (!services.provider || !toolUseId) return true;
          const detail = await services.provider.getToolResult(id, toolUseId);
          return !detail.found || detail.status === "pending";
        },
        launchArgs,
        remoteSessions,
        terminalAccounts,
        registerRename,
        shellTermEnv,
        appSettings.read().appTheme ?? "dark",
      );
    openWindow();
    app.on("activate", () => {
      if (BrowserWindow.getAllWindows().length === 0) openWindow();
    });
    // Push update-state to whatever window is open (resolved at send-time, like the fullscreen push).
    const sendUpdate = (state: import("@shared/update").UpdateState): void => {
      const w = BrowserWindow.getAllWindows()[0];
      if (w && !w.isDestroyed()) w.webContents.send(IPC.updateState, state);
    };
    const updater = createUpdater({
      send: sendUpdate,
      isPackaged: app.isPackaged,
      currentVersion: app.getVersion(),
      skippedVersion: appSettings.read().skippedUpdateVersion,
      saveSkipped: (v) => appSettings.setSkippedUpdateVersion(v),
    });
    // One login-shell probe at startup: recover the real PATH and a rc-set CLAUDE_CONFIG_DIR that a
    // Finder-launched .app doesn't inherit. Packaged-only (dev inherits the shell env); tight timeout. Runs
    // AFTER createWindow (above) so it never blocks first paint, but BEFORE the settings/statusline/provider
    // readers so they ALL read the recovered dir — not ~/.claude — when CLAUDE_CONFIG_DIR is relocated,
    // keeping discovery and transcript/resume reads in sync.
    const shellEnv = app.isPackaged
      ? probeShellEnv(process.env.SHELL || "/bin/zsh")
      : null;
    // Packaged but the probe came back empty: a slow/wedged login shell timed out, or its rc printed
    // nothing usable. PATH and CLAUDE_CONFIG_DIR then fall back to the well-known dirs / ~/.claude, so a
    // `claude` installed somewhere exotic won't be found. Say so once rather than degrading silently.
    if (app.isPackaged && shellEnv === null) {
      logWarn(
        "login-shell-environment-recovery-failed",
        "could not recover the login-shell environment (slow shell startup or a wedged rc file); " +
          "falling back to well-known dirs for PATH. If sessions can't find `claude`, speed up your " +
          "shell startup or check its config.",
      );
    }
    const recoveredConfigDir = shellEnv?.configDir ?? null;
    // claudeDir feeds the settings/transcript readers below (settingsManager, statusLine, provider) —
    // where THIS APP reads Claude Code's own data from, independent of how sessions are spawned.
    const claudeDir = resolveClaudeDir(undefined, recoveredConfigDir);
    // correctedPath feeds the footer terminal's env (shellTermEnv above) and the background gh PR
    // lookup. Managed sessions no longer need it — they spawn through the user's own login shell,
    // which resolves PATH for itself (see command.ts's toSpawnForm).
    const correctedPath = shouldCorrectPath(process.platform, app.isPackaged)
      ? resolveShellPath({
          platform: process.platform,
          shell: process.env.SHELL,
          home: homedir(),
          currentPath: process.env.PATH,
          probe: () => shellEnv?.path ?? null,
        })
      : null;
    configurePrPath(correctedPath);
    // Wrap the user's statusLine so live cost/context and account rate limits flow to the app.
    // Idempotent and reversible; a failure must never cost the user a window. Gated on the user's
    // durable preference — a Settings-page Disable must survive relaunch, not silently re-install.
    const settingsManager = createSettingsManager({ claudeDir });
    let statuslineLaunchFault: string | null = null;
    if (appSettings.read().statuslineEnabled ?? true) {
      try {
        const result = settingsManager.install();
        if (result.healed) {
          logWarn(
            "statusline-install-desynced",
            "statusLine install was desynced (missing record or externally stripped entry); " +
              "recovered the original command and reinstalled",
          );
        }
      } catch (err) {
        statuslineLaunchFault = (err as Error).message;
        logError(
          "statusline-install-failed",
          "statusLine install failed; live rate limits and cost will be unavailable",
          err,
        );
      }
    }
    // With reclaude, every account binding's captures are read: switching accounts (below) moves new
    // sessions to another config dir, and their windows must show without a relaunch.
    const recCli = reclaudeCli(process.env.CBW_CLAUDE_LAUNCHER);
    const statusLine = createStatusLineReader({
      claudeDir,
      claudeDirs: recCli ? () => reclaudeConfigDirs() : undefined,
    });
    // Codex has no login-shell recovery yet: resolveCodexDir reads CODEX_HOME/well-known-dir
    // directly, unlike claudeDir's recovered-config-dir path above.
    const codexDir = resolveCodexDir();
    const recentWindowMs = readSessionWindowMs(claudeDir);
    // The parse-worker utility process: every poll-driven O(transcript-size) and O(session-count)
    // fs read runs there (#430, #432), so a growing transcript or a large session population can't
    // block the main thread on any poll tick. Lazy fork on first call; on worker fault each read
    // degrades to the same code in-process (see RemoteClaudeReads). The corrected login-shell PATH
    // rides the fork env so the worker's git/gh spawns (readMetrics) resolve like main's would.
    const parseWorker = createParseWorkerClient(
      join(__dirname, "parse-worker.js"),
      correctedPath ? { env: { ...process.env, PATH: correctedPath } } : {},
    );
    const claudeProvider = createClaudeProvider({
      managed,
      claudeDir,
      recentWindowMs,
      remote: createRemoteClaudeReads(parseWorker, claudeDir),
    });
    // Codex account rate limits: OAuth wham/usage first (auth.json read-only), app-server fallback.
    // Same lazy-refresh contract as the claude usage service — refreshes ride renderer polls only.
    const codexLimits = createCodexLimitsService({
      codexDir,
      fetchFn: net.fetch.bind(net),
    });
    // A relay in config.toml (new-api style) in place of OpenAI: its key's usage, same lazy contract.
    const codexRelay = createRelayUsageService({
      locate: locateCodexRelay(codexDir),
      fetchFn: net.fetch.bind(net),
    });
    const codexThreadMetadata = createCodexThreadMetadataService();
    const codexProvider = createCodexProvider({
      codexDir,
      recentWindowMs,
      limits: codexLimits,
      relay: codexRelay,
      threadMetadata: codexThreadMetadata,
      managed: {
        has: (id) => managed.agentOf(id) === "codex",
        cwdOf: (id) => managed.cwdOf(id),
        codexEntries: () => managed.codexEntries(),
      },
      remote: {
        readTranscript: (rolloutPath, since) =>
          parseWorker.call({ op: "readCodexTranscript", rolloutPath, since }),
      },
    });
    // Pi: its session files, and its relay's usage when models.json points at one.
    const piDir = resolvePiDir();
    const piProvider = createPiProvider({
      piDir,
      recentWindowMs,
      managed: {
        has: (id) => managed.agentOf(id) === "pi",
        cwdOf: (id) => managed.cwdOf(id),
      },
      relay: createRelayUsageService({
        locate: locatePiRelay(piDir),
        fetchFn: net.fetch.bind(net),
      }),
    });
    // agy (Antigravity CLI): its conversation dbs, and the plan windows Antigravity Tools keeps.
    const agyDir = resolveAgyDir();
    const agyQuota = createAgyQuotaReader({
      agyDir,
      fetchFn: net.fetch.bind(net),
      cachePath: join(app.getPath("userData"), "agy-quota-cache.json"),
    });
    const agyProvider = createAgyProvider({
      agyDir,
      recentWindowMs,
      managed: {
        has: (id) => managed.agentOf(id) === "agy",
        cwdOf: (id) => managed.cwdOf(id),
        agyEntries: () => managed.agyEntries(),
      },
      quota: agyQuota,
      remote: {
        parseTranscript: (mtimeMs, steps) =>
          parseWorker.call({ op: "parseAgyTranscript", mtimeMs, steps }),
      },
    });
    // qoder (Qoder CLI): JSONL transcripts, subagents and tasks under ~/.qoder.
    const qoderDir = resolveQoderDir();
    const qoderProvider = createQoderProvider({
      qoderDir,
      recentWindowMs,
      managed: {
        has: (id) => managed.agentOf(id) === "qoder",
        cwdOf: (id) => managed.cwdOf(id),
        qoderEntries: () => managed.qoderEntries(),
      },
      remote: createRemoteClaudeReads(parseWorker, qoderDir),
    });
    // id → agent: live drafts answer from the registry; indexed rows from the sessions table;
    // anything unknown is claude (the legacy default — never a projects/ sweep for a codex id).
    const agentOf = (id: string): AgentId =>
      managed.agentOf(id) ?? getSessionAgent(db, id) ?? "claude";
    services.agentOf = agentOf;
    const provider = createCompositeProvider(
      {
        claude: claudeProvider,
        codex: codexProvider,
        pi: piProvider,
        agy: agyProvider,
        qoder: qoderProvider,
      },
      agentOf,
    );
    services.provider = provider;
    const sessionTitles = createSessionTitleStore({
      dir: app.getPath("userData"),
    });
    const sessionPins = createSessionPinStore({
      dir: app.getPath("userData"),
    });
    const launchPresets = createLaunchPresetStore({
      dir: app.getPath("userData"),
    });
    const board = createBoardStore({ dir: app.getPath("userData") });
    const junAccount = createJunAccount({
      dir: app.getPath("userData"),
      cipher: {
        available: () => safeStorage.isEncryptionAvailable(),
        encrypt: (text) => safeStorage.encryptString(text),
        decrypt: (data) => safeStorage.decryptString(data),
      },
    });
    const projectState = createProjectStateStore({
      dir: app.getPath("userData"),
    });
    const cliStatus = createCliStatusController({
      configDirs: {
        claude: claudeDir,
        codex: codexDir,
        pi: piDir,
        agy: agyDir,
        qoder: qoderDir,
      },
    });
    services.cliStatus = cliStatus;
    // Warm every agent's verdict in the background; each check is async and the window is already up.
    setTimeout(() => {
      for (const agent of AGENT_IDS) {
        void cliStatus.recheck(agent).catch((err: unknown) => {
          logError(
            "initial-cli-status-check-failed",
            `initial CLI status check failed for ${agent}`,
            err,
          );
        });
      }
    }, 0);
    let emailCache: string | null | undefined;
    const accountEmail = (): string | null => {
      // CLAUDE_CONFIG_DIR follows an account switch; claudeDir is the one the app started with.
      if (emailCache === undefined)
        emailCache = readAccountEmail(
          process.env.CLAUDE_CONFIG_DIR ?? claudeDir,
        );
      return emailCache;
    };
    // The account switcher (Settings and the Pressure panel): reclaude's organizations, one Claude
    // account each. Switching makes another the default; the app then points CLAUDE_CONFIG_DIR at it
    // (sessions started after inherit it, and rec.exe launches them on that account) and wraps its
    // statusLine. Transcripts are shared by every binding, so no session is lost.
    const claudeAccountsView = async (
      error?: string,
    ): Promise<ClaudeAccountsView> => {
      if (!recCli) return { orgs: null };
      try {
        const orgs = await listAccounts(recCli, (device) =>
          readAccountEmail(bindingConfigDir(device)),
        );
        return error ? { orgs, error } : { orgs };
      } catch (err) {
        return { orgs: [], error: error ?? (err as Error).message };
      }
    };
    // Point CLAUDE_CONFIG_DIR at reclaude's default binding (after a switch, or a login that made the
    // new account the default) and wrap that dir's statusLine.
    const followDefaultAccount = () => {
      const found = detectReclaude();
      if (found && found.configDir !== process.env.CLAUDE_CONFIG_DIR) {
        process.env.CLAUDE_CONFIG_DIR = found.configDir;
        if (appSettings.read().statuslineEnabled ?? true) {
          try {
            createSettingsManager({ claudeDir: found.configDir }).install();
          } catch (err) {
            logError(
              "statusline-install-failed",
              "statusLine install failed for the switched account",
              err,
            );
          }
        }
      }
      emailCache = undefined;
    };
    const orgId = (id: unknown): string | null =>
      typeof id === "string" && /^\d+$/.test(id) ? id : null;
    const openAuthUrl = (url: string) => {
      if (/^https:\/\//i.test(url)) void shell.openExternal(url);
    };
    // Fork (2026-11-03): smart account switching — with two or more bindings, the default moves to
    // the account with the most 5h room before the current one runs out (account-switch.ts).
    const accountSwitcher: AccountSwitcher | undefined = recCli
      ? createAccountSwitcher({
          readBindings: () => readBindings(recCli),
          currentDevice: () => currentDevice(),
          claudeEmail: (device) => readAccountEmail(bindingConfigDir(device)),
          switchTo: async (id) => {
            await useOrg(recCli, id);
            followDefaultAccount();
          },
          prefs: () => normalizePrefs(appSettings.read().smartAccountSwitch),
          savePrefs: (prefs) => appSettings.setSmartAccountSwitch(prefs),
          statePath: join(app.getPath("userData"), "account-quotas.json"),
          pinOf: (id) => sessionAccounts.get(id),
          log: (msg, err) => logError("account-switch", msg, err),
        })
      : undefined;
    void accountSwitcher?.refresh();
    if (accountSwitcher) accountView = () => accountSwitcher.view();
    ipcMain.handle(IPC.claudeAccountsList, () => claudeAccountsView());
    ipcMain.handle(IPC.claudeAccountsUse, async (_e, raw: unknown) => {
      const id = orgId(raw);
      if (!recCli || !id) return claudeAccountsView();
      try {
        await useOrg(recCli, id);
      } catch (err) {
        return claudeAccountsView((err as Error).message);
      }
      followDefaultAccount();
      accountSwitcher?.noteManualSwitch();
      return claudeAccountsView();
    });
    // Binding and adding both wait for the browser authorization; the answer is the new list.
    ipcMain.handle(IPC.claudeAccountsBind, async (_e, raw: unknown) => {
      const id = orgId(raw);
      if (!recCli || !id) return claudeAccountsView();
      try {
        await authorize(recCli, ["org", "bind", id], openAuthUrl);
      } catch (err) {
        return claudeAccountsView((err as Error).message);
      }
      followDefaultAccount();
      void accountSwitcher?.refresh();
      return claudeAccountsView();
    });
    ipcMain.handle(IPC.claudeAccountsAdd, async () => {
      if (!recCli) return claudeAccountsView();
      try {
        await authorize(recCli, ["login"], openAuthUrl);
      } catch (err) {
        return claudeAccountsView((err as Error).message);
      }
      followDefaultAccount();
      void accountSwitcher?.refresh();
      return claudeAccountsView();
    });
    // Remove a binding that isn't the default (switch away first): its login goes, its config and the
    // shared sessions stay.
    ipcMain.handle(IPC.claudeAccountsRemove, async (_e, raw: unknown) => {
      const id = orgId(raw);
      if (!recCli || !id) return claudeAccountsView();
      const view = await claudeAccountsView();
      if (view.orgs?.find((o) => o.id === id)?.current) return view;
      try {
        await logoutOrg(recCli, id);
      } catch (err) {
        return claudeAccountsView((err as Error).message);
      }
      followDefaultAccount();
      void accountSwitcher?.refresh();
      return claudeAccountsView();
    });
    // Account usage via the OAuth usage API: constructed once; refreshes are spawned inside
    // renderer polls only (window closed → polls stop → refreshes stop). net.fetch rides
    // Chromium's stack (system proxy, OS certs). The cache file is OURS — never another tool's.
    const usage = createUsageService({
      fetchFn: net.fetch.bind(net),
      readToken: createTokenReader({ claudeDir }),
      cachePath: join(app.getPath("userData"), "usage-cache.json"),
    });
    // Read once per app run — editing settings.json while
    // the app is running won't change the model picker until restart.
    let modelDefaultsCache: ModelDefaults | undefined;
    const modelDefaults = (): ModelDefaults => {
      if (modelDefaultsCache === undefined)
        modelDefaultsCache = readModelDefaults(claudeDir, process.env);
      return modelDefaultsCache;
    };
    // Before each discovery sweep, follow any /clear that rotated a Managed pty's session id: relabel the
    // registry and re-key the live pty + renderer, so the rotated session stays Managed instead of being
    // re-derived as a read-only Observed one.
    const checkedUnderPtys = new Set<string>();
    // A claimed pty (codex rollout, agy conversation) takes its session's own id everywhere the
    // app keyed it by the draft id.
    const applyClaim = ({
      from,
      to,
      rolloutPath,
    }: {
      from: string;
      to: string;
      rolloutPath: string;
    }): void => {
      managed.rename(from, to);
      managed.claim(to, rolloutPath);
      sessionTitles.rename(from, to);
      sessionPins.rename(from, to);
      launchArgs.rename(from, to);
      remoteSessions.rename(from, to);
      renameInWindow(from, to);
    };
    const reconcile = async (): Promise<void> => {
      await applyRotations(
        {
          entries: () => managed.entriesFor("claude"),
          rename: (from, to) => managed.rename(from, to),
        },
        // The registry sweep is a per-tick fs read while any managed claude pty is live, so route
        // it through the parse worker; a worker fault degrades to the in-process read for the pass.
        () =>
          parseWorker
            .call({ op: "readSessionFiles", claudeDir })
            .catch(() => readSessionFiles(claudeDir)),
        (from, to) => {
          renameInWindow(from, to);
          // The pty keeps running under HAPI after a phone takeover or /clear, so the new id is remote
          // too; the old id stays marked for its own Resume.
          try {
            if (remoteSessions.has(from)) remoteSessions.set(to, true);
          } catch (err) {
            logError(
              "remote-session-follow-failed",
              "could not carry the remote mark to the rotated session id",
              err,
            );
          }
          try {
            sessionAccounts.follow(from, to);
          } catch (err) {
            logError(
              "session-account-follow-failed",
              "could not carry the session's account to the rotated session id",
              err,
            );
          }
        },
        { read: () => readParentMap(), seen: checkedUnderPtys },
      );
      // Codex claims land in the same beforeSync slot, so the re-key + rollout binding hit the
      // very pass that first discovers the rollout — no duplicate-row window between polls. Order
      // vs. the rotation pass above doesn't matter: the two tracks touch disjoint managed entries
      // (claude-agent vs codex-agent ids), so neither can observe the other's rename.
      await applyClaims({
        ptys: managed.codexEntries(),
        claimedRollouts: managed.claimedRollouts(),
        // Same split as the rotation sweep: the rollout walk + head-reads run in the worker (only
        // the spawn floor and claimed paths ride the request), falling back in-process on a fault.
        scan: (earliestMs, claimedRollouts) =>
          parseWorker
            .call({
              op: "scanClaimableRollouts",
              codexDir,
              earliestMs,
              claimedPaths: [...claimedRollouts],
            })
            .catch(() =>
              scanClaimableRollouts({
                listRollouts: () => listRollouts(codexDir),
                readHead: (path) => readRolloutHead(path),
                earliestMs,
                claimedRollouts,
              }),
            ),
        apply: applyClaim,
      });
      // agy takes no session id either: its new conversation db is claimed the same way. The scan
      // stays in-process — it opens only dbs touched since the oldest pending agy spawn.
      await applyClaims({
        ptys: managed.agyEntries(),
        claimedRollouts: managed.claimedRollouts(),
        scan: (earliestMs, claimedRollouts) =>
          scanClaimableAgy(agyDir, earliestMs, claimedRollouts),
        apply: applyClaim,
      });
    };
    const caffeinate = createCaffeinate({ blocker: powerSaveBlocker });
    // Fork feature: the workbench's product cards (override with CBW_PRODUCT_CARDS).
    const productsDirs = () => {
      const cardsDir =
        process.env.CBW_PRODUCT_CARDS ??
        "E:/0项目/平台整合规划/workbench/cards";
      return { cardsDir, stateDir: join(cardsDir, "..", "data", "state") };
    };
    const { sync, overview } = registerIpc({
      db,
      provider,
      statusLine,
      accountEmail,
      modelDefaults,
      beforeSync: reconcile,
      refreshSessionMetadata: () => codexThreadMetadata.refresh(),
      nativeSessionRename: (id, title) =>
        agentOf(id) === "codex"
          ? codexThreadMetadata.setName(id, title)
          : Promise.resolve(false),
      analyticsDb,
      analyticsDbPath,
      indexDbPath,
      claudeDir,
      codexDir,
      cliStatus,
      managed,
      sessionTitles,
      sessionPins,
      remoteSessions,
      sessionAccounts,
      contentSearch,
      board,
      junAccount,
      productsDirs,
      launchPresets,
      projectState,
      updater,
      appSettings,
      settingsManager,
      statuslineLaunchFault,
      caffeinate,
      usage,
      accountSwitcher,
      readAgyAccounts: () => agyQuota.readOverview?.() ?? null,
      sessionOverlays: [
        (sessions) => codexProvider.overlaySessions(sessions),
        (sessions) => piProvider.overlaySessions(sessions),
        (sessions) => agyProvider.overlaySessions(sessions),
        (sessions) => qoderProvider.overlaySessions(sessions),
      ],
    });

    // Fork (2026-11-01): signed in, Jun-Code titles sessions and picks their topic itself (Claude Haiku
    // through the hub account's relay) — see topic-judge.ts. A minute apart; nothing runs signed out.
    {
      const dirs = productsDirs();
      const judge = createTopicJudge({
        chat: (model, messages) => junAccount.chat(model, messages),
        signedIn: () => junAccount.status().signedIn,
        projectsDir: () =>
          join(process.env.CLAUDE_CONFIG_DIR ?? claudeDir, "projects"),
        cardsDir: dirs.cardsDir,
        dataDir: join(dirs.stateDir, ".."),
        readProducts: () => readProducts(dirs.cardsDir, dirs.stateDir),
        stateFile: join(app.getPath("userData"), "topic-judge.json"),
        log: (msg, err) => logError("topic-judge", msg, err),
      });
      const run = () => void judge.tick().catch(() => undefined);
      setTimeout(run, 20_000);
      setInterval(run, 60_000);
    }

    // One-shot launch check: packaged only, and only when the user hasn't turned it off. Deferred so it
    // never blocks first paint (mirrors the setTimeout'd CLI check). No recurring timer — see the
    // "renderer polls; no main timers" invariant; this fires once per launch.
    if (app.isPackaged && (appSettings.read().autoCheckUpdates ?? true)) {
      setTimeout(() => {
        // Opening About during this delay may already have checked. Keep the launch path one-shot
        // instead of issuing a second automatic request immediately afterward.
        if (updater.getState().phase.kind === "idle") void updater.check();
      }, 3000);
    }
    // Fork: the app stays open for days, so check again every 4 hours (the setting is re-read, so
    // turning it off stops these too). A found release downloads and the dialog offers it.
    if (app.isPackaged)
      setInterval(
        () => {
          const kind = updater.getState().phase.kind;
          if (
            (appSettings.read().autoCheckUpdates ?? true) &&
            (kind === "idle" || kind === "upToDate" || kind === "error")
          )
            void updater.check();
        },
        4 * 60 * 60 * 1000,
      );

    // Fork (2026-11-09): Settings → Appearance's "Launch at login" (it was on the HUD's General page).
    const loginItem = (): LoginItem => ({
      supported: process.platform !== "linux",
      enabled:
        process.platform !== "linux" && app.getLoginItemSettings().openAtLogin,
    });
    ipcMain.handle(IPC.loginItemGet, loginItem);
    ipcMain.handle(IPC.loginItemSet, (_e, enabled: unknown) => {
      if (loginItem().supported)
        app.setLoginItemSettings({ openAtLogin: enabled === true });
      return loginItem();
    });

    try {
      await sync(); // incremental parse of ~/.claude → SQLite; the window's first overview() is served right after
    } catch (err) {
      // A failed sync must not cost the user a window. Open with an empty list;
      // a manual Refresh retries, and surfacing the error in the UI is a later issue.
      logError(
        "initial-session-sync-failed",
        "initial session sync failed; opening the window anyway",
        err,
      );
    }

    // Fork (2026-11-09): DeskTidy's top island (in place of the HUD overlay) polls a loopback feed
    // every second or two — see island-feed.ts. A poll reads the in-memory overview; when the last
    // sync is 10s old it also starts one in the background, so the island stays current while the
    // main window is minimized and not polling.
    let lastIslandSync = Date.now();
    let islandSyncing = false;
    let islandProducts: { at: number; data: ProductsData | null } | null = null;
    let islandLast: { at: number; snap: IslandSnapshot } | null = null;
    const islandSnapshot = (): IslandSnapshot => {
      const now = Date.now();
      // Building it is synchronous main-process work (SQLite, statusLine captures, a few JSON
      // files): a second poller, or a poll right after one, gets the last one.
      if (islandLast && now - islandLast.at < 1000) return islandLast.snap;
      // One background sync at a time: a slow one must not queue another every 10s behind it.
      if (!islandSyncing && now - lastIslandSync > 10_000) {
        islandSyncing = true;
        void sync()
          .catch((err) =>
            logError("island-sync-failed", "island sync failed", err),
          )
          .finally(() => {
            islandSyncing = false;
            lastIslandSync = Date.now();
          });
      }
      // The topic cards change rarely; read them at most every 2s, not on every poll. A bad card
      // file costs the topic colours, not the whole snapshot.
      if (!islandProducts || now - islandProducts.at > 2000) {
        const dirs = productsDirs();
        let data: ProductsData | null = null;
        try {
          data = readProducts(dirs.cardsDir, dirs.stateDir);
        } catch (err) {
          logError(
            "island-products-failed",
            "readProducts failed; island gets no topics",
            err,
          );
        }
        islandProducts = { at: now, data };
      }
      const o = overview();
      const snap = buildIslandSnapshot({
        sessions: o.sessions,
        accounts: accountView(),
        account: o.account,
        agyAccounts: agyQuota.readOverview?.() ?? null,
        products: islandProducts.data,
        remoteOnline: remoteStatus().online,
        now,
      });
      const took = Date.now() - now;
      if (took > 50)
        logWarn("island-snapshot-slow", `island snapshot took ${took} ms`);
      islandLast = { at: now, snap };
      return snap;
    };
    const showMain = (sessionId?: string) => {
      if (BrowserWindow.getAllWindows().length === 0) openWindow();
      const w = BrowserWindow.getAllWindows()[0];
      if (!w) return;
      if (w.isMinimized()) w.restore();
      w.show();
      w.focus();
      if (sessionId) w.webContents.send(IPC.selectSession, sessionId);
    };
    // Off-screen runs serve it too: it opens no window, so a screenshot build can smoke-test it.
    let islandFeed: IslandFeed | null = null;
    startIslandFeed({
      dir: app.getPath("userData"),
      snapshot: islandSnapshot,
      open: showMain,
      log: (msg, err) => logError("island-feed", msg, err),
    })
      .then((feed) => {
        islandFeed = feed;
      })
      .catch((err) =>
        logError("island-feed-failed", "island feed failed to start", err),
      );
    app.on("before-quit", () => void islandFeed?.stop());
  })
  .catch((err) => {
    // Last resort: never let a startup throw vanish as a silent unhandled rejection.
    logError("app-start-failed", "failed to start the app", err);
  });

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
