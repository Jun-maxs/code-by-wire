import { createReadStream, existsSync, readdirSync, statSync } from "node:fs";
import { mkdirSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { createInterface } from "node:readline";
import type { SkillUsage } from "@shared/skills";

/**
 * How often each skill was used, read from the agents' own transcripts (fork feature, 2026-10-28),
 * so the Skills page can point at the ones nobody calls. Claude Code: a `Skill` tool call or a
 * `/name` slash command. Codex has no skill tool — it reads the skill's SKILL.md with a shell or
 * file tool, so a tool call naming `skills/<name>/SKILL.md` counts (its instructions also list every
 * skill's path, which is why only tool-call lines are read).
 *
 * Transcripts run to gigabytes, so each file's hits are cached by size + mtime and only new or
 * grown files are read again.
 */

interface FileHits {
  size: number;
  mtimeMs: number;
  /** skill → [count, last used epoch ms] */
  hits: Record<string, [number, number]>;
}

interface Cache {
  version: 1;
  files: Record<string, FileHits>;
  /** Hits from transcripts since deleted (cleanup, the Recycle Bin), so they still count. */
  retired: FileHits["hits"];
}

const CLAUDE_SKILL = /"name":"Skill","input":\{"skill":"([^"]+)"/g;
const SLASH = /<command-name>\/([\w:.-]+)<\/command-name>/g;
const CODEX_READ = /skills(?:\\+|\/)+([\w.-]+)(?:\\+|\/)+SKILL\.md/g;
const STAMP = /"timestamp":"([^"]+)"/;

/** `superpowers:brainstorming` → `brainstorming`; skills are matched by their bare name. */
const bare = (name: string) => name.slice(name.lastIndexOf(":") + 1);

function transcriptRoots(): { dir: string; kind: "claude" | "codex" }[] {
  const home = homedir();
  const claude = [
    process.env.CLAUDE_CONFIG_DIR &&
      join(process.env.CLAUDE_CONFIG_DIR, "projects"),
    join(home, ".claude-shared", "projects"),
    join(home, ".claude", "projects"),
  ].filter((x): x is string => !!x && existsSync(x));
  const seen = new Set<string>();
  const out: { dir: string; kind: "claude" | "codex" }[] = [];
  for (const dir of claude) {
    let real = dir;
    try {
      real = realpathSync(dir);
    } catch {
      // keep the path as given
    }
    if (seen.has(real)) continue;
    seen.add(real);
    out.push({ dir: real, kind: "claude" });
  }
  const codex = join(home, ".codex", "sessions");
  if (existsSync(codex)) out.push({ dir: codex, kind: "codex" });
  return out;
}

function walk(dir: string, out: string[]): void {
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const e of entries) {
    const p = join(dir, e.name);
    if (e.isDirectory()) walk(p, out);
    else if (e.name.endsWith(".jsonl")) out.push(p);
  }
}

async function scanFile(
  path: string,
  kind: "claude" | "codex",
  fallbackMs: number,
): Promise<FileHits["hits"]> {
  const hits: FileHits["hits"] = {};
  const add = (name: string, line: string) => {
    const n = bare(name);
    if (!n) return;
    const t = Date.parse(STAMP.exec(line)?.[1] ?? "") || fallbackMs;
    const h = (hits[n] ??= [0, 0]);
    h[0]++;
    h[1] = Math.max(h[1], t);
  };
  const rl = createInterface({
    input: createReadStream(path, { encoding: "utf8" }),
    crlfDelay: Infinity,
  });
  for await (const line of rl) {
    if (kind === "claude") {
      if (line.includes('"name":"Skill"'))
        for (const m of line.matchAll(CLAUDE_SKILL)) add(m[1], line);
      if (line.includes("<command-name>/"))
        for (const m of line.matchAll(SLASH)) add(m[1], line);
    } else if (
      line.includes("SKILL.md") &&
      (line.includes('"type":"function_call"') ||
        line.includes('"type":"custom_tool_call"'))
    ) {
      // One read of a file is one use, however many times the command names it.
      const names = new Set([...line.matchAll(CODEX_READ)].map((m) => m[1]));
      for (const n of names) add(n, line);
    }
  }
  return hits;
}

export interface SkillUsageScanner {
  /** The usage as of the last finished scan, and whether one is running. */
  read(): {
    usage: Record<string, SkillUsage>;
    scannedAt: number | null;
    scanning: boolean;
  };
  /** Start a scan unless one is running; resolves when it finishes. */
  scan(): Promise<void>;
}

export function createSkillUsageScanner(cacheFile: string): SkillUsageScanner {
  let cache: Cache = { version: 1, files: {}, retired: {} };
  try {
    const raw = JSON.parse(readFileSync(cacheFile, "utf8")) as Cache;
    if (raw?.version === 1 && raw.files)
      cache = { ...raw, retired: raw.retired ?? {} };
  } catch {
    // no cache yet
  }
  let scannedAt: number | null = existsSync(cacheFile)
    ? statSync(cacheFile).mtimeMs
    : null;
  let running: Promise<void> | null = null;

  const summarize = (): Record<string, SkillUsage> => {
    const out: Record<string, SkillUsage> = {};
    const all = [
      cache.retired,
      ...Object.values(cache.files).map((f) => f.hits),
    ];
    for (const hits of all)
      for (const [name, [count, last]] of Object.entries(hits)) {
        const u = (out[name] ??= { count: 0, lastUsedAt: null });
        u.count += count;
        u.lastUsedAt = Math.max(u.lastUsedAt ?? 0, last) || null;
      }
    return out;
  };

  const scan = async () => {
    const next: Cache = {
      version: 1,
      files: {},
      retired: { ...cache.retired },
    };
    for (const { dir, kind } of transcriptRoots()) {
      const files: string[] = [];
      walk(dir, files);
      for (const path of files) {
        let st;
        try {
          st = statSync(path);
        } catch {
          continue;
        }
        const old = cache.files[path];
        if (old && old.size === st.size && old.mtimeMs === st.mtimeMs) {
          next.files[path] = old;
          continue;
        }
        try {
          next.files[path] = {
            size: st.size,
            mtimeMs: st.mtimeMs,
            hits: await scanFile(path, kind, st.mtimeMs),
          };
        } catch {
          // unreadable right now (being written, locked); keep what it had and try again next scan
          if (old) next.files[path] = old;
        }
      }
    }
    for (const [path, f] of Object.entries(cache.files)) {
      if (next.files[path]) continue;
      for (const [name, [count, last]] of Object.entries(f.hits)) {
        const r = (next.retired[name] ??= [0, 0]);
        r[0] += count;
        r[1] = Math.max(r[1], last);
      }
    }
    cache = next;
    scannedAt = Date.now();
    try {
      mkdirSync(dirname(cacheFile), { recursive: true });
      writeFileSync(cacheFile, JSON.stringify(cache));
    } catch {
      // the counts still serve this run
    }
  };

  return {
    read: () => ({ usage: summarize(), scannedAt, scanning: running !== null }),
    scan() {
      running ??= scan().finally(() => {
        running = null;
      });
      return running;
    },
  };
}
