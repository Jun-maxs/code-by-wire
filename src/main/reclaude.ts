import { existsSync, readFileSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

/** What the account switcher reclaude (`rec`) selects for Claude Code. */
export interface Reclaude {
  /** The selected account's Claude config dir: `~/.rec/claude/accounts/<account>/config`. */
  configDir: string;
  /** `rec.exe`, which starts `claude` for that account (proxy, timezone and daemon included). */
  launcher: string;
}

export interface ReclaudeDeps {
  home: string;
  env: NodeJS.ProcessEnv;
  readText: (path: string) => string | null;
  isDir: (path: string) => boolean;
  isFile: (path: string) => boolean;
}

const realDeps = (): ReclaudeDeps => ({
  home: homedir(),
  env: process.env,
  readText: (path) => {
    try {
      return readFileSync(path, "utf8");
    } catch {
      return null;
    }
  },
  isDir: (path) => {
    try {
      return statSync(path).isDirectory();
    } catch {
      return false;
    }
  },
  isFile: (path) => existsSync(path),
});

/**
 * The reclaude account in use, or null when reclaude isn't installed or names no usable account.
 * reclaude keeps the selected account's name in `~/.rec/claude/current`; since v1.5 an account only
 * takes effect in a `claude` that `rec` starts, so sessions must be launched through `rec.exe`
 * (installed under `%LOCALAPPDATA%\Programs\reclaude\bin`). A name that could climb out of the
 * accounts folder is refused.
 */
export function detectReclaude(
  deps: ReclaudeDeps = realDeps(),
): Reclaude | null {
  const root = join(deps.home, ".rec", "claude");
  const account = deps.readText(join(root, "current"))?.trim();
  if (!account || /[\\/]|\.\./.test(account)) return null;
  const configDir = join(root, "accounts", account, "config");
  if (!deps.isDir(configDir)) return null;
  const localAppData = deps.env.LOCALAPPDATA;
  if (!localAppData) return null;
  const launcher = join(localAppData, "Programs", "reclaude", "bin", "rec.exe");
  return deps.isFile(launcher) ? { configDir, launcher } : null;
}

/**
 * Adopt reclaude's account for this run unless the user's environment already names a Claude config
 * dir (a `CLAUDE_CONFIG_DIR` they set wins, as it does for `claude` itself): sessions then read and
 * launch under the same account. Sets `CLAUDE_CONFIG_DIR` and `CBW_CLAUDE_LAUNCHER` in `env`; call
 * once at startup, before anything resolves the config dir or spawns a session.
 */
export function adoptReclaude(
  env: NodeJS.ProcessEnv = process.env,
  detect: () => Reclaude | null = detectReclaude,
): Reclaude | null {
  if (env.CLAUDE_CONFIG_DIR) return null;
  const found = detect();
  if (!found) return null;
  env.CLAUDE_CONFIG_DIR = found.configDir;
  env.CBW_CLAUDE_LAUNCHER ??= found.launcher;
  return found;
}
