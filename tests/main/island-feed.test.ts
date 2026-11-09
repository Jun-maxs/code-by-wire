import { request } from "node:http";
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  ISLAND_FEED_FILE,
  startIslandFeed,
  type IslandFeed,
} from "../../src/main/island-feed";
import type { IslandSnapshot } from "../../src/shared/island-feed";

const SNAPSHOT: IslandSnapshot = {
  version: 1,
  now: 1_800_000_000_000,
  sessions: [
    {
      id: "abc",
      agent: "claude",
      state: "working",
      title: "Jun-Code · 修切号",
      project: "cbw-wt-jun",
      topicColor: "#5e8bff",
      lastActivity: 1_799_999_990_000,
      account: "#2",
      remote: false,
    },
  ],
  accounts: { smartSwitch: true, items: [] },
  remote: { online: true },
};

let dir: string;
let feed: IslandFeed | null;
let open: ReturnType<typeof vi.fn<(id: string) => void>>;

const discovery = () =>
  JSON.parse(readFileSync(join(dir, ISLAND_FEED_FILE), "utf8")) as {
    version: number;
    port: number;
    token: string;
    pid: number;
  };

interface Reply {
  status: number;
  type: string | undefined;
  body: string;
}

function call(
  method: string,
  path: string,
  opts: { token?: string | null; host?: string; body?: string } = {},
): Promise<Reply> {
  const { port, token } = discovery();
  const headers: Record<string, string> = {
    host: opts.host ?? `127.0.0.1:${port}`,
  };
  const t = opts.token === undefined ? token : opts.token;
  if (t !== null) headers.authorization = `Bearer ${t}`;
  if (opts.body !== undefined) {
    headers["content-type"] = "application/json";
    headers["content-length"] = String(Buffer.byteLength(opts.body));
  }
  return new Promise((resolve, reject) => {
    const req = request(
      { host: "127.0.0.1", port, path, method, headers },
      (res) => {
        let body = "";
        res.setEncoding("utf8");
        res.on("data", (c: string) => (body += c));
        res.on("end", () =>
          resolve({
            status: res.statusCode ?? 0,
            type: res.headers["content-type"],
            body,
          }),
        );
      },
    );
    req.on("error", reject);
    req.end(opts.body);
  });
}

beforeEach(async () => {
  dir = mkdtempSync(join(tmpdir(), "cbw-island-"));
  open = vi.fn<(id: string) => void>();
  feed = await startIslandFeed({ dir, snapshot: () => SNAPSHOT, open });
});

afterEach(async () => {
  await feed?.stop();
  feed = null;
  rmSync(dir, { recursive: true, force: true });
});

describe("startIslandFeed", () => {
  it("writes the discovery file", () => {
    const d = discovery();
    expect(d.version).toBe(1);
    expect(d.port).toBe(feed?.port);
    expect(d.token).toMatch(/^[0-9a-f]{64}$/);
    expect(d.pid).toBe(process.pid);
  });

  it("replaces a stale file", async () => {
    await feed?.stop();
    writeFileSync(
      join(dir, ISLAND_FEED_FILE),
      JSON.stringify({ port: 1, token: "x", pid: 1, version: 1 }),
    );
    feed = await startIslandFeed({ dir, snapshot: () => SNAPSHOT, open });
    const d = discovery();
    expect(d.port).toBe(feed.port);
    expect(d.token).toMatch(/^[0-9a-f]{64}$/);
    expect((await call("GET", "/v1/snapshot")).status).toBe(200);
  });

  it("removes the file on stop", async () => {
    await feed?.stop();
    feed = null;
    expect(existsSync(join(dir, ISLAND_FEED_FILE))).toBe(false);
  });

  it("rejects a missing or wrong token with 401", async () => {
    expect((await call("GET", "/v1/snapshot", { token: null })).status).toBe(
      401,
    );
    expect(
      (await call("GET", "/v1/snapshot", { token: "0".repeat(64) })).status,
    ).toBe(401);
    expect((await call("GET", "/v1/snapshot", { token: "short" })).status).toBe(
      401,
    );
  });

  it("rejects a foreign Host with 403", async () => {
    const { port } = discovery();
    const r = await call("GET", "/v1/snapshot", { host: `evil.test:${port}` });
    expect(r.status).toBe(403);
  });

  it("serves the snapshot", async () => {
    const r = await call("GET", "/v1/snapshot");
    expect(r.status).toBe(200);
    expect(r.type).toContain("application/json");
    expect(JSON.parse(r.body)).toEqual(SNAPSHOT);
  });

  it("answers 500 when the snapshot throws", async () => {
    await feed?.stop();
    const log = vi.fn();
    feed = await startIslandFeed({
      dir,
      snapshot: () => {
        throw new Error("boom");
      },
      open,
      log,
    });
    expect((await call("GET", "/v1/snapshot")).status).toBe(500);
    expect(log).toHaveBeenCalledTimes(1);
  });

  it("opens a session", async () => {
    const r = await call("POST", "/v1/open", {
      body: JSON.stringify({ sessionId: "abc" }),
    });
    expect(r.status).toBe(204);
    expect(open).toHaveBeenCalledTimes(1);
    expect(open).toHaveBeenCalledWith("abc");
  });

  it("rejects bad open bodies", async () => {
    expect((await call("POST", "/v1/open", { body: "not json" })).status).toBe(
      400,
    );
    expect(
      (
        await call("POST", "/v1/open", {
          body: JSON.stringify({ sessionId: 7 }),
        })
      ).status,
    ).toBe(400);
    expect(
      (
        await call("POST", "/v1/open", {
          body: JSON.stringify({ sessionId: "x".repeat(5000) }),
        })
      ).status,
    ).toBe(413);
    expect(open).not.toHaveBeenCalled();
  });

  it("404 for anything else", async () => {
    expect((await call("GET", "/v1/nope")).status).toBe(404);
    expect((await call("GET", "/v1/open")).status).toBe(404);
  });
});
