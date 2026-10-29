import { useContext, useMemo, useState, type ReactNode } from "react";
import { remainingH, taskProgress, type BoardTask } from "@shared/board";
import { formatAgeShort } from "@shared/format";
import { productForSession, type ProductInfo } from "@shared/products";
import type { Session } from "@shared/types";
import { cx, Lamp } from "../../ui/atoms";
import { Icon } from "../../ui/icons";
import { useI18n } from "../../i18n";
import { useLinkTask, useSessionTasks } from "../../board/session-tasks";
import { boardStrings, fmtDay, fmtH } from "../../board/strings";
import { Chip, Progress, TopicChip } from "../../board/parts";
import {
  ProductsContext,
  useSessionProduct,
} from "../../products/products-context";
import { EmptyState } from "./chrome";

/**
 * The dock's Task and Topic tabs (fork feature, 2026-10-29). Task: the board task this session is on —
 * status, dates, subtasks, notes — and the other sessions on it; without one, the open tasks to put it
 * on, same topic first. Topic: the topic card's open threads beside every session and open task in the
 * topic, so parallel work on one product reads apart. Edits beyond linking happen on the board.
 */
export function DockTaskDetail({ session }: { session: Session }) {
  const { locale } = useI18n();
  const s = boardStrings(locale);
  const ctx = useSessionTasks();
  const products = useContext(ProductsContext);
  const product = useSessionProduct(session);
  const link = useLinkTask(session);
  const [picking, setPicking] = useState(false);
  if (!ctx) return null;
  const task = ctx.taskOf(session.id);

  if (!task || picking)
    return (
      <TaskPicker
        tasks={ctx.tasks}
        current={task}
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
  return (
    <div className="flex min-w-0 gap-6 px-4 py-3">
      <div className="flex min-w-0 flex-1 flex-col gap-2">
        <div className="flex min-w-0 items-center gap-2">
          <TopicChip topic={topic} />
          <h3 className="min-w-0 truncate text-body font-medium text-fg">
            {task.title}
          </h3>
          <Chip tone={task.status === "decide" ? "mid" : "plain"}>
            {s.status[task.status]}
          </Chip>
          <span className="ml-auto flex shrink-0 items-center gap-1">
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
          </span>
        </div>
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-meta text-fg-dim">
          <span>
            {s.dock.priority} {task.priority}
          </span>
          {task.due && (
            <span>
              {s.dock.due} {fmtDay(task.due)}
            </span>
          )}
          {task.plannedDate && (
            <span>
              {s.dock.planned} {fmtDay(task.plannedDate)}
            </span>
          )}
          {task.estimateH > 0 && (
            <span>
              {s.dock.estimate(fmtH(task.estimateH), fmtH(remainingH(task)))}
            </span>
          )}
          {task.subtasks.length > 0 && (
            <span>{s.dock.subtasks(done, task.subtasks.length)}</span>
          )}
        </div>
        {task.subtasks.length > 0 && (
          <>
            <Progress
              value={taskProgress(task)}
              status={task.status}
              className="max-w-80"
            />
            <ul className="flex flex-col gap-0.5">
              {task.subtasks.map((st) => (
                <li
                  key={st.id}
                  className={cx(
                    "flex items-start gap-2 text-aux",
                    st.done ? "text-fg-dim line-through" : "text-fg-muted",
                  )}
                >
                  <Icon
                    name={st.done ? "check" : "square"}
                    size={12}
                    className="mt-0.5 shrink-0 text-fg-dim"
                  />
                  <span className="min-w-0">{st.text}</span>
                </li>
              ))}
            </ul>
          </>
        )}
        {task.notes.trim() && (
          <Section title={s.dock.notes}>
            <p className="line-clamp-4 whitespace-pre-wrap text-aux text-fg-muted">
              {task.notes.trim()}
            </p>
          </Section>
        )}
      </div>
      <aside className="flex w-64 shrink-0 flex-col gap-1">
        <Section title={s.dock.sessions}>
          {siblings.map((x) => (
            <SessionLine
              key={x.id}
              session={x}
              current={x.id === session.id}
              currentLabel={s.dock.thisSession}
              onOpen={ctx.openSession}
            />
          ))}
        </Section>
      </aside>
    </div>
  );
}

export function DockTopic({ session }: { session: Session }) {
  const { locale } = useI18n();
  const s = boardStrings(locale);
  const ctx = useSessionTasks();
  const products = useContext(ProductsContext);
  const product = useSessionProduct(session);
  const peers = useMemo(() => {
    if (!products || !product || !ctx) return [];
    return ctx.sessions
      .filter((x) => productForSession(products, x) === product.key)
      .sort((a, b) => b.lastActivityMs - a.lastActivityMs)
      .slice(0, 12);
  }, [products, product, ctx]);
  if (!ctx) return null;
  if (!product) return <EmptyState>{s.dock.noTopic}</EmptyState>;
  const openTasks = ctx.tasks.filter(
    (x) => x.topic === product.key && x.status !== "done",
  );
  return (
    <div className="flex min-w-0 gap-6 px-4 py-3">
      <div className="flex min-w-0 flex-1 flex-col gap-2">
        <TopicHeader product={product} />
        {!product.hasCard ? (
          <p className="text-aux text-fg-dim">{s.dock.noCard}</p>
        ) : (
          <TopicCard product={product} />
        )}
      </div>
      <aside className="flex w-72 shrink-0 flex-col gap-3">
        <Section title={s.dock.topicSessions}>
          {peers.map((x) => (
            <SessionLine
              key={x.id}
              session={x}
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
                className="flex min-w-0 items-center gap-2 rounded-sm px-1 py-0.5 text-left text-aux text-fg-muted hover:bg-(--ui-row-hover-background) hover:text-fg"
              >
                <span className="min-w-0 flex-1 truncate">{x.title}</span>
                <span className="shrink-0 text-meta text-fg-dim">
                  {s.status[x.status]}
                </span>
              </button>
            ))}
          </Section>
        )}
      </aside>
    </div>
  );
}

