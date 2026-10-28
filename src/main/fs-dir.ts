import { readdirSync, statSync } from "node:fs";
import { join } from "node:path";

/** True when `path` is an existing directory. Every stat failure (missing, not a dir, EACCES) collapses to
 *  `false` — the single "not a usable directory" answer the terminal spawn guard and the Open-in handler
 *  both want, so neither has to re-derive it. */
export function isDirectory(path: string): boolean {
  try {
    return statSync(path).isDirectory();
  } catch {
    return false;
  }
}

/** Bytes on disk under `path` (a file, or a directory walked recursively); 0 when it's missing. */
export function pathBytes(path: string): number {
  try {
    const st = statSync(path);
    if (!st.isDirectory()) return st.size;
    let n = 0;
    for (const e of readdirSync(path)) n += pathBytes(join(path, e));
    return n;
  } catch {
    return 0;
  }
}
