import type { TrashResult } from "./session-trash";
import type {
  SessionCleanupSettings,
  SessionCleanupView,
} from "./session-cleanup";
import type { CardRun, ProductsData, TopicInput } from "./products";
import type { SkillCheck, SkillRemoveResult, SkillsData } from "./skills";
import type {
  AiTestResult,
  BoardAi,
  BoardDoc,
  Insight,
  InsightRunState,
} from "./board";
import type {
  Session,
  Account,
  Task,
  BackgroundShell,
  ShellOutput,
  Monitor,
} from "./types";
export type ProjectPlacement = "pinned" | "hidden" | "ordinary";
export type ProjectState = Record<
  string,
  { pinnedAtMs?: number; hiddenAtMs?: number }
>;
import type {
  TranscriptRead,
  ReadSettled,
  ToolResultDetail,
} from "./transcript";
import type { TerminalApi } from "./terminal";
import type { ShellTerminalApi } from "./shell-terminal";
import type { MetricsRead } from "./metrics";
import type { ModelDefaults } from "./models";
import type { StatsSnapshot, StatsRange, ScanProgress } from "./stats";
import type { CliStatus, CliStatusByAgent } from "./cli-status";
import type { AgentId } from "./agents";
import type { UpdateState } from "./update";
import type { StatuslineStatus } from "./statusline-status";
import type { Locale } from "./locale";
import type { LaunchPresets } from "./extra-args";
import type {
  DiagnosticReportResult,
  SaveDiagnosticReportResult,
} from "./diagnostic-report";
export { type UpdateState };
export const IPC = {
  overview: "overview:get",
  refresh: "sessions:refresh",
  readTranscript: "transcript:read",
  readSubagentTranscript: "subagentTranscript:read",
  readTasks: "tasks:read",
  readShells: "shells:read",
  readShellOutput: "shellOutput:read",
  readMonitors: "monitors:read",
  readMonitorOutput: "monitorOutput:read",
  readMetrics: "metrics:read",
  fullscreen: "window:fullscreen",
  modelDefaults: "model:defaults",
  readStats: "stats:read",
  pumpStats: "stats:pump",
  dbInfo: "db:info",
  recheckCli: "cli:recheck",
  resetAnalytics: "analytics:reset",
  openExternal: "shell:openExternal",
  revealPath: "shell:revealPath",
  openIn: "shell:openIn",
  diagnosticReport: "session:diagnosticReport",
  saveDiagnosticReport: "session:saveDiagnosticReport",
  clipboardWriteText: "clipboard:writeText",
  clipboardReadText: "clipboard:readText",
  clipboardProbe: "clipboard:probe",
  renameSession: "session:rename",
  setSessionPinned: "session:setPinned",
  readProducts: "products:read",
  readProductCard: "products:card",
  saveTopic: "products:topic-save",
  deleteTopic: "products:topic-delete",
  assignSessionTopic: "products:assign",
  generateCard: "products:generate",
  readBoard: "board:read",
  saveBoard: "board:save",
  boardLinkSession: "board:linkSession",
  runBoardInsight: "board:insight-run",
  boardInsightState: "board:insight-state",
  testBoardAi: "board:ai-test",
  listSkills: "skills:list",
  checkSkill: "skills:check",
  updateSkill: "skills:update",
  scanSkillUsage: "skills:scanUsage",
  removeSkill: "skills:remove",
  trashSession: "session:trash",
  sessionCleanupGet: "session:cleanupGet",
  sessionCleanupSet: "session:cleanupSet",
  sessionCleanupRun: "session:cleanupRun",
  setProjectPlacement: "project:setPlacement",
  getToolResult: "toolResult:get",
  updateGetState: "update:getState",
  updateCheck: "update:check",
  updateDownload: "update:download",
  updateInstall: "update:install",
  updateGetAutoCheck: "update:getAutoCheck",
  updateSetAutoCheck: "update:setAutoCheck",
  appearanceGetAppTheme: "appearance:getAppTheme",
  appearanceSetAppTheme: "appearance:setAppTheme",
  appearanceGetTerminalTheme: "appearance:getTerminalTheme",
  appearanceSetTerminalTheme: "appearance:setTerminalTheme",
  appearanceGetLocale: "appearance:getLocale",
  appearanceSetLocale: "appearance:setLocale",
  statuslineGetStatus: "statusline:getStatus",
  statuslineSetEnabled: "statusline:setEnabled",
  statuslineSetRefreshInterval: "statusline:setRefreshInterval",
  statuslineRepair: "statusline:repair",
  caffeinateGet: "caffeinate:get",
  caffeinateSet: "caffeinate:set",
  hudSettingsGet: "hud:settingsGet",
  claudeAccountsList: "claudeAccounts:list",
  claudeAccountsUse: "claudeAccounts:use",
  claudeAccountsBind: "claudeAccounts:bind",
  hudSettingsSet: "hud:settingsSet",
  launchPresetsGet: "launchPresets:get",
  launchPresetsSet: "launchPresets:set",
  /** PUSH: main -> renderer on every update-state transition. */
  updateState: "update:state",
  selectSession: "window:selectSession",
} as const;

