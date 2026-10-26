import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { readTextOrNull } from "./claude-config";

/**
 * Fork feature: sessions started "with remote" — launched through the remote command (claude-r, which runs
 * Claude Code under HAPI so the session can be continued from the phone). Keyed by session id; Resume and
 * Fork read it back so a remote session stays remote for its whole life. Stored under Electron's userData
 * beside launch-args.json. A missing id means a plain local session, as before the feature.
 */
export interface RemoteSessionStore {
  /** The ids started with remote. */
  read(): Record<string, true>;
  has(id: string): boolean;
  /** Mark (or unmark) `id` as a remote session. */
  set(id: string, remote: boolean): void;
  /** Follow a session-id re-key (/clear rotation). No-op when `from` is not remote or `to` already is. */
  rename(from: string, to: string): void;
}

export function createRemoteSessionStore(deps: {
  dir: string;
}): RemoteSessionStore {
  const file = join(deps.dir, "remote-sessions.json");

  function read(): Record<string, true> {
    const raw = readTextOrNull(file);
    if (raw === null) return {};
    try {
      const v: unknown = JSON.parse(raw);
      if (!v || typeof v !== "object" || Array.isArray(v)) return {};
      const out: Record<string, true> = {};
      for (const [k, val] of Object.entries(v)) if (val === true) out[k] = true;
      return out;
    } catch {
      return {}; // a corrupt file reads as "nothing remote" rather than crashing the app
    }
  }

  function write(next: Record<string, true>): void {
    mkdirSync(deps.dir, { recursive: true });
    writeFileSync(file, JSON.stringify(next, null, 2) + "\n");
  }

  return {
    read,
    has: (id) => read()[id] === true,
    set(id, remote) {
      const next = read();
      if (remote) next[id] = true;
      else delete next[id];
      write(next);
    },
    rename(from, to) {
      const next = read();
      if (!next[from] || next[to]) return;
      next[to] = true;
      delete next[from];
      write(next);
    },
  };
}

/** The remote command: CBW_REMOTE_COMMAND, else `claude-r` (the owner's HAPI wrapper on PATH). */
export function remoteCommand(env: NodeJS.ProcessEnv = process.env): string {
  return env.CBW_REMOTE_COMMAND?.trim() || "claude-r";
}
