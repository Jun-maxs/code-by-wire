import { useMemo, useState } from "react";
import {
  PRIORITIES,
  blankTask,
  dayKey,
  daysBetween,
  splitPendingQueue,
  type BoardTask,
  type Priority,
} from "@shared/board";
import { shortTopicName } from "@shared/products";
import type { Session } from "@shared/types";
import { cx } from "../ui/atoms";
import { Icon } from "../ui/icons";
import { buildLiveByTask, taskMatches, useBoardCtx } from "./context";
import {
  Chip,
  Dot,
  PRIORITY_TEXT,
  Panel,
  TopicChip,
  btn,
  inputInline,
} from "./parts";
import { fmtDay } from "./strings";

type QueueFilter = "all" | "confirm" | "execute" | "done";

const SPLIT_CONFIRM_PREVIEW = 4;

/**
 * Core Module 1: Pending Confirmations (`decide` + live `waiting` sessions) & Queued Execution
 * (`doing` + `todo`), with 1-line quick-add, 1-click approve-to-queue, session spawn/open, and
 * 1-click completion that logs straight into today's implementation digest.
 */
export function PendingQueuePanel({
  query,
  scrollBody,
}: {
  query: string;
  scrollBody: "split" | "focus";
}) {
  const ctx = useBoardCtx();
  const {
    doc,
    rawDoc,
    topicFilter,
    defaultTopic,
    s,
    today,
    sessions,
    sessionsById,
    topics,
    sessionTopic,
    sessionTitle,
    openSession,
    newSessionFor,
    openTask,
    update,
    completeTask,
    reopenTaskById,
    dismissTaskById,
  } = ctx;

  const [filter, setFilter] = useState<QueueFilter>("all");
  const [quickKind, setQuickKind] = useState<"decide" | "todo">("todo");
  const [quickTitle, setQuickTitle] = useState("");
  const [quickPriority, setQuickPriority] = useState<Priority>("P1");
  const [quickTopic, setQuickTopic] = useState<string>("");
  const [confirmCollapsed, setConfirmCollapsed] = useState(false);
  const [confirmShowAll, setConfirmShowAll] = useState(false);
  const [executeCollapsed, setExecuteCollapsed] = useState(false);
  const [doneExpanded, setDoneExpanded] = useState(false);
  const [spawningId, setSpawningId] = useState<string | null>(null);

  const topicNames = useMemo(() => {
    const out: Record<string, string> = {};
    for (const [k, p] of Object.entries(topics)) out[k] = p.name;
    return out;
  }, [topics]);

  const liveByTask = useMemo(
    () => buildLiveByTask(doc.tasks, sessionsById),
    [doc.tasks, sessionsById],
  );

  // Unlinked root sessions waiting on user reply (filtered by active topic & search query).
  const unlinkedWaiting = useMemo(() => {
    const linkedOpen = new Set(
      rawDoc.tasks
        .filter((t) => t.status !== "done")
        .flatMap((t) => t.sessionIds),
    );
    const ql = query.trim().toLowerCase();
    return sessions
      .filter(
        (x) =>
          !x.parentSessionId && x.state === "waiting" && !linkedOpen.has(x.id),
      )
      .filter((x) => {
        const tk = sessionTopic(x);
        if (topicFilter === "all") return true;
        if (topicFilter === "none") return !tk;
        return tk === topicFilter;
      })
      .filter((x) => !ql || sessionTitle(x).toLowerCase().includes(ql))
      .sort((a, b) => b.lastActivityMs - a.lastActivityMs);
  }, [rawDoc.tasks, sessions, sessionTopic, sessionTitle, topicFilter, query]);

  const matchedTasks = useMemo(
    () => doc.tasks.filter((t) => taskMatches(t, query, topicNames)),
    [doc.tasks, query, topicNames],
  );

  const groups = useMemo(
    () => splitPendingQueue(matchedTasks, today, liveByTask),
    [matchedTasks, today, liveByTask],
  );

  const confirmTotal = groups.confirm.length + unlinkedWaiting.length;
  const runningCount = groups.execute.filter(
    (t) => t.status === "doing" || (liveByTask.get(t.id)?.working ?? 0) > 0,
  ).length;

  const effectiveKind: "decide" | "todo" =
    filter === "confirm" ? "decide" : quickKind;

  const submitQuickAdd = () => {
    const title = quickTitle.trim();
    if (!title) return;
    const chosenTopic = defaultTopic ?? (quickTopic || null);
    update((d) => ({
      ...d,
      tasks: [
        blankTask(d, title, {
          status: effectiveKind,
          priority: quickPriority,
          topic: chosenTopic,
        }),
        ...d.tasks,
      ],
    }));
    setQuickTitle("");
  };

  const cyclePriority = () => {
    const idx = PRIORITIES.indexOf(quickPriority);
    setQuickPriority(PRIORITIES[(idx + 1) % PRIORITIES.length]);
  };

  const handleSessionAction = (t: BoardTask, latest: Session | undefined) => {
    if (latest) {
      openSession(latest.id);
      return;
    }
    setSpawningId(t.id);
    void newSessionFor(t)
      .then((id) => {
        if (id) openSession(id);
      })
      .finally(() => setSpawningId(null));
  };

  const showConfirm = filter === "all" || filter === "confirm";
  const showExecute = filter === "all" || filter === "execute";
  const showDoneOnly = filter === "done";

  // In split `all` overview, cap pending confirmations to the top 4 by default so `Queued for execution`
  // stays immediately visible in the first screen without scrolling past 15 items.
  const capConfirm =
    scrollBody === "split" &&
    filter === "all" &&
    !query.trim() &&
    !confirmShowAll &&
    groups.confirm.length > SPLIT_CONFIRM_PREVIEW;
  const visibleConfirmTasks = capConfirm
    ? groups.confirm.slice(0, SPLIT_CONFIRM_PREVIEW)
    : groups.confirm;
  const hiddenConfirmCount = groups.confirm.length - visibleConfirmTasks.length;

  return (
    <Panel
      title={s.queueTitle}
      className={cx(
        scrollBody === "focus"
          ? "h-full min-h-0"
          : "max-h-96 min-h-0 @3xl:h-full @3xl:max-h-none",
      )}
      right={
        <div className="flex items-center rounded-md border border-(--ui-stroke-tertiary) p-0.5">
          {(
            [
              {
                id: "all",
                label: s.qFilterAll,
                count: confirmTotal + groups.execute.length,
                amberDot: false,
              },
              {
                id: "confirm",
                label: s.qFilterConfirm,
                count: confirmTotal,
                amberDot: confirmTotal > 0,
              },
              {
                id: "execute",
                label: s.qFilterExecute,
                count: groups.execute.length,
                amberDot: false,
              },
              {
                id: "done",
                label: s.qFilterDone,
                count: groups.done.length,
                amberDot: false,
              },
            ] as const
          ).map((f) => (
            <button
              key={f.id}
              type="button"
              aria-pressed={filter === f.id}
              onClick={() => setFilter(f.id)}
              className={cx(
                "inline-flex h-6 items-center gap-1 rounded-sm px-2 text-aux transition-colors duration-100",
                filter === f.id
                  ? "bg-(--ui-control-active-background) font-medium text-fg"
                  : "text-fg-faint hover:text-fg",
              )}
            >
              {f.amberDot && (
                <span aria-hidden className="size-1.5 rounded-full bg-accent" />
              )}
              <span>{f.label}</span>
              {f.count > 0 && (
                <span className="font-mono text-meta tabular-nums text-fg-faint">
                  {f.count}
                </span>
              )}
            </button>
          ))}
        </div>
      }
    >
      {/* 1-line inline quick-add bar */}
      {!showDoneOnly && (
        <div className="flex items-center gap-1.5 border-b border-ink-850 px-4 py-2">
          <div className="inline-flex shrink-0 items-center rounded-md border border-(--ui-stroke-tertiary) bg-well p-0.5">
            <button
              type="button"
              aria-pressed={effectiveKind === "decide"}
              onClick={() => setQuickKind("decide")}
              className={cx(
                "inline-flex h-6 items-center rounded-sm px-2 text-aux transition-colors",
                effectiveKind === "decide"
                  ? "bg-(--ui-control-active-background) font-medium text-fg"
                  : "text-fg-faint hover:text-fg",
              )}
            >
              {s.quickKindConfirm}
            </button>
            <button
              type="button"
              aria-pressed={effectiveKind === "todo"}
              onClick={() => setQuickKind("todo")}
              className={cx(
                "inline-flex h-6 items-center rounded-sm px-2 text-aux transition-colors",
                effectiveKind === "todo"
                  ? "bg-(--ui-control-active-background) font-medium text-fg"
                  : "text-fg-faint hover:text-fg",
              )}
            >
              {s.quickKindExecute}
            </button>
          </div>

          <input
            value={quickTitle}
            onChange={(e) => setQuickTitle(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.nativeEvent.isComposing) {
                e.preventDefault();
                submitQuickAdd();
              }
            }}
            placeholder={
              effectiveKind === "decide"
                ? s.quickTaskPlaceholderConfirm
                : s.quickTaskPlaceholderExecute
            }
            className={cx(inputInline, "min-w-0 flex-1")}
          />

          {defaultTopic === null && Object.keys(topics).length > 0 && (
            <select
              value={quickTopic}
              onChange={(e) => setQuickTopic(e.target.value)}
              aria-label={s.fTopic}
              className={cx(inputInline, "w-20 shrink-0 px-1.5 text-aux")}
            >
              <option value="">{s.fNoTopic}</option>
              {Object.values(topics).map((p) => (
                <option key={p.key} value={p.key}>
                  {shortTopicName(p.name)}
                </option>
              ))}
            </select>
          )}

          <button
            type="button"
            onClick={cyclePriority}
            title={s.fPriority}
            className={cx(
              "inline-flex h-7 shrink-0 items-center justify-center rounded-md border border-(--ui-stroke-tertiary) bg-well px-2 font-mono text-aux hover:text-fg",
              PRIORITY_TEXT[quickPriority],
            )}
          >
            {quickPriority}
          </button>

          {quickTitle.trim().length > 0 && (
            <button
              type="button"
              onClick={submitQuickAdd}
              className={btn.outline}
            >
              <Icon name="plus" size={13} />
              {s.quickAddBtn}
            </button>
          )}
        </div>
      )}

      {/* Queue body */}
      <div className="min-h-0 flex-1 overflow-y-auto overflow-x-hidden divide-y divide-ink-850">
        {showDoneOnly ? (
          groups.done.length === 0 ? (
            <p className="px-4 py-8 text-center text-aux text-fg-faint">
              {s.emptyQueueFiltered}
            </p>
          ) : (
            <div className="divide-y divide-ink-850">
              {groups.done.map((t) => (
                <DoneTaskRow
                  key={t.id}
                  task={t}
                  onOpen={() => openTask(t.id)}
                  onReopen={() => reopenTaskById(t.id, "todo")}
                  onDismiss={() => dismissTaskById(t.id)}
                />
              ))}
            </div>
          )
        ) : (
          <>
            {/* Section 1: Pending Confirmations */}
            {showConfirm && (
              <div className="flex flex-col">
                <button
                  type="button"
                  aria-expanded={!confirmCollapsed}
                  onClick={() => setConfirmCollapsed((v) => !v)}
                  className="flex w-full items-center justify-between gap-2 bg-ink-950/60 px-4 py-2 text-left transition-colors hover:bg-(--ui-row-hover-background)"
                >
                  <div className="flex items-center gap-2">
                    <Dot
                      className={confirmTotal > 0 ? "bg-accent" : "bg-idle"}
                    />
                    <span className="text-aux font-semibold text-fg">
                      {s.sectionConfirm}
                    </span>
                    <span className="font-mono text-meta tabular-nums text-fg-faint">
                      {confirmTotal}
                    </span>
                  </div>
                  <Icon
                    name={confirmCollapsed ? "chevron-right" : "chevron-down"}
                    size={13}
                    className="text-fg-faint"
                  />
                </button>

                {!confirmCollapsed &&
                  (confirmTotal === 0 ? (
                    <p className="px-4 py-3 text-aux text-fg-faint">
                      {s.emptyConfirm}
                    </p>
                  ) : (
                    <div className="divide-y divide-ink-850">
                      {unlinkedWaiting.map((sess) => {
                        const tk = sessionTopic(sess);
                        const tp = tk ? topics[tk] : undefined;
                        return (
                          <div
                            key={sess.id}
                            className="flex items-center gap-2.5 px-4 py-2.5 transition-colors hover:bg-(--ui-row-hover-background)"
                          >
                            <Dot className="bg-accent animate-pulse" />
                            <TopicChip topic={tp} />
                            <div className="min-w-0 flex-1">
                              <button
                                type="button"
                                onClick={() => openSession(sess.id)}
                                className="block max-w-full truncate text-left text-body font-medium text-fg hover:underline"
                              >
                                {sessionTitle(sess)}
                              </button>
                            </div>
                            <Chip tone="mid">{s.waitingSessionTag}</Chip>
                            <button
                              type="button"
                              onClick={() => openSession(sess.id)}
                              className={btn.soft}
                            >
                              <Icon name="arrow-up-right" size={12} />
                              {s.openSessionBtn}
                            </button>
                          </div>
                        );
                      })}

                      {visibleConfirmTasks.map((t) => (
                        <TaskQueueRow
                          key={t.id}
                          task={t}
                          inConfirm
                          today={today}
                          spawning={spawningId === t.id}
                          onOpen={() => openTask(t.id)}
                          onApprove={() =>
                            update((d) => ({
                              ...d,
                              tasks: d.tasks.map((x) =>
                                x.id === t.id ? { ...x, status: "todo" } : x,
                              ),
                            }))
                          }
                          onMarkDecide={() => undefined}
                          onSessionAction={(latest) =>
                            handleSessionAction(t, latest)
                          }
                          onComplete={() => completeTask(t.id)}
                          onDismiss={() => dismissTaskById(t.id)}
                        />
                      ))}

                      {(hiddenConfirmCount > 0 ||
                        (confirmShowAll &&
                          scrollBody === "split" &&
                          filter === "all" &&
                          groups.confirm.length > SPLIT_CONFIRM_PREVIEW)) && (
                        <button
                          type="button"
                          onClick={() => setConfirmShowAll((v) => !v)}
                          className="flex w-full items-center justify-center gap-1.5 py-2 text-aux text-fg-faint transition-colors hover:bg-(--ui-row-hover-background) hover:text-fg"
                        >
                          <Icon
                            name={
                              confirmShowAll ? "chevron-up" : "chevron-down"
                            }
                            size={12}
                          />
                          <span>
                            {confirmShowAll
                              ? s.collapseConfirm
                              : s.expandMoreConfirm(hiddenConfirmCount)}
                          </span>
                        </button>
                      )}
                    </div>
                  ))}
              </div>
            )}

            {/* Section 2: Queued for Execution (`doing` + `todo`) */}
            {showExecute && (
              <div className="flex flex-col">
                <button
                  type="button"
                  aria-expanded={!executeCollapsed}
                  onClick={() => setExecuteCollapsed((v) => !v)}
                  className="flex w-full items-center justify-between gap-2 bg-ink-950/60 px-4 py-2 text-left transition-colors hover:bg-(--ui-row-hover-background)"
                >
                  <div className="flex items-center gap-2">
                    <Dot
                      className={runningCount > 0 ? "bg-working" : "bg-idle"}
                    />
                    <span className="text-aux font-semibold text-fg">
                      {s.sectionExecute}
                    </span>
                    <span className="font-mono text-meta tabular-nums text-fg-faint">
                      {groups.execute.length}
                    </span>
                  </div>
                  <div className="flex items-center gap-2">
                    {runningCount > 0 && (
                      <span className="inline-flex items-center gap-1.5 text-meta text-fg-muted">
                        <span
                          aria-hidden
                          className="size-1.5 rounded-full bg-working"
                        />
                        {s.sectionExecuteRunning(runningCount)}
                      </span>
                    )}
                    <Icon
                      name={executeCollapsed ? "chevron-right" : "chevron-down"}
                      size={13}
                      className="text-fg-faint"
                    />
                  </div>
                </button>

                {!executeCollapsed &&
                  (groups.execute.length === 0 ? (
                    <p className="px-4 py-4 text-aux text-fg-faint">
                      {query.trim() ? s.emptyQueueFiltered : s.emptyExecute}
                    </p>
                  ) : (
                    <div className="divide-y divide-ink-850">
                      {groups.execute.map((t) => (
                        <TaskQueueRow
                          key={t.id}
                          task={t}
                          inConfirm={false}
                          today={today}
                          spawning={spawningId === t.id}
                          onOpen={() => openTask(t.id)}
                          onApprove={() => undefined}
                          onMarkDecide={() =>
                            update((d) => ({
                              ...d,
                              tasks: d.tasks.map((x) =>
                                x.id === t.id ? { ...x, status: "decide" } : x,
                              ),
                            }))
                          }
                          onSessionAction={(latest) =>
                            handleSessionAction(t, latest)
                          }
                          onComplete={() => completeTask(t.id)}
                          onDismiss={() => dismissTaskById(t.id)}
                        />
                      ))}
                    </div>
                  ))}
              </div>
            )}

            {/* Collapsible recent done footer */}
            {filter === "all" && groups.done.length > 0 && (
              <div className="flex flex-col">
                <button
                  type="button"
                  aria-expanded={doneExpanded}
                  onClick={() => setDoneExpanded((v) => !v)}
                  className="flex items-center gap-1.5 px-4 py-2 text-left text-aux text-fg-faint hover:bg-(--ui-row-hover-background) hover:text-fg"
                >
                  <Icon
                    name={doneExpanded ? "chevron-down" : "chevron-right"}
                    size={13}
                  />
                  <span>{s.sectionDone(groups.done.length)}</span>
                </button>
                {doneExpanded && (
                  <div className="divide-y divide-ink-850 border-t border-ink-850">
                    {groups.done.slice(0, 10).map((t) => (
                      <DoneTaskRow
                        key={t.id}
                        task={t}
                        onOpen={() => openTask(t.id)}
                        onReopen={() => reopenTaskById(t.id, "todo")}
                        onDismiss={() => dismissTaskById(t.id)}
                      />
                    ))}
                  </div>
                )}
              </div>
            )}
          </>
        )}
      </div>
    </Panel>
  );
}

