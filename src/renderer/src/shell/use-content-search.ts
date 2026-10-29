import { useEffect, useState } from "react";
import type { Session } from "@shared/types";

/**
 * Fork feature (2026-10-29): search session transcripts by content. Asks main to keep its full-text index
 * over every transcript, and turns the sidebar query into session id → excerpt hits
 * (debounced; queries under two characters search titles only).
 */
export function useContentSearch(
  sessions: Session[],
  query: string,
): { hits: ReadonlyMap<string, string>; indexing: boolean } {
  // Main lists the transcripts itself; re-list when the session count changes (a new or deleted one).
  const count = sessions.length;
  useEffect(() => {
    void window.api.trackSessionContent().catch(() => undefined);
  }, [count]);

  const [result, setResult] = useState<{
    q: string;
    hits: ReadonlyMap<string, string>;
    indexing: boolean;
  }>({ q: "", hits: new Map(), indexing: false });
  const q = query.trim();
  useEffect(() => {
    if (q.length < 2) return;
    let alive = true;
    const timer = setTimeout(() => {
      void window.api
        .searchSessionContent(q)
        .then((r) => {
          if (alive)
            setResult({
              q,
              hits: new Map(r.hits.map((h) => [h.id, h.snippet])),
              indexing: r.indexing,
            });
        })
        .catch(() => undefined);
    }, 250);
    return () => {
      alive = false;
      clearTimeout(timer);
    };
  }, [q]);
  return result.q === q && q.length >= 2
    ? { hits: result.hits, indexing: result.indexing }
    : { hits: EMPTY, indexing: false };
}

const EMPTY: ReadonlyMap<string, string> = new Map();
