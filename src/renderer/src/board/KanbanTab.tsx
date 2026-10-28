import { useMemo, useState, type DragEvent } from "react";
import {
  TASK_STATUSES,
  blankTask,
  daysBetween,
  remainingH,
  taskProgress,
  taskRisks,
  type BoardTask,
  type TaskStatus,
} from "@shared/board";
import { cx } from "../ui/atoms";
import { Icon } from "../ui/icons";
import { taskLive, useBoardCtx } from "./context";
import {
  Chip,
  Dot,
  PRIORITY_DOT,
  Progress,
  STATUS_BG,
  TopicChip,
  btn,
  input,
  riskLevel,
  taskMatches,
} from "./parts";
import { fmtDay, fmtH } from "./strings";

type Filter = "all" | "P0" | "P1" | "risk";

const DRAG_MIME = "application/x-cbw-task";

export function KanbanTab({ query }: { query: string }) {
  const ctx = useBoardCtx();
  const { doc, s, today, update, sessionsById } = ctx;
  const [filter, setFilter] = useState<Filter>("all");
  const [over, setOver] = useState<TaskStatus | null>(null);

  const risksOf = (t: BoardTask) =>
    taskRisks(t, today, doc, taskLive(t, sessionsById).lastActivityMs);

  const visible = useMemo(
    () =>
      doc.tasks.filter(
        (t) =>
          taskMatches(t, query) &&
          (filter === "all" ||
            (filter === "risk"
              ? risksOf(t).length > 0
              : t.priority === filter)),
      ),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [doc, query, filter, today, sessionsById],
  );
  const open = doc.tasks.filter((t) => t.status !== "done");
  const leftTotal = open.reduce((a, t) => a + remainingH(t), 0);

  function move(id: string, status: TaskStatus, beforeId: string | null) {
    update((d) => {
      const task = d.tasks.find((t) => t.id === id);
      if (!task) return d;
      const col = d.tasks
        .filter((t) => t.status === status && t.id !== id)
        .sort((a, b) => a.order - b.order);
      const at = beforeId ? col.findIndex((t) => t.id === beforeId) : -1;
      const moved: BoardTask = {
        ...task,
        status,
        doneAt: status === "done" ? (task.doneAt ?? Date.now()) : null,
      };
      col.splice(at < 0 ? col.length : at, 0, moved);
      const orders = new Map(col.map((t, i) => [t.id, i]));
      return {
        ...d,
        tasks: d.tasks.map((t) =>
          t.id === id
            ? { ...moved, order: orders.get(id)! }
            : orders.has(t.id)
              ? { ...t, order: orders.get(t.id)! }
              : t,
        ),
      };
    });
  }

  function drop(e: DragEvent, status: TaskStatus, beforeId: string | null) {
    const id = e.dataTransfer.getData(DRAG_MIME);
    setOver(null);
    if (!id) return;
    e.preventDefault();
    e.stopPropagation();
    move(id, status, beforeId);
  }

  const weekAgo = Date.now() - 7 * 864e5;
  const filters: { id: Filter; label: string }[] = [
    { id: "all", label: s.filterAll },
    { id: "P0", label: "P0" },
    { id: "P1", label: "P1" },
    { id: "risk", label: s.filterRisk },
  ];

  return (
    <div className="flex h-full min-h-0 flex-col gap-3 px-5 pb-4">
      <div className="flex items-center justify-between gap-3">
        <p className="text-aux text-fg-faint">
          <span className="text-fg-muted">
            {s.totalLine(doc.tasks.length, fmtH(leftTotal))}
          </span>
          <span className="mx-2 opacity-50">·</span>
          {s.dragHint}
        </p>
        <div className="flex items-center rounded-md border border-(--ui-stroke-tertiary) p-[2px]">
          {filters.map((f) => (
            <button
              key={f.id}
              type="button"
              aria-pressed={filter === f.id}
              onClick={() => setFilter(f.id)}
              className={cx(
                "h-6 rounded-sm px-2.5 text-aux transition-colors duration-100",
                filter === f.id
                  ? "bg-(--ui-control-active-background) font-medium text-fg"
                  : "text-fg-faint hover:text-fg",
              )}
            >
              {f.label}
            </button>
          ))}
        </div>
      </div>

      <div className="grid min-h-0 flex-1 auto-cols-[minmax(200px,1fr)] grid-flow-col gap-3 overflow-x-auto">
        {TASK_STATUSES.map((status) => {
          const cards = visible
            .filter((t) => t.status === status)
            .sort((a, b) =>
              status === "done"
                ? (b.doneAt ?? 0) - (a.doneAt ?? 0)
                : a.order - b.order,
            );
          const colLeft = cards.reduce((a, t) => a + remainingH(t), 0);
          const doneWeek = doc.tasks.filter(
            (t) => t.status === "done" && (t.doneAt ?? 0) >= weekAgo,
          ).length;
          return (
            <section
              key={status}
              onDragOver={(e) => {
                if (!e.dataTransfer.types.includes(DRAG_MIME)) return;
                e.preventDefault();
                setOver(status);
              }}
              onDragLeave={(e) => {
                if (!e.currentTarget.contains(e.relatedTarget as Node))
                  setOver(null);
              }}
              onDrop={(e) => drop(e, status, null)}
              className={cx(
                "flex min-h-0 flex-col rounded-xl border bg-ink-925 transition-colors duration-100",
                over === status
                  ? "border-(--ui-stroke-primary)"
                  : "border-ink-800",
              )}
            >
              <header className="flex h-10 shrink-0 items-center gap-2 px-3">
                <Dot className={STATUS_BG[status]} />
                <h2 className="text-body font-semibold text-fg">
                  {s.status[status]}
                </h2>
                <span className="rounded-sm bg-(--ui-bg-tertiary) px-1.5 font-mono text-meta tabular-nums text-fg-faint">
                  {cards.length}
                </span>
                <span className="ml-auto text-meta text-fg-faint">
                  {status === "done"
                    ? s.weekDone(doneWeek)
                    : s.colLeft(fmtH(colLeft))}
                </span>
              </header>
              <div className="flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto px-2 pb-2">
                {cards.map((t) => (
                  <TaskCard
                    key={t.id}
                    task={t}
                    onDrop={(e) => drop(e, status, t.id)}
                  />
                ))}
                {status !== "done" && <QuickAdd status={status} />}
              </div>
            </section>
          );
        })}
      </div>
    </div>
  );
}

