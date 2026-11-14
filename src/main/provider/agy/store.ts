import Database from "better-sqlite3";
import {
  closeSync,
  existsSync,
  openSync,
  readdirSync,
  readSync,
  statSync,
  unlinkSync,
} from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import {
  readAgyHead,
  readAgyModel,
  STEP_MODEL,
  STEP_USER,
  type AgyGenRow,
  type AgyHead,
  type AgyStepRow,
} from "./conversation";

/** The Antigravity CLI's data dir: `CBW_AGY_DIR`, else `~/.gemini/antigravity-cli`. */
export function resolveAgyDir(env: NodeJS.ProcessEnv = process.env): string {
  return env.CBW_AGY_DIR || join(homedir(), ".gemini", "antigravity-cli");
}

export interface AgyFile {
  id: string;
  path: string;
  /** The later of the db and a non-empty -wal: agy's commits land in the wal until a checkpoint. */
  mtimeMs: number;
}

const mtimeOf = (path: string, nonEmpty = false): number => {
  try {
    const st = statSync(path);
    return nonEmpty && st.size === 0 ? 0 : st.mtimeMs;
  } catch {
    return 0;
  }
};

/** Every conversation db: `<agyDir>/conversations/<uuid>.db`, the uuid being its id. */
export function listAgyConversations(agyDir: string): AgyFile[] {
  const root = join(agyDir, "conversations");
  let names: string[];
  try {
    names = readdirSync(root);
  } catch {
    return [];
  }
  const out: AgyFile[] = [];
  for (const name of names) {
    const m = /^([0-9a-f-]{8,})\.db$/i.exec(name);
    if (!m) continue;
    const path = join(root, name);
    // An empty -wal is what any reader's open leaves behind (this app's included) — not agy writing.
    const mtimeMs = Math.max(mtimeOf(path), mtimeOf(`${path}-wal`, true));
    if (mtimeMs > 0) out.push({ id: m[1], path, mtimeMs });
  }
  return out;
}

/** Open a conversation read-only for one read. agy holds the file open while it runs; a reader never
 *  blocks it, and a momentarily locked db reads as null for this pass. agy's dbs are in WAL mode, so
 *  even a read-only open creates the -wal/-shm side files; the ones this read created are removed
 *  again (an open agy keeps its own, and Windows refuses to delete a file another process holds). */
function withDb<T>(path: string, read: (db: Database.Database) => T): T | null {
  const sides = [`${path}-wal`, `${path}-shm`].filter((p) => !existsSync(p));
  let db: Database.Database | null = null;
  try {
    db = new Database(path, {
      readonly: true,
      fileMustExist: true,
      timeout: 250,
    });
    return read(db);
  } catch {
    return null;
  } finally {
    db?.close();
    for (const side of sides) {
      try {
        if (statSync(side).size === 0 || side.endsWith("-shm"))
          unlinkSync(side);
      } catch {
        // Not created, or another process holds it now — leave it.
      }
    }
  }
}

const bytes = (v: unknown): Uint8Array | null =>
  v instanceof Uint8Array ? v : null;

interface RawStep {
  idx: number;
  step_type: number;
  status: number;
  metadata: unknown;
  payload: unknown;
  has_perm?: number;
}

const toStep = (r: RawStep): AgyStepRow => ({
  idx: r.idx,
  stepType: r.step_type,
  status: r.status,
  metadata: bytes(r.metadata),
  payload: bytes(r.payload),
  ...(r.has_perm ? { hasPermissions: true } : {}),
});

export interface AgyConversationHead extends AgyHead {
  /** Whether any step was written — a launch that never took a message leaves an empty one. */
  hasSteps: boolean;
}

export function readAgyConversationHead(
  path: string,
): AgyConversationHead | null {
  return withDb(path, (db) => {
    const row = db
      .prepare(
        "select data from trajectory_metadata_blob where id = 'main' limit 1",
      )
      .get() as { data: unknown } | undefined;
    const head = readAgyHead(bytes(row?.data));
    if (!head) return null;
    const any = db.prepare("select 1 from steps limit 1").get();
    return { ...head, hasSteps: any !== undefined };
  });
}

export interface AgyConversationStats {
  /** Step metadata, plus the payload of user steps (the title) — tool outputs aren't read. */
  steps: AgyStepRow[];
  genMeta: AgyGenRow[];
  model: { id: string; label: string } | null;
}

/** The latest model a generation recorded (the newest gen_metadata rows first). */
function latestModel(
  db: Database.Database,
): { id: string; label: string } | null {
  const rows = db
    .prepare("select data from gen_metadata order by idx desc limit 8")
    .all() as { data: unknown }[];
  for (const r of rows) {
    const model = readAgyModel(bytes(r.data));
    if (model) return model;
  }
  return null;
}

