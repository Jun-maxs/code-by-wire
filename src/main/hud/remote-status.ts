import { readFileSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

/** Whether the phone can reach this PC: the HAPI runner (`hapi runner start`) is alive and its
 *  heartbeat in `~/.hapi/runner.state.json` is fresh. The runner rewrites the file about once a
 *  minute while it is connected to the hub. */
export interface RemoteStatus {
  /** false when HAPI isn't set up on this machine at all. */
  installed: boolean;
  online: boolean;
  /** The hub the runner talks to (e.g. https://main.yuanjp.shop). */
  hub: string | null;
  /** Last heartbeat, epoch ms. */
  heartbeatAt: number | null;
}

const STALE_MS = 150_000;

export function remoteStatus(
  file = join(
    process.env.HAPI_HOME ?? join(homedir(), ".hapi"),
    "runner.state.json",
  ),
  now = Date.now(),
): RemoteStatus {
  let state: { pid?: number; startedWithApiUrl?: string };
  let mtime: number;
  try {
    state = JSON.parse(readFileSync(file, "utf8")) as typeof state;
    mtime = statSync(file).mtimeMs;
  } catch {
    return { installed: false, online: false, hub: null, heartbeatAt: null };
  }
  let alive = false;
  if (typeof state.pid === "number") {
    try {
      process.kill(state.pid, 0);
      alive = true;
    } catch (e) {
      // EPERM: the process exists but isn't ours to signal — still alive.
      alive = (e as NodeJS.ErrnoException).code === "EPERM";
    }
  }
  return {
    installed: true,
    online: alive && now - mtime < STALE_MS,
    hub: state.startedWithApiUrl ?? null,
    heartbeatAt: mtime,
  };
}
