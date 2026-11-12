import Database from "better-sqlite3";
import { existsSync, readdirSync, statSync, unlinkSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import {
  readAgyHead,
  readAgyModel,
  STEP_USER,
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
}

const toStep = (r: RawStep): AgyStepRow => ({
  idx: r.idx,
  stepType: r.step_type,
  status: r.status,
  metadata: bytes(r.metadata),
  payload: bytes(r.payload),
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
                  case when step_type = ${STEP_USER} then step_payload end as payload
             from steps order by idx`,
        )
        .all() as RawStep[]
    ).map(toStep);
    return { steps, model: latestModel(db) };
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