export function readAgyConversationStats(
  path: string,
): AgyConversationStats | null {
  return withDb(path, (db) => {
    const steps = (
      db
        .prepare(
          `select idx, step_type, status, metadata,
                  case when step_type = ${STEP_USER}
                         or idx = (select max(idx) from steps where step_type = ${STEP_MODEL})
                       then step_payload end as payload,
                  case when permissions is not null and length(permissions) > 0 then 1 else 0 end as has_perm
             from steps order by idx`,
        )
        .all() as RawStep[]
    ).map(toStep);
    const genMeta = (
      db.prepare("select idx, data from gen_metadata order by idx").all() as {
        idx: number;
        data: unknown;
      }[]
    ).map((r) => ({ idx: r.idx, data: bytes(r.data) }));
    return { steps, genMeta, model: latestModel(db) };
  });
}

/** Every step with its payload — the transcript view and the tool drill-in. */
export function readAgySteps(path: string): AgyStepRow[] | null {
  return withDb(path, (db) =>
    (
      db
        .prepare(
          "select idx, step_type, status, metadata, step_payload as payload from steps order by idx",
        )
        .all() as RawStep[]
    ).map(toStep),
  );
}

export type AgyPresenceState = "locked" | "unlocked" | "absent";

/**
 * Checks whether an active `agy` process holds `<agyDir>/presence/<id>.lock`.
 * On Windows, live `agy` holds an exclusive byte-range lock on its lockfile, so `readSync`
 * fails with EBUSY/EACCES while the CLI is running and succeeds cleanly once it exits.
 */
export function readAgyPresence(agyDir: string, id: string): AgyPresenceState {
  const lockPath = join(agyDir, "presence", `${id}.lock`);
  let fd: number | null = null;
  try {
    fd = openSync(lockPath, "r");
    const buf = Buffer.alloc(1);
    readSync(fd, buf, 0, 1, 0);
    return "unlocked";
  } catch (err) {
    const code = (err as NodeJS.ErrnoException | null)?.code;
    if (code === "ENOENT" || code === "ENOTDIR") return "absent";
    if (
      code === "EBUSY" ||
      code === "EACCES" ||
      code === "EPERM" ||
      code === "EAGAIN"
    )
      return "locked";
    return "absent";
  } finally {
    if (fd !== null) {
      try {
        closeSync(fd);
      } catch {
        // Ignore close failures on OS handles.
      }
    }
  }
}

export interface AgySummaryRow {
  conversationId: string;
  title: string;
  status: string;
  notFullyIdle: boolean;
  killed: boolean;
  parentConversationId: string;
  agentName: string;
  stepCount: number;
  lastModifiedMs: number;
}

interface RawSummaryRow {
  conversation_id: string;
  title: string;
  status: string;
  not_fully_idle: number | boolean;
  killed: number | boolean;
  parent_conversation_id: string;
  agent_name: string;
  step_count: number;
  last_modified_time: string;
}

const summaryFallback = new Map<string, Map<string, AgySummaryRow>>();

/**
 * Read live cascade status, title, and parent-subagent links from `<agyDir>/conversation_summaries.db`.
 * Always queries SQLite directly so in-place page updates never hit stale stat caches, keeping the
 * last successful map only as a transient lock-contention fallback.
 */
export function readAgySummaries(agyDir: string): Map<string, AgySummaryRow> {
  const dbPath = join(agyDir, "conversation_summaries.db");
  if (!existsSync(dbPath)) return new Map();

  const rows = withDb<Map<string, AgySummaryRow>>(dbPath, (db) => {
    const out = new Map<string, AgySummaryRow>();
    const rawSummaries = db
      .prepare(
        `select conversation_id, title, status, not_fully_idle, killed,
                parent_conversation_id, agent_name, step_count, last_modified_time
           from conversation_summaries`,
      )
      .all() as RawSummaryRow[];
    for (const r of rawSummaries) {
      if (!r.conversation_id) continue;
      const parsedModified = Date.parse(r.last_modified_time);
      out.set(r.conversation_id, {
        conversationId: r.conversation_id,
        title: r.title || "",
        status: r.status || "",
        notFullyIdle: Boolean(r.not_fully_idle),
        killed: Boolean(r.killed),
        parentConversationId: r.parent_conversation_id || "",
        agentName: r.agent_name || "",
        stepCount: Number(r.step_count) || 0,
        lastModifiedMs: Number.isFinite(parsedModified) ? parsedModified : 0,
      });
    }
    try {
      const parents = db
        .prepare("select conversation_id, parent_id from conversation_parents")
        .all() as { conversation_id: string; parent_id: string }[];
      for (const p of parents) {
        const hit = out.get(p.conversation_id);
        if (hit && !hit.parentConversationId && p.parent_id)
          hit.parentConversationId = p.parent_id;
      }
    } catch {
      // Older DB schemas may omit conversation_parents.
    }
    return out;
  });

  if (!rows) {
    return summaryFallback.get(agyDir) ?? new Map<string, AgySummaryRow>();
  }
  summaryFallback.set(agyDir, rows);
  return rows;
}
