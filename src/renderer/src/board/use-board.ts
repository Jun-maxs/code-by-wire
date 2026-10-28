import { useCallback, useContext, useEffect, useRef, useState } from "react";
import {
  buildInsightPrompt,
  dayKey,
  emptyBoard,
  type BoardDoc,
  type Insight,
  type InsightRunState,
} from "@shared/board";
import { productForSession } from "@shared/products";
import type { Session } from "@shared/types";
import { ProductsContext } from "../products/products-context";
import { announceBoard, onBoardChanged, onBoardFlush } from "./session-tasks";

/** Edits land on screen at once and reach disk after this quiet spell (typing in a field). */
const SAVE_DEBOUNCE_MS = 400;
const INSIGHT_POLL_MS = 1500;

export interface BoardApi {
  doc: BoardDoc;
  loaded: boolean;
  /** Apply an edit (immutably) and schedule a save. */
  update: (fn: (doc: BoardDoc) => BoardDoc) => void;
  today: string;
  run: InsightRunState;
  runInsight: (trigger: Insight["trigger"]) => void;
}

/** Local calendar day, re-read every minute so the board rolls over at midnight. */
export function useToday(): string {
  const [today, setToday] = useState(() => dayKey(new Date()));
  useEffect(() => {
    const t = setInterval(() => setToday(dayKey(new Date())), 60_000);
    return () => clearInterval(t);
  }, []);
  return today;
}

/** The insight prompt from the board plus what the app knows about sessions and topics. */
export function useInsightPrompt(sessions: Session[]) {
  const products = useContext(ProductsContext);
  return useCallback(
    (doc: BoardDoc, today: string) => {
      const names: Record<string, string> = {};
      for (const [k, p] of Object.entries(products?.products ?? {}))
        names[k] = p.name;
      const facts = [...sessions]
        .sort((a, b) => b.lastActivityMs - a.lastActivityMs)
        .map((s) => ({
          title: products?.titles[s.id] ?? s.title,
          state: s.state,
          lastActivityMs: s.lastActivityMs,
          topic: products ? productForSession(products, s) : null,
        }));
      return buildInsightPrompt(doc, today, facts, names);
    },
    [sessions, products],
  );
}

export function useBoard(sessions: Session[]): BoardApi {
  const [doc, setDoc] = useState<BoardDoc>(emptyBoard);
  const [loaded, setLoaded] = useState(false);
  const [run, setRun] = useState<InsightRunState>({
    running: false,
    startedAt: null,
    error: null,
  });
  const today = useToday();
  const pending = useRef<BoardDoc | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const prompt = useInsightPrompt(sessions);

  useEffect(() => {
    void window.api.readBoard().then((d) => {
      setDoc(d);
      setLoaded(true);
    });
    void window.api.boardInsightState().then(setRun);
  }, []);

  const flush = useCallback(() => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
    const next = pending.current;
    pending.current = null;
    if (next)
      void window.api
        .saveBoard(next)
        .then((saved) => announceBoard(saved, "board"));
  }, []);
  // Links made from the sidebar or a session's menu land in the file; pick them up here (the board
  // flushed its pending edits just before, so there's nothing local to lose).
  useEffect(() => {
    const offFlush = onBoardFlush(flush);
    const offChanged = onBoardChanged((d, source) => {
      if (source === "link" && !pending.current) setDoc(d);
    });
    return () => {
      offFlush();
      offChanged();
    };
  }, [flush]);
  // Never lose the last keystrokes when the view closes.
  useEffect(() => flush, [flush]);

  const update = useCallback(
    (fn: (d: BoardDoc) => BoardDoc) => {
      setDoc((d) => {
        const next = fn(d);
        pending.current = next;
        return next;
      });
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(flush, SAVE_DEBOUNCE_MS);
    },
    [flush],
  );

  // While a run is going, poll it; when it ends, pick up the insight main appended to the file.
  useEffect(() => {
    if (!run.running) return;
    const t = setInterval(() => {
      void window.api.boardInsightState().then((s) => {
        setRun(s);
        if (!s.running) {
          flush();
          void window.api.readBoard().then(setDoc);
        }
      });
    }, INSIGHT_POLL_MS);
    return () => clearInterval(t);
  }, [run.running, flush]);

  const runInsight = useCallback(
    (trigger: Insight["trigger"]) => {
      flush();
      void window.api
        .runBoardInsight(prompt(pending.current ?? doc, today), trigger)
        .then(setRun);
    },
    [doc, today, prompt, flush],
  );

  return { doc, loaded, update, today, run, runInsight };
}

/**
 * The daily automatic insight, mounted app-wide (the board view may never open that day): once a
 * minute, past the configured hour with no run since then today, start one. Reads the file each time
 * so it never works from a stale copy of the board.
 */
export function useBoardAutoInsight(sessions: Session[]): void {
  const prompt = useInsightPrompt(sessions);
  const promptRef = useRef(prompt);
  promptRef.current = prompt;
  useEffect(() => {
    const tick = async () => {
      const doc = await window.api.readBoard();
      if (doc.insightHour === null || doc.tasks.length === 0) return;
      const now = new Date();
      if (now.getHours() < doc.insightHour) return;
      const since = new Date(now);
      since.setHours(doc.insightHour, 0, 0, 0);
      if (doc.insights.some((i) => i.at >= since.getTime())) return;
      const state = await window.api.boardInsightState();
      if (state.running) return;
      // A failed run today waits for the next day or a manual run instead of retrying every minute.
      if (state.error && (state.startedAt ?? 0) >= since.getTime()) return;
      await window.api.runBoardInsight(
        promptRef.current(doc, dayKey(now)),
        "auto",
      );
    };
    const t = setInterval(() => void tick(), 60_000);
    return () => clearInterval(t);
  }, []);
}
