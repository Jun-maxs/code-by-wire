import { describe, it, expect } from "vitest";
import {
  detectRotations,
  applyRotations,
  type ManagedPty,
} from "../../src/main/provider/claude/rotation";

describe("detectRotations", () => {
  it("follows a managed pty whose Claude session id rotated (a /clear) to the new id", () => {
    // The app spawned `claude --session-id A`, so pid 100 is Managed under id A. The user ran /clear,
    // which starts a fresh Claude session under the SAME process: <pid>.json now carries sessionId B.
    const rotations = detectRotations(
      [{ id: "A", pid: 100 }],
      [{ pid: 100, sessionId: "B" }],
    );
    expect(rotations).toEqual([{ from: "A", to: "B", pid: 100 }]);
  });

  it("reports no rotation while the session id still matches its pid", () => {
    expect(
      detectRotations([{ id: "A", pid: 100 }], [{ pid: 100, sessionId: "A" }]),
    ).toEqual([]);
  });

  it("reports no rotation when the pid has no registry entry — a dead/mid-write process is the Ended path, not a rotation", () => {
    expect(detectRotations([{ id: "A", pid: 100 }], [])).toEqual([]);
  });

  it("ignores registry entries for pids it does not manage", () => {
    expect(
      detectRotations([{ id: "A", pid: 100 }], [{ pid: 999, sessionId: "Z" }]),
    ).toEqual([]);
  });

  it("returns only the rotated pty when several are managed", () => {
    const rotations = detectRotations(
      [
        { id: "A", pid: 100 },
        { id: "C", pid: 200 },
      ],
      [
        { pid: 100, sessionId: "B" }, // A rotated to B
        { pid: 200, sessionId: "C" }, // C unchanged
      ],
    );
    expect(rotations).toEqual([{ from: "A", to: "B", pid: 100 }]);
  });
});

describe("detectRotations below the pty (fork: Windows ptys, HAPI takeover)", () => {
  const tree = (pairs: Array<[number, number]>) => new Map(pairs);

  it("follows /clear on Windows, where the pty is cmd.exe and claude runs below it", () => {
    const parents = tree([
      [100, 1],
      [200, 100],
      [300, 200],
    ]);
    expect(
      detectRotations(
        [{ id: "A", pid: 100 }],
        [{ pid: 300, sessionId: "B" }],
        parents,
      ),
    ).toEqual([{ from: "A", to: "B", pid: 100 }]);
  });

  it("follows a HAPI phone takeover: the local claude is gone and a new one runs a fresh id below the pty", () => {
    const parents = tree([
      [100, 1],
      [200, 100],
      [400, 200],
    ]);
    const rotations = detectRotations(
      [{ id: "A", pid: 100 }],
      [
        { pid: 300, sessionId: "A" }, // the killed local claude's leftover file: not in the snapshot
        { pid: 400, sessionId: "B", startedAt: 2000 },
      ],
      parents,
    );
    expect(rotations).toEqual([{ from: "A", to: "B", pid: 100 }]);
  });

  it("stays put while the managed id itself still runs below the pty", () => {
    const parents = tree([
      [100, 1],
      [300, 100],
      [400, 100],
    ]);
    expect(
      detectRotations(
        [{ id: "A", pid: 100 }],
        [
          { pid: 300, sessionId: "A" },
          { pid: 400, sessionId: "B" },
        ],
        parents,
      ),
    ).toEqual([]);
  });

  it("skips a claude started from inside the session, even when it is newer", () => {
    // The session's claude (300) /cleared to B; a `claude -p` it ran (500) is its child, not a takeover.
    const parents = tree([
      [100, 1],
      [300, 100],
      [500, 300],
    ]);
    const rotations = detectRotations(
      [{ id: "A", pid: 100 }],
      [
        { pid: 300, sessionId: "B", startedAt: 1000 },
        { pid: 500, sessionId: "C", startedAt: 9000 },
      ],
      parents,
    );
    expect(rotations).toEqual([{ from: "A", to: "B", pid: 100 }]);
  });

  it("never takes an id another managed pty already holds", () => {
    const parents = tree([
      [100, 1],
      [300, 100],
    ]);
    expect(
      detectRotations(
        [
          { id: "A", pid: 100 },
          { id: "B", pid: 900 },
        ],
        [{ pid: 300, sessionId: "B" }],
        parents,
      ),
    ).toEqual([]);
  });

  it("ignores live sessions that do not run below the pty", () => {
    const parents = tree([
      [100, 1],
      [300, 1],
    ]);
    expect(
      detectRotations(
        [{ id: "A", pid: 100 }],
        [{ pid: 300, sessionId: "B" }],
        parents,
      ),
    ).toEqual([]);
  });
});

