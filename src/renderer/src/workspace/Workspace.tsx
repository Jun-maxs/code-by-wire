import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type Dispatch,
  type ReactNode,
  type SetStateAction,
} from "react";
import { useStore } from "@nanostores/react";
import type {
  Session,
  Subagent,
  BackgroundShell,
  Monitor,
} from "@shared/types";
import { AGENTS } from "@shared/agents";
import { useI18n } from "../i18n";
import { AgentIcon } from "../ui/agent-icons";
import { TranscriptView } from "./TranscriptView";
import { WorkView } from "./WorkView";
import {
  $viewModes,
  resolveSessionViewMode,
  setSessionViewMode,
  toggleSessionViewMode,
} from "./view-mode";
import { useTranscriptModals } from "./use-transcript-modals";
import { TerminalView } from "../terminal/TerminalView";
import { useTranscript, type DocState } from "./use-transcript";
import { ActivityDock } from "./panels/ActivityDock";
import { SubagentDrill, type DrillCrumb } from "./SubagentDrill";
import { indexByDispatch, type DispatchDrill } from "./drill-index";
import { ShellDetailModal } from "./ShellDetailModal";
import { MonitorDetailModal } from "./MonitorDetailModal";
import { useSubagentTranscript } from "./use-subagent-transcript";
import { useShells } from "./use-shells";
import { useShellOutput } from "./use-shell-output";
import { useMonitors } from "./use-monitors";
import { useMonitorOutput } from "./use-monitor-output";
import { useTasks } from "./use-tasks";
import { ObservedTerminal } from "./ObservedTerminal";
import { OverlayScroll } from "../ui/OverlayScroll";
import { MiddleHeader } from "../shell/MiddleHeader";
import { SessionMenu } from "../shell/SessionMenu";

export function Workspace({
  session: s,
  canSpawn,
  onResume,
  onFork,
  onEnd,
  onRename,
  onTogglePin,
  onBeforeAutoResume,
  onAfterAutoResume,
  leftEdgeExposed,
  rightEdgeExposed,
  leading,
}: {
  session: Session;
  /** Whether the selected session's agent CLI is usable; gates Resume and Fork (both spawn it). */
  canSpawn: boolean;
  onResume: (id: string) => Promise<void>;
  onFork: (session: Session) => Promise<void>;
  /** End the running Managed session (header-only; never offered in the observed-terminal panel). */
  onEnd: (id: string) => void;
  /** Persist a display-name override for this session (null/empty clears it). Applies to any session. */
  onRename: (id: string, title: string | null) => void;
  /** Persist (or clear) the pin mark for this session. Applies to any session. */
  onTogglePin: (id: string, pinned: boolean) => void;
  onBeforeAutoResume?: (id: string) => void;
  onAfterAutoResume?: (id: string, draft?: Session) => void;
  /** Whether the left pane isn't actually docked next to the header — reserves the cluster inset. */
  leftEdgeExposed: boolean;
  /** Whether the right pane isn't docked — the header clears the fixed right toggle cluster. */
  rightEdgeExposed: boolean;
  /** Fork (2026-11-02): the header's Single ⇄ Split switch. */
  leading?: ReactNode;
}) {
  // Recomputed each render; App's 3s background re-sync re-renders this, so the timeline timestamps tick.
  const now = Date.now();
  const caps = AGENTS[s.agent].capabilities;
  const modes = useStore($viewModes);
  const viewMode = resolveSessionViewMode(s, modes, caps.hasTranscript);
  const transcriptOn = viewMode === "work";
  const setTranscriptOn = useCallback(
    (next: boolean) => {
      setSessionViewMode(s.id, next ? "work" : "cli");
    },
    [s.id],
  );
  // Lifted from WorkspaceBody so the header's CLI tab can clear a subagent drill on select.
  const [drill, setDrill] = useState<DrillCrumb[]>([]);

  // When a live terminal stands up via an explicit Resume (from CLI/ObservedTerminal or SessionMenu) and
  // the user hasn't explicitly pinned Work view on this session, resolveSessionViewMode naturally lands on
  // CLI (`!explicit && hasLiveTerminal => "cli"`).

  return (
    <div className="flex h-full min-w-0 flex-1 flex-col bg-ink-950 text-fg">
      <MiddleHeader
        title={s.title}
        session={s}
        transcriptOn={transcriptOn}
        onToggleTranscript={() => toggleSessionViewMode(s, caps.hasTranscript)}
        onExitDrill={() => setDrill([])}
        drilled={drill.length > 0}
        leftEdgeExposed={leftEdgeExposed}
        rightEdgeExposed={rightEdgeExposed}
        leading={leading}
        menu={
          <SessionMenu
            session={s}
            canSpawn={canSpawn}
            onResume={onResume}
            onFork={onFork}
            onEnd={onEnd}
            onRename={onRename}
            onTogglePin={onTogglePin}
          />
        }
      />

      <div className="min-h-0 flex-1">
        <WorkspaceBody
          session={s}
          now={now}
          canSpawn={canSpawn}
          onResume={onResume}
          onFork={onFork}
          onBeforeAutoResume={onBeforeAutoResume}
          onAfterAutoResume={onAfterAutoResume}
          transcriptOn={transcriptOn}
          setTranscriptOn={setTranscriptOn}
          drill={drill}
          setDrill={setDrill}
        />
      </div>
    </div>
  );
}

