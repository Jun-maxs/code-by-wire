import { useCallback, useContext, useEffect, useMemo, useState } from "react";
import {
  MAX_DAILY_LOG,
  blankBrief,
  blankTask,
  completeTaskWithBrief,
  dismissBrief,
  dismissTask,
  mergedDailyBriefs,
  reopenTask,
  splitPendingQueue,
  upsertBriefText,
  type BoardTask,
  type DailyBrief,
  type TaskStatus,
} from "@shared/board";
import { productForSession } from "@shared/products";
import type { Session } from "@shared/types";
import { useI18n } from "../i18n";
import { cx } from "../ui/atoms";
import { Icon, type IconName } from "../ui/icons";
import { ProductsContext } from "../products/products-context";
import { TopicsSection } from "../settings/TopicsSection";
import { onOpenTask, takePendingTask } from "./board-bus";
import { BoardContext, buildLiveByTask, type BoardCtx } from "./context";
import { DailyDigestPanel } from "./DailyDigestPanel";
import { InsightPanel } from "./InsightPanel";
import { PendingQueuePanel } from "./PendingQueuePanel";
import { btn } from "./parts";
import { boardStrings } from "./strings";
import { Sheet, TaskDrawer } from "./TaskDrawer";
import { TopicBar } from "./TopicBar";
import { useBoard } from "./use-board";

type ViewMode = "split" | "queue" | "digest";

const MODES: { id: ViewMode; icon: IconName }[] = [
  { id: "split", icon: "layout-grid" },
  { id: "queue", icon: "square-kanban" },
  { id: "digest", icon: "scroll-text" },
];

let lastMode: ViewMode = "split";
let lastTopic = "all";

/**
 * The refactored work board (2026-11-13):
 * 1. Pending confirmations & queued execution tasks (`PendingQueuePanel`)
 * 2. Daily implementation digest (`DailyDigestPanel`)
 */
