import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { tasksBySession, type BoardDoc, type BoardTask } from "@shared/board";
import type { Session } from "@shared/types";
import {
  ProductsRefreshContext,
  useSessionProduct,
} from "../products/products-context";

/**
 * Sessions ↔ board tasks outside the board (fork feature, 2026-10-28): the sidebar, the session menu
 * and the session header show which task a session belongs to and can move it to another. The board
 * view owns its own copy of the document, so both sides talk through window events: the board
 * announces what it saved, and before a link is written the board is asked to flush pending edits
 * (main applies the link to the file, so neither side overwrites the other).
 */
const CHANGED = "cbw:board-changed";
const FLUSH = "cbw:board-flush";
const OPEN_TASK = "cbw:board-open-task";

export function announceBoard(doc: BoardDoc, source: "board" | "link"): void {
  window.dispatchEvent(new CustomEvent(CHANGED, { detail: { doc, source } }));
}

export function onBoardChanged(
  fn: (doc: BoardDoc, source: "board" | "link") => void,
): () => void {
  const h = (e: Event) => {
    const d = (e as CustomEvent<{ doc: BoardDoc; source: "board" | "link" }>)
      .detail;
    fn(d.doc, d.source);
  };
  window.addEventListener(CHANGED, h);
  return () => window.removeEventListener(CHANGED, h);
}

export function onBoardFlush(fn: () => void): () => void {
  window.addEventListener(FLUSH, fn);
  return () => window.removeEventListener(FLUSH, fn);
}

/** A task to open once the board view mounts (or now, if it's open). */
let pendingTask: string | null = null;
export function takePendingTask(): string | null {
  const t = pendingTask;
  pendingTask = null;
  return t;
}
export function onOpenTask(fn: (id: string) => void): () => void {
  const h = () => {
    const id = takePendingTask();
    if (id) fn(id);
  };
  window.addEventListener(OPEN_TASK, h);
  return () => window.removeEventListener(OPEN_TASK, h);
}

interface SessionTasks {
  /** Open (not done) tasks first, then done ones, each in board order. */
  tasks: BoardTask[];
  taskOf: (sessionId: string) => BoardTask | undefined;
  link: (sessionId: string, taskId: string | null) => Promise<void>;
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
    const off = onBoardChanged((d) => setDoc(d));
    // The insight run and other windows write the file too; a slow refresh keeps up with them.
    const t = setInterval(load, 30_000);
    return () => {
      alive = false;
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
  const link = useCallback(async (sessionId: string, taskId: string | null) => {
    window.dispatchEvent(new Event(FLUSH));
    const next = await window.api.linkSessionToTask(sessionId, taskId);
    announceBoard(next, "link");
  }, []);
  const openTask = useCallback(
    (taskId: string) => {
      pendingTask = taskId;
      onShowBoard();
      window.dispatchEvent(new Event(OPEN_TASK));
    },
    [onShowBoard],
  );
  const value = useMemo<SessionTasks>(
    () => ({
      tasks,
      taskOf: (id) => bySession.get(id),
      link,
      openTask,
      showBoard: onShowBoard,
      sessions,
      openSession: onOpenSession,
    }),
    [tasks, bySession, link, openTask, onShowBoard, sessions, onOpenSession],
  );
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useSessionTasks(): SessionTasks | null {
  return useContext(Ctx);
}

/** Put `session` under a board task (null unlinks). The sidebar groups by topic, so the session also
 *  follows the task's topic and sits with its task. */
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
