import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import {
  completeTaskWithBrief,
  dayKey,
  splitPendingQueue,
  tasksBySession,
  type BoardDoc,
  type BoardTask,
  type TaskLiveSummary,
} from "@shared/board";
import type { Session } from "@shared/types";
import {
  ProductsRefreshContext,
  useSessionProduct,
} from "../products/products-context";
import {
  announceBoard,
  onBoardChanged,
  queueOpenTask,
  requestBoardFlush,
} from "./board-bus";

interface SessionTasks {
  /** Open (not done) tasks first, then done ones, each in board order. */
  tasks: BoardTask[];
  /** Number of items needing user confirmation (`decide` tasks + `waiting` sessions). */
  confirmCount: number;
  /** Number of queued/running execution tasks (`doing` + `todo`). */
  executeCount: number;
  taskOf: (sessionId: string) => BoardTask | undefined;
  link: (sessionId: string, taskId: string | null) => Promise<void>;
  /** Complete a task and log its implementation brief into today's daily digest. */
  completeTask: (taskId: string) => Promise<void>;
  /** Go to the board with this task's drawer open. */
  openTask: (taskId: string) => void;
  /** Go to the board. */
  showBoard: () => void;
  /** Every session the app knows, for the dock's "other sessions on this task/topic" lists. */
  sessions: Session[];
  openSession: (id: string) => void;
}

const Ctx = createContext<SessionTasks | null>(null);

export function SessionTasksProvider({
  onShowBoard,
  sessions,
  onOpenSession,
  children,
}: {
  onShowBoard: () => void;
  sessions: Session[];
  onOpenSession: (id: string) => void;
  children: ReactNode;
}) {
  const [doc, setDoc] = useState<BoardDoc | null>(null);
  useEffect(() => {
    let alive = true;
    const load = () =>
      void window.api.readBoard().then((d) => alive && setDoc(d));
    load();
    // Re-read once shortly after launch so the background git-log cache refresh shows up promptly.
    const warm = setTimeout(load, 1500);
    const off = onBoardChanged((d) => setDoc(d));
    const t = setInterval(load, 30_000);
    return () => {
      alive = false;
      clearTimeout(warm);
      off();
      clearInterval(t);
    };
  }, []);

  const bySession = useMemo(
    () => (doc ? tasksBySession(doc) : new Map<string, BoardTask>()),
    [doc],
  );
  const tasks = useMemo(
    () =>
      doc
        ? [
            ...doc.tasks.filter((t) => t.status !== "done"),
            ...doc.tasks.filter((t) => t.status === "done"),
          ]
        : [],
    [doc],
  );

  const { confirmCount, executeCount } = useMemo(() => {
    const byId = new Map(sessions.map((s) => [s.id, s]));
    const liveByTask = new Map<string, TaskLiveSummary>();
    const linkedOpenSessions = new Set<string>();
    for (const t of doc?.tasks ?? []) {
      if (t.status === "done") continue;
      let working = 0;
      let waiting = 0;
      let last: number | undefined;
      for (const id of t.sessionIds) {
        linkedOpenSessions.add(id);
        const s = byId.get(id);
        if (!s) continue;
        if (s.state === "working") working++;
        else if (s.state === "waiting") waiting++;
        last = Math.max(last ?? 0, s.lastActivityMs);
      }
      liveByTask.set(t.id, { working, waiting, lastActivityMs: last });
    }
    const unlinkedWaiting = sessions.filter(
      (s) =>
        !s.parentSessionId &&
        s.state === "waiting" &&
        !linkedOpenSessions.has(s.id),
    ).length;
    if (!doc) return { confirmCount: unlinkedWaiting, executeCount: 0 };
    const groups = splitPendingQueue(doc.tasks, dayKey(new Date()), liveByTask);
    return {
      confirmCount: groups.confirm.length + unlinkedWaiting,
      executeCount: groups.execute.length,
    };
  }, [doc, sessions]);

  const link = useCallback(async (sessionId: string, taskId: string | null) => {
    requestBoardFlush();
    const next = await window.api.linkSessionToTask(sessionId, taskId);
    announceBoard(next, "link");
  }, []);

  const completeTask = useCallback(async (taskId: string) => {
    requestBoardFlush();
    const fresh = await window.api.readBoard();
    const next = completeTaskWithBrief(fresh, taskId, dayKey(new Date()));
    const saved = await window.api.saveBoard(next);
    announceBoard(saved, "link");
  }, []);

  const openTask = useCallback(
    (taskId: string) => {
      onShowBoard();
      queueOpenTask(taskId);
    },
    [onShowBoard],
  );

  const value = useMemo<SessionTasks>(
    () => ({
      tasks,
      confirmCount,
      executeCount,
      taskOf: (id) => bySession.get(id),
      link,
      completeTask,
      openTask,
      showBoard: onShowBoard,
      sessions,
      openSession: onOpenSession,
    }),
    [
      tasks,
      confirmCount,
      executeCount,
      bySession,
      link,
      completeTask,
      openTask,
      onShowBoard,
      sessions,
      onOpenSession,
    ],
  );
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

// eslint-disable-next-line react-refresh/only-export-components -- paired context hook
export function useSessionTasks(): SessionTasks | null {
  return useContext(Ctx);
}

// eslint-disable-next-line react-refresh/only-export-components -- paired context hook
export function useLinkTask(session: {
  id: string;
  title: string;
}): (taskId: string | null) => void {
  const tasks = useSessionTasks();
  const refreshProducts = useContext(ProductsRefreshContext);
  const currentTopic = useSessionProduct(session)?.key;
  return (taskId) => {
    if (!tasks) return;
    void tasks.link(session.id, taskId).catch(() => undefined);
    const topic = tasks.tasks.find((x) => x.id === taskId)?.topic;
    if (topic && topic !== currentTopic)
      void window.api
        .assignSessionTopic(session.id, topic)
        .then(refreshProducts)
        .catch(() => undefined);
  };
}