/** The HUD overlay's preferences: whether it shows, and on which display (`null` = the primary). */
export interface HudSettings {
  enabled: boolean;
  display: string | null;
}

/** One of the user's reclaude organizations (one Claude account each). */
export interface ClaudeOrg {
  id: string;
  name: string;
  /** "personal" / "team" as reclaude reports it. */
  kind: string;
  email: string;
  /** Bound on this machine (has its own config dir and credentials). */
  bound: boolean;
  /** The default binding: new sessions run on it. */
  current: boolean;
}

/** The account switcher's state: null `orgs` when reclaude isn't in use; `error` when listing failed. */
export interface ClaudeAccountsView {
  orgs: ClaudeOrg[] | null;
  error?: string;
}

/** A display the HUD can sit on, for the Settings picker. */
export interface HudDisplayOption {
  id: string;
  primary: boolean;
  width: number;
  height: number;
}

/** What Settings shows for the HUD: the stored preferences and the displays attached now. */
export interface HudSettingsView {
  settings: HudSettings;
  displays: HudDisplayOption[];
}

/** What the clipboard holds besides text: an image (a screenshot), or files copied in the file
 *  manager (Windows Explorer puts no text on the clipboard for those). */
export interface ClipboardProbe {
  hasImage: boolean;
  files: string[];
}

/** The index-only slice: the indexed session list from one SQLite read. The SQLite index holds no
 *  live statusLine data, so the account is added later — this is what the store returns,
 *  before the overlay. */
export interface IndexOverview {
  sessions: Session[];
}

/** What the renderer receives: the index slice plus the live statusLine overlay (ipc.ts assembles it). */
export interface OverviewData extends IndexOverview {
  projectState: ProjectState;
  /** App-wide account: billing mode + rate limits from the live statusLine. null when there is no
   *  statusLine data (no captures, or all stale) — the UI reads null as "no rate-limit bars". */
  account: Account | null;
  /** The cached CLI verdict per agent, keyed like AGENT_IDS. Missing/null means no completed check
   *  yet for that agent. */
  cliStatus: CliStatusByAgent;
  /** The user's home directory (os.homedir()), for ~-abbreviating paths in the renderer (the
   *  sidebar's group hints). Rides the overview so no separate IPC round trip is needed. */
  homeDir: string;
}

/** The result of an on-demand tasks read: a fresh list with a change token the caller echoes back as
 *  `since`, or one of the shared settled outcomes (see ReadSettled). */
export type TaskRead =
  | { status: "changed"; mtimeMs: number; tasks: Task[] }
  | ReadSettled;

/** The result of a background-shells list read: the session's shells with a change token, or a shared
 *  settled outcome. The list omits each shell's output path; the log is read separately via readShellOutput. */
export type ShellsRead =
  | { status: "changed"; mtimeMs: number; shells: BackgroundShell[] }
  | ReadSettled;

/** The result of a drilled shell-output read: the output with a change token, or a settled outcome.
 *  Polled only while a shell is open (gated like the subagent read). */
export type ShellOutputRead =
  | { status: "changed"; mtimeMs: number; output: ShellOutput }
  | ReadSettled;

/** The result of a monitors list read: the session's monitors with a change token, or a settled outcome.
 *  The list omits each monitor's output path; the log is read separately via readMonitorOutput. */
export type MonitorsRead =
  | { status: "changed"; mtimeMs: number; monitors: Monitor[] }
  | ReadSettled;

/** The result of a drilled monitor-output read: the output with a change token, or a settled outcome.
 *  Polled only while a monitor is open (gated like the shell read). */
export type MonitorOutputRead =
  | { status: "changed"; mtimeMs: number; output: ShellOutput }
  | ReadSettled;