/**
 * The workspace body: the center live view (terminal or transcript, per `transcriptOn`) with the Activity
 * dock below it. One transcript poll (useTranscript) feeds the center and the dock. The right-rail
 * telemetry panels have moved out to a sibling `RightSidebar` at the App level — this column is full width.
 */
function WorkspaceBody({
  session: s,
  now,
  canSpawn,
  onResume,
  onFork,
  onBeforeAutoResume,
  onAfterAutoResume,
  transcriptOn,
  setTranscriptOn,
  drill,
  setDrill,
}: {
  session: Session;
  now: number;
  canSpawn: boolean;
  onResume: (id: string) => Promise<void>;
  onFork: (session: Session) => Promise<void>;
  onBeforeAutoResume?: (id: string) => void;
  onAfterAutoResume?: (id: string, draft?: Session) => void;
  transcriptOn: boolean;
  setTranscriptOn: (transcriptOn: boolean) => void;
  /** The subagent drill-stack: empty = the Session transcript; a crumb = a drilled Subagent. Lifted to
   *  Workspace so the header's CLI tab can clear it on select. */
  drill: DrillCrumb[];
  setDrill: Dispatch<SetStateAction<DrillCrumb[]>>;
}) {
  const doc = useTranscript(s.id);
  const tasks = useTasks(s.id);
  const shells = useShells(s.id);
  const monitors = useMonitors(s.id);
  const top = drill[drill.length - 1];
  const activeAgentId = top?.agentId;
  // A background shell opens in a modal, not the drill-stack. Hold the whole shell object so the modal
  // never blanks if the shell is later reaped from the list; the id drives the lifted output poll and the
  // dock's row highlight / tab hold.
  const [modalShell, setModalShell] = useState<BackgroundShell | null>(null);
  const activeShellId = modalShell?.id;
  // Both polls lifted here (always mounted) and gated on their active id, so they survive the Managed
  // Terminal ⇄ Transcript toggle. Each is a no-op until a Subagent is drilled / a shell modal is open.
  const subagentDoc = useSubagentTranscript(s.id, activeAgentId);
  const shellOutput = useShellOutput(s.id, activeShellId);
  // The live BackgroundShell behind the open modal, re-resolved each poll so status/runtime stay fresh
  // (a running shell flips to completed on its own); falls back to the stored snapshot if it was reaped.
  const activeShell = activeShellId
    ? (shells?.find((sh) => sh.id === activeShellId) ?? modalShell ?? undefined)
    : undefined;
  // A monitor opens in a modal too, mutually exclusive with the shell modal (only one is set at a time).
  const [modalMonitor, setModalMonitor] = useState<Monitor | null>(null);
  const activeMonitorId = modalMonitor?.id;
  const monitorOutput = useMonitorOutput(s.id, activeMonitorId);
  const activeMonitor = activeMonitorId
    ? (monitors?.find((m) => m.id === activeMonitorId) ??
      modalMonitor ??
      undefined)
    : undefined;
  // Resolve an inline dispatch by its tool_use_id against the session's full nested forest, rebuilt each
  // poll. A dispatch is drillable iff it's a key; clicking PUSHES the resolved subagent (deep), unlike a
  // lane click which resets to depth 1.
  const dispatchIndex = useMemo(
    () => indexByDispatch(doc?.subagents ?? []),
    [doc],
  );
  const dispatchDrill: DispatchDrill = useMemo(
    () => ({
      index: dispatchIndex,
      onDrill: (toolUseId) => {
        const node = dispatchIndex.get(toolUseId);
        if (node)
          setDrill((d) => [
            ...d,
            {
              kind: "subagent",
              agentId: node.id,
              type: node.type,
              description: node.description,
            },
          ]);
      },
    }),
    [dispatchIndex],
  );
  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="min-h-0 flex-1">
        <CenterView
          session={s}
          now={now}
          doc={doc}
          subagentDoc={subagentDoc}
          drill={drill}
          onNavigate={(depth) => setDrill((d) => d.slice(0, depth))}
          dispatchDrill={dispatchDrill}
          canSpawn={canSpawn}
          onResume={onResume}
          onFork={onFork}
          onBeforeAutoResume={onBeforeAutoResume}
          onAfterAutoResume={onAfterAutoResume}
          transcriptOn={transcriptOn}
          setTranscriptOn={setTranscriptOn}
        />
      </div>
      {AGENTS[s.agent].capabilities.hasActivity && (
        <ActivityDock
          session={s}
          tasks={tasks ?? []}
          doc={doc}
          shells={shells ?? []}
          monitors={monitors ?? []}
          now={now}
          hideContextInTally={transcriptOn && drill.length === 0}
          activeAgentId={activeAgentId}
          activeShellId={activeShellId}
          activeMonitorId={activeMonitorId}
          onDrill={(agent: Subagent) =>
            setDrill([
              {
                kind: "subagent",
                agentId: agent.id,
                type: agent.type,
                description: agent.description,
              },
            ])
          }
          onDrillShell={(shell: BackgroundShell) => {
            setModalMonitor(null);
            setModalShell(shell);
          }}
          onDrillMonitor={(monitor: Monitor) => {
            setModalShell(null);
            setModalMonitor(monitor);
          }}
        />
      )}
      {activeShell && (
        <ShellDetailModal
          shell={activeShell}
          output={shellOutput}
          now={now}
          onClose={() => setModalShell(null)}
        />
      )}
      {activeMonitor && (
        <MonitorDetailModal
          monitor={activeMonitor}
          output={monitorOutput}
          now={now}
          onClose={() => setModalMonitor(null)}
        />
      )}
    </div>
  );
}

