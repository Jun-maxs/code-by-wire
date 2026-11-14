import type { ReactNode } from "react";
import { SiblingTabs } from "./SiblingTabs";
import type { Session } from "@shared/types";
import { isMacPlatform } from "@shared/platform";
import { AGENTS } from "@shared/agents";
import { cx, ScrollHintShadow } from "../ui/atoms";
import { Icon } from "../ui/icons";
import { useFullscreen } from "../ui/use-fullscreen";
import { useI18n } from "../i18n";
import { stripInlineCode } from "@shared/board";
import { useSessionTasks } from "../board/session-tasks";
import { InlineCodeText, STATUS_BG } from "../board/parts";
import { headerRightPaddingPx, titlebarContentInsetPx } from "./titlebar";
import { viewToggleShortcutLabel } from "../workspace/view-mode";

/**
 * The middle column's own in-column header: a draggable strip that carries the active session's
 * menu — name and chevron, bundled in `SessionMenu` and passed in as
 * `menu` — or a plain title when there's no session, plus the Claude Code ⇄ Transcript view switcher. The
 * sidebar toggles live in the fixed `TitlebarControls` clusters, NOT here — nothing in this header
 * mounts or unmounts when a pane toggles.
 *
 * Both paddings snap (hermes behavior — no transition): they change in the same frame as the
 * pane's grid track, so the title reflows exactly once, in sync with the sidebar. When the left
 * pane is docked, its own strip covers the traffic lights and the left cluster, so 14px suffices;
 * when it isn't, this header is the visual left edge and insets past lights + cluster. The right
 * padding mirrors that for the right cluster, which only floats over this header while a session
 * exists and the right pane isn't docked.
 */
export function MiddleHeader({
  title,
  session,
  transcriptOn,
  onToggleTranscript,
  onExitDrill,
  drilled,
  leftEdgeExposed,
  rightEdgeExposed,
  menu,
  leading,
  split = false,
}: {
  title: string;
  session: Session | null;
  transcriptOn: boolean;
  onToggleTranscript: () => void;
  /** Clears any active subagent drill. Called when the user explicitly leaves the Transcript side via
   *  "Claude Code", so returning to Transcript later always shows the main session, never a stale drill. */
  onExitDrill: () => void;
  /** True while a subagent drill is showing its own copy of this header's bottom shadow, directly
   *  under its breadcrumb bar — suppresses this one so the two don't stack over the breadcrumb. */
  drilled: boolean;
  /** True whenever the left pane isn't actually docked next to this header — closed by the user,
   *  or force-collapsed by a narrow window. Rendered state, not the stored preference. */
  leftEdgeExposed: boolean;
  /** Same, for the right pane. Only matters while a session exists (the right cluster is hidden
   *  otherwise). */
  rightEdgeExposed: boolean;
  menu: ReactNode;
  /** Fork (2026-11-02): the Single ⇄ Split layout switch, at the very left of a session header. */
  leading?: ReactNode;
  /** Split view: each pane carries its own terminal ⇄ transcript toggle and the grid already shows
   *  the other sessions, so the header drops its view switch and topic tabs. */
  split?: boolean;
}) {
  const { t } = useI18n();
  const isMac = isMacPlatform(window.api.platform);
  const isFullscreen = useFullscreen();
  const paddingLeft = leftEdgeExposed
    ? titlebarContentInsetPx(isMac, isFullscreen)
    : 12;
  const paddingRight = headerRightPaddingPx(
    Boolean(session) && rightEdgeExposed,
  );
  // The live in-app terminal (Workspace's TerminalView, via terminal/xterm-factory.ts) is the one
  // panel below this header whose background follows Terminal theme instead of App theme — every
  // other case below (Transcript, ObservedTerminal, or no session) stays on this header's own
  // --ui-chat-surface-background, so fading to transparent there is already correct. Mirrors
  // Workspace.tsx's own hasLiveTerminal check (management === "managed" && state !== "ended").
  const terminalBelow =
    split ||
    (!transcriptOn &&
      session !== null &&
      session.management === "managed" &&
      session.state !== "ended");

  return (
    <>
      <header
        className={cx(
          "drag-region relative flex shrink-0 select-none items-center gap-3 overflow-hidden border-b border-(--ui-stroke-tertiary) bg-(--ui-chat-surface-background)",
          isMac && "title-bar",
        )}
        style={{ height: "var(--titlebar-height)", paddingLeft, paddingRight }}
      >
        {session ? (
          <>
            {leading}
            {menu}
            {!transcriptOn && <TaskChip sessionId={session.id} />}
            {!split && <SiblingTabs session={session} />}
          </>
        ) : (
          <span className="truncate text-aux font-medium leading-none text-fg-muted">
            {title}
          </span>
        )}
        <div className="no-drag ml-auto flex shrink-0 items-center gap-2">
          {session && !split && (
            <div
              role="group"
              aria-label={t.shell.middleHeader.viewGroupLabel}
              className="flex shrink-0 items-center rounded-sm border border-(--ui-stroke-tertiary) bg-[color-mix(in_srgb,var(--color-fg)_5%,transparent)] p-[2px]"
            >
              <ViewSegment
                icon={<Icon name="square-terminal" size={12} />}
                label={t.shell.middleHeader.cli}
                active={!transcriptOn}
                title={t.shell.middleHeader.toggleViewHint(
                  viewToggleShortcutLabel(isMac),
                )}
                onSelect={() => {
                  if (transcriptOn) {
                    onToggleTranscript();
                    onExitDrill();
                  }
                }}
              />
              <ViewSegment
                icon={<Icon name="list-tree" size={12} />}
                label={t.shell.middleHeader.work}
                active={transcriptOn}
                disabled={!AGENTS[session.agent].capabilities.hasTranscript}
                title={
                  AGENTS[session.agent].capabilities.hasTranscript
                    ? t.shell.middleHeader.toggleViewHint(
                        viewToggleShortcutLabel(isMac),
                      )
                    : t.common.comingSoon
                }
                onSelect={() => {
                  if (!transcriptOn) onToggleTranscript();
                }}
              />
            </div>
          )}
        </div>
      </header>
      {/* Suppressed while drilled (the subagent breadcrumb shows its own copy one level lower) AND
       *  while a live terminal is below: that's a bounded panel, not scrolling text, so it doesn't
       *  need the scroll-edge hint, and the header's own border-b already separates it cleanly.
       *  Rendering it there previously reintroduced App-theme color into a Terminal-themed area (see
       *  git history: 62e4401 and its follow-up both tried blending/recoloring this shadow for the
       *  terminal case before landing on simply not rendering it there at all). */}
      {!drilled && !terminalBelow && <ScrollHintShadow />}
    </>
  );
}

