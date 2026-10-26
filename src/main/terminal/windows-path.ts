import { execFileSync } from "node:child_process";
import { windowsSystemTool } from "./windows-system";

/** Where Windows keeps the PATH a fresh login gets: the machine's, then the user's. */
const PATH_KEYS = [
  "HKLM\\SYSTEM\\CurrentControlSet\\Control\\Session Manager\\Environment",
  "HKCU\\Environment",
];

/** The `Path` value out of `reg query <key> /v Path` output, or null when the key has none. */
export function parseRegPath(output: string): string | null {
  const m = output.match(/^\s*Path\s+REG_(?:EXPAND_)?SZ\s+(.*)$/im);
  return m ? m[1].trim() : null;
}

/**
 * `current` with every directory of the registry `values` it lacks appended, in order. `%VAR%`
 * references expand against `env` (an unset one stays as written); comparison ignores case, as
 * Windows paths do. An entry `reg` decoded with a replacement character (a non-ASCII folder read
 * through the wrong code page) is skipped rather than added mangled.
 */
export function mergeWindowsPath(
  current: string | undefined,
  values: string[],
  env: NodeJS.ProcessEnv,
): string {
  const parts = (current ?? "").split(";").filter(Boolean);
  const have = new Set(parts.map((p) => p.toLowerCase()));
  for (const value of values) {
    for (const raw of value.split(";")) {
      const dir = raw
        .replace(/%([^%]+)%/g, (whole, name: string) => env[name] ?? whole)
        .trim();
      if (!dir || dir.includes("\uFFFD") || have.has(dir.toLowerCase()))
        continue;
      have.add(dir.toLowerCase());
      parts.push(dir);
    }
  }
  return parts.join(";");
}

/**
 * Launched from a stripped environment (a shortcut some launchers start, a scheduled task), the app's
 * PATH can lack System32 and the user's own folders: node-pty then can't find cmd.exe, and cmd can't
 * find `claude`. Merge the registry's machine and user PATH back into `process.env.PATH` once at
 * startup. Windows-only; any failure leaves PATH as it was.
 */
export function restoreWindowsPath(
  env: NodeJS.ProcessEnv = process.env,
  query: (key: string) => string = (key) =>
    execFileSync(
      windowsSystemTool("reg.exe", env),
      ["query", key, "/v", "Path"],
      {
        encoding: "utf8",
        windowsHide: true,
      },
    ),
): void {
  const values: string[] = [];
  for (const key of PATH_KEYS) {
    try {
      const value = parseRegPath(query(key));
      if (value) values.push(value);
    } catch {
      // A missing key or value is not an error worth reporting: there is just nothing to add.
    }
  }
  if (values.length) env.PATH = mergeWindowsPath(env.PATH, values, env);
}
