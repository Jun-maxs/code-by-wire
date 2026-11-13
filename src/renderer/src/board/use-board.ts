import { useCallback, useContext, useEffect, useRef, useState } from "react";
import {
  buildInsightPrompt,
  dayKey,
  emptyBoard,
  mergedDailyBriefs,
  type BoardDoc,
  type Insight,
  type InsightRunState,
} from "@shared/board";
import { productForSession } from "@shared/products";
import type { Session } from "@shared/types";
import {
  ProductsContext,
  ProductsRefreshContext,
} from "../products/products-context";
import { announceBoard, onBoardChanged, onBoardFlush } from "./board-bus";

/** Edits land on screen at once and reach disk after this quiet spell (typing in a field). */
const SAVE_DEBOUNCE_MS = 400;
const INSIGHT_POLL_MS = 1500;

export interface BoardApi {
  doc: BoardDoc;
  loaded: boolean;
  syncing: boolean;
  /** Apply an edit (immutably) and schedule a save. */
  update: (fn: (doc: BoardDoc) => BoardDoc) => void;
  /** Re-read workbench cards, releases, and git cache from main. */
  reload: () => Promise<void>;
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
  const [syncing, setSyncing] = useState(false);
  const [run, setRun] = useState<InsightRunState>({
    running: false,
    startedAt: null,
    error: null,
  });
  const today = useToday();
  const pending = useRef<BoardDoc | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const prompt = useInsightPrompt(sessions);
  const refreshProducts = useContext(ProductsRefreshContext);

  useEffect(() => {
    let alive = true;
    void window.api.readBoard().then((d) => {
      if (!alive) return;
      setDoc(d);
      setLoaded(true);
    });
    // Pick up the async git-log cache warm-up shortly after opening the board.
    const warm = setTimeout(() => {
      if (!pending.current) {
        void window.api.readBoard().then((d) => {
          if (alive && !pending.current) setDoc(d);
        });
      }
    }, 1400);
    void window.api.boardInsightState().then((s) => alive && setRun(s));
    return () => {
      alive = false;
      clearTimeout(warm);
    };
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

  useEffect(() => flush, [flush]);

  const update = useCallback(
    (fn: (d: BoardDoc) => BoardDoc) => {
      setDoc((d) => {
        const next = fn(d);
        pending.current = next;
        queueMicrotask(() => announceBoard(next, "board"));
        return next;
      });
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(flush, SAVE_DEBOUNCE_MS);
    },
    [flush],
  );

  const reload = useCallback(async () => {
    setSyncing(true);
    try {
      flush();
      refreshProducts();
      const first = await window.api.readBoard();
      if (!pending.current) {
        setDoc(first);
        announceBoard(first, "board");
      }
      // Wait briefly in case main kicked off a fresh git-log scan on `readBoard()`.
      await new Promise((r) => setTimeout(r, 900));
      const second = await window.api.readBoard();
      if (!pending.current) {
        setDoc(second);
        announceBoard(second, "board");
      }
    } finally {
      setSyncing(false);
    }
  }, [flush, refreshProducts]);

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

  return { doc, loaded, syncing, update, reload, today, run, runInsight };
}

/**
 * The daily automatic insight, mounted app-wide (the board view may never open that day): once a
 * minute, past the configured hour with no run since then today, start one.
 */
export function useBoardAutoInsight(sessions: Session[]): void {
  const prompt = useInsightPrompt(sessions);
  const promptRef = useRef(prompt);
  promptRef.current = prompt;
  useEffect(() => {
    const tick = async () => {
      const doc = await window.api.readBoard();
      if (
        doc.insightHour === null ||
        (doc.tasks.length === 0 && mergedDailyBriefs(doc).length === 0)
      )
        return;
      const now = new Date();
      if (now.getHours() < doc.insightHour) return;
      const since = new Date(now);
      since.setHours(doc.insightHour, 0, 0, 0);
      if (doc.insights.some((i) => i.at >= since.getTime())) return;
      const state = await window.api.boardInsightState();
      if (state.running) return;
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
