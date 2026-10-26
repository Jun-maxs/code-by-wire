import {
  closeSync,
  openSync,
  readdirSync,
  readFileSync,
  readSync,
  statSync,
} from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import type {
  PersistedSession,
  RelayUsage,
  Session,
  SessionCandidate,
} from "@shared/types";
import { normalizeModelId } from "@shared/models";
import { toTranscriptWire } from "@shared/transcript";
import type { Provider } from "../types";
import { deriveSessionState } from "../claude/state";
import { projectFromCwd } from "../../project-name";
import { MAX_TEXT_FILE_BYTES } from "../../util/file-size";
import {
  extractPiToolResult,
  parsePiEvents,
  readPiHead,
  summarizePiSession,
  type PiSessionHead,
} from "./transcript";

/** Pi's home: `PI_CODING_AGENT_DIR`, else `~/.pi/agent` — where its sessions and models.json live. */
export function resolvePiDir(env: NodeJS.ProcessEnv = process.env): string {
  return env.PI_CODING_AGENT_DIR || join(homedir(), ".pi", "agent");
}

/** A session file written to within this long counts as a session at work. */
export const PI_WORKING_WINDOW_MS = 10_000;
const DEFAULT_RECENT_WINDOW_MS = 30 * 24 * 60 * 60 * 1000;
/** The session line is the file's first; this much always holds it. */
const HEAD_BYTES = 64 * 1024;

interface PiFile {
  id: string;
  path: string;
  mtimeMs: number;
  size: number;
}

/** Every session file: `<piDir>/sessions/<cwd-slug>/<iso>_<uuid>.jsonl`, the uuid being its id. */
export function listPiSessions(piDir: string): PiFile[] {
  const root = join(piDir, "sessions");
  const out: PiFile[] = [];
  let slugs: string[];
  try {
    slugs = readdirSync(root);
  } catch {
    return out;
  }
  for (const slug of slugs) {
    let names: string[];
    try {
      names = readdirSync(join(root, slug));
    } catch {
      continue;
    }
    for (const name of names) {
      const m = /_([0-9a-f-]{8,})\.jsonl$/i.exec(name);
      if (!m) continue;
      const path = join(root, slug, name);
      try {
        const st = statSync(path);
        if (st.isFile())
          out.push({ id: m[1], path, mtimeMs: st.mtimeMs, size: st.size });
      } catch {
        // vanished mid-scan
      }
    }
  }
  return out;
}

function readHead(path: string): PiSessionHead | null {
  let fd: number | null = null;
  try {
    fd = openSync(path, "r");
    const buf = Buffer.alloc(HEAD_BYTES);
    const n = readSync(fd, buf, 0, HEAD_BYTES, 0);
    const first = buf.subarray(0, n).toString("utf8").split("\n")[0] ?? "";
    return readPiHead(first);
  } catch {
    return null;
  } finally {
    if (fd !== null) closeSync(fd);
  }
}

function readWhole(file: PiFile): string | null {
  if (file.size > MAX_TEXT_FILE_BYTES) return null;
  try {
    return readFileSync(file.path, "utf8");
  } catch {
    return null;
  }
}

export interface PiProviderDeps {
  piDir?: string;
  now?: () => number;
  recentWindowMs?: number;
  managed?: {
    has(id: string): boolean;
    cwdOf?(id: string): string | undefined;
  };
  /** The key's usage when Pi reaches its models through a relay (usage/relay.ts). */
  relay?: { read(): RelayUsage | null };
}

export interface PiProvider extends Provider {
  overlaySessions(sessions: Session[]): Session[];
}

/**
 * The Pi read-side provider: sidebar rows from session heads, the transcript pane from the whole
 * session file. Liveness is the file's freshness (Pi keeps no process registry), so an idle Pi
 * reads as ended until it writes again — the same accepted gap as codex. Every other reader settles
 * empty; the capability flags keep their surfaces hidden.
 */