export function BoardView({
  sessions,
  onOpenSession,
  onNewSession,
}: {
  sessions: Session[];
  onOpenSession: (id: string) => void;
  /** Spawn a session in `cwd`; resolves to its id. */
  onNewSession: (cwd: string) => Promise<string>;
}) {
  const { locale } = useI18n();
  const s = boardStrings(locale);
  const api = useBoard(sessions);
  const products = useContext(ProductsContext);
  const [mode, setModeState] = useState<ViewMode>(lastMode);
  const setMode = (m: ViewMode) => {
    lastMode = m;
    setModeState(m);
  };
  const [query, setQuery] = useState("");
  const [taskId, setTaskId] = useState<string | null>(takePendingTask);
  useEffect(() => onOpenTask(setTaskId), []);
  const [panel, setPanel] = useState<"insight" | "topics" | null>(null);
  const [topic, setTopicState] = useState<string>(lastTopic);
  const setTopic = (t: string) => {
    lastTopic = t;
    setTopicState(t);
  };

  const sessionsById = useMemo(
    () => new Map(sessions.map((x) => [x.id, x])),
    [sessions],
  );
  const sessionTopic = useCallback(
    (x: Session) => (products ? productForSession(products, x) : null),
    [products],
  );
  const sessionTitle = useCallback(
    (x: Session) => products?.titles[x.id] ?? x.title,
    [products],
  );

  const newSessionFor = useCallback(
    async (task: BoardTask) => {
      const own = task.sessionIds
        .map((id) => sessionsById.get(id))
        .filter((x): x is Session => !!x?.cwd)
        .sort((a, b) => b.lastActivityMs - a.lastActivityMs)[0];
      const repo = task.topic
        ? products?.products[task.topic]?.repos[0]
        : undefined;
      const any = [...sessions]
        .filter((x) => x.cwd)
        .sort((a, b) => b.lastActivityMs - a.lastActivityMs)[0];
      const cwd = own?.cwd ?? repo ?? any?.cwd;
      if (!cwd) return null;
      try {
        const id = await onNewSession(cwd);
        api.update((d) => ({
          ...d,
          tasks: d.tasks.map((t) =>
            t.id === task.id
              ? {
                  ...t,
                  sessionIds: [...t.sessionIds, id],
                  status:
                    t.status === "todo" || t.status === "decide"
                      ? "doing"
                      : t.status,
                }
              : t,
          ),
        }));
        return id;
      } catch {
        return null;
      }
    },
    [sessionsById, sessions, products, onNewSession, api],
  );

  const inTopic = useCallback(
    (k: string | null) =>
      topic === "all" || (topic === "none" ? !k : k === topic),
    [topic],
  );
  const viewDoc = useMemo(
    () => ({
      ...api.doc,
      tasks: api.doc.tasks.filter((t) => inTopic(t.topic)),
      ideas: api.doc.ideas.filter((i) => inTopic(i.topic)),
    }),
    [api.doc, inTopic],
  );
  const defaultTopic = topic === "all" || topic === "none" ? null : topic;

  const completeTask = useCallback(
    (id: string) => {
      api.update((d) => completeTaskWithBrief(d, id, api.today));
    },
    [api],
  );

  const reopenTaskById = useCallback(
    (id: string, status: Exclude<TaskStatus, "done"> = "todo") => {
      api.update((d) => reopenTask(d, id, status));
    },
    [api],
  );

  const dismissTaskById = useCallback(
    (id: string) => {
      api.update((d) => dismissTask(d, id));
    },
    [api],
  );

  const addManualBrief = useCallback(
    (text: string, briefTopic?: string | null, date?: string) => {
      const clean = text.trim();
      if (!clean) return;
      api.update((d) => ({
        ...d,
        dailyLog: [
          blankBrief(date ?? api.today, clean, {
            topic: briefTopic ?? defaultTopic,
            source: "manual",
          }),
          ...d.dailyLog,
        ].slice(0, MAX_DAILY_LOG),
      }));
    },
    [api, defaultTopic],
  );

  const editBriefText = useCallback(
    (brief: DailyBrief, nextText: string) => {
      api.update((d) => upsertBriefText(d, brief, nextText));
    },
    [api],
  );

  const removeBrief = useCallback(
    (brief: Pick<DailyBrief, "id" | "syncKey" | "date" | "topic" | "text">) => {
      api.update((d) => dismissBrief(d, brief));
    },
    [api],
  );

  // 1-line top telemetry summary (DESIGN.md: compress metrics into a 1-line summary bar).
  const telemetry = useMemo(() => {
    const liveByTask = buildLiveByTask(viewDoc.tasks, sessionsById);
    const groups = splitPendingQueue(viewDoc.tasks, api.today, liveByTask);
    const linkedOpen = new Set(
      api.doc.tasks
        .filter((t) => t.status !== "done")
        .flatMap((t) => t.sessionIds),
    );
    const unlinkedWaiting = sessions.filter(
      (x) =>
        !x.parentSessionId &&
        x.state === "waiting" &&
        !linkedOpen.has(x.id) &&
        inTopic(sessionTopic(x)),
    ).length;
    const todayBriefs = mergedDailyBriefs(api.doc, { topic }).filter(
      (b) => b.date === api.today,
    ).length;
    return {
      confirm: groups.confirm.length + unlinkedWaiting,
      execute: groups.execute.length,
      todayBriefs,
    };
  }, [
    viewDoc.tasks,
    api.doc,
    api.today,
    sessionsById,
    sessions,
    inTopic,
    sessionTopic,
    topic,
  ]);

  const ctx: BoardCtx = {
    ...api,
    doc: viewDoc,
    rawDoc: api.doc,
    topicFilter: topic,
    defaultTopic,
    s,
    sessions,
    sessionsById,
    topics: products?.products ?? {},
    sessionTopic,
    sessionTitle,
    openSession: onOpenSession,
    newSessionFor,
    openTask: setTaskId,
    completeTask,
    reopenTaskById,
    dismissTaskById,
    addManualBrief,
    editBriefText,
    removeBrief,
  };

  const createTask = () => {
    const task = blankTask(api.doc, "", {
      topic: defaultTopic,
      status: "todo",
    });
    api.update((d) => ({ ...d, tasks: [task, ...d.tasks] }));
    setTaskId(task.id);
  };

  const closeTask = () => {
    const t = api.doc.tasks.find((x) => x.id === taskId);
    if (
      t &&
      !t.title.trim() &&
      !t.summary.trim() &&
      t.subtasks.length === 0 &&
      t.sessionIds.length === 0 &&
      !t.notes
    )
      api.update((d) => ({
        ...d,
        tasks: d.tasks.filter((x) => x.id !== t.id),
      }));
    setTaskId(null);
  };

  return (
    <BoardContext.Provider value={ctx}>
      <div className="@container relative flex h-full min-h-0 flex-col">
        {/* Top bar: 3-mode switch with inline counts + search + sync + AI review + single primary button */}
        <div className="flex shrink-0 flex-wrap items-center gap-2 px-5 py-2.5">
          <nav
            className="flex items-center rounded-lg border border-(--ui-stroke-tertiary) p-[3px]"
            aria-label={s.title}
          >
            {MODES.map((x) => {
              const modeCount =
                x.id === "queue"
                  ? telemetry.confirm + telemetry.execute
                  : x.id === "digest"
                    ? telemetry.todayBriefs
                    : 0;
              return (
                <button
                  key={x.id}
                  type="button"
                  aria-pressed={mode === x.id}
                  onClick={() => setMode(x.id)}
                  className={cx(
                    "inline-flex h-7 items-center gap-1.5 rounded-md px-2.5 text-body transition-colors duration-100",
                    mode === x.id
                      ? "bg-(--ui-control-active-background) font-medium text-fg"
                      : "text-fg-faint hover:text-fg",
                  )}
                >
                  <Icon name={x.icon} size={14} />
                  <span>{s.modes[x.id]}</span>
                  {x.id === "queue" && telemetry.confirm > 0 && (
                    <span
                      aria-hidden
                      className="size-1.5 rounded-full bg-accent"
                    />
                  )}
                  {modeCount > 0 && (
                    <span className="font-mono text-meta tabular-nums text-fg-faint">
                      {modeCount}
                    </span>
                  )}
                </button>
              );
            })}
          </nav>

          <div className="ml-auto flex items-center gap-1.5">
            <label className="relative flex items-center">
              <Icon
                name="search"
                size={13}
                className="pointer-events-none absolute left-2 text-fg-faint"
              />
              <input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder={s.search}
                className="h-7 w-40 rounded-md border border-(--ui-stroke-tertiary) bg-transparent pl-7 pr-2 text-body text-fg outline-none placeholder:text-fg-dim focus:border-(--ui-stroke-primary) @4xl:w-52"
              />
            </label>

            <button
              type="button"
              disabled={api.syncing}
              onClick={() => void api.reload()}
              className={btn.ghost}
              title={s.syncNow}
            >
              <Icon
                name="rotate-ccw"
                size={13}
                className={api.syncing ? "animate-spin" : ""}
              />
              <span className="hidden @3xl:inline">
                {api.syncing ? s.syncing : s.syncShort}
              </span>
            </button>

            <button
              type="button"
              onClick={() => setPanel("insight")}
              className={btn.outline}
            >
              <Icon
                name={api.run.running ? "loader-circle" : "sparkles"}
                size={13}
                className={api.run.running ? "animate-spin" : ""}
              />
              {s.insight}
            </button>

            <button type="button" onClick={createTask} className={btn.primary}>
              <Icon name="plus" size={13} />
              {s.newTask}
            </button>
          </div>
        </div>

        {/* Horizontal product/topic strip */}
        <TopicBar
          topic={topic}
          onTopic={setTopic}
          onManage={() => setPanel("topics")}
        />

        {/* Workspace body: side-by-side split on >=768px container (covers both 1440x900 and 1084x655), bounded stacked panels below */}
        {mode === "split" ? (
          <div className="grid min-h-0 flex-1 grid-cols-1 gap-3.5 overflow-y-auto px-5 py-3 @3xl:grid-cols-[minmax(0,1.05fr)_minmax(0,1fr)] @3xl:overflow-hidden">
            <div className="min-w-0 @3xl:h-full @3xl:min-h-0">
              <PendingQueuePanel query={query} scrollBody="split" />
            </div>
            <div className="min-w-0 @3xl:h-full @3xl:min-h-0">
              <DailyDigestPanel query={query} scrollBody="split" />
            </div>
          </div>
        ) : (
          <div className="min-h-0 flex-1 overflow-hidden px-5 py-3">
            <div className="mx-auto h-full min-h-0 w-full max-w-[880px]">
              {mode === "queue" ? (
                <PendingQueuePanel query={query} scrollBody="focus" />
              ) : (
                <DailyDigestPanel query={query} scrollBody="focus" />
              )}
            </div>
          </div>
        )}

        {taskId && (
          <TaskDrawer key={taskId} taskId={taskId} onClose={closeTask} />
        )}
        {panel === "insight" && <InsightPanel onClose={() => setPanel(null)} />}
        {panel === "topics" && (
          <Sheet
            onClose={() => setPanel(null)}
            label={s.topicsManage}
            width={620}
          >
            <div className="flex items-center justify-between border-b border-ink-850 px-4 py-3">
              <div>
                <h2 className="text-subhead font-semibold text-fg">
                  {s.topicsManage}
                </h2>
                <p className="mt-0.5 text-aux text-fg-faint">{s.topicsLede}</p>
              </div>
              <button
                type="button"
                onClick={() => setPanel(null)}
                className={btn.ghost}
                aria-label="close"
              >
                <Icon name="x" size={15} />
              </button>
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4">
              <TopicsSection />
            </div>
          </Sheet>
        )}
      </div>
    </BoardContext.Provider>
  );
}
