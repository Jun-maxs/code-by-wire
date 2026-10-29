import Database from "better-sqlite3";
import { closeSync, openSync, readSync, statSync } from "node:fs";
import type { ContentHit, ContentSearchResult } from "@shared/content-search";
import { extractText } from "./content-text";

/**
 * Full-text search over session transcripts (fork feature, 2026-10-29): the sidebar search finds a
 * session by what was said in it — a URL, a file name, an error line — not only by its title.
 *
 * The index keeps the words people read (prompts, replies, the paths/commands/URLs a tool was given),
 * never tool output, so it stays a small fraction of the multi-gigabyte transcripts. It lives in its own
 * SQLite file with an FTS5 trigram table (CJK-friendly substring search). Files are read incrementally
 * from the last indexed byte, a few megabytes per step on a timer, so the main thread never stalls.
 */

const STEP_BYTES = 2 * 1024 * 1024;
const STEP_DELAY_MS = 60;
const IDLE_RECHECK_MS = 60_000;

interface Tracked {
  id: string;
  path: string;
}

export interface ContentSearch {
  /** Replace the set of transcripts to keep indexed (the app's current sessions). */
  track(list: Tracked[]): void;
  search(query: string, limit?: number): ContentSearchResult;
  close(): void;
}

export function createContentSearch(dbPath: string): ContentSearch {
  const db = new Database(dbPath);
  db.pragma("journal_mode = WAL");
  db.exec(`
    CREATE TABLE IF NOT EXISTS files (
      path TEXT PRIMARY KEY,
      session_id TEXT NOT NULL,
      size INTEGER NOT NULL,
      mtime INTEGER NOT NULL,
      offset INTEGER NOT NULL
    );
    CREATE VIRTUAL TABLE IF NOT EXISTS msgs USING fts5(
      text, session_id UNINDEXED, ts UNINDEXED, tokenize = 'trigram'
    );
  `);
  const getFile = db.prepare<
    [string],
    { size: number; mtime: number; offset: number }
  >("SELECT size, mtime, offset FROM files WHERE path = ?");
  const putFile = db.prepare(
    "INSERT INTO files (path, session_id, size, mtime, offset) VALUES (?, ?, ?, ?, ?) ON CONFLICT(path) DO UPDATE SET session_id = excluded.session_id, size = excluded.size, mtime = excluded.mtime, offset = excluded.offset",
  );
  const putMsg = db.prepare(
    "INSERT INTO msgs (text, session_id, ts) VALUES (?, ?, ?)",
  );
  const dropMsgs = db.prepare("DELETE FROM msgs WHERE session_id = ?");

  let tracked: Tracked[] = [];
  /** Paths still to look at in this sweep; refilled from `tracked` once a minute. */
  let queue: Tracked[] = [];
  let timer: ReturnType<typeof setTimeout> | null = null;
  let closed = false;
  let pending = 0;

  const schedule = (ms: number): void => {
    if (closed) return;
    if (timer) clearTimeout(timer);
    timer = setTimeout(step, ms);
    timer.unref?.();
  };

  function step(): void {
    timer = null;
    if (closed) return;
    let budget = STEP_BYTES;
    while (budget > 0 && queue.length > 0) {
      const f = queue[0];
      const used = indexSome(f, budget);
      if (used < 0) queue.shift();
      else budget -= used;
    }
    if (queue.length > 0) {
      pending = queue.length;
      schedule(STEP_DELAY_MS);
      return;
    }
    // Caught up: sweep every tracked file again in a minute for appended turns.
    pending = 0;
    queue = [...tracked];
    schedule(IDLE_RECHECK_MS);
  }

  /** Index up to `budget` new bytes of one file. Returns bytes read, or -1 when the file is caught up. */
  function indexSome(f: Tracked, budget: number): number {
    let st;
    try {
      st = statSync(f.path);
    } catch {
      return -1;
    }
    const row = getFile.get(f.path);
    let offset = row?.offset ?? 0;
    // Shorter than what was already read (a /compact rewrite, a re-key): start the file over.
    if (st.size < offset) {
      dropMsgs.run(f.id);
      offset = 0;
    }
    if (offset >= st.size) {
      if (!row || row.size !== st.size)
        putFile.run(f.path, f.id, st.size, Math.floor(st.mtimeMs), offset);
      return -1;
    }
    const len = Math.min(budget, st.size - offset);
    const buf = Buffer.alloc(len);
    const fd = openSync(f.path, "r");
    try {
      readSync(fd, buf, 0, len, offset);
    } finally {
      closeSync(fd);
    }
    // Only whole lines: stop at the last newline (a single line longer than the budget is taken whole).
    let end = buf.lastIndexOf(0x0a);
    if (end < 0) {
      if (offset + len < st.size) return indexLongLine(f, offset, st);
      end = len - 1;
    }
    const text = buf.subarray(0, end + 1).toString("utf8");
    const next = offset + end + 1;
    db.transaction(() => {
      for (const line of text.split("\n")) indexLine(f.id, line);
      putFile.run(f.path, f.id, st.size, Math.floor(st.mtimeMs), next);
    })();
    return end + 1;
  }

  /** A line bigger than one step (a pasted image, a huge tool result): skip it — it is never prose. */
  function indexLongLine(
    f: Tracked,
    offset: number,
    st: { size: number; mtimeMs: number },
  ): number {
    const fd = openSync(f.path, "r");
    const chunk = Buffer.alloc(STEP_BYTES);
    let pos = offset;
    try {
      for (;;) {
        const n = readSync(fd, chunk, 0, chunk.length, pos);
        if (n <= 0) break;
        const nl = chunk.subarray(0, n).indexOf(0x0a);
        if (nl >= 0) {
          pos += nl + 1;
          break;
        }
        pos += n;
      }
    } finally {
      closeSync(fd);
    }
    putFile.run(f.path, f.id, st.size, Math.floor(st.mtimeMs), pos);
    return pos - offset;
  }

  function indexLine(sessionId: string, line: string): void {
    if (line.length < 2) return;
    let obj: unknown;
    try {
      obj = JSON.parse(line);
    } catch {
      return;
    }
    const pieces = extractText(obj);
    if (pieces.length === 0) return;
    const ts = timestampOf(obj);
    for (const p of pieces) putMsg.run(p, sessionId, ts);
  }

  return {
    track(list) {
      tracked = list.filter((x) => x.path);
      // First call (or between sweeps): start right away instead of waiting out the idle recheck.
      if (pending === 0) {
        queue = [...tracked];
        pending = queue.length;
        schedule(STEP_DELAY_MS);
      }
    },
    search(query, limit = 300) {
      const q = query.trim();
      const indexing = pending > 0;
      if (q.length < 2) return { hits: [], indexing };
      const rows =
        [...q].length >= 3
          ? (db
              .prepare(
                `SELECT session_id AS id, snippet(msgs, 0, '', '', '…', 16) AS snippet, ts
                 FROM msgs WHERE msgs MATCH ? ORDER BY ts DESC LIMIT ?`,
              )
              .all(`"${q.replace(/"/g, '""')}"`, limit * 4) as RawHit[])
          : (db
              .prepare(
                `SELECT session_id AS id, text AS snippet, ts FROM msgs
                 WHERE text LIKE ? ESCAPE '\\' ORDER BY ts DESC LIMIT ?`,
              )
              .all(
                `%${q.replace(/[\\%_]/g, (c) => `\\${c}`)}%`,
                limit * 4,
              ) as RawHit[]);
      const seen = new Map<string, ContentHit>();
      for (const r of rows) {
        if (seen.has(r.id)) continue;
        seen.set(r.id, { id: r.id, snippet: trimAround(r.snippet, q) });
        if (seen.size >= limit) break;
      }
      return { hits: [...seen.values()], indexing };
    },
    close() {
      closed = true;
      if (timer) clearTimeout(timer);
      db.close();
    },
  };
}

interface RawHit {
  id: string;
  snippet: string;
  ts: number;
}

/** About 40 characters either side of the first match, on one line. */
function trimAround(text: string, q: string): string {
  const flat = text.replace(/\s+/g, " ").trim();
  const at = flat.toLowerCase().indexOf(q.toLowerCase());
  if (at < 0 || flat.length <= 90) return flat.slice(0, 90);
  const from = Math.max(0, at - 40);
  return `${from > 0 ? "…" : ""}${flat.slice(from, at + q.length + 40)}…`;
}

function timestampOf(obj: unknown): number {
  const o = obj as { timestamp?: unknown };
  const t = typeof o.timestamp === "string" ? Date.parse(o.timestamp) : NaN;
  return Number.isFinite(t) ? t : 0;
}
