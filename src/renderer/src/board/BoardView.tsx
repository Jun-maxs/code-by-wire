import { useCallback, useContext, useEffect, useMemo, useState } from "react";
import { blankTask, type BoardTask } from "@shared/board";
import { productForSession } from "@shared/products";
import type { Session } from "@shared/types";
import { useI18n } from "../i18n";
import { cx } from "../ui/atoms";
import { Icon, type IconName } from "../ui/icons";
import { ProductsContext } from "../products/products-context";
import { BoardContext, type BoardCtx } from "./context";
import { InsightPanel, ImportDialog } from "./InsightPanel";
import { KanbanTab } from "./KanbanTab";
import { OverviewTab } from "./OverviewTab";
import { HabitsTab, IdeasTab, ScheduleTab } from "./PlanTabs";
import { Sheet, TaskDrawer } from "./TaskDrawer";
import { TopicRail } from "./TopicRail";
import { TopicsSection } from "../settings/TopicsSection";
import { btn } from "./parts";
import { boardStrings } from "./strings";
import { useBoard } from "./use-board";
import { onOpenTask, takePendingTask } from "./session-tasks";

type Tab = "overview" | "kanban" | "schedule" | "ideas" | "habits";
const TABS: { id: Tab; icon: IconName }[] = [
  { id: "overview", icon: "house" },
  { id: "kanban", icon: "square-kanban" },
  { id: "schedule", icon: "calendar-days" },
  { id: "ideas", icon: "lightbulb" },
  { id: "habits", icon: "repeat" },
];

let lastTab: Tab = "overview";
let lastTopic = "all";

/**
 * The work board (fork feature, 2026-10-28): tasks that each carry agent sessions, laid out as an
 * overview, a kanban, a 14-day schedule, an idea inbox and daily habits, with an AI insight report.
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
  const [tab, setTabState] = useState<Tab>(lastTab);
  const setTab = (t: Tab) => {
    lastTab = t;
    setTabState(t);
  };
  const [query, setQuery] = useState("");
  // A task asked for from outside the board (a session's task chip) opens on arrival.
  const [taskId, setTaskId] = useState<string | null>(takePendingTask);
  useEffect(() => onOpenTask(setTaskId), []);
  const [panel, setPanel] = useState<"insight" | "import" | "topics" | null>(
    null,
  );
  // "all", "none" (tasks without a topic) or a topic key; remembered across visits like the tab.
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
      // Run where the task's work already happens: its newest session's folder, else the topic's
      // first repo, else wherever the newest session overall ran.
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
                  status: t.status === "todo" ? "doing" : t.status,
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

  // Every page reads the board through the topic filter; edits still go to the whole document.
  const inTopic = (k: string | null) =>
    topic === "all" || (topic === "none" ? !k : k === topic);
  const viewDoc = useMemo(
    () => ({
      ...api.doc,
      tasks: api.doc.tasks.filter((t) => inTopic(t.topic)),
      ideas: api.doc.ideas.filter((i) => inTopic(i.topic)),
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [api.doc, topic],
  );
  const defaultTopic = topic === "all" || topic === "none" ? null : topic;

  const ctx: BoardCtx = {
    ...api,
    doc: viewDoc,
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
  };

  const createTask = () => {
    const task = blankTask(api.doc, "", { topic: defaultTopic });
    api.update((d) => ({ ...d, tasks: [...d.tasks, task] }));
    setTaskId(task.id);
  };
  // A task left without a title when its drawer closes was an abandoned "new task".
  const closeTask = () => {
    const t = api.doc.tasks.find((x) => x.id === taskId);
    if (
      t &&
      !t.title.trim() &&
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

  const empty =
    api.loaded &&
    api.doc.tasks.length === 0 &&
    (tab === "overview" || tab === "kanban");

  return (
    <BoardContext.Provider value={ctx}>
      <div className="relative flex h-full min-h-0 flex-col">
        <div className="flex shrink-0 flex-wrap items-center gap-2 px-5 py-3">
          <nav
            className="flex items-center rounded-lg border border-(--ui-stroke-tertiary) p-[3px]"
            aria-label={s.title}
          >
            {TABS.map((x) => (
              <button
                key={x.id}
                type="button"
                aria-pressed={tab === x.id}
                onClick={() => setTab(x.id)}
                className={cx(
                  "inline-flex h-7 items-center gap-1.5 rounded-md px-3 text-body transition-colors duration-100",
                  tab === x.id
                    ? "bg-(--ui-control-active-background) font-medium text-fg"
                    : "text-fg-faint hover:text-fg",
                )}
              >
                <Icon name={x.icon} size={14} />
                {s.tabs[x.id]}
              </button>
            ))}
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
                className="h-7 w-48 rounded-md border border-(--ui-stroke-tertiary) bg-transparent pl-7 pr-2 text-body text-fg outline-none placeholder:text-fg-faint focus:border-(--ui-stroke-primary)"
              />
            </label>
            {products && Object.keys(products.products).length > 0 && (
              <button
                type="button"
                onClick={() => setPanel("import")}
                className={btn.ghost}
                title={s.importTopics}
              >
                <Icon name="tag" size={14} />
                <span className="hidden 2xl:inline">{s.importTopics}</span>
              </button>
            )}
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

        <div className="flex min-h-0 flex-1">
          {tab !== "habits" && (
            <TopicRail
              topic={topic}
              onTopic={setTopic}
              onManage={() => setPanel("topics")}
              tasks={api.doc.tasks}
            />
          )}
          <div
            className={cx(
              "min-w-0 min-h-0 flex-1",
              tab === "kanban" || tab === "schedule" ? "" : "overflow-y-auto",
            )}
          >
            {empty ? (
              <EmptyBoard
                onNew={createTask}
                onImport={products ? () => setPanel("import") : null}
              />
            ) : tab === "overview" ? (
              <OverviewTab onOpenInsight={() => setPanel("insight")} />
            ) : tab === "kanban" ? (
              <KanbanTab query={query} />
            ) : tab === "schedule" ? (
              <ScheduleTab query={query} />
            ) : tab === "ideas" ? (
              <IdeasTab query={query} />
            ) : (
              <HabitsTab />
            )}
          </div>
        </div>

        {taskId && (
          <TaskDrawer key={taskId} taskId={taskId} onClose={closeTask} />
        )}
        {panel === "insight" && <InsightPanel onClose={() => setPanel(null)} />}
        {panel === "import" && <ImportDialog onClose={() => setPanel(null)} />}
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

function EmptyBoard({
  onNew,
  onImport,
}: {
  onNew: () => void;
  onImport: (() => void) | null;
}) {
  const { locale } = useI18n();
  const s = boardStrings(locale);
  return (
    <div className="grid h-full place-items-center px-6 pb-16">
      <div className="flex max-w-[420px] flex-col items-center gap-3 text-center">
        <div className="grid size-11 place-items-center rounded-xl border border-ink-800 bg-ink-925 text-fg-muted">
          <Icon name="square-kanban" size={20} />
        </div>
        <h2 className="text-title font-semibold text-fg">{s.emptyBoard}</h2>
        <p className="text-aux leading-relaxed text-fg-faint">
          {s.emptyBoardHint}
        </p>
        <div className="mt-1 flex gap-2">
          {onImport && (
            <button type="button" onClick={onImport} className={btn.outline}>
              <Icon name="tag" size={13} />
              {s.importTopics}
            </button>
          )}
          <button type="button" onClick={onNew} className={btn.primary}>
            <Icon name="plus" size={13} />
            {s.newTask}
          </button>
        </div>
      </div>
    </div>
  );
}
