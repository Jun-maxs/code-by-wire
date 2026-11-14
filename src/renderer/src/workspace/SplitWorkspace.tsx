import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import type { Session } from "@shared/types";
import { AGENTS } from "@shared/agents";
import { useI18n } from "../i18n";
import { cx, Lamp } from "../ui/atoms";
import { Icon, type IconName } from "../ui/icons";
import { AgentIcon } from "../ui/agent-icons";
import { TerminalView } from "../terminal/TerminalView";
import { terminalStore } from "../terminal/terminal-store-instance";
import { useSessionTasks } from "../board/session-tasks";
import { MiddleHeader } from "../shell/MiddleHeader";
import { SessionMenu } from "../shell/SessionMenu";
import { SplitCandidates, type SplitNewSession } from "../shell/SplitControls";
import {
  paneLine,
  paneProgress,
  sessionDisplayTitle,
  splitColumns,
  type PaneLine,
  type StripTone,
} from "../shell/split-view";
import { ObservedTerminal } from "./ObservedTerminal";
import { WorkView } from "./WorkView";
import {
  $viewModes,
  resolveSessionViewMode,
  setSessionViewMode,
} from "./view-mode";
import { useTasks } from "./use-tasks";
import { useTranscript } from "./use-transcript";
import { useTurnActivity } from "./use-turn-activity";
import { PaneTaskCard } from "./PaneTaskCard";
import { useStore } from "@nanostores/react";
import { $accounts, sessionMarks } from "../settings/accounts-store";
import { SessionAccountMark } from "../settings/AccountBadge";
import { ClaudeAccountSwitch } from "../settings/ClaudeAccounts";

/** Marks a pane's own buttons, so pressing one doesn't first focus that pane. */
const PANE_ACTION = "data-pane-action";

/**
 * Fork (2026-11-02): the middle column as a grid of up to six sessions. Each pane is a slim
 * Workspace — a progress strip, a one-line title bar and the live terminal (or transcript) — with
 * no activity dock. The focused pane is the app's selected session: the header menu and the right
 * sidebar follow it. See docs/plans/2026-11-02-split-view.md.
 */