function TaskCard({
  task: t,
  onDrop,
}: {
  task: BoardTask;
  onDrop: (e: DragEvent) => void;
}) {
  const { s, today, doc, topics, sessionsById, openTask } = useBoardCtx();
  const live = taskLive(t, sessionsById);
  const risks = taskRisks(t, today, doc, live.lastActivityMs);
  const progress = taskProgress(t);
  const done = t.status === "done";
  const subDone = t.subtasks.filter((x) => x.done).length;
  const daysLeft = t.due ? daysBetween(today, t.due) : null;
  const edge =
    risks[0] === "overdue"
      ? "before:bg-danger"
      : risks[0] === "tight"
        ? "before:bg-accent"
        : "before:bg-transparent";

  return (
    <article
      draggable
      onDragStart={(e) => {
        e.dataTransfer.setData(DRAG_MIME, t.id);
        e.dataTransfer.effectAllowed = "move";
      }}
      onDragOver={(e) => {
        if (e.dataTransfer.types.includes(DRAG_MIME)) e.preventDefault();
      }}
      onDrop={onDrop}
      onClick={() => openTask(t.id)}
      className={cx(
        "group relative flex cursor-pointer flex-col gap-2 overflow-hidden rounded-lg border border-(--ui-stroke-secondary) bg-ink-950 px-3 py-2.5 transition-colors duration-100 hover:border-(--ui-stroke-primary)",
        "before:absolute before:inset-y-0 before:left-0 before:w-[2px]",
        edge,
        done && "opacity-75",
      )}
    >
      <div className="flex items-start gap-2">
        <span
          aria-label={t.priority}
          title={t.priority}
          className={cx(
            "mt-[5px] size-1.5 shrink-0 rounded-full",
            PRIORITY_DOT[t.priority],
          )}
        />
        <h3
          className={cx(
            "min-w-0 flex-1 text-body font-medium leading-snug text-fg",
            done && "line-through decoration-fg-faint",
          )}
        >
          {t.title || s.untitled}
        </h3>
        {done && <Icon name="check" size={14} className="mt-0.5 text-ok" />}
      </div>

      {(risks.length > 0 || t.topic || t.tags.length > 0) && (
        <div className="flex flex-wrap items-center gap-1">
          {risks.slice(0, 1).map((r) => (
            <Chip key={r} tone={riskLevel(r)}>
              {s.risk[r]}
            </Chip>
          ))}
          <TopicChip topic={t.topic ? topics[t.topic] : undefined} />
          {t.tags.slice(0, 2).map((x) => (
            <Chip key={x}>{x}</Chip>
          ))}
          {t.tags.length > 2 && (
            <span className="text-meta text-fg-faint">
              +{t.tags.length - 2}
            </span>
          )}
        </div>
      )}

      <div className="flex items-center gap-2">
        <Progress value={progress} status={t.status} className="flex-1" />
        <span className="w-8 text-right font-mono text-meta tabular-nums text-fg-faint">
          {Math.round(progress * 100)}%
        </span>
      </div>

      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-meta text-fg-faint">
        {done ? (
          <>
            {t.doneAt && (
              <span className="inline-flex items-center gap-1">
                <Icon name="check" size={11} />
                {s.doneOn(fmtDay(dayOf(t.doneAt)))}
              </span>
            )}
            {t.estimateH > 0 && <span>{s.est(fmtH(t.estimateH))}</span>}
          </>
        ) : (
          <>
            {t.due && daysLeft !== null && (
              <span
                className={cx(
                  "inline-flex items-center gap-1",
                  daysLeft < 0
                    ? "text-danger"
                    : daysLeft <= 2
                      ? "text-accent"
                      : "",
                )}
              >
                <Icon name="calendar-days" size={11} />
                {daysLeft < 0
                  ? s.overdueBy(-daysLeft)
                  : daysLeft <= 2
                    ? s.dueIn(daysLeft)
                    : s.due(fmtDay(t.due))}
              </span>
            )}
            {t.estimateH > 0 && (
              <span className="inline-flex items-center gap-1">
                <Icon name="clock" size={11} />
                {s.left(fmtH(remainingH(t)))}
              </span>
            )}
            {t.subtasks.length > 0 && (
              <span className="inline-flex items-center gap-1">
                <Icon name="check" size={11} />
                {subDone}/{t.subtasks.length}
              </span>
            )}
          </>
        )}
        {t.sessionIds.length > 0 && (
          <span
            className={cx(
              "ml-auto inline-flex items-center gap-1",
              live.working > 0
                ? "text-working"
                : live.waiting > 0
                  ? "text-accent"
                  : "",
            )}
          >
            <Icon name="terminal" size={11} />
            {live.working > 0
              ? s.running
              : live.waiting > 0
                ? s.waitingYou
                : t.sessionIds.length}
          </span>
        )}
      </div>
    </article>
  );
}

function dayOf(ms: number): string {
  const d = new Date(ms);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

function QuickAdd({ status }: { status: TaskStatus }) {
  const { s, update, defaultTopic } = useBoardCtx();
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState("");
  if (!editing)
    return (
      <button
        type="button"
        onClick={() => setEditing(true)}
        className={cx(btn.ghost, "w-full justify-start text-fg-faint")}
      >
        <Icon name="plus" size={13} />
        {s.addTo(s.status[status])}
      </button>
    );
  return (
    <input
      autoFocus
      value={text}
      placeholder={s.addPlaceholder}
      onChange={(e) => setText(e.target.value)}
      onBlur={() => {
        if (!text.trim()) setEditing(false);
      }}
      onKeyDown={(e) => {
        if (e.key === "Escape") {
          setText("");
          setEditing(false);
        }
        if (e.key !== "Enter" || e.nativeEvent.isComposing) return;
        const title = text.trim();
        if (!title) return;
        update((d) => ({
          ...d,
          tasks: [
            ...d.tasks,
            blankTask(d, title, { status, topic: defaultTopic }),
          ],
        }));
        setText("");
      }}
      className={input}
    />
  );
}
