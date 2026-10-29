import { MAX_SESSION_TITLE_LEN } from "@shared/title-override";
import type { Session } from "@shared/types";
import { cx, Lamp } from "../ui/atoms";
import { Icon } from "../ui/icons";
import { AgentIcon } from "../ui/agent-icons";
import { agentOrDefault } from "@shared/agents";
import { useSessionTasks } from "../board/session-tasks";
import { useI18n } from "../i18n";
import { useSessionMenu } from "./use-session-menu";
import { SessionMenuDropdown } from "./SessionMenuDropdown";
import { useSessionProduct } from "../products/products-context";
import { isUnsentSession } from "./session-list-model";
import { ProductHoverCard } from "../products/ProductHoverCard";
import { shortTopicName } from "@shared/products";
import { formatAgeShort } from "@shared/format";

/**
 * The hermes single-line sidebar row: a 26px-tall strip with a state `Lamp` and the title. A
 * hover-revealed 3-dot button opens the same menu as the session header's title menu (Copy ID,
 * Rename, Resume, Fork, End, Open in), sharing its state machine via `useSessionMenu` — see
 * `SessionMenu.tsx` for the header's own trigger over the same hook. Renaming swaps this row's
 * select-button for a plain (non-button) container so the inline `<input>` never nests inside a
 * `<button>`, which HTML disallows. A short last-activity age follows the title (fork); the
 * context-% chip lives in the right sidebar's Session panel. The dimmed worktree hint shows on leaf
 * sessions that merged into their repo's folder (2026-07-09 worktree-merge spec). Trailing controls appear in
 * this order: subagent count, disclosure, then role/agent/actions. Actions replace the role badge
 * or agent in its slot while revealed, keeping every other element stationary.
 */