export function SplitWorkspace({
  panes,
  active,
  candidates,
  newSession,
  leading,
  canSpawnFor,
  onActivate,
  onRemove,
  onMaximize,
  onAdd,
  onResume,
  onFork,
  onEnd,
  onRename,
  onTogglePin,
  onBeforeAutoResume,
  onAfterAutoResume,
  leftEdgeExposed,
  rightEdgeExposed,
}: {
  /** The grid's sessions, in pane order (already resolved; never empty). */
  panes: Session[];
  /** The focused pane's session. */
  active: Session;
  /** Sessions an empty grid cell offers to add. */
  candidates: Session[];
  /** Start a new session in the focused pane's directory; it joins the grid. */
  newSession?: SplitNewSession;
  leading: ReactNode;
  canSpawnFor: (s: Session) => boolean;
  onActivate: (id: string) => void;
  onRemove: (id: string) => void;
  onMaximize: (id: string) => void;
  onAdd: (id: string) => void;
  onResume: (id: string) => Promise<void>;
  onFork: (session: Session) => Promise<void>;
  onEnd: (id: string) => void;
  onRename: (id: string, title: string | null) => void;
  onTogglePin: (id: string, pinned: boolean) => void;
  onBeforeAutoResume?: (id: string) => void;
  onAfterAutoResume?: (id: string, draft?: Session) => void;
  leftEdgeExposed: boolean;
  rightEdgeExposed: boolean;
}) {
  const gridRef = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);
  useLayoutEffect(() => {
    const el = gridRef.current;
    if (!el) return;
    setWidth(el.clientWidth);
    const ro = new ResizeObserver(() => setWidth(el.clientWidth));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  // Recomputed each render; App's 3s re-sync re-renders this, so the turn timers tick.
  const now = Date.now();
  const cols = splitColumns(panes.length, width);
  const rows = Math.ceil(panes.length / cols);
  const empty = cols * rows - panes.length;

  return (
    <div className="flex h-full min-w-0 flex-1 flex-col bg-ink-950 text-fg">
      <MiddleHeader
        title={active.title}
        session={active}
        split
        leading={leading}
        transcriptOn={false}
        onToggleTranscript={() => {}}
        onExitDrill={() => {}}
        drilled={false}
        leftEdgeExposed={leftEdgeExposed}
        rightEdgeExposed={rightEdgeExposed}
        menu={
          <SessionMenu
            session={active}
            canSpawn={canSpawnFor(active)}
            onResume={onResume}
            onFork={onFork}
            onEnd={onEnd}
            onRename={onRename}
            onTogglePin={onTogglePin}
          />
        }
      />
      <div
        ref={gridRef}
        className="grid min-h-0 flex-1 gap-px bg-ink-800"
        style={{
          gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))`,
          gridTemplateRows: `repeat(${rows}, minmax(0, 1fr))`,
        }}
      >
        {panes.map((s) => (
          <SplitPane
            key={s.id}
            session={s}
            active={s.id === active.id}
            canSpawn={canSpawnFor(s)}
            canRemove={panes.length > 1}
            onActivate={onActivate}
            onRemove={onRemove}
            onMaximize={onMaximize}
            onResume={onResume}
            onFork={onFork}
            onBeforeAutoResume={onBeforeAutoResume}
            onAfterAutoResume={onAfterAutoResume}
            now={now}
          />
        ))}
        {empty > 0 && (
          <EmptyCell
            span={empty}
            candidates={candidates}
            onAdd={onAdd}
            newSession={newSession}
          />
        )}
      </div>
    </div>
  );
}

function SplitPane({
  session: s,
  active,
  canSpawn,
  canRemove,
  onActivate,
  onRemove,
  onMaximize,
  onResume,
  onFork,
  onBeforeAutoResume,
  onAfterAutoResume,
  now,
}: {
  session: Session;
  active: boolean;
  canSpawn: boolean;
  canRemove: boolean;
  onActivate: (id: string) => void;
  onRemove: (id: string) => void;
  onMaximize: (id: string) => void;
  onResume: (id: string) => Promise<void>;
  onFork: (session: Session) => Promise<void>;
  onBeforeAutoResume?: (id: string) => void;
  onAfterAutoResume?: (id: string, draft?: Session) => void;
  now: number;
}) {
  const { t } = useI18n();
  const ref = useRef<HTMLElement>(null);
  const hasLiveTerminal = s.management === "managed" && s.state !== "ended";
  const caps = AGENTS[s.agent].capabilities;
  const modes = useStore($viewModes);
  const viewMode = resolveSessionViewMode(s, modes, caps.hasTranscript);
  const workOn = viewMode === "work";

  const tasks = useTasks(s.id);
  const boardTask = useSessionTasks()?.taskOf(s.id);
  const progress = paneProgress(tasks, boardTask);
  // Only Claude and Antigravity read native turn activity (an ended one reads once, then sits
  // on its unchanged token — the task card still lists its history).
  const activity = useTurnActivity(
    s.id,
    s.agent === "claude" || s.agent === "agy",
  );
  const line = paneLine(s, progress, activity, now, t);
  // Fork (2026-11-03): which account the pane runs on, once there are two to tell apart — and, as a
  // button, where this pane alone moves to another account.
  const accounts = useStore($accounts);
  const marks = sessionMarks(accounts, s);

  // Focused from elsewhere (Ctrl+Tab, the sidebar, DeskTidy's island): put the keyboard in this pane's terminal.
  const showsTerminal = !workOn && hasLiveTerminal;
  useEffect(() => {
    if (!active || !showsTerminal) return;
    if (ref.current?.contains(document.activeElement)) return;
    terminalStore.get(s.id)?.term.focus();
  }, [active, showsTerminal, s.id]);

  const activate = (target: EventTarget | null) => {
    if (active) return;
    if (target instanceof Element && target.closest(`[${PANE_ACTION}]`)) return;
    onActivate(s.id);
  };

  const body = workOn ? (
    <PaneWork
      session={s}
      now={now}
      canSpawn={canSpawn}
      onFork={onFork}
      onBeforeAutoResume={onBeforeAutoResume}
      onAfterAutoResume={onAfterAutoResume}
    />
  ) : hasLiveTerminal ? (
    <TerminalView sessionId={s.id} autoFocus={active} />
  ) : caps.hasTranscript ? (
    <ObservedTerminal
      session={s}
      canSpawn={canSpawn}
      onResume={onResume}
      onFork={onFork}
    />
  ) : (
    <div className="flex h-full flex-col items-center justify-center gap-2 bg-ink-950 text-fg-faint">
      <AgentIcon agent={s.agent} size={22} className="opacity-60" />
      <p className="text-aux">
        {t.workspace.emptyStates.sessionEndedTranscriptSoon}
      </p>
    </div>
  );

  return (
    <section
      ref={ref}
      aria-label={s.title}
      onMouseDownCapture={(e) => activate(e.target)}
      onFocusCapture={(e) => activate(e.target)}
      className="group/pane @container/pane flex min-h-0 min-w-0 flex-col overflow-hidden bg-ink-950"
    >
      <ProgressStrip line={line} />
      <header
        className={cx(
          "flex h-7 shrink-0 items-center gap-2 border-b border-(--ui-stroke-tertiary) pl-2 pr-1",
          active ? "bg-ink-900" : "bg-ink-950",
        )}
      >
        <span className="grid size-3.5 shrink-0 place-items-center">
          <Lamp state={s.state} management={s.management} />
        </span>
        {marks && (
          <span className="flex shrink-0" {...{ [PANE_ACTION]: "" }}>
            <ClaudeAccountSwitch
              session={s}
              compact
              mark={
                <SessionAccountMark marks={marks} ended={s.state === "ended"} />
              }
            />
          </span>
        )}
        <PaneTaskCard
          session={s}
          activity={activity}
          todos={tasks}
          boardTask={boardTask}
          now={now}
        >
          {s.agent !== "claude" && (
            <AgentIcon agent={s.agent} size={12} className="shrink-0" />
          )}
          <span
            className={cx(
              "min-w-0 flex-1 truncate text-aux font-medium",
              active ? "text-fg" : "text-fg-muted",
            )}
          >
            {sessionDisplayTitle(s, t)}
          </span>
          {line.doing && (
            <span className="hidden shrink-0 text-meta text-fg-faint @min-[36rem]/pane:inline @min-[36rem]/pane:max-w-36 @min-[36rem]/pane:truncate">
              {line.doing}
            </span>
          )}
          {line.meta && (
            <span className="hidden shrink-0 font-mono text-meta tabular-nums text-fg-faint @min-[28rem]/pane:inline">
              {line.meta}
            </span>
          )}
        </PaneTaskCard>
        {caps.hasTranscript && (
          <div
            role="group"
            aria-label={t.shell.middleHeader.viewGroupLabel}
            {...{ [PANE_ACTION]: "" }}
            className="flex shrink-0 items-center rounded-xs bg-[color-mix(in_srgb,var(--color-fg)_5%,transparent)] p-[1px]"
          >
            <button
              type="button"
              aria-pressed={!workOn}
              title={t.shell.split.showCli}
              onClick={() => setSessionViewMode(s.id, "cli")}
              className={cx(
                "inline-flex h-5 items-center gap-1 rounded-[2px] px-1.5 text-meta font-medium transition-colors duration-100",
                !workOn
                  ? "bg-ink-700 text-fg"
                  : "text-fg-faint hover:bg-(--ui-control-hover-background) hover:text-fg",
              )}
            >
              <Icon name="square-terminal" size={10} />
              <span>{t.shell.split.cli}</span>
            </button>
            <button
              type="button"
              aria-pressed={workOn}
              title={t.shell.split.showWork}
              onClick={() => setSessionViewMode(s.id, "work")}
              className={cx(
                "inline-flex h-5 items-center gap-1 rounded-[2px] px-1.5 text-meta font-medium transition-colors duration-100",
                workOn
                  ? "bg-ink-700 text-fg"
                  : "text-fg-faint hover:bg-(--ui-control-hover-background) hover:text-fg",
              )}
            >
              <Icon name="list-tree" size={10} />
              <span>{t.shell.split.work}</span>
            </button>
          </div>
        )}
        <div
          className={cx(
            "flex shrink-0 items-center transition-opacity duration-100",
            active
              ? "opacity-100"
              : "opacity-0 focus-within:opacity-100 group-hover/pane:opacity-100",
          )}
        >
          <PaneAction
            icon="maximize"
            label={t.shell.split.maximize}
            onClick={() => onMaximize(s.id)}
          />
          {canRemove && (
            <PaneAction
              icon="x"
              label={t.shell.split.remove}
              onClick={() => onRemove(s.id)}
            />
          )}
        </div>
      </header>
      <div className="min-h-0 flex-1">{body}</div>
    </section>
  );
}

const STRIP_FILL: Record<StripTone, string> = {
  accent: "bg-accent",
  working: "bg-working",
  ok: "bg-ok",
  neutral: "bg-fg/40",
};

/** The 3px strip along a pane's top edge (see paneLine): a measured fill when the session keeps a
 *  list; else a segment gliding along the track while it works (held still under reduced motion),
 *  or a full band in its state color. */
function ProgressStrip({ line }: { line: PaneLine }) {
  const width = line.indeterminate
    ? 35
    : line.pct === null
      ? 100
      : Math.round(line.pct * 100);
  return (
    <div
      role="progressbar"
      aria-label={line.label}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={line.pct === null ? undefined : Math.round(line.pct * 100)}
      className="h-[3px] shrink-0 overflow-hidden bg-ink-850"
    >
      <div
        className={cx(
          "h-full",
          STRIP_FILL[line.tone],
          line.indeterminate &&
            "animate-strip-slide motion-reduce:animate-none",
        )}
        style={{ width: `${width}%` }}
      />
    </div>
  );
}

function PaneAction({
  icon,
  label,
  onClick,
}: {
  icon: IconName;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      {...{ [PANE_ACTION]: "" }}
      aria-label={label}
      title={label}
      onClick={onClick}
      className="grid size-5 place-items-center rounded-xs text-fg-faint transition-colors duration-100 hover:bg-(--ui-control-hover-background) hover:text-fg hover:transition-none"
    >
      <Icon name={icon} size={13} />
    </button>
  );
}

/** A pane's Work view side; mounted only while shown, so CLI panes don't poll their transcript. */
function PaneWork({
  session,
  now,
  canSpawn,
  onFork,
  onBeforeAutoResume,
  onAfterAutoResume,
}: {
  session: Session;
  now: number;
  canSpawn: boolean;
  onFork: (session: Session) => Promise<void>;
  onBeforeAutoResume?: (id: string) => void;
  onAfterAutoResume?: (id: string, draft?: Session) => void;
}) {
  const doc = useTranscript(session.id);
  return (
    <WorkView
      session={session}
      doc={doc}
      now={now}
      canSpawn={canSpawn}
      compactPane
      onFork={onFork}
      onBeforeAutoResume={onBeforeAutoResume}
      onAfterAutoResume={onAfterAutoResume}
    />
  );
}

/** The grid's leftover cell(s): the add list in place, so a 5-pane grid's sixth slot is useful. */
function EmptyCell({
  span,
  candidates,
  onAdd,
  newSession,
}: {
  span: number;
  candidates: Session[];
  onAdd: (id: string) => void;
  newSession?: SplitNewSession;
}) {
  const { t } = useI18n();
  return (
    <div
      className="flex min-h-0 min-w-0 flex-col bg-ink-950"
      style={{ gridColumn: `span ${span}` }}
    >
      <p className="flex h-[31px] shrink-0 items-center border-b border-(--ui-stroke-tertiary) px-3 text-aux text-fg-faint">
        {t.shell.split.addTitle}
      </p>
      <div className="min-h-0 flex-1 overflow-y-auto p-1">
        <SplitCandidates
          sessions={candidates}
          onPick={onAdd}
          newSession={newSession}
        />
      </div>
    </div>
  );
}
