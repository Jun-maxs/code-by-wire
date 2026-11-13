import type { BoardDoc } from "@shared/board";

/**
 * Window event bus keeping `BoardView` (`useBoard`) and the app-wide `SessionTasksProvider` in sync
 * without needing extra IPC channels.
 */
export const BOARD_CHANGED = "cbw:board-changed";
export const BOARD_FLUSH = "cbw:board-flush";
export const BOARD_OPEN_TASK = "cbw:board-open-task";

export function announceBoard(doc: BoardDoc, source: "board" | "link"): void {
  window.dispatchEvent(
    new CustomEvent(BOARD_CHANGED, { detail: { doc, source } }),
  );
}

export function onBoardChanged(
  fn: (doc: BoardDoc, source: "board" | "link") => void,
): () => void {
  const h = (e: Event) => {
    const d = (e as CustomEvent<{ doc: BoardDoc; source: "board" | "link" }>)
      .detail;
    fn(d.doc, d.source);
  };
  window.addEventListener(BOARD_CHANGED, h);
  return () => window.removeEventListener(BOARD_CHANGED, h);
}

export function onBoardFlush(fn: () => void): () => void {
  window.addEventListener(BOARD_FLUSH, fn);
  return () => window.removeEventListener(BOARD_FLUSH, fn);
}

export function requestBoardFlush(): void {
  window.dispatchEvent(new Event(BOARD_FLUSH));
}

let pendingTask: string | null = null;

export function queueOpenTask(taskId: string): void {
  pendingTask = taskId;
  window.dispatchEvent(new Event(BOARD_OPEN_TASK));
}

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
  window.addEventListener(BOARD_OPEN_TASK, h);
  return () => window.removeEventListener(BOARD_OPEN_TASK, h);
}