/** The center column's live view. Every session gets the Claude Code ⇄ Transcript switcher in `MiddleHeader`;
 *  `transcriptOn` (lifted to `Workspace`, threaded down here) drives which side shows: off is the Terminal
 *  — the live xterm for a running Managed session, else the ObservedTerminal panel (Fork shows whenever the
 *  agent's `canFork` capability is on, disabled with a coming-soon tooltip otherwise; Resume once Ended) —
 *  on is the Transcript, or the drilled Subagent surface when the drill-stack is non-empty. Drilling a lane
 *  auto-selects the Transcript side. A background shell opens in a modal instead (see WorkspaceBody), so it
 *  never touches this toggle. */
function CenterView({
  session: s,
  now,
  doc,
  subagentDoc,
  drill,
  onNavigate,
  dispatchDrill,
  canSpawn,
  onResume,
  onFork,
  onBeforeAutoResume,
  onAfterAutoResume,
  transcriptOn,
  setTranscriptOn,
}: {
  session: Session;
  now: number;
  doc: DocState;
  subagentDoc: DocState;
  drill: DrillCrumb[];
  onNavigate: (depth: number) => void;
  dispatchDrill: DispatchDrill;
  canSpawn: boolean;
  onResume: (id: string) => Promise<void>;
  onFork: (session: Session) => Promise<void>;
  onBeforeAutoResume?: (id: string) => void;
  onAfterAutoResume?: (id: string, draft?: Session) => void;
  transcriptOn: boolean;
  setTranscriptOn: (transcriptOn: boolean) => void;
}) {
  const { t } = useI18n();
  const top = drill[drill.length - 1];
  // The full subagent path, so the breadcrumb shows Session › A › B … instead of just the top.
  const subagentCrumbs = drill.map((c) => ({
    agentId: c.agentId,
    type: c.type,
    description: c.description,
  }));
  const drilledView = top ? (
    <SubagentDrill
      crumbs={subagentCrumbs}
      onNavigate={onNavigate}
      doc={subagentDoc}
      dispatchDrill={dispatchDrill}
      sessionId={s.id}
    />
  ) : null;
  const drilled = drill.length > 0;
  const drilledKey = top?.agentId;

  // Drilling into a Subagent always surfaces its transcript in the Work side of the toggle.
  useEffect(() => {
    if (drilledKey) setTranscriptOn(true);
  }, [drilledKey, setTranscriptOn]);

  const hasLiveTerminal = s.management === "managed" && s.state !== "ended";
  const caps = AGENTS[s.agent].capabilities;
  const terminalSlot = hasLiveTerminal ? (
    <TerminalView sessionId={s.id} />
  ) : caps.hasTranscript ? (
    <ObservedTerminal
      session={s}
      canSpawn={canSpawn}
      onResume={onResume}
      onFork={onFork}
    />
  ) : (
    <div className="flex h-full flex-col items-center justify-center gap-2 bg-ink-950 text-fg-faint">
      <AgentIcon agent={s.agent} size={26} className="opacity-60" />
      <p className="text-body">
        {t.workspace.emptyStates.sessionEndedTranscriptSoon}
      </p>
    </div>
  );

  return (
    <div className="h-full min-h-0">
      {!transcriptOn ? (
        <div className="h-full">{terminalSlot}</div>
      ) : drilled ? (
        drilledView
      ) : (
        <WorkView
          session={s}
          doc={doc}
          now={now}
          canSpawn={canSpawn}
          onFork={onFork}
          dispatchDrill={dispatchDrill}
          onBeforeAutoResume={onBeforeAutoResume}
          onAfterAutoResume={onAfterAutoResume}
        />
      )}
    </div>
  );
}

/** The scrolling transcript, shared by the Observed center and the Transcript side of the toggle
 *  (and each split-view pane's transcript side). */
export function RenderedTranscript({
  session: s,
  doc,
  dispatchDrill,
}: {
  session: Session;
  doc: DocState;
  dispatchDrill?: DispatchDrill;
}) {
  const readOnly = s.management === "observed";
  const { onOpen, modals } = useTranscriptModals(s.id);
  return (
    <OverlayScroll className="h-full">
      <TranscriptView
        doc={doc}
        state={s.state}
        readOnly={readOnly}
        dispatchDrill={dispatchDrill}
        onOpen={onOpen}
      />
      {modals}
    </OverlayScroll>
  );
}