/** The result of a Stats poll: a fresh snapshot with a change token the renderer echoes back as `since`,
 *  or `unchanged` when nothing the snapshot depends on has moved (no new turn, same local day, scan caught
 *  up, no in-place rewrite) — so the handler skips every aggregate and the renderer skips the re-render.
 *  Mirrors the transcript/tasks reads. */
export type StatsRead =
  | { status: "changed"; token: string; snapshot: StatsSnapshot }
  | { status: "unchanged"; token: string };

/** Per-agent count split used by both cards in Settings → Databases. */
export interface AgentCounts {
  total: number;
  byAgent: Record<AgentId, number>;
}

export interface AnalyticsDbInfo {
  path: string;
  sizeBytes: number;
  turns: AgentCounts;
  sessions: AgentCounts;
  oldestTs: number | null;
  processedFiles: number;
  worktrees: number;
}

export interface IndexDbInfo {
  path: string;
  sizeBytes: number;
  sessions: AgentCounts;
}

/** Both local SQLite stores shown by Settings → Databases. */
export interface DbInfo {
  analytics: AnalyticsDbInfo;
  index: IndexDbInfo;
}

/** A target for the header's "Open in" dropdown. The renderer sends one of these plus the session id;
 *  the main process resolves the folder and opens it. */
export type OpenInTarget = "vscode" | "finder";

/** The result of an openIn request. The handler never throws to the renderer: every failure (no
 *  resolvable cwd, path gone, shell error) comes back as `{ ok: false, error }` so the menu can show it.
 *  A discriminated union, so a successful result can't carry an error and a failure must name one. */
export type OpenInResult = { ok: true } | { ok: false; error: string };

/** The message both the main handler and the renderer fall back to when an open fails without a more
 *  specific reason. Defined once here, the only module both layers import, so the two can't drift. */
export const OPEN_IN_FAILED_MESSAGE = "Couldn't open.";