export function createPiProvider(deps: PiProviderDeps = {}): PiProvider {
  const piDir = deps.piDir ?? resolvePiDir();
  const now = deps.now ?? (() => Date.now());
  const recentWindowMs = deps.recentWindowMs ?? DEFAULT_RECENT_WINDOW_MS;
  const managed = deps.managed ?? { has: () => false };

  const heads = new Map<string, PiSessionHead>();
  const headFor = (path: string): PiSessionHead | null => {
    const cached = heads.get(path);
    if (cached) return cached;
    const head = readHead(path);
    if (head) heads.set(path, head);
    return head;
  };
  const fileFor = (id: string): PiFile | null =>
    listPiSessions(piDir).find((f) => f.id === id) ?? null;
  const signals = (mtimeMs: number, id: string) => {
    const fresh = now() - mtimeMs < PI_WORKING_WINDOW_MS;
    return {
      alive: managed.has(id) || fresh,
      status: fresh ? "busy" : undefined,
      awaitingUser: false,
    };
  };

  const summarize = (c: SessionCandidate): PersistedSession => {
    const file = c.transcriptPath ? fileFor(c.id) : null;
    const text = file ? readWhole(file) : null;
    const s = text ? summarizePiSession(text) : null;
    const project = projectFromCwd(c.cwd);
    return {
      id: c.id,
      agent: "pi",
      title: s?.title ?? project,
      project,
      cwd: c.cwd,
      originCwd: c.cwd,
      branch: undefined,
      state: deriveSessionState(signals(c.transcriptMtimeMs, c.id)),
      management: managed.has(c.id) ? "managed" : "observed",
      model: normalizeModelId(s?.modelRaw ?? undefined),
      modelRaw: s?.modelRaw ?? undefined,
      lastActivityMs: c.transcriptMtimeMs || c.updatedAt || 0,
      createdMs: c.updatedAt || 0,
      awaitingUser: false,
      transcriptMtimeMs: c.transcriptMtimeMs,
      usage: s?.usage ?? {
        inputTokens: 0,
        outputTokens: 0,
        cacheReadTokens: 0,
        cacheCreationTokens: 0,
        cacheCreation5mTokens: 0,
        cacheCreation1hTokens: 0,
      },
      usageByModel: [],
      contextTokens: s?.contextTokens ?? 0,
    };
  };

  return {
    id: "pi",
    listCandidates: () => {
      const cutoff = now() - recentWindowMs;
      const out: SessionCandidate[] = [];
      for (const f of listPiSessions(piDir)) {
        if (f.mtimeMs < cutoff && !managed.has(f.id)) continue;
        const head = headFor(f.path);
        if (!head) continue;
        const sig = signals(f.mtimeMs, f.id);
        out.push({
          id: f.id,
          agent: "pi",
          alive: sig.alive,
          status: sig.status,
          cwd: head.cwd,
          transcriptPath: f.path,
          transcriptMtimeMs: f.mtimeMs,
          updatedAt: head.startedMs,
        });
      }
      return out;
    },
    summarize: (c) => Promise.resolve(summarize(c)),
    restate: (c, prev) => ({
      ...prev,
      management: managed.has(c.id) ? "managed" : "observed",
      state: deriveSessionState(signals(c.transcriptMtimeMs, c.id)),
    }),
    readTranscript: (id, sinceMtimeMs) => {
      const file = fileFor(id);
      if (!file) return { status: "absent" };
      if (sinceMtimeMs !== undefined && file.mtimeMs === sinceMtimeMs)
        return { status: "unchanged", mtimeMs: file.mtimeMs };
      if (file.size > MAX_TEXT_FILE_BYTES) return { status: "absent" };
      const text = readWhole(file);
      if (text === null) return { status: "error" };
      return toTranscriptWire({
        status: "changed",
        mtimeMs: file.mtimeMs,
        doc: { ...parsePiEvents(text), subagents: [] },
      });
    },
    getToolResult: (id, toolUseId) => {
      const file = fileFor(id);
      const text = file ? readWhole(file) : null;
      return text === null
        ? { found: false }
        : extractPiToolResult(text, toolUseId);
    },
    readSubagentTranscript: () => ({ status: "absent" }),
    readTasks: () => ({ status: "absent" }),
    readShells: () => ({ status: "absent" }),
    readShellOutput: () => ({ status: "absent" }),
    readMonitors: () => ({ status: "absent" }),
    readMonitorOutput: () => ({ status: "absent" }),
    readMetrics: () => ({ status: "absent" }),
    resolveResumeTarget: (id) => {
      const file = fileFor(id);
      const cwd = file ? headFor(file.path)?.cwd : undefined;
      return file && cwd
        ? { alive: signals(file.mtimeMs, id).alive, cwd }
        : null;
    },
    resolveSessionCwd: (id) => {
      const file = fileFor(id);
      return (file && headFor(file.path)?.cwd) || managed.cwdOf?.(id) || null;
    },
    resolveTranscriptPath: (id) => fileFor(id)?.path ?? null,
    overlaySessions: (sessions) => {
      const relay = deps.relay?.read() ?? null;
      return relay
        ? sessions.map((s) =>
            s.agent === "pi" ? { ...s, relayUsage: relay } : s,
          )
        : sessions;
    },
  };
}
