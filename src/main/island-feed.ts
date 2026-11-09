import { randomBytes, timingSafeEqual } from "node:crypto";
import {
  mkdirSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import {
  createServer,
  type IncomingMessage,
  type ServerResponse,
} from "node:http";
import type { AddressInfo } from "node:net";
import { join } from "node:path";
import type { IslandSnapshot } from "@shared/island-feed";

/**
 * Fork (2026-11-09): DeskTidy's top island reads this app over loopback, in place of the HUD overlay.
 * A tiny HTTP server on 127.0.0.1 (port picked by the OS) answers `GET /v1/snapshot` and
 * `POST /v1/open`; the port and a per-launch token go in `<userData>/island-feed.json`, which the
 * island reads (and checks `pid` against, since a crash leaves the file behind). Every request must
 * carry the token, and a Host other than 127.0.0.1:<port> is refused, so a web page in a browser on
 * this PC — DNS rebinding included — can't read sessions or open windows.
 */

export const ISLAND_FEED_FILE = "island-feed.json";
/** An open request is `{"sessionId":"…"}`; anything bigger is refused unread. */
const MAX_BODY = 4096;

export interface IslandFeedDeps {
  /** userData: the discovery file is written here. */
  dir: string;
  snapshot: () => IslandSnapshot;
  /** Bring the main window forward on this session (main's showMain). */
  open: (sessionId: string) => void;
  log?: (message: string, err?: unknown) => void;
}

export interface IslandFeed {
  port: number;
  stop(): Promise<void>;
}

function send(res: ServerResponse, status: number, body?: unknown): void {
  if (body === undefined) {
    res.writeHead(status, { "cache-control": "no-store" });
    res.end();
    return;
  }
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
  });
  res.end(JSON.stringify(body));
}

/** The request body, or null once it passes MAX_BODY (the rest is discarded with the request). */
function readBody(req: IncomingMessage): Promise<string | null> {
  if (Number(req.headers["content-length"] ?? 0) > MAX_BODY)
    return Promise.resolve(null);
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    req.on("data", (c: Buffer) => {
      size += c.length;
      if (size > MAX_BODY) {
        req.removeAllListeners("data");
        req.resume();
        resolve(null);
      } else chunks.push(c);
    });
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });
}

export async function startIslandFeed(
  deps: IslandFeedDeps,
): Promise<IslandFeed> {
  const token = randomBytes(32).toString("hex");
  const expected = Buffer.from(`Bearer ${token}`);
  const authorized = (req: IncomingMessage): boolean => {
    const got = Buffer.from(req.headers.authorization ?? "");
    return got.length === expected.length && timingSafeEqual(got, expected);
  };
  let port = 0;

  const handle = async (req: IncomingMessage, res: ServerResponse) => {
    if (req.headers.host !== `127.0.0.1:${port}`) return send(res, 403);
    if (!authorized(req)) return send(res, 401);
    const path = (req.url ?? "").split("?")[0];
    if (req.method === "GET" && path === "/v1/snapshot") {
      try {
        return send(res, 200, deps.snapshot());
      } catch (err) {
        deps.log?.("island snapshot failed", err);
        return send(res, 500);
      }
    }
    if (req.method === "POST" && path === "/v1/open") {
      const body = await readBody(req);
      if (body === null) return send(res, 413);
      let sessionId: unknown;
      try {
        sessionId = (JSON.parse(body) as { sessionId?: unknown } | null)
          ?.sessionId;
      } catch {
        return send(res, 400);
      }
      if (typeof sessionId !== "string" || !sessionId) return send(res, 400);
      try {
        deps.open(sessionId);
      } catch (err) {
        deps.log?.("island open failed", err);
        return send(res, 500);
      }
      return send(res, 204);
    }
    return send(res, 404);
  };

  const server = createServer((req, res) => {
    handle(req, res).catch((err: unknown) => {
      deps.log?.("island request failed", err);
      if (!res.headersSent) send(res, 500);
      else res.destroy();
    });
  });
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      server.off("error", reject);
      resolve();
    });
  });
  server.on("error", (err) => deps.log?.("island feed error", err));
  port = (server.address() as AddressInfo).port;

  // Written whole and renamed into place, so the island never reads half a file; a file left by a
  // crashed launch is replaced.
  const file = join(deps.dir, ISLAND_FEED_FILE);
  mkdirSync(deps.dir, { recursive: true });
  writeFileSync(
    `${file}.tmp`,
    JSON.stringify({ version: 1, port, token, pid: process.pid }),
  );
  renameSync(`${file}.tmp`, file);

  return {
    port,
    stop: async () => {
      // The file goes first, synchronously: on quit the app may exit before the server has closed.
      // Only our own file: a later launch may already have written its own.
      try {
        const on = JSON.parse(readFileSync(file, "utf8")) as {
          token?: unknown;
        };
        if (on.token === token) rmSync(file, { force: true });
      } catch {
        // gone already, or not ours to judge
      }
      await new Promise<void>((resolve) => {
        server.close(() => resolve());
        server.closeAllConnections();
      });
    },
  };
}