export interface IpcApi {
  /** Read-only: the indexed sessions as they stand, no sync — fast initial paint. */
  overview(): Promise<OverviewData>;
  /** Sync the index against ~/.claude, then return the fresh sessions from one read. */
  refresh(): Promise<OverviewData>;
  readTranscript(id: string, sinceMtimeMs?: number): Promise<TranscriptRead>;
  /** Read one subagent's own transcript (its sidechain file) into render-ready events — the read behind
   *  drilling into a Subagent lane. `sinceMtimeMs` is the change token from the last read; an unchanged
   *  token skips the read. */
  readSubagentTranscript(
    id: string,
    agentId: string,
    sinceMtimeMs?: number,
  ): Promise<TranscriptRead>;
  /** Read one session's task list from ~/.claude/tasks/<id>/. `sinceMtimeMs` is the change token from
   *  the caller's last read; when it still matches, the result is `unchanged`. */
  readTasks(id: string, sinceMtimeMs?: number): Promise<TaskRead>;
  /** List one session's background shells (compact metadata for the dock). `sinceMtimeMs` is the change
   *  token; an unchanged transcript skips the read. */
  readShells(id: string, sinceMtimeMs?: number): Promise<ShellsRead>;
  /** Read one background shell's output — the read behind drilling into a shell. Prefers the live
   *  `.output` file, falls back to stitched transcript snapshots. `sinceMtimeMs` is the change token. */
  readShellOutput(
    id: string,
    shellId: string,
    sinceMtimeMs?: number,
  ): Promise<ShellOutputRead>;
  /** List one session's monitors (compact metadata for the dock). `sinceMtimeMs` is the change token;
   *  an unchanged transcript skips the read. */
  readMonitors(id: string, sinceMtimeMs?: number): Promise<MonitorsRead>;
  /** Read one monitor's output — the read behind drilling into a monitor. Prefers the authoritative
   *  `.output` file (known at stream-end), falls back to de-duplicated stitched events. `sinceMtimeMs`
   *  is the change token. */
  readMonitorOutput(
    id: string,
    monitorId: string,
    sinceMtimeMs?: number,
  ): Promise<MonitorOutputRead>;
  /** Read one session's lazy metrics (token speed, git, voice, remote). `sinceMtimeMs` is the change
   *  token from the last read; an unchanged token skips the recompute. */
  readMetrics(id: string, sinceMtimeMs?: number): Promise<MetricsRead>;
  /** Per-family model overrides, the configured default family, and the allowed-family allowlist —
   *  read from Claude Code's settings.json and the process env. */
  modelDefaults(): Promise<ModelDefaults>;
  /** Run one bounded, incremental scan step, then return a snapshot scoped to `range` (all-time when
   *  omitted) and `calendarYear` (trailing twelve months when omitted), tagged with a change token. Pass the
   *  last token as `since`; when nothing the snapshot depends on has moved, the result is `unchanged` and no
   *  snapshot is built. Polled while the Stats view is open; never rejects. */
  readStats(
    agent: AgentId,
    range?: StatsRange,
    calendarYear?: number,
    since?: string,
  ): Promise<StatsRead>;
  /** Run one bounded, incremental analytics scan step and return how far the backfill has gotten —
   *  the background pump's poll (spec 2026-07-10). No aggregates are computed, so a caught-up tick
   *  costs one readdir+stat walk. Polled for the app's lifetime by useStatsPump; never rejects (a
   *  scan failure or missing store serves a done progress, parking the pump at its idle cadence). */
  pumpStats(): Promise<ScanProgress>;
  /** Settings → Databases readout, assembled in main so the renderer gets one shape for both stores.
   *  Polled at the warm cadence while the section is mounted. Resolves null when no store is wired or
   *  the read fails; never rejects. */
  dbInfo(): Promise<DbInfo | null>;
  /** Force a fresh CLI status check for one agent (the footer's Re-check button). */
  recheckCli(agent: AgentId): Promise<CliStatus>;
  /** Drop the durable analytics store (turns + scan high-water marks) so the next stats poll rebuilds it
   *  from the transcripts on disk. Resolves `{ ok: false }` when no analytics store is wired or the clear
   *  fails; never rejects. */
  resetAnalytics(): Promise<{ ok: boolean }>;
  /** Open an http(s) URL in the user's default browser (the Git cell's PR link). Non-http(s) URLs are
   *  ignored by the main handler. */
  openExternal(url: string): Promise<void>;
  /** Reveal one of the app's database files in the OS file manager. */
  revealPath(path: string): Promise<void>;
  /** Open the session's working directory in `target`. The path is resolved in the main process from the
   *  session id (registry → transcript), so this works for ended sessions too. Never rejects. */
  openIn(id: string, target: OpenInTarget): Promise<OpenInResult>;
  /** Build a public-safe Markdown diagnostic report for one indexed session. */
  diagnosticReport(id: string): Promise<DiagnosticReportResult>;
  /** Save the exact previewed Markdown through a native picker; no destination path crosses in. */
  saveDiagnosticReport(
    fileName: string,
    markdown: string,
  ): Promise<SaveDiagnosticReportResult>;
  /** Copy text to the system clipboard (the Git popover's branch / commit copy buttons). */
  clipboardWriteText(text: string): Promise<void>;
  /** Read text from the system clipboard (terminal paste — main-process clipboard for the same
   *  reason as the write path: no focused-secure-context requirement). `type: "selection"` reads
   *  the Linux X11 selection clipboard (Shift+Insert); only ever requested on Linux. */
  clipboardReadText(type?: "selection"): Promise<string>;
  /** What the clipboard holds when it has no text (a screenshot, Explorer-copied files), so a
   *  terminal paste can hand the CLI its image key or the file paths. */
  clipboardProbe(): Promise<ClipboardProbe>;
  /** Persist a display-name override for a session id (null or a value that trims to empty clears it,
   *  reverting to the derived/live name), then return the fresh overview with the override applied.
   *  Both overview() and refresh() also carry the override, since it is applied in overviewNow(). */
  renameSession(id: string, title: string | null): Promise<OverviewData>;
  /** Persist (or clear) the durable pin mark for a session id, then return the fresh overview with
   *  pinnedAtMs stamped. Applied in overviewNow(), so overview() and refresh() carry it too. */
  setSessionPinned(id: string, pinned: boolean): Promise<OverviewData>;
  /** The workbench's product cards + session→product records for the sidebar's product tags; null
   *  when no cards dir is configured/present (rows then render untagged). */
  readProducts(): Promise<ProductsData | null>;
  /** One topic's card markdown; null without a card. */
  readProductCard(key: string): Promise<string | null>;
  /** Create or update a topic (name, color, trigger words, folders); returns the fresh data. */
  saveTopic(topic: TopicInput): Promise<ProductsData | null>;
  /** Remove a topic (its card moves to the workbench's cards/.trash). */
  deleteTopic(key: string): Promise<ProductsData | null>;
  /** Put a session under a topic by hand ("" = no topic). */
  assignSessionTopic(id: string, key: string): Promise<ProductsData | null>;
  /** Start writing the topic's card in the background; progress rides readProducts().runs. */
  generateCard(key: string): Promise<CardRun>;
  /** The work board document (tasks, ideas, habits, insights). */
  readBoard(): Promise<BoardDoc>;
  /** Replace the whole board document; returns it as stored (sanitized). */
  saveBoard(doc: BoardDoc): Promise<BoardDoc>;
  /** Put a session under one task (null = none), read-modify-write in main; returns the board. */
  linkSessionToTask(
    sessionId: string,
    taskId: string | null,
  ): Promise<BoardDoc>;
  /** Start the AI insight run on a renderer-built prompt; the result lands in the board's insights. */
  runBoardInsight(
    prompt: string,
    trigger: Insight["trigger"],
  ): Promise<InsightRunState>;
  boardInsightState(): Promise<InsightRunState>;
  /** Send a tiny prompt through an AI setting (saved or not) to check it answers. */
  testBoardAi(ai: BoardAi): Promise<AiTestResult>;
  /** Skills installed on this machine (every folder merged by name) and Claude Code plugins. */
  listSkills(): Promise<SkillsData>;
  /** Check one skill against its upstream (git, its own updater, or the upstream SKILL.md). */
  checkSkill(name: string): Promise<SkillCheck>;
  /** git pull / run its updater in every copy, then check again. */
  updateSkill(name: string): Promise<SkillCheck>;
  /** Re-read the transcripts for per-skill usage (incremental), then list again. */
  scanSkillUsage(): Promise<SkillsData>;
  /** Uninstall everywhere: links removed, folders to the Recycle Bin. */
  removeSkill(name: string): Promise<SkillRemoveResult>;
  /** Move an ended session's transcript (and subagent dir) to the OS trash and drop it from the index.
   *  Refused for a live session. The row disappears on the next overview poll. */
  trashSession(id: string): Promise<TrashResult>;
  /** Automatic cleanup: the rule, what it would trash now, the last run. */
  getSessionCleanup(): Promise<SessionCleanupView>;
  setSessionCleanup(next: SessionCleanupSettings): Promise<SessionCleanupView>;
  /** Run the cleanup now (ignores the on/off switch); resolves when it's done. */
  runSessionCleanup(): Promise<SessionCleanupView>;
  /** Every saved launch-args preset, keyed by agent (the New-session preset picker). */
  getLaunchPresets(): Promise<LaunchPresets>;
  /** Replace the whole presets object — the renderer owns list edits and ships the result back. */
  setLaunchPresets(presets: LaunchPresets): Promise<void>;
  setProjectPlacement(
    key: string,
    placement: ProjectPlacement,
  ): Promise<OverviewData>;
  /** Fetch one tool call's full command + output on demand (the tool turn's detail modal). Not polled;
   *  a one-shot read keyed by the tool_use id. `agentId` reads the call from that subagent's own
   *  transcript file instead of the session transcript (the drilled Subagent view). */
  getToolResult(
    id: string,
    toolUseId: string,
    agentId?: string,
  ): Promise<ToolResultDetail>;
  /** The current update state (initial paint + post-action reconciliation). */
  getUpdateState(): Promise<UpdateState>;
  /** Trigger a check; resolves to the resulting state. Live transitions also arrive via onUpdateState. */
  checkForUpdate(): Promise<UpdateState>;
  /** Download the available update. Progress arrives via onUpdateState. */
  downloadUpdate(): Promise<void>;
  /** Quit and install a downloaded update — the app quits, so this never resolves. */
  installUpdate(): void;
  /** Whether the launch check is enabled (missing setting reads as true). */
  getAutoCheckUpdates(): Promise<boolean>;
  /** Persist the launch-check preference. */
  setAutoCheckUpdates(enabled: boolean): Promise<void>;
  /** The app chrome's theme (missing preference reads as "dark"). */
  getAppTheme(): Promise<"dark" | "light">;
  /** Persist the app theme and sync Electron's nativeTheme (the native macOS traffic-light
   *  buttons — this app uses titleBarStyle "hidden" with them visible). */
  setAppTheme(theme: "dark" | "light"): Promise<void>;
  /** The terminal panels' theme (interactive shell rail + observed session terminal), independent
   *  of the app theme (missing preference reads as "dark"). */
  getTerminalTheme(): Promise<"dark" | "light">;
  /** Persist the terminal theme. */
  setTerminalTheme(theme: "dark" | "light"): Promise<void>;
  /** The app's display language (missing or invalid preference reads as "en" —
   *  the handler runs normalizeLocale, so the renderer never sees a raw value). */
  getLocale(): Promise<Locale>;
  /** Persist the display language. The renderer's $locale atom is the live copy;
   *  no native side effect (unlike setAppTheme's nativeTheme sync). */
  setLocale(locale: Locale): Promise<void>;
  /** The Statusline card's readout: preference, install state, derived health, coverage. Assembled in
   *  main; polled by the System section every 3s while open. Never rejects. */
  getStatuslineStatus(): Promise<StatuslineStatus>;
  /** Toggle capture. Disable = uninstall (settings restored byte-for-byte, captures removed) + persist
   *  the preference; enable = clear it + install. Returns the fresh status; failures surface as
   *  state "fault", never a rejection. */
  setStatuslineEnabled(enabled: boolean): Promise<StatuslineStatus>;
  /** Write refreshInterval (seconds, 1–60 from the UI) into the wrapped statusLine block; null means
   *  events-only. Returns the fresh status. */
  setStatuslineRefreshInterval(
    seconds: number | null,
  ): Promise<StatuslineStatus>;
  /** Re-run the installer's self-heal (recovers a stripped entry / vanished record). Returns the
   *  fresh status. */
  repairStatusline(): Promise<StatuslineStatus>;
  /** Whether the keep-awake blocker is currently active (the footer button's initial paint). */
  getCaffeinate(): Promise<boolean>;
  /** Turn keep-awake on or off. Resolves to the resulting state — main is the source of truth,
   *  so the footer renders the response rather than assuming the toggle took. */
  setCaffeinate(on: boolean): Promise<boolean>;
  /** The HUD overlay's preferences and the displays it can use. */
  getHudSettings(): Promise<HudSettingsView>;
  /** reclaude's organizations (Claude accounts) and which one new sessions use. */
  listClaudeAccounts(): Promise<ClaudeAccountsView>;
  /** Make a bound organization the default (`reclaude org use`); answers with the new list. */
  useClaudeAccount(id: string): Promise<ClaudeAccountsView>;
  /** Start binding an organization (`reclaude org bind`, authorized in the browser). */
  bindClaudeAccount(id: string): Promise<void>;
  /** Store the HUD preferences and apply them at once (show, hide or move the overlay). */
  setHudSettings(settings: HudSettings): Promise<HudSettingsView>;
}