function TopicHeader({ product }: { product: ProductInfo }) {
  return (
    <h3 className="flex items-center gap-1.5 text-body font-medium text-fg">
      <span
        aria-hidden
        className="size-2 shrink-0 rounded-[2px]"
        style={{ background: product.color }}
      />
      {product.name}
      {product.domains.length > 0 && (
        <span className="truncate text-meta font-normal text-fg-dim">
          {product.domains.join(" · ")}
        </span>
      )}
    </h3>
  );
}

function TopicCard({ product }: { product: ProductInfo }) {
  const { t } = useI18n();
  const labels = t.shell.sessionRow.product;
  return (
    <div className="grid gap-3 sm:grid-cols-3">
      {product.doing && (
        <Section title={labels.doing}>
          <p className="text-aux text-fg-muted">{product.doing}</p>
        </Section>
      )}
      {product.loose.length > 0 && (
        <Section title={labels.loose}>
          <Lines lines={product.loose} />
        </Section>
      )}
      {product.decide.length > 0 && (
        <Section title={labels.decide}>
          <Lines lines={product.decide} />
        </Section>
      )}
    </div>
  );
}

function Lines({ lines }: { lines: string[] }) {
  return (
    <ul className="flex flex-col gap-1">
      {lines.map((l) => (
        <li key={l} className="text-aux leading-snug text-fg-muted">
          {l}
        </li>
      ))}
    </ul>
  );
}