export function SessionRow({
  session,
  selected,
  onSelect,
  canSpawn,
  onResume,
  onFork,
  onEnd,
  onRename,
  onTogglePin,
  showAgentIcon = true,
  depth = 0,
  descendantCount = 0,
  activeDescendantCount = 0,
  childrenExpanded = false,
  onToggleChildren,
  hideProduct = false,
  snippet,
}: {
  session: Session;
  selected: boolean;
  onSelect: () => void;
  canSpawn: boolean;
  onResume: (id: string) => Promise<void>;
  onFork: (session: Session) => Promise<void>;
  onEnd: (id: string) => void;
  onRename: (id: string, title: string | null) => void;
  onTogglePin: (id: string, pinned: boolean) => void;
  showAgentIcon?: boolean;
  depth?: number;
  descendantCount?: number;
  activeDescendantCount?: number;
  childrenExpanded?: boolean;
  onToggleChildren?: () => void;
  /** The sidebar already groups by topic, so the title needn't repeat the topic's name. */
  hideProduct?: boolean;
  /** Fork: where a sidebar search matched this session's conversation, shown under the title. */
  snippet?: string;
}) {
  const { t } = useI18n();
  const menu = useSessionMenu(session, canSpawn, {
    onResume,
    onFork,
    onEnd,
    onRename,
    onTogglePin,
  });
  // Fork feature: which product this session is about (workbench cards) — a color dot before the
  // title and a hover card with the product's domain and progress.
  const product = useSessionProduct(session);
  const displayTitle = isUnsentSession(session)
    ? t.shell.sessionRow.unsentTitle
    : session.title;
  const hasChildren = descendantCount > 0 && onToggleChildren !== undefined;
  const cappedDepth = Math.min(depth, 2);
  const rowStyle =
    cappedDepth > 0 ? { marginLeft: `${cappedDepth * 12}px` } : undefined;

  const task = useSessionTasks()?.taskOf(session.id);
  const now = Date.now();
  if (menu.editing) {
    return (
      <div
        style={rowStyle}
        className="flex min-h-[1.625rem] min-w-0 items-center gap-1.5 rounded-md py-0.5 pl-2 pr-2"
      >
        <span className="grid size-3.5 shrink-0 place-items-center">
          <Lamp state={session.state} management={session.management} />
        </span>
        <input
          ref={menu.renameField.inputRef}
          aria-label={t.shell.sessionMenu.renameFieldLabel}
          value={menu.renameField.value}
          maxLength={MAX_SESSION_TITLE_LEN}
          onChange={menu.renameField.onChange}
          onBlur={menu.renameField.onBlur}
          onKeyDown={menu.renameField.onKeyDown}
          className="h-5 min-w-0 flex-1 rounded-xs border border-(--ui-stroke-tertiary) bg-(--ui-control-active-background) px-1.5 text-body text-fg outline-none"
        />
      </div>
    );
  }

  // The action trigger reveals on hover, keyboard focus inside the row, or while its menu is open.
  // Actions replace the role badge or agent in the same slot, keeping the disclosure stationary.
  // group-has-[:focus-visible] (not group-focus-within) means a plain click does not leave the row
  // stuck revealed.
  const reveal =
    "group-hover:pointer-events-auto group-hover:opacity-100 group-has-[:focus-visible]:pointer-events-auto group-has-[:focus-visible]:opacity-100";
  const trailingContentVisibility = menu.open
    ? "opacity-0"
    : "opacity-100 group-hover:opacity-0 group-has-[:focus-visible]:opacity-0";
  const threadKindLabel = session.threadKind
    ? t.shell.sessionRow.threadKind[session.threadKind]
    : null;
  return (
    <ProductHoverCard product={product}>
      <div
        style={rowStyle}
        className={cx(
          "group relative flex min-h-[1.625rem] min-w-0 items-center gap-1 rounded-md transition-colors duration-100 ease-out hover:transition-none",
          selected && "rounded-md bg-(--ui-row-active-background)",
          !selected && "hover:bg-(--ui-row-hover-background)",
        )}
      >
        {depth > 0 && (
          <span
            aria-hidden
            className="pointer-events-none absolute -left-1.5 top-0 h-1/2 w-2 border-b border-l border-(--ui-stroke-tertiary)"
          />
        )}
        <button
          type="button"
          onClick={onSelect}
          onContextMenu={(event) => {
            event.preventDefault();
            menu.openAt(event.clientX, event.clientY);
          }}
          aria-pressed={selected}
          aria-label={t.shell.sessionRow.openSession(session.title)}
          className={cx(
            "flex min-h-[1.625rem] min-w-0 flex-1 cursor-pointer items-center gap-1.5 rounded-md py-0.5 pl-2 text-left",
          )}
        >
          <span className="grid size-3.5 shrink-0 place-items-center">
            <Lamp state={session.state} management={session.management} />
          </span>
          <span
            className={cx(
              "min-w-0 flex-1 truncate text-body leading-none text-fg-muted group-hover:text-fg",
              selected && "text-fg",
            )}
            title={product ? `${product.name} · ${displayTitle}` : displayTitle}
          >
            {/* Fork feature: the topic's name leads the title, in its color, so parallel
             *  sessions on different products read apart at a glance. */}
            {product && !hideProduct && (
              <span className="font-medium" style={{ color: product.color }}>
                {shortTopicName(product.name)}
                <span className="text-fg-dim"> · </span>
              </span>
            )}
            {displayTitle}
          </span>
          {/* Fork change (2026-10-29): how long since the session last moved, so stale ones read
           *  apart without opening the right sidebar. The past hour reads a step brighter. */}
          {session.lastActivityMs > 0 && (
            <span
              className={cx(
                "shrink-0 text-meta leading-none tabular-nums",
                now - session.lastActivityMs < 3_600_000
                  ? "text-fg-muted"
                  : "text-fg-dim",
              )}
              title={t.time.ago(session.lastActivityMs, now)}
            >
              {formatAgeShort(session.lastActivityMs, now)}
            </span>
          )}
          {session.remote && (
            <span
              className="shrink-0 text-fg-dim"
              title={t.shell.newSession.remoteHint}
            >
              <Icon name="smartphone" size={11} />
            </span>
          )}
          {hasChildren && (
            <span
              className={cx(
                "shrink-0 text-meta tabular-nums text-fg-dim",
                activeDescendantCount > 0 && "text-primary",
              )}
              title={t.shell.sessionRow.subagentCount(
                descendantCount,
                activeDescendantCount,
              )}
            >
              {descendantCount}
            </span>
          )}
          {!hasChildren && session.worktree && (
            <span
              className={cx(
                "flex min-w-0 shrink-[2] items-center gap-1 text-meta leading-none text-fg-dim",
                "group-hover:hidden group-has-[:focus-visible]:hidden",
                menu.open && "hidden",
              )}
            >
              <Icon name="worktree" size={10} className="shrink-0" />
              <span className="truncate">{session.worktree.name}</span>
            </span>
          )}
        </button>
        {hasChildren && (
          <button
            type="button"
            onClick={(event) => {
              event.stopPropagation();
              onToggleChildren();
            }}
            aria-expanded={childrenExpanded}
            aria-label={
              childrenExpanded
                ? t.shell.sessionRow.collapseSubagents(descendantCount)
                : t.shell.sessionRow.expandSubagents(descendantCount)
            }
            className="grid size-5 shrink-0 cursor-pointer place-items-center rounded-sm text-fg-dim hover:bg-(--ui-control-hover-background) hover:text-fg"
          >
            <Icon
              name="chevron-right"
              size={13}
              className={cx(
                "transition-transform",
                childrenExpanded && "rotate-90",
              )}
            />
          </button>
        )}
        <div
          ref={menu.rootRef}
          className={cx(
            "relative mr-1 flex h-5 shrink-0 items-center justify-end",
            !threadKindLabel && "w-5",
          )}
        >
          {threadKindLabel ? (
            <span
              className={cx(
                "shrink-0 rounded-sm bg-(--ui-control-active-background) px-1 py-0.5 text-tiny leading-none text-fg-dim transition-opacity duration-100",
                trailingContentVisibility,
              )}
              title={threadKindLabel}
            >
              {threadKindLabel}
            </span>
          ) : // Only agents other than the default get a mark (fork, 2026-10-28): a Claude mark on every
          // row said nothing and drowned the state marks.
          // A session on a board task shows the board mark there instead (fork, 2026-10-28).
          showAgentIcon && session.agent !== agentOrDefault(undefined) ? (
            <span
              aria-hidden
              className={cx(
                "pointer-events-none grid size-5 place-items-center transition-opacity duration-100",
                trailingContentVisibility,
              )}
            >
              <AgentIcon agent={session.agent} size={13} />
            </span>
          ) : task ? (
            <span
              aria-hidden
              className={cx(
                "pointer-events-none grid size-5 place-items-center text-fg-dim transition-opacity duration-100",
                trailingContentVisibility,
              )}
            >
              <Icon name="square-kanban" size={12} />
            </span>
          ) : null}
          <button
            type="button"
            onClick={() => menu.toggleMenu()}
            aria-label={t.shell.sessionRow.sessionActions}
            aria-expanded={menu.open}
            aria-haspopup="menu"
            className={cx(
              "pointer-events-none absolute right-0 top-0 grid size-5 cursor-pointer place-items-center rounded-sm text-fg-dim opacity-0 transition-opacity duration-100 ease-out hover:bg-(--ui-control-hover-background) hover:text-fg focus-visible:pointer-events-auto focus-visible:opacity-100",
              reveal,
              menu.open &&
                "pointer-events-auto opacity-100 bg-(--ui-control-active-background) text-fg",
            )}
          >
            <Icon name="ellipsis" size={13} />
          </button>
        </div>
        <SessionMenuDropdown session={session} menu={menu} />
      </div>
      {snippet && (
        <p
          className="truncate pb-1 pl-7.5 pr-2 text-meta leading-snug text-fg-dim"
          style={rowStyle}
          title={snippet}
        >
          {snippet}
        </p>
      )}
    </ProductHoverCard>
  );
}
