import { useContext, useMemo, useState, type ReactNode } from "react";
import {
  cleanCardDoing,
  dayKey,
  daysBetween,
  splitCardLine,
  splitPendingQueue,
  stripInlineCode,
  taskProgress,
  type BoardTask,
} from "@shared/board";
import { formatAgeShort } from "@shared/format";
import { productForSession, type ProductInfo } from "@shared/products";
import type { Session } from "@shared/types";
import { cx, Lamp } from "../../ui/atoms";
import { Icon } from "../../ui/icons";
import { useI18n } from "../../i18n";
import { useLinkTask, useSessionTasks } from "../../board/session-tasks";
import { boardStrings, fmtDay } from "../../board/strings";
import {
  Chip,
  InlineCodeText,
  PRIORITY_TEXT,
  Progress,
  STATUS_BG,
  TopicChip,
  btn,
} from "../../board/parts";
import {
  ProductsContext,
  useSessionProduct,
} from "../../products/products-context";
import { EmptyState } from "./chrome";

/**
 * The dock's Board Item (`task`) and Product (`topic`) tabs (fork feature, 2026-10-29; synced with the
 * two-core board refactor, 2026-11-13).
 * - `DockTaskDetail`: linked board item with inline product chip, backtick code rendering, status-aware
 *   1-click primary action (`确认转执行` vs `完成并记入今日清单` vs `重新打开`) + 1-click undo, interactive
 *   subtask checkboxes, and sibling sessions. Without a linked item, shows `TaskPicker`.
 * - `DockTopic`: cleaned workbench product card (`doing` / `loose` / `decide` with stale dirty-tree lines
 *   stripped) alongside peer sessions and open board items in queue priority order.
 */