describe("applyRotations", () => {
  function fakeManaged(initial: ManagedPty[]) {
    let list = [...initial];
    return {
      entries: () => list,
      rename: (from: string, to: string) => {
        list = list.map((e) => (e.id === from ? { id: to, pid: e.pid } : e));
      },
    };
  }

  it("renames each rotated id in the registry, then hands (from, to) to the rename effect", async () => {
    const managed = fakeManaged([{ id: "A", pid: 100 }]);
    const renamed: Array<[string, string]> = [];

    const out = await applyRotations(
      managed,
      () => [{ pid: 100, sessionId: "B" }],
      (from, to) => renamed.push([from, to]),
    );

    expect(out).toEqual([{ from: "A", to: "B", pid: 100 }]);
    expect(managed.entries()).toEqual([{ id: "B", pid: 100 }]); // registry follows the pty to its new id
    expect(renamed).toEqual([["A", "B"]]); // and the effect (pty re-key + renderer hand-off) fires
  });

  it("accepts an async registry read — the parse-worker routing the reconcile uses", async () => {
    const managed = fakeManaged([{ id: "A", pid: 100 }]);
    const renamed: Array<[string, string]> = [];
    await applyRotations(
      managed,
      () => Promise.resolve([{ pid: 100, sessionId: "B" }]),
      (from, to) => renamed.push([from, to]),
    );
    expect(renamed).toEqual([["A", "B"]]);
  });

  it("does nothing when no managed pty rotated", async () => {
    const managed = fakeManaged([{ id: "A", pid: 100 }]);
    const renamed: Array<[string, string]> = [];
    await applyRotations(
      managed,
      () => [{ pid: 100, sessionId: "A" }],
      (from, to) => renamed.push([from, to]),
    );
    expect(managed.entries()).toEqual([{ id: "A", pid: 100 }]);
    expect(renamed).toEqual([]);
  });

  it("skips the registry read entirely when nothing is managed — the common no-terminal case", async () => {
    const managed = fakeManaged([]);
    let reads = 0;
    const out = await applyRotations(
      managed,
      () => {
        reads++;
        return [];
      },
      () => {},
    );
    expect(reads).toBe(0); // nothing this run controls → nothing can have rotated, so don't read sessions/
    expect(out).toEqual([]);
  });

  it("reads the process snapshot once per unchecked unmanaged session, then follows it below the pty", async () => {
    const managed = fakeManaged([{ id: "A", pid: 100 }]);
    let reads = 0;
    const tree = {
      read: () => {
        reads++;
        return Promise.resolve(
          new Map([
            [100, 1],
            [300, 100],
          ]),
        );
      },
      seen: new Set<string>(),
    };
    const renamed: Array<[string, string]> = [];
    const registry = () => [{ pid: 300, sessionId: "B" }];

    await applyRotations(
      managed,
      registry,
      (f, t) => renamed.push([f, t]),
      tree,
    );
    expect(renamed).toEqual([["A", "B"]]);
    await applyRotations(managed, registry, () => {}, tree);
    expect(reads).toBe(1); // B is managed now — nothing new to check, no second spawn
  });

  it("skips the snapshot when every registry session is already managed", async () => {
    const managed = fakeManaged([{ id: "A", pid: 100 }]);
    let reads = 0;
    const tree = {
      read: () => {
        reads++;
        return Promise.resolve(new Map<number, number>());
      },
      seen: new Set<string>(),
    };
    await applyRotations(
      managed,
      () => [{ pid: 300, sessionId: "A" }],
      () => {},
      tree,
    );
    expect(reads).toBe(0);
  });

  it("retries on the next pass after a failed (empty) snapshot", async () => {
    const managed = fakeManaged([{ id: "A", pid: 100 }]);
    const snapshots = [
      new Map<number, number>(),
      new Map([
        [100, 1],
        [300, 100],
      ]),
    ];
    const tree = {
      read: () => Promise.resolve(snapshots.shift() ?? new Map()),
      seen: new Set<string>(),
    };
    const renamed: Array<[string, string]> = [];
    const registry = () => [{ pid: 300, sessionId: "B" }];

    await applyRotations(
      managed,
      registry,
      (f, t) => renamed.push([f, t]),
      tree,
    );
    expect(renamed).toEqual([]);
    await applyRotations(
      managed,
      registry,
      (f, t) => renamed.push([f, t]),
      tree,
    );
    expect(renamed).toEqual([["A", "B"]]);
  });
});