/** Everything exposed on `window.api`: the request/response surface plus the Managed-terminal surface. */
export type AppApi = IpcApi & {
  terminal: TerminalApi;
  /** The footer shell-terminal surface (a plain interactive shell per tab) — separate manager and
   *  channels from the Managed `terminal` surface above. */
  shellTerminal: ShellTerminalApi;
  /** Electron webUtils.getPathForFile: the absolute filesystem path of a DOM File dragged from the
   *  OS, for dropping paths into the terminal. Typed loosely (`object`) so this shared type stays
   *  DOM-lib-free under tsconfig.node.json; renderer call sites pass a real File. */
  getPathForFile(file: object): string;
  /** The host platform (`process.platform`), so the renderer can branch macOS-only chrome (the
   *  frameless title bar reserves space for the traffic lights only on darwin). */
  platform: string;
  /** Current web zoom factor (`webFrame.getZoomFactor()`), so the title bar can counter-zoom to a
   *  fixed physical size and keep the macOS traffic lights (OS-drawn, immune to web zoom) aligned. */
  getZoomFactor(): number;
  /** Subscribe to native macOS fullscreen changes. Main pushes the new state on every
   *  enter/leave-full-screen and on each load; the callback receives it, and the returned fn
   *  unsubscribes for effect cleanup. Off macOS main never sends, so the state stays false. */
  onFullscreenChange(cb: (isFullscreen: boolean) => void): () => void;
  /** Subscribe to update-state pushes. Main sends on every transition (including download progress);
   *  the returned fn unsubscribes. Mirrors onFullscreenChange. */
  onUpdateState(cb: (state: UpdateState) => void): () => void;
  /** Subscribe to main asking the window to show a session (the HUD panel's session rows). */
  onSelectSession(cb: (id: string) => void): () => void;
};
