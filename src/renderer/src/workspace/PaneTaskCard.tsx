import { useEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import type { Session, Task } from "@shared/types";
import type { BoardTask } from "@shared/board";
import type { TurnActivity } from "@shared/turn-activity";
import { formatAgeShort } from "@shared/format";
import { cx } from "../ui/atoms";
import { useI18n } from "../i18n";
import { paneTaskGroups, type PaneTaskItem } from "../shell/split-view";

const OPEN_DELAY_MS = 300;
const CARD_WIDTH = 360;
/** Rows shown per group before "N more". */
const GROUP_LIMIT = { now: 3, queued: 5, done: 8 };

/**
 * Fork (2026-11-02): hovering a split pane's title line shows its task list — what is under way,
 * what is queued, and what is done. Portaled with fixed positioning (the pane clips) and
 * pointer-transparent, so it never takes the clicks meant for the pane under it.
 */
export function PaneTaskCard({
  session,
  activity,
  todos,
  boardTask,
  now,
  children,
}: {
  session: Session;
  activity: TurnActivity | null | undefined;
  todos: Task[] | null | undefined;
  boardTask: BoardTask | undefined;
  now: number;
  children: ReactNode;
}) {
  const anchor = useRef<HTMLDivElement>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [pos, setPos] = useState<{
    left: number;
    top: number;
    width: number;
  } | null>(null);
  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );
  const show = (): void => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      // The header row, so the card lines up under the whole title bar.
      const r = anchor.current?.closest("header")?.getBoundingClientRect();
      if (!r) return;
      const width = Math.min(CARD_WIDTH, window.innerWidth - 16);
      setPos({
        left: Math.max(8, Math.min(r.left + 8, window.innerWidth - width - 8)),
        top: r.bottom + 4,
        width,
      });
    }, OPEN_DELAY_MS);
  };
  const hide = (): void => {
    if (timer.current) clearTimeout(timer.current);
    setPos(null);
  };
  return (
    <div
      ref={anchor}
      onMouseEnter={show}
      onMouseLeave={hide}
      onMouseDown={hide}
      className="flex min-w-0 flex-1 items-center gap-2"
    >
      {children}
      {pos &&
        createPortal(
          <div
            role="tooltip"
            style={{ left: pos.left, top: pos.top, width: pos.width }}
            className="pointer-events-none fixed z-50 max-h-[calc(100vh-6rem)] overflow-hidden rounded-lg border border-ink-800 bg-ink-900 px-3 py-2.5 text-aux leading-snug text-fg-muted shadow-(--shadow-md)"
          >
            <CardBody
              session={session}
              activity={activity}
              todos={todos}
              boardTask={boardTask}
              now={now}
            />
          </div>,
          document.body,
        )}
    </div>
  );
}

function CardBody({
  session: s,
  activity,
  todos,
  boardTask,
  now,
}: {
  session: Session;
  activity: TurnActivity | null | undefined;
  todos: Task[] | null | undefined;
  boardTask: BoardTask | undefined;
  now: number;
}) {
  const { t } = useI18n();
  const tx = t.shell.split;
  const groups = paneTaskGroups(s, activity, todos);
  const empty =
    groups.now.length + groups.queued.length + groups.done.length === 0;
  const subtasks = boardTask?.subtasks ?? [];
  const nowMarker = s.state === "waiting" ? "text-accent" : "text-working";
  const tool = activity?.lastTool
    ? activity.lastTool.target || activity.lastTool.name
    : "";
  const figures = (item: PaneTaskItem, live: boolean): string => {
    if (item.kind !== "prompt") return "";
    const parts: string[] = [];
    if (item.steps) parts.push(tx.steps(item.steps));
    const end = live ? now : item.endMs;
    if (item.startMs && end) parts.push(t.time.duration(end - item.startMs));
    if (!live && item.endMs) parts.push(formatAgeShort(item.endMs, now));
    return parts.join(" · ");
  };
  return (
    <>
      <p className="mb-1.5 truncate text-body font-medium text-fg">{s.title}</p>
      {empty && <p className="text-fg-dim">{tx.tasksNone}</p>}
      <Group
        label={tx.tasksNow}
        items={groups.now}
        limit={GROUP_LIMIT.now}
        render={(item) => (
          <Row
            marker="●"
            markerTone={nowMarker}
            text={item.text}
            adds={item.adds}
            figures={figures(item, true)}
            sub={
              item.kind === "prompt"
                ? s.state === "waiting"
                  ? [tx.waiting, tool].filter(Boolean).join(" · ")
                  : tool
                : undefined
            }
          />
        )}
      />
      <Group
        label={tx.tasksQueued}
        items={groups.queued}
        limit={GROUP_LIMIT.queued}
        render={(item) => (
          <Row marker="○" markerTone="text-fg-dim" text={item.text} />
        )}
      />
      <Group
        label={tx.tasksDone}
        items={groups.done}
        limit={GROUP_LIMIT.done}
        render={(item) => (
          <Row
            marker="✓"
            markerTone="text-ok"
            text={item.text}
            adds={item.adds}
            textTone="text-fg-faint"
            figures={figures(item, false)}
          />
        )}
      />
      {boardTask && subtasks.length > 0 && (
        <p className="mt-2 truncate border-t border-(--ui-stroke-tertiary) pt-1.5 text-meta text-fg-dim">
          {tx.boardTask(
            boardTask.title,
            subtasks.filter((x) => x.done).length,
            subtasks.length,
          )}
        </p>
      )}
    </>
  );
}

function Group({
  label,
  items,
  limit,
  render,
}: {
  label: string;
  items: PaneTaskItem[];
  limit: number;
  render: (item: PaneTaskItem) => ReactNode;
}) {
  const { t } = useI18n();
  if (items.length === 0) return null;
  return (
    <section className="mt-1.5 first-of-type:mt-0">
      <p className="mb-0.5 text-meta text-fg-dim">
        {label}
        {items.length > 1 && (
          <span className="ml-1 font-mono tabular-nums">{items.length}</span>
        )}
      </p>
      <ul className="space-y-0.5">
        {items.slice(0, limit).map((item, i) => (
          <li key={`${item.kind}-${i}`}>{render(item)}</li>
        ))}
      </ul>
      {items.length > limit && (
        <p className="pl-4 text-meta text-fg-dim">
          {t.shell.split.tasksMore(items.length - limit)}
        </p>
      )}
    </section>
  );
}

function Row({
  marker,
  markerTone,
  text,
  textTone = "text-fg-muted",
  figures,
  sub,
  adds,
}: {
  marker: string;
  markerTone: string;
  text: string;
  textTone?: string;
  figures?: string;
  sub?: string;
  adds?: string[];
}) {
  return (
    <div className="flex min-w-0 items-baseline gap-1.5">
      <span
        aria-hidden
        className={cx("w-2.5 shrink-0 text-center text-meta", markerTone)}
      >
        {marker}
      </span>
      <div className="min-w-0 flex-1">
        <div className="flex min-w-0 items-baseline gap-2">
          <span className={cx("min-w-0 flex-1 truncate", textTone)}>
            {text}
          </span>
          {figures && (
            <span className="shrink-0 font-mono text-meta tabular-nums text-fg-dim">
              {figures}
            </span>
          )}
        </div>
        {adds?.map((add, i) => (
          <p key={i} className="truncate text-meta text-fg-faint">
            + {add}
          </p>
        ))}
        {sub && <p className="truncate text-meta text-fg-faint">{sub}</p>}
      </div>
    </div>
  );
}