function TaskQueueRow({
  task,
  inConfirm,
  today,
  spawning,
  onOpen,
  onApprove,
  onMarkDecide,
  onSessionAction,
  onComplete,
  onDismiss,
}: {
  task: BoardTask;
  inConfirm: boolean;
  today: string;
  spawning: boolean;
  onOpen: () => void;
  onApprove: () => void;
  onMarkDecide: () => void;
  onSessionAction: (latest: Session | undefined) => void;
  onComplete: () => void;
  onDismiss: () => void;
}) {
  const { s, topics, sessionsById } = useBoardCtx();
  const topic = task.topic ? topics[task.topic] : undefined;
  const linkedSessions = task.sessionIds
    .map((id) => sessionsById.get(id))
    .filter((x): x is Session => !!x)
    .sort((a, b) => b.lastActivityMs - a.lastActivityMs);
  const latestSession = linkedSessions[0];
  const waitingCount = linkedSessions.filter(
    (x) => x.state === "waiting",
  ).length;
  const workingCount = linkedSessions.filter(
    (x) => x.state === "working",
  ).length;
  const isLiveRunning = workingCount > 0 || task.status === "doing";
  const doneSteps = task.subtasks.filter((st) => st.done).length;
  const deltaDays = task.due ? daysBetween(today, task.due) : null;

  return (
    <div className="group flex items-start gap-2.5 px-4 py-2.5 transition-colors hover:bg-(--ui-row-hover-background)">
      {/* Queued execution items expose a 1-click completion circle; pending confirmation items avoid accidental tick-done before deciding. */}
      {!inConfirm && (
        <button
          type="button"
          onClick={onComplete}
          title={s.completeAndLog}
          aria-label={s.completeAndLog}
          className="mt-1 grid size-4 shrink-0 place-items-center rounded-full border border-(--ui-stroke-primary) text-transparent transition-colors hover:border-fg hover:text-fg"
        >
          <Icon name="check" size={10} />
        </button>
      )}

      <div className="min-w-0 flex-1">
        <div className="flex items-start gap-1.5">
          {waitingCount > 0 && (
            <Dot className="mt-1.5 bg-accent animate-pulse" />
          )}
          {!inConfirm && waitingCount === 0 && isLiveRunning && (
            <Dot className="mt-1.5 bg-working" />
          )}
          {topic && (
            <span className="mt-0.5 shrink-0">
              <TopicChip topic={topic} />
            </span>
          )}
          <button
            type="button"
            onClick={onOpen}
            className="min-w-0 flex-1 text-left text-body font-medium leading-relaxed text-fg hover:underline"
          >
            {task.title || s.untitled}
          </button>
        </div>

        {(task.summary ||
          task.due ||
          task.subtasks.length > 0 ||
          linkedSessions.length > 0 ||
          task.priority !== "P1") && (
          <div className="mt-1 flex flex-wrap items-center gap-x-2.5 gap-y-1 text-meta text-fg-faint">
            {task.summary && (
              <span className="line-clamp-1 text-aux text-fg-muted">
                {task.summary}
              </span>
            )}
            {waitingCount > 0 && <Chip tone="mid">{s.waitingSessionTag}</Chip>}
            {waitingCount === 0 && isLiveRunning && (
              <span className="inline-flex items-center gap-1 text-fg-muted">
                <span
                  aria-hidden
                  className="size-1.5 rounded-full bg-working"
                />
                {s.running}
              </span>
            )}
            {linkedSessions.length > 0 && waitingCount === 0 && (
              <span>{s.sessions(linkedSessions.length)}</span>
            )}
            {task.subtasks.length > 0 && (
              <span className="font-mono tabular-nums">
                {s.subtaskCount(doneSteps, task.subtasks.length)}
              </span>
            )}
            {task.due && deltaDays !== null && (
              <span
                className={cx(
                  "inline-flex items-center gap-1 font-mono tabular-nums",
                  deltaDays < 0
                    ? "text-danger"
                    : deltaDays <= 1
                      ? "text-accent"
                      : "text-fg-faint",
                )}
              >
                {deltaDays < 0
                  ? s.overdueBy(-deltaDays)
                  : deltaDays === 0
                    ? s.dueToday
                    : s.due(fmtDay(task.due))}
              </span>
            )}
            {task.priority !== "P1" && (
              <span className={cx("font-mono", PRIORITY_TEXT[task.priority])}>
                {task.priority}
              </span>
            )}
          </div>
        )}
      </div>

      {/* Right 1-click action cluster: soft primary pill + quiet secondary actions */}
      <div className="flex shrink-0 items-center gap-1">
        {inConfirm && task.status === "decide" ? (
          <>
            <button
              type="button"
              onClick={onApprove}
              className={btn.soft}
              title={s.approveToTodo}
            >
              <Icon name="arrow-right" size={12} />
              {s.approveToTodo}
            </button>
            <button
              type="button"
              disabled={spawning}
              onClick={() => onSessionAction(latestSession)}
              title={latestSession ? s.openSessionBtn : s.spawnSession}
              aria-label={latestSession ? s.openSessionBtn : s.spawnSession}
              className="grid size-6 place-items-center rounded-sm text-fg-faint opacity-0 transition-opacity group-hover:opacity-100 focus:opacity-100 hover:bg-(--ui-control-hover-background) hover:text-fg"
            >
              <Icon
                name={
                  spawning
                    ? "loader-circle"
                    : latestSession
                      ? "arrow-up-right"
                      : "rocket"
                }
                size={12}
                className={spawning ? "animate-spin" : ""}
              />
            </button>
          </>
        ) : (
          <button
            type="button"
            disabled={spawning}
            onClick={() => onSessionAction(latestSession)}
            className={btn.soft}
            title={latestSession ? s.openSessionBtn : s.spawnSession}
          >
            <Icon
              name={
                spawning
                  ? "loader-circle"
                  : latestSession
                    ? "arrow-up-right"
                    : "rocket"
              }
              size={12}
              className={spawning ? "animate-spin" : ""}
            />
            {latestSession ? s.openSessionBtn : s.spawnSession}
          </button>
        )}

        {!inConfirm && (
          <button
            type="button"
            onClick={onMarkDecide}
            title={s.markDecide}
            aria-label={s.markDecide}
            className="grid size-6 place-items-center rounded-sm text-fg-faint opacity-0 transition-opacity group-hover:opacity-100 focus:opacity-100 hover:bg-(--ui-control-hover-background) hover:text-fg"
          >
            <Icon name="flag" size={12} />
          </button>
        )}

        <button
          type="button"
          onClick={onDismiss}
          title={s.dismissItem}
          aria-label={s.dismissItem}
          className="grid size-6 place-items-center rounded-sm text-fg-faint opacity-0 transition-opacity group-hover:opacity-100 focus:opacity-100 hover:bg-(--ui-control-hover-background) hover:text-fg"
        >
          <Icon name="x" size={13} />
        </button>
      </div>
    </div>
  );
}