/** One segment of the header's view switcher: icon + label, `aria-pressed` for the active side.
 *  Active gets the control-active fill; inactive is quiet text that brightens on hover. Clicking
 *  the active segment is a no-op (the caller's `onSelect` guard). `disabled` (with a `title`
 *  tooltip) is for a Transcript segment on an agent with no transcript capability. */
export function ViewSegment({
  icon,
  label,
  active,
  onSelect,
  disabled,
  title,
}: {
  icon: ReactNode;
  label: string;
  active: boolean;
  onSelect: () => void;
  disabled?: boolean;
  title?: string;
}) {
  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={onSelect}
      disabled={disabled}
      title={title}
      className={cx(
        "flex h-4 items-center gap-1.5 rounded-xs px-2 text-meta font-medium leading-none transition-colors duration-100",
        active
          ? "bg-(--ui-control-active-background) text-fg"
          : "text-fg-faint hover:text-fg",
        disabled && "cursor-not-allowed opacity-40 hover:text-fg-faint",
      )}
    >
      {icon}
      {label}
    </button>
  );
}

/** The board task this session belongs to (fork, 2026-10-28); click to open it on the board. */
function TaskChip({ sessionId }: { sessionId: string }) {
  const { t } = useI18n();
  const tasks = useSessionTasks();
  const task = tasks?.taskOf(sessionId);
  if (!tasks || !task) return null;
  return (
    <button
      type="button"
      onClick={() => tasks.openTask(task.id)}
      title={`${t.shell.sessionMenu.openTask}：${stripInlineCode(task.title)}`}
      className="no-drag hidden h-5 min-w-0 max-w-52 shrink-[2] items-center gap-1.5 rounded-sm bg-ink-900 px-1.5 text-meta text-fg-muted transition-colors hover:bg-ink-800 hover:text-fg xl:inline-flex"
    >
      <span
        aria-hidden
        className={cx("size-1.5 shrink-0 rounded-full", STATUS_BG[task.status])}
      />
      <span className="truncate">
        <InlineCodeText text={task.title} />
      </span>
    </button>
  );
}