export function DockTaskDetail({ session }: { session: Session }) {
  const { locale } = useI18n();
  const s = boardStrings(locale);
  const ctx = useSessionTasks();
  const products = useContext(ProductsContext);
  const product = useSessionProduct(session);
  const link = useLinkTask(session);
  const [picking, setPicking] = useState(false);
  const today = dayKey(new Date());

  if (!ctx) return null;
  const task = ctx.taskOf(session.id);

  if (!task || picking)
    return (
      <TaskPicker
        tasks={ctx.tasks}
        current={task}
        today={today}
        topicKey={product?.key ?? null}
        topics={products?.products ?? {}}
        onPick={(id) => {
          setPicking(false);
          link(id);
        }}
        onCancel={task ? () => setPicking(false) : undefined}
        onOpenBoard={ctx.showBoard}
      />
    );

  const topic = task.topic ? products?.products[task.topic] : undefined;
  const done = task.subtasks.filter((x) => x.done).length;
  const siblings = ctx.sessions.filter((x) => task.sessionIds.includes(x.id));
  const deltaDays = task.due ? daysBetween(today, task.due) : null;
  // Match PendingQueuePanel: hide unchosen `:decide:` candidate options once promoted to execution.
  const subtitleText =
    task.status === "decide"
      ? task.summary.trim()
      : task.outcome.trim() ||
        (!task.sourceKey?.includes(":decide:") ? task.summary.trim() : "");
  const undoForThis =
    ctx.lastUndo && ctx.lastUndo.taskId === task.id ? ctx.lastUndo : null;

  return (
    <div className="@container px-4 py-3">
      <div className="flex min-w-0 flex-col gap-3 @2xl:flex-row @2xl:gap-6">
        <div className="flex min-w-0 flex-1 flex-col gap-1.5 overflow-hidden">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1.5">
            <div className="flex min-w-80 flex-1 items-center gap-2">
              <TopicChip topic={topic} />
              <h3
                className="min-w-0 truncate text-body font-medium text-fg"
                title={stripInlineCode(task.title || s.untitled)}
              >
                <InlineCodeText text={task.title || s.untitled} />
              </h3>
              {task.status === "doing" ? (
                <Chip tone="plain" className="text-fg-muted">
                  <span
                    aria-hidden
                    className="size-1.5 shrink-0 rounded-full bg-working"
                  />
                  {s.status.doing}
                </Chip>
              ) : (
                <Chip
                  tone={
                    task.status === "decide"
                      ? "mid"
                      : task.status === "done"
                        ? "ok"
                        : "plain"
                  }
                >
                  {s.status[task.status]}
                </Chip>
              )}
            </div>

            <div className="flex min-w-0 flex-wrap items-center gap-1">
              {task.status === "decide" ? (
                <button
                  type="button"
                  onClick={() => void ctx.approveTask(task.id)}
                  className={btn.soft}
                >
                  <Icon name="arrow-right" size={12} />
                  {s.dock.approveTask}
                </button>
              ) : task.status === "done" ? (
                <button
                  type="button"
                  onClick={() => void ctx.reopenTask(task.id)}
                  className={btn.soft}
                >
                  <Icon name="rotate-ccw" size={12} />
                  {s.dock.reopenTask}
                </button>
              ) : (
                <button
                  type="button"
                  onClick={() => void ctx.completeTask(task.id)}
                  className={btn.soft}
                >
                  <Icon name="check" size={12} />
                  {s.dock.completeTask}
                </button>
              )}
              <DockButton
                icon="arrow-up-right"
                onClick={() => ctx.openTask(task.id)}
              >
                {s.dock.openOnBoard}
              </DockButton>
              <DockButton icon="link" onClick={() => setPicking(true)}>
                {s.dock.changeTask}
              </DockButton>
              <DockButton icon="unlink" onClick={() => link(null)}>
                {s.dock.unlink}
              </DockButton>
            </div>
          </div>

          {undoForThis && (
            <div className="flex items-center justify-between gap-2 rounded-md bg-ink-900 px-2.5 py-1 text-aux text-fg-muted">
              <span className="min-w-0 truncate">
                <InlineCodeText
                  text={
                    undoForThis.kind === "approved"
                      ? s.undoApproved(undoForThis.taskTitle || s.untitled)
                      : s.undoCompleted(undoForThis.taskTitle || s.untitled)
                  }
                />
              </span>
              <div className="flex shrink-0 items-center gap-1">
                <button
                  type="button"
                  onClick={() => void ctx.undoLast()}
                  className="inline-flex h-5 items-center gap-1 rounded-sm bg-ink-800 px-2 text-meta font-medium text-fg transition-colors hover:bg-ink-700"
                >
                  <Icon name="rotate-ccw" size={11} />
                  {s.undo}
                </button>
                <button
                  type="button"
                  onClick={ctx.dismissUndo}
                  aria-label={s.cancelEdit}
                  className="grid size-5 place-items-center rounded-sm text-fg-faint hover:text-fg"
                >
                  <Icon name="x" size={11} />
                </button>
              </div>
            </div>
          )}

          {subtitleText && (
            <p className="text-aux leading-relaxed text-fg-muted">
              <InlineCodeText text={subtitleText} />
            </p>
          )}

          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-meta text-fg-faint">
            <span>
              {s.dock.priority}{" "}
              <span className={cx("font-mono", PRIORITY_TEXT[task.priority])}>
                {task.priority}
              </span>
            </span>
            {task.due && deltaDays !== null && (
              <span
                className={cx(
                  "font-mono tabular-nums",
                  task.status !== "done" && deltaDays < 0
                    ? "text-danger"
                    : task.status !== "done" && deltaDays <= 1
                      ? "text-accent"
                      : "text-fg-faint",
                )}
              >
                {task.status !== "done" && deltaDays < 0
                  ? s.overdueBy(-deltaDays)
                  : task.status !== "done" && deltaDays === 0
                    ? s.dueToday
                    : s.due(fmtDay(task.due))}
              </span>
            )}
            {task.subtasks.length > 0 && (
              <span className="font-mono tabular-nums">
                {s.dock.subtasks(done, task.subtasks.length)}
              </span>
            )}
          </div>

          {task.subtasks.length > 0 && (
            <>
              <Progress
                value={taskProgress(task)}
                status={task.status}
                className="max-w-80"
              />
              <ul className="flex flex-col gap-1">
                {task.subtasks.map((st) => (
                  <li key={st.id}>
                    <button
                      type="button"
                      onClick={() => void ctx.toggleSubtask(task.id, st.id)}
                      className={cx(
                        "group flex w-full items-start gap-2 rounded-sm px-1 py-0.5 text-left text-aux transition-colors hover:bg-(--ui-row-hover-background)",
                        st.done ? "text-fg-dim line-through" : "text-fg-muted",
                      )}
                    >
                      <span
                        aria-hidden
                        className={cx(
                          "mt-0.5 grid size-3.5 shrink-0 place-items-center rounded-[3px] border transition-colors",
                          st.done
                            ? "border-ink-600 bg-ink-800 text-fg"
                            : "border-(--ui-stroke-primary) text-transparent group-hover:border-fg",
                        )}
                      >
                        <Icon name="check" size={10} />
                      </span>
                      <span className="min-w-0 leading-snug">
                        <InlineCodeText text={st.text} />
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            </>
          )}

          {task.notes.trim() && (
            <Section title={s.dock.notes}>
              <p className="line-clamp-4 whitespace-pre-wrap text-aux leading-relaxed text-fg-muted">
                <InlineCodeText text={task.notes.trim()} />
              </p>
            </Section>
          )}
        </div>

        <aside className="flex shrink-0 flex-col gap-1 border-t border-ink-850 pt-2.5 @2xl:w-60 @2xl:border-l @2xl:border-t-0 @2xl:pl-5 @2xl:pt-0">
          <Section title={s.dock.sessions}>
            {siblings.map((x) => (
              <SessionLine
                key={x.id}
                session={x}
                displayTitle={products?.titles[x.id] ?? x.title}
                current={x.id === session.id}
                currentLabel={s.dock.thisSession}
                onOpen={ctx.openSession}
              />
            ))}
          </Section>
        </aside>
      </div>
    </div>
  );
}

export function DockTopic({ session }: { session: Session }) {
  const { locale } = useI18n();
  const s = boardStrings(locale);
  const ctx = useSessionTasks();
  const products = useContext(ProductsContext);
  const product = useSessionProduct(session);
  const today = dayKey(new Date());

  const peers = useMemo(() => {
    if (!products || !product || !ctx) return [];
    return ctx.sessions
      .filter((x) => productForSession(products, x) === product.key)
      .sort((a, b) => b.lastActivityMs - a.lastActivityMs)
      .slice(0, 12);
  }, [products, product, ctx]);

  const openTasks = useMemo(() => {
    if (!ctx || !product) return [];
    const scoped = ctx.tasks.filter(
      (x) => x.topic === product.key && x.status !== "done",
    );
    const { confirm, execute } = splitPendingQueue(scoped, today);
    return [...confirm, ...execute];
  }, [ctx, product, today]);

  if (!ctx) return null;
  if (!product) return <EmptyState>{s.dock.noTopic}</EmptyState>;

  return (
    <div className="@container px-4 py-3">
      <div className="flex min-w-0 flex-col gap-3 @2xl:flex-row @2xl:gap-6">
        <div className="flex min-w-0 flex-1 flex-col gap-2 overflow-hidden">
          <TopicHeader product={product} />
          {!product.hasCard ? (
            <p className="text-aux text-fg-faint">{s.dock.noCard}</p>
          ) : (
            <TopicCard product={product} cleanEmptyLabel={s.dock.cardClean} />
          )}
        </div>
        <aside className="flex shrink-0 flex-col gap-3 border-t border-ink-850 pt-2.5 @2xl:w-64 @2xl:border-l @2xl:border-t-0 @2xl:pl-5 @2xl:pt-0">
          <Section title={s.dock.topicSessions}>
            {peers.map((x) => (
              <SessionLine
                key={x.id}
                session={x}
                displayTitle={products?.titles[x.id] ?? x.title}
                current={x.id === session.id}
                currentLabel={s.dock.thisSession}
                task={ctx.taskOf(x.id)?.title ?? s.dock.noTaskShort}
                onOpen={ctx.openSession}
              />
            ))}
          </Section>
          {openTasks.length > 0 && (
            <Section title={s.dock.topicTasks}>
              {openTasks.map((x) => (
                <button
                  key={x.id}
                  type="button"
                  onClick={() => ctx.openTask(x.id)}
                  title={stripInlineCode(x.title || s.untitled)}
                  className="flex min-w-0 items-center gap-2 rounded-sm px-1.5 py-1 text-left text-aux text-fg-muted transition-colors hover:bg-(--ui-row-hover-background) hover:text-fg"
                >
                  <span
                    aria-hidden
                    className={cx(
                      "size-1.5 shrink-0 rounded-full",
                      STATUS_BG[x.status],
                    )}
                  />
                  <span className="min-w-0 flex-1 truncate">
                    <InlineCodeText text={x.title || s.untitled} />
                  </span>
                  <span className="shrink-0 text-meta text-fg-faint">
                    {s.status[x.status]}
                  </span>
                </button>
              ))}
            </Section>
          )}
        </aside>
      </div>
    </div>
  );
}

function TopicHeader({ product }: { product: ProductInfo }) {
  return (
    <h3 className="flex min-w-0 items-center gap-2 text-body font-medium text-fg">
      <span
        aria-hidden
        className="size-2 shrink-0 rounded-[2px]"
        style={{ background: product.color }}
      />
      <span className="shrink-0">{product.name}</span>
      {product.domains.length > 0 && (
        <span className="min-w-0 truncate font-mono text-meta font-normal text-fg-faint">
          {product.domains.join(" / ")}
        </span>
      )}
    </h3>
  );
}

function TopicCard({
  product,
  cleanEmptyLabel,
}: {
  product: ProductInfo;
  cleanEmptyLabel: string;
}) {
  const { t } = useI18n();
  const labels = t.shell.sessionRow.product;

  const doingText = useMemo(
    () => cleanCardDoing(product.doing),
    [product.doing],
  );
  const decideItems = useMemo(
    () =>
      product.decide
        .map(splitCardLine)
        .filter((x): x is NonNullable<typeof x> => x !== null),
    [product.decide],
  );
  const looseItems = useMemo(
    () =>
      product.loose
        .map(splitCardLine)
        .filter((x): x is NonNullable<typeof x> => x !== null),
    [product.loose],
  );

  if (!doingText && decideItems.length === 0 && looseItems.length === 0) {
    return <p className="text-aux text-fg-faint">{cleanEmptyLabel}</p>;
  }

  return (
    <div className="grid gap-3 @lg:grid-cols-2 @2xl:grid-cols-3">
      {doingText && (
        <Section title={labels.doing}>
          <p className="text-aux leading-relaxed text-fg-muted">
            <InlineCodeText text={doingText} />
          </p>
        </Section>
      )}
      {decideItems.length > 0 && (
        <Section title={labels.decide}>
          <CardItems items={decideItems} dotClassName="bg-accent" />
        </Section>
      )}
      {looseItems.length > 0 && (
        <Section title={labels.loose}>
          <CardItems items={looseItems} />
        </Section>
      )}
    </div>
  );
}

function CardItems({
  items,
  dotClassName,
}: {
  items: { title: string; summary: string }[];
  dotClassName?: string;
}) {
  return (
    <ul className="flex flex-col gap-1.5">
      {items.map((item, idx) => (
        <li
          key={`${idx}:${item.title}`}
          className="flex items-start gap-1.5 text-aux leading-relaxed text-fg-muted"
        >
          {dotClassName && (
            <span
              aria-hidden
              className={cx(
                "mt-1.5 size-1.5 shrink-0 rounded-full",
                dotClassName,
              )}
            />
          )}
          <div className="min-w-0 flex-1">
            <div>
              <InlineCodeText text={item.title} />
            </div>
            {item.summary && (
              <div className="text-meta leading-snug text-fg-faint">
                <InlineCodeText text={item.summary} />
              </div>
            )}
          </div>
        </li>
      ))}
    </ul>
  );
}

/** Choose a task for a session that has none (or is changing it): open tasks in queue priority order, same product first. */
function TaskPicker({
  tasks,
  current,
  today,
  topicKey,
  topics,
  onPick,
  onCancel,
  onOpenBoard,
}: {
  tasks: BoardTask[];
  current: BoardTask | undefined;
  today: string;
  topicKey: string | null;
  topics: Record<string, ProductInfo>;
  onPick: (id: string) => void;
  onCancel?: () => void;
  onOpenBoard: () => void;
}) {
  const { locale } = useI18n();
  const s = boardStrings(locale);
  const ordered = useMemo(() => {
    const { confirm, execute } = splitPendingQueue(tasks, today);
    const open = [...confirm, ...execute];
    if (!topicKey) return open;
    return [
      ...open.filter((x) => x.topic === topicKey),
      ...open.filter((x) => x.topic !== topicKey),
    ];
  }, [tasks, today, topicKey]);

  return (
    <div className="flex flex-col gap-2.5 px-4 py-3">
      <div className="flex flex-wrap items-center gap-2">
        <p className="text-aux text-fg-muted">
          {current ? s.dock.changeTask : s.dock.noTask}
        </p>
        {topicKey && ordered.length > 0 && (
          <span className="text-meta text-fg-faint">
            {s.dock.sameTopicFirst}
          </span>
        )}
        <span className="ml-auto flex items-center gap-1">
          <button type="button" onClick={onOpenBoard} className={btn.soft}>
            <Icon name="square-kanban" size={12} />
            {s.dock.openBoard}
          </button>
          {onCancel && (
            <DockButton icon="x" onClick={onCancel}>
              {s.dock.back}
            </DockButton>
          )}
        </span>
      </div>
      {ordered.length === 0 ? (
        <p className="text-aux text-fg-faint">{s.dock.noTasks}</p>
      ) : (
        <div className="grid grid-cols-[repeat(auto-fill,minmax(16rem,1fr))] gap-1.5">
          {ordered.map((x) => {
            const tp = x.topic ? topics[x.topic] : undefined;
            const isSelected = current?.id === x.id;
            return (
              <button
                key={x.id}
                type="button"
                onClick={() => onPick(x.id)}
                aria-pressed={isSelected}
                title={stripInlineCode(x.title || s.untitled)}
                className={cx(
                  "flex min-w-0 items-center gap-2 rounded-md px-2.5 py-1.5 text-left text-aux transition-colors",
                  isSelected
                    ? "bg-ink-800 text-fg ring-1 ring-ink-700"
                    : "bg-ink-900 text-fg-muted hover:bg-ink-800 hover:text-fg",
                )}
              >
                {tp && (
                  <span
                    aria-hidden
                    className="size-2 shrink-0 rounded-[2px]"
                    style={{ background: tp.color }}
                  />
                )}
                <span className="min-w-0 flex-1 truncate">
                  <InlineCodeText text={x.title || s.untitled} />
                </span>
                <span className="inline-flex shrink-0 items-center gap-1 text-meta text-fg-faint">
                  <span
                    aria-hidden
                    className={cx(
                      "size-1.5 shrink-0 rounded-full",
                      STATUS_BG[x.status],
                    )}
                  />
                  {s.status[x.status]}
                </span>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

function SessionLine({
  session,
  displayTitle,
  current,
  currentLabel,
  task,
  onOpen,
}: {
  session: Session;
  displayTitle: string;
  current: boolean;
  currentLabel: string;
  /** The session's board task, shown under its title (Product tab). */
  task?: string;
  onOpen: (id: string) => void;
}) {
  const now = Date.now();
  return (
    <button
      type="button"
      onClick={() => onOpen(session.id)}
      disabled={current}
      title={stripInlineCode(displayTitle)}
      className={cx(
        "flex min-w-0 items-start gap-1.5 rounded-sm px-1.5 py-1 text-left transition-colors",
        current
          ? "bg-(--ui-row-active-background)"
          : "hover:bg-(--ui-row-hover-background)",
      )}
    >
      <span className="mt-0.5 grid size-3.5 shrink-0 place-items-center">
        <Lamp state={session.state} management={session.management} />
      </span>
      <span className="flex min-w-0 flex-1 flex-col">
        <span
          className={cx(
            "truncate text-aux",
            current ? "font-medium text-fg" : "text-fg-muted",
          )}
        >
          <InlineCodeText text={displayTitle} />
        </span>
        {task && (
          <span className="truncate text-meta text-fg-faint">
            <InlineCodeText text={task} />
          </span>
        )}
      </span>
      <span className="shrink-0 font-mono text-meta tabular-nums text-fg-faint">
        {current ? currentLabel : formatAgeShort(session.lastActivityMs, now)}
      </span>
    </button>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="flex min-w-0 flex-col gap-1">
      <h4 className="text-meta font-medium text-fg-faint">{title}</h4>
      {children}
    </section>
  );
}

function DockButton({
  icon,
  onClick,
  children,
}: {
  icon: Parameters<typeof Icon>[0]["name"];
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="inline-flex h-6 max-w-48 shrink-0 items-center gap-1 whitespace-nowrap rounded-sm px-2 text-aux text-fg-faint transition-colors hover:bg-(--ui-control-hover-background) hover:text-fg"
    >
      <Icon name={icon} size={12} className="shrink-0" />
      <span className="truncate">{children}</span>
    </button>
  );
}