/** Choose a task for a session that has none (or is changing it): open tasks, same topic first. */
function TaskPicker({
  tasks,
  current,
  topicKey,
  topics,
  onPick,
  onCancel,
  onOpenBoard,
}: {
  tasks: BoardTask[];
  current: BoardTask | undefined;
  topicKey: string | null;
  topics: Record<string, ProductInfo>;
  onPick: (id: string) => void;
  onCancel?: () => void;
  onOpenBoard: () => void;
}) {
  const { locale } = useI18n();
  const s = boardStrings(locale);
  const open = tasks.filter((x) => x.status !== "done");
  const ordered = topicKey
    ? [
        ...open.filter((x) => x.topic === topicKey),
        ...open.filter((x) => x.topic !== topicKey),
      ]
    : open;
  return (
    <div className="flex flex-col gap-2 px-4 py-3">
      <div className="flex items-center gap-2">
        <p className="text-aux text-fg-muted">
          {current ? s.dock.changeTask : s.dock.noTask}
        </p>
        {topicKey && ordered.length > 0 && (
          <span className="text-meta text-fg-dim">{s.dock.sameTopicFirst}</span>
        )}
        <span className="ml-auto flex items-center gap-1">
          <DockButton icon="square-kanban" onClick={onOpenBoard}>
            {s.dock.openBoard}
          </DockButton>
          {onCancel && (
            <DockButton icon="x" onClick={onCancel}>
              {s.dock.back}
            </DockButton>
          )}
        </span>
      </div>
      {ordered.length === 0 ? (
        <p className="text-aux text-fg-dim">{s.dock.noTasks}</p>
      ) : (
        <div className="grid grid-cols-[repeat(auto-fill,minmax(16rem,1fr))] gap-1">
          {ordered.map((x) => (
            <button
              key={x.id}
              type="button"
              onClick={() => onPick(x.id)}
              aria-pressed={current?.id === x.id}
              className={cx(
                "flex min-w-0 items-center gap-2 rounded-md border border-(--ui-stroke-tertiary) px-2 py-1.5 text-left text-aux text-fg-muted hover:bg-(--ui-row-hover-background) hover:text-fg",
                current?.id === x.id &&
                  "bg-(--ui-row-active-background) text-fg",
              )}
            >
              {x.topic && topics[x.topic] && (
                <span
                  aria-hidden
                  className="size-1.5 shrink-0 rounded-[2px]"
                  style={{ background: topics[x.topic].color }}
                />
              )}
              <span className="min-w-0 flex-1 truncate">{x.title}</span>
              <span className="shrink-0 text-meta text-fg-dim">
                {s.status[x.status]}
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function SessionLine({
  session,
  current,
  currentLabel,
  task,
  onOpen,
}: {
  session: Session;
  current: boolean;
  currentLabel: string;
  /** The session's board task, shown under its title (Topic tab). */
  task?: string;
  onOpen: (id: string) => void;
}) {
  const now = Date.now();
  return (
    <button
      type="button"
      onClick={() => onOpen(session.id)}
      disabled={current}
      className={cx(
        "flex min-w-0 items-start gap-1.5 rounded-sm px-1 py-0.5 text-left",
        current
          ? "bg-(--ui-row-active-background)"
          : "hover:bg-(--ui-row-hover-background)",
      )}
    >
      <span className="mt-0.5 grid size-3.5 shrink-0 place-items-center">
        <Lamp state={session.state} management={session.management} />
      </span>
      <span className="flex min-w-0 flex-1 flex-col">
        <span className="truncate text-aux text-fg-muted">{session.title}</span>
        {task && <span className="truncate text-meta text-fg-dim">{task}</span>}
      </span>
      <span className="shrink-0 text-meta tabular-nums text-fg-dim">
        {current ? currentLabel : formatAgeShort(session.lastActivityMs, now)}
      </span>
    </button>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="flex min-w-0 flex-col gap-1">
      <h4 className="text-meta text-fg-dim">{title}</h4>
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
      className="inline-flex h-6 max-w-48 items-center gap-1 rounded-sm px-1.5 text-meta text-fg-dim transition-colors hover:bg-(--ui-control-hover-background) hover:text-fg"
    >
      <Icon name={icon} size={12} className="shrink-0" />
      <span className="truncate">{children}</span>
    </button>
  );
}