function DoneTaskRow({
  task,
  onOpen,
  onReopen,
  onDismiss,
}: {
  task: BoardTask;
  onOpen: () => void;
  onReopen: () => void;
  onDismiss: () => void;
}) {
  const { s, topics } = useBoardCtx();
  const topic = task.topic ? topics[task.topic] : undefined;
  const doneDay = task.doneAt ? dayKey(new Date(task.doneAt)) : null;

  return (
    <div className="group flex items-center gap-2.5 px-4 py-2 transition-colors hover:bg-(--ui-row-hover-background)">
      <button
        type="button"
        onClick={onReopen}
        title={s.reopenTask}
        aria-label={s.reopenTask}
        className="grid size-4 shrink-0 place-items-center rounded-full border border-(--ui-stroke-tertiary) bg-(--ui-bg-tertiary) text-ok hover:border-fg"
      >
        <Icon name="check" size={10} />
      </button>
      <TopicChip topic={topic} />
      <button
        type="button"
        onClick={onOpen}
        className="min-w-0 flex-1 truncate text-left text-body text-fg-faint line-through hover:text-fg"
      >
        {task.title || s.untitled}
      </button>
      {doneDay && (
        <span className="shrink-0 font-mono text-meta tabular-nums text-fg-faint">
          {s.doneOn(fmtDay(doneDay))}
        </span>
      )}
      <button
        type="button"
        onClick={onDismiss}
        title={s.dismissItem}
        aria-label={s.dismissItem}
        className="grid size-6 shrink-0 place-items-center rounded-sm text-fg-faint opacity-0 transition-opacity group-hover:opacity-100 hover:bg-(--ui-control-hover-background) hover:text-fg"
      >
        <Icon name="x" size={13} />
      </button>
    </div>
  );
}
