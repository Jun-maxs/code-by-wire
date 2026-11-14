import { createRequire } from "node:module";
import {
  mkdtempSync,
  mkdirSync,
  rmSync,
  utimesSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { buildIslandSnapshot } from "../../src/shared/island-feed";
import { hydrate } from "../../src/main/db/store";
import type { AgyPresenceState } from "../../src/main/provider/agy/store";

const require = createRequire(import.meta.url);
const { DatabaseSync } = require("node:sqlite") as typeof import("node:sqlite");

vi.mock("better-sqlite3", () => {
  return {
    default: class MockBetterSqlite3 {
      private inner: InstanceType<typeof DatabaseSync>;
      constructor(path: string, opts?: { readonly?: boolean }) {
        this.inner = new DatabaseSync(path, { readOnly: opts?.readonly });
      }
      prepare(sql: string) {
        return this.inner.prepare(sql);
      }
      close() {
        this.inner.close();
      }
    },
  };
});

import { createAgyProvider } from "../../src/main/provider/agy";

type Field = [number, number | string | Field[]];
function varint(n: number): number[] {
  const out: number[] = [];
  do {
    let b = n % 128;
    n = Math.floor(n / 128);
    if (n > 0) b |= 0x80;
    out.push(b);
  } while (n > 0);
  return out;
}
function pb(fields: Field[]): Uint8Array {
  const out: number[] = [];
  for (const [f, v] of fields) {
    if (typeof v === "number") {
      out.push(...varint(f * 8), ...varint(v));
    } else {
      const bytes = typeof v === "string" ? new TextEncoder().encode(v) : pb(v);
      out.push(...varint(f * 8 + 2), ...varint(bytes.length), ...bytes);
    }
  }
  return Uint8Array.from(out);
}

function writeConversationDb(
  dbPath: string,
  opts: {
    cwd: string;
    createdSec: number;
    steps: {
      idx: number;
      stepType: number;
      status: number;
      metadata: Uint8Array;
      payload?: Uint8Array | null;
      permissions?: Uint8Array | null;
    }[];
    genMeta?: { idx: number; data: Uint8Array }[];
    walMode?: boolean;
  },
) {
  const db = new DatabaseSync(dbPath);
  if (opts.walMode) db.exec("PRAGMA journal_mode=WAL;");
  db.exec(`
    CREATE TABLE trajectory_metadata_blob (id TEXT PRIMARY KEY, data BLOB);
    CREATE TABLE steps (
      idx INTEGER PRIMARY KEY,
      step_type INTEGER NOT NULL,
      status INTEGER NOT NULL,
      has_subtrajectory NUMERIC NOT NULL DEFAULT false,
      metadata BLOB,
      error_details BLOB,
      permissions BLOB,
      task_details BLOB,
      render_info BLOB,
      step_payload BLOB,
      step_format INTEGER NOT NULL DEFAULT 0
    );
    CREATE TABLE gen_metadata (idx INTEGER PRIMARY KEY, data BLOB, size INTEGER NOT NULL DEFAULT 0);
  `);
  const head = pb([
    [1, [[1, `file:///${opts.cwd.replace(/\\/g, "/")}`]]],
    [2, [[1, opts.createdSec]]],
  ]);
  db.prepare(
    "INSERT INTO trajectory_metadata_blob (id, data) VALUES ('main', ?)",
  ).run(head);
  const insertStep = db.prepare(
    "INSERT INTO steps (idx, step_type, status, metadata, permissions, step_payload) VALUES (?, ?, ?, ?, ?, ?)",
  );
  for (const s of opts.steps) {
    insertStep.run(
      s.idx,
      s.stepType,
      s.status,
      s.metadata,
      s.permissions ?? null,
      s.payload ?? null,
    );
  }
  const insertGen = db.prepare(
    "INSERT INTO gen_metadata (idx, data, size) VALUES (?, ?, ?)",
  );
  for (const g of opts.genMeta ?? []) {
    insertGen.run(g.idx, g.data, g.data.length);
  }
  db.close();
}

function writeSummariesDb(
  agyDir: string,
  rows: {
    id: string;
    title?: string;
    status: string;
    notFullyIdle?: number;
    killed?: number;
    parentId?: string;
    agentName?: string;
    stepCount?: number;
    lastModifiedIso?: string;
  }[],
) {
  const dbPath = join(agyDir, "conversation_summaries.db");
  const db = new DatabaseSync(dbPath);
  db.exec(`
    CREATE TABLE IF NOT EXISTS conversation_summaries (
      conversation_id TEXT PRIMARY KEY,
      title TEXT NOT NULL DEFAULT '',
      preview TEXT NOT NULL DEFAULT '',
      step_count INTEGER NOT NULL DEFAULT 0,
      last_modified_time datetime NOT NULL DEFAULT '',
      workspace_uris TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL DEFAULT '',
      source TEXT NOT NULL DEFAULT '',
      project_id TEXT NOT NULL DEFAULT '',
      agent_name TEXT NOT NULL DEFAULT '',
      parent_conversation_id TEXT NOT NULL DEFAULT '',
      nesting_depth INTEGER NOT NULL DEFAULT 0,
      battle_id TEXT NOT NULL DEFAULT '',
      winning_conversation_id TEXT NOT NULL DEFAULT '',
      not_fully_idle numeric NOT NULL DEFAULT false,
      killed numeric NOT NULL DEFAULT false,
      last_user_input_time datetime NOT NULL DEFAULT '',
      last_user_input_step_index INTEGER NOT NULL DEFAULT -1,
      app_data_dir TEXT NOT NULL DEFAULT '',
      raw_summary BLOB,
      group_id TEXT NOT NULL DEFAULT ''
    );
    CREATE TABLE IF NOT EXISTS conversation_parents (
      conversation_id TEXT PRIMARY KEY,
      parent_id TEXT NOT NULL
    );
  `);
  db.exec("DELETE FROM conversation_summaries;");
  const stmt = db.prepare(`
    INSERT INTO conversation_summaries
      (conversation_id, title, status, not_fully_idle, killed, parent_conversation_id, agent_name, step_count, last_modified_time)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  for (const r of rows) {
    stmt.run(
      r.id,
      r.title ?? "",
      r.status,
      r.notFullyIdle ?? 0,
      r.killed ?? 0,
      r.parentId ?? "",
      r.agentName ?? "",
      r.stepCount ?? 1,
      r.lastModifiedIso ?? "2026-11-12T13:00:00Z",
    );
  }
  db.close();
}

describe("agy provider live state, subagent filtering, and metrics", () => {
  const dirs: string[] = [];
  afterEach(() => {
    while (dirs.length) {
      rmSync(dirs.pop()!, { recursive: true, force: true });
    }
  });

  const makeTemp = () => {
    const dir = mkdtempSync(join(tmpdir(), "agy-prov-"));
    dirs.push(dir);
    mkdirSync(join(dir, "conversations"), { recursive: true });
    return dir;
  };

  it("keeps working during long Gemini thinking (>10s) and hides subagent from island alerts", async () => {
    const agyDir = makeTemp();
    let fakeNow = Date.parse("2026-11-12T13:01:00Z");
    const parentId = "aaaaaaaa-1111-2222-3333-444444444444";
    const childId = "bbbbbbbb-1111-2222-3333-444444444444";

    writeFileSync(
      join(agyDir, "settings.json"),
      JSON.stringify({ model: "Gemini 4 Hydrogen (XHigh)" }),
    );

    const parentDb = join(agyDir, "conversations", `${parentId}.db`);
    const childDb = join(agyDir, "conversations", `${childId}.db`);

    writeConversationDb(parentDb, {
      cwd: "C:/repo/demo",
      createdSec: Math.floor((fakeNow - 60_000) / 1000),
      steps: [
        {
          idx: 0,
          stepType: 14,
          status: 3,
          metadata: pb([[1, [[1, Math.floor((fakeNow - 55_000) / 1000)]]]]),
          payload: pb([[19, [[2, "Optimize sidebar"]]]]),
        },
        {
          idx: 1,
          stepType: 15,
          status: 8, // in-flight generation started 45s ago
          metadata: pb([[1, [[1, Math.floor((fakeNow - 45_000) / 1000)]]]]),
        },
      ],
    });
    // Simulate DB mtime 45 seconds old (>10s AGY_WORKING_WINDOW_MS)
    const staleDate = new Date(fakeNow - 45_000);
    utimesSync(parentDb, staleDate, staleDate);

    writeConversationDb(childDb, {
      cwd: "C:/repo/demo",
      createdSec: Math.floor((fakeNow - 30_000) / 1000),
      steps: [
        {
          idx: 0,
          stepType: 14,
          status: 3,
          metadata: pb([[1, [[1, Math.floor((fakeNow - 30_000) / 1000)]]]]),
          payload: pb([[19, [[2, "Subagent check"]]]]),
        },
        {
          idx: 1,
          stepType: 15,
          status: 3,
          metadata: pb([
            [1, [[1, Math.floor((fakeNow - 28_000) / 1000)]]],
            [7, [[1, Math.floor((fakeNow - 20_000) / 1000)]]],
            [
              9,
              [
                [2, 500],
                [3, 120],
                [5, 1000],
              ],
            ],
          ]),
          payload: pb([[20, [[1, "Checked files."]]]]),
        },
      ],
      genMeta: [
        {
          idx: 0,
          data: pb([
            [
              1,
              [
                [19, "gemini-4-carbon"],
                [21, "Gemini 4 Carbon (High)"],
                [
                  20,
                  [
                    [1, "parent_cascade_id"],
                    [2, parentId],
                  ],
                ],
              ],
            ],
          ]),
        },
      ],
    });
    const childDate = new Date(fakeNow - 20_000);
    utimesSync(childDb, childDate, childDate);

    writeSummariesDb(agyDir, [
      {
        id: parentId,
        title: "Optimize Jun Sidebar",
        status: "CASCADE_RUN_STATUS_RUNNING",
        notFullyIdle: 1,
      },
      {
        id: childId,
        title: "Subagent",
        status: "CASCADE_RUN_STATUS_IDLE",
        notFullyIdle: 0,
        parentId,
        agentName: "self",
      },
    ]);

    let presenceMap: Record<string, AgyPresenceState> = {
      [parentId]: "locked",
      [childId]: "absent",
    };

    const provider = createAgyProvider({
      agyDir,
      now: () => fakeNow,
      readPresence: (_dir, id) => presenceMap[id] ?? "absent",
    });

    const candidates = await Promise.resolve(provider.listCandidates());
    const persisted = await Promise.all(
      candidates.map((c) => provider.summarize(c)),
    );
    const sessions = provider.overlaySessions(persisted.map((p) => hydrate(p)));

    const parent = sessions.find((s) => s.id === parentId)!;
    const child = sessions.find((s) => s.id === childId)!;

    // Parent must NOT drop to idle despite 45s old DB mtime and no gen_metadata yet:
    expect(parent.state).toBe("working");
    expect(parent.modelDisplayName).toBe("Gemini 4 Hydrogen");
    expect(parent.effortLevel).toBe("xhigh");
    expect(parent.apiDurationMs).toBeGreaterThanOrEqual(45_000);
    expect(parent.sessionClockMs).toBeGreaterThanOrEqual(60_000);

    // Child must link to parent so island-feed ignores child idle transitions:
    expect(child.parentSessionId).toBe(parentId);
    expect(child.threadKind).toBe("subagent");
    expect(child.usageByModel?.length).toBe(1);

    const snap = buildIslandSnapshot({
      sessions,
      accounts: null,
      account: null,
      products: null,
      remoteOnline: false,
      now: fakeNow,
    });
    expect(snap.sessions.map((s) => s.id)).toEqual([parentId]);
    expect(snap.sessions[0]?.state).toBe("working");

    // Once real turn finishes: step finishes (status=3) & summary flips IDLE while lock held -> idle ONCE
    fakeNow += 5_000;
    const doneDb = new DatabaseSync(parentDb);
    doneDb
      .prepare("UPDATE steps SET status = 3, step_payload = ? WHERE idx = 1")
      .run(pb([[20, [[1, "Done."]]]]));
    doneDb.close();
    const idleDate = new Date(fakeNow);
    utimesSync(parentDb, idleDate, idleDate);
    writeSummariesDb(agyDir, [
      {
        id: parentId,
        title: "Optimize Jun Sidebar",
        status: "CASCADE_RUN_STATUS_IDLE",
        notFullyIdle: 0,
      },
      {
        id: childId,
        title: "Subagent",
        status: "CASCADE_RUN_STATUS_IDLE",
        notFullyIdle: 0,
        parentId,
        agentName: "self",
      },
    ]);
    const candsIdle = await Promise.resolve(provider.listCandidates());
    const pIdle = provider.restate(
      candsIdle.find((c) => c.id === parentId)!,
      persisted.find((s) => s.id === parentId)!,
    );
    expect(pIdle.state).toBe("idle");

    // While child subagent is still RUNNING, parent must stay working even if its own summary reads IDLE:
    presenceMap = { [parentId]: "locked", [childId]: "locked" };
    writeSummariesDb(agyDir, [
      {
        id: parentId,
        title: "Optimize Jun Sidebar",
        status: "CASCADE_RUN_STATUS_IDLE",
        notFullyIdle: 0,
      },
      {
        id: childId,
        title: "Subagent",
        status: "CASCADE_RUN_STATUS_RUNNING",
        notFullyIdle: 1,
        parentId,
        agentName: "self",
      },
    ]);
    const candsChildActive = await Promise.resolve(provider.listCandidates());
    const pChildActive = provider.restate(
      candsChildActive.find((c) => c.id === parentId)!,
      pIdle,
    );
    expect(pChildActive.state).toBe("working");

    // Once CLI process closes/crashes (`unlocked`), state flips cleanly to `ended`:
    presenceMap = { [parentId]: "unlocked", [childId]: "absent" };
    writeSummariesDb(agyDir, [
      {
        id: parentId,
        title: "Optimize Jun Sidebar",
        status: "CASCADE_RUN_STATUS_RUNNING",
        notFullyIdle: 1,
      },
    ]);
    const candsDead = await Promise.resolve(provider.listCandidates());
    const pDead = provider.restate(
      candsDead.find((c) => c.id === parentId)!,
      pIdle,
    );
    expect(pDead.state).toBe("ended");

    // Child transcript and turn activity both resolve cleanly:
    const subTx = await Promise.resolve(
      provider.readSubagentTranscript(parentId, childId),
    );
    expect(subTx.status).toBe("changed");
    const act = await Promise.resolve(provider.readTurnActivity!(parentId));
    expect(act.status).toBe("changed");
    if (act.status === "changed") {
      expect(act.activity.tasks[0]?.text).toBe("Optimize sidebar");
    }

    const metrics = await Promise.resolve(provider.readMetrics(childId));
    expect(metrics.status).toBe("changed");
    if (metrics.status === "changed") {
      expect(metrics.metrics.tokenSpeed?.outputTps).toBeCloseTo(120 / 8, 5);
    }
  });
});
