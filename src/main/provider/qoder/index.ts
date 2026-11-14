import { closeSync, openSync, readFileSync, readSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import type {
  ModelUsage,
  PersistedSession,
  Session,
  SessionCandidate,
} from "@shared/types";
import { normalizeModelId } from "@shared/models";
import { toTranscriptWire } from "@shared/transcript";
import type { Provider } from "../types";
import type { RemoteClaudeReads } from "../claude";
import { indexTranscripts, readRoot } from "../claude/discover";
import { createClaudeReader } from "../claude/reader";
import { deriveSessionState } from "../claude/state";
import { subagentsDirFor, subagentsNewestMtime } from "../claude/subagents";
import { usageByModelFor } from "../claude/usage-by-model";
import { projectFromCwd } from "../../project-name";
import { MAX_TEXT_FILE_BYTES } from "../../util/file-size";
import {
  firstQoderCwd,
  formatQoderModelLabel,
  QODER_DEFAULT_CONTEXT_WINDOW,
  summarizeQoderTranscript,
  type QoderTranscriptSummary,
} from "./transcript";

/** Qoder CLI's home: `QODER_CONFIG_DIR`, else `~/.qoder`. */
export function resolveQoderDir(
  override?: string,
  env: NodeJS.ProcessEnv = process.env,
): string {
  return override || env.QODER_CONFIG_DIR?.trim() || join(homedir(), ".qoder");
}

/** A session file written to within this window counts as actively working when unmanaged. */
export const QODER_WORKING_WINDOW_MS = 10_000;
const DEFAULT_RECENT_WINDOW_MS = 30 * 24 * 60 * 60 * 1000;
const HEAD_SCAN_BYTES = 64 * 1024;

export interface ManagedQoderPty {
  id: string;
  cwd: string;
  spawnedAtMs: number;
}

export interface QoderProviderDeps {
  qoderDir?: string;
  now?: () => number;
  recentWindowMs?: number;
  managed?: {
    has(id: string): boolean;
    cwdOf?(id: string): string | undefined;
    qoderEntries?(): ManagedQoderPty[];
  };
  /** Optional off-thread reader backed by the parse worker (`createRemoteClaudeReads(worker, qoderDir)`). */
  remote?: Partial<RemoteClaudeReads>;
}

export interface QoderProvider extends Provider {
  overlaySessions(sessions: Session[]): Session[];
}

const emptyUsage = () => ({
  inputTokens: 0,
  outputTokens: 0,
  cacheReadTokens: 0,
  cacheCreationTokens: 0,
  cacheCreation5mTokens: 0,
  cacheCreation1hTokens: 0,
});

async function orLocal<T>(
  viaWorker: Promise<T> | undefined,
  local: () => T,
): Promise<T> {
  if (viaWorker) {
    try {
      return await viaWorker;
    } catch {
      // Fall back to the in-process reader on any worker fault.
    }
  }
  return local();
}

/** Read a bounded prefix of a Qoder JSONL file to extract its working directory without loading multi-MB transcripts. */
function readHeadCwd(path: string): string {
  let fd: number;
  try {
    fd = openSync(path, "r");
  } catch {
    return "";
  }
  try {
    const buf = Buffer.allocUnsafe(HEAD_SCAN_BYTES);
    let filled = 0;
    while (filled < buf.length) {
      const n = readSync(fd, buf, filled, buf.length - filled, filled);
      if (n === 0) break;
      filled += n;
    }
    return firstQoderCwd(buf.toString("utf8", 0, filled));
  } catch {
    return "";
  } finally {
    try {
      closeSync(fd);
    } catch {
      // ignore close failure on read-only descriptor
    }
  }
}

function findQoderTranscriptById(
  qoderDir: string,
  id: string,
): { path: string; mtimeMs: number } | null {
  const root = join(qoderDir, "projects");
  let best: { path: string; mtimeMs: number } | null = null;
  for (const proj of readRoot(root)) {
    const path = join(root, proj, `${id}.jsonl`);
    try {
      const st = statSync(path);
      if (st.isFile() && (!best || st.mtimeMs > best.mtimeMs)) {
        best = { path, mtimeMs: st.mtimeMs };
      }
    } catch {
      // not in this project subdir
    }
  }
  return best;
}

function readConfiguredContextWindow(qoderDir: string): number {
  try {
    const raw: unknown = JSON.parse(
      readFileSync(join(qoderDir, "settings.json"), "utf8"),
    );
    if (raw && typeof raw === "object" && !Array.isArray(raw)) {
      const root = raw as Record<string, unknown>;
      if (
        typeof root.contextWindow === "number" &&
        Number.isFinite(root.contextWindow) &&
        root.contextWindow > 0
      ) {
        return root.contextWindow;
      }
      const modelObj =
        root.model && typeof root.model === "object"
          ? (root.model as Record<string, unknown>)
          : undefined;
      const modelName =
        typeof modelObj?.name === "string" ? modelObj.name.trim() : "";
      const prefs =
        modelObj?.preferences && typeof modelObj.preferences === "object"
          ? (modelObj.preferences as Record<string, unknown>)
          : undefined;
      if (prefs && modelName) {
        const entry = prefs[`qoder/${modelName}`] ?? prefs[modelName];
        if (entry && typeof entry === "object") {
          const w = (entry as Record<string, unknown>).contextWindow;
          if (typeof w === "number" && Number.isFinite(w) && w > 0) return w;
        }
      }
    }
  } catch {
    // settings.json absent or unreadable — use Qoder's 1M default
  }
  return QODER_DEFAULT_CONTEXT_WINDOW;
}

/**
 * Qoder CLI read-side provider: discovers `<qoderDir>/projects/<slug>/<id>.jsonl` plus live managed
 * PTYs, summarizes Qoder metadata (`workspace-directories`, `runtime-config`, `ai-title`), and
 * reuses the Claude-compatible reader for transcripts, tool results, subagents, tasks, shells,
 * monitors, and git/PR metrics.
 */
export function createQoderProvider(
  deps: QoderProviderDeps = {},
): QoderProvider {
  const qoderDir = resolveQoderDir(deps.qoderDir);
  const now = deps.now ?? (() => Date.now());
  const recentWindowMs = deps.recentWindowMs ?? DEFAULT_RECENT_WINDOW_MS;
  const managed = deps.managed ?? { has: () => false };
  const remote = deps.remote ?? {};

  const reader = createClaudeReader({
    claudeDir: qoderDir,
    isPidAlive: () => false,
  });
  const defaultWindow = readConfiguredContextWindow(qoderDir);

  const headCwds = new Map<string, { mtimeMs: number; cwd: string }>();
  const headCwdFor = (path: string, mtimeMs: number): string => {
    const hit = headCwds.get(path);
    if (hit && hit.mtimeMs === mtimeMs && hit.cwd) return hit.cwd;
    const cwd = readHeadCwd(path);
    headCwds.set(path, { mtimeMs, cwd });
    return cwd;
  };

  interface CachedSummary {
    path: string;
    mtimeMs: number;
    summary: QoderTranscriptSummary;
    usageByModel: ModelUsage[];
  }
  const summariesById = new Map<string, CachedSummary>();

  const loadSummary = (
    id: string,
    path: string,
    mtimeMs: number,
    fallbackCwd: string,
  ): CachedSummary | null => {
    const hit = summariesById.get(id);
    if (hit && hit.path === path && hit.mtimeMs === mtimeMs) return hit;
    try {
      const st = statSync(path);
      if (st.size > MAX_TEXT_FILE_BYTES) return hit ?? null;
      const jsonl = readFileSync(path, "utf8");
      const summary = summarizeQoderTranscript(jsonl, fallbackCwd);
      const usageByModel = usageByModelFor(jsonl, path, id);
      const entry: CachedSummary = { path, mtimeMs, summary, usageByModel };
      summariesById.set(id, entry);
      return entry;
    } catch {
      return hit ?? null;
    }
  };

  const signals = (mtimeMs: number, id: string, awaitingUser = false) => {
    const fresh = mtimeMs > 0 && now() - mtimeMs < QODER_WORKING_WINDOW_MS;
    const alive = managed.has(id) || fresh;
    const waiting = alive && awaitingUser;
    return {
      alive,
      status: waiting ? "waiting" : fresh ? "busy" : undefined,
      awaitingUser: waiting,
    };
  };

  const summarize = (c: SessionCandidate): PersistedSession => {
    const fallbackCwd = c.cwd || managed.cwdOf?.(c.id) || "";
    const loaded = c.transcriptPath
      ? loadSummary(c.id, c.transcriptPath, c.transcriptMtimeMs, fallbackCwd)
      : null;
    const s = loaded?.summary ?? null;
    const cwd = s?.cwd || fallbackCwd;
    const originCwd = s?.originCwd || fallbackCwd || cwd;
    const project = s?.project || projectFromCwd(cwd);
    const sig = signals(c.transcriptMtimeMs, c.id, s?.awaitingUser === true);

    return {
      id: c.id,
      agent: "qoder",
      title: s?.title || project,
      project,
      cwd,
      originCwd,
      branch: s?.branch,
      state: deriveSessionState(sig),
      management: managed.has(c.id) ? "managed" : "observed",
      model: s?.model ?? normalizeModelId(undefined),
      modelRaw: s?.modelRaw,
      effortLevel: s?.effortLevel,
      compactionCount: s?.compactionCount,
      compactionTokensReclaimed: s?.compactionTokensReclaimed,
      lastActivityMs:
        s?.lastActivityMs || c.transcriptMtimeMs || c.updatedAt || 0,
      createdMs: s?.createdMs || c.updatedAt || c.transcriptMtimeMs || 0,
      awaitingUser: sig.awaitingUser,
      transcriptMtimeMs: c.transcriptMtimeMs,
      usage: s?.usage ?? emptyUsage(),
      usageByModel: loaded?.usageByModel ?? [],
      contextTokens: s?.contextTokens ?? 0,
    };
  };

  return {
    id: "qoder",
    listCandidates: () => {
      const tNow = now();
      const cutoff = tNow - recentWindowMs;
      const transcripts = indexTranscripts(qoderDir);
      const out: SessionCandidate[] = [];
      const seen = new Set<string>();

      for (const [id, t] of transcripts) {
        const isManaged = managed.has(id);
        const foldedMtime = Math.max(
          t.mtimeMs,
          subagentsNewestMtime(subagentsDirFor(t.path)),
        );
        if (foldedMtime < cutoff && !isManaged) continue;
        const cwd = managed.cwdOf?.(id) || headCwdFor(t.path, t.mtimeMs);
        seen.add(id);
        const sig = signals(foldedMtime, id);
        out.push({
          id,
          agent: "qoder",
          alive: sig.alive,
          status: sig.status,
          cwd,
          transcriptPath: t.path,
          transcriptMtimeMs: foldedMtime,
          updatedAt: foldedMtime,
        });
      }

      // Keep live Managed Qoder PTYs visible before `<id>.jsonl` is written on disk.
      for (const pty of managed.qoderEntries?.() ?? []) {
        if (seen.has(pty.id)) continue;
        out.push({
          id: pty.id,
          agent: "qoder",
          alive: true,
          status: undefined,
          cwd: pty.cwd,
          transcriptPath: undefined,
          transcriptMtimeMs: 0,
          updatedAt: pty.spawnedAtMs,
        });
      }

      return out;
    },
    summarize: (c) => Promise.resolve(summarize(c)),
    restate: (c, prev) => {
      const sig = signals(c.transcriptMtimeMs, c.id, prev.awaitingUser);
      return {
        ...prev,
        management: managed.has(c.id) ? "managed" : "observed",
        state: deriveSessionState(sig),
        awaitingUser: sig.awaitingUser,
      };
    },
    resolveResumeTarget: (id) => {
      const file = findQoderTranscriptById(qoderDir, id);
      if (file) {
        const foldedMtime = Math.max(
          file.mtimeMs,
          subagentsNewestMtime(subagentsDirFor(file.path)),
        );
        const loaded = loadSummary(
          id,
          file.path,
          foldedMtime,
          managed.cwdOf?.(id) ?? "",
        );
        const cwd =
          loaded?.summary.cwd ||
          headCwdFor(file.path, file.mtimeMs) ||
          managed.cwdOf?.(id) ||
          "";
        if (!cwd) return null;
        return {
          alive: signals(foldedMtime, id, loaded?.summary.awaitingUser === true)
            .alive,
          cwd,
          transcript: loaded?.summary.hasTurns ?? false,
        };
      }
      const managedCwd = managed.cwdOf?.(id);
      if (managedCwd && managed.has(id)) {
        return { alive: true, cwd: managedCwd, transcript: false };
      }
      return null;
    },
    resolveSessionCwd: (id) => {
      const managedCwd = managed.cwdOf?.(id);
      if (managedCwd) return managedCwd;
      const file = findQoderTranscriptById(qoderDir, id);
      if (!file) return null;
      return headCwdFor(file.path, file.mtimeMs) || null;
    },
    resolveTranscriptPath: (id) => reader.resolveTranscriptPath(id),
    readTranscript: (id, since) =>
      orLocal(remote.readTranscript?.(id, since), () =>
        toTranscriptWire(reader.readTranscript(id, since)),
      ),
    getToolResult: (id, toolUseId, agentId) =>
      orLocal(remote.getToolResult?.(id, toolUseId, agentId), () =>
        reader.getToolResult(id, toolUseId, agentId),
      ),
    readSubagentTranscript: (id, agentId, since) =>
      orLocal(remote.readSubagentTranscript?.(id, agentId, since), () =>
        toTranscriptWire(reader.readSubagentTranscript(id, agentId, since)),
      ),
    readTasks: (id, since) =>
      orLocal(remote.readTasks?.(id, since), () => reader.readTasks(id, since)),
    readShells: (id, since) =>
      orLocal(remote.readShells?.(id, since), () =>
        reader.readShells(id, since),
      ),
    readShellOutput: (id, shellId, since) =>
      orLocal(remote.readShellOutput?.(id, shellId, since), () =>
        reader.readShellOutput(id, shellId, since),
      ),
    readMonitors: (id, since) =>
      orLocal(remote.readMonitors?.(id, since), () =>
        reader.readMonitors(id, since),
      ),
    readMonitorOutput: (id, monitorId, since) =>
      orLocal(remote.readMonitorOutput?.(id, monitorId, since), () =>
        reader.readMonitorOutput(id, monitorId, since),
      ),
    readMetrics: (id, since) =>
      orLocal(remote.readMetrics?.(id, since), () =>
        reader.readMetrics(id, since),
      ),
    overlaySessions: (sessions) => {
      if (!sessions.some((s) => s.agent === "qoder")) return sessions;
      return sessions.map((s) => {
        if (s.agent !== "qoder") return s;
        let cached = summariesById.get(s.id);
        if (!cached) {
          const file = findQoderTranscriptById(qoderDir, s.id);
          if (file) {
            cached =
              loadSummary(s.id, file.path, file.mtimeMs, s.cwd ?? "") ??
              undefined;
          }
        }
        const window = cached?.summary.contextWindow ?? defaultWindow;
        const displayName =
          cached?.summary.modelDisplayName ??
          formatQoderModelLabel(s.modelRaw) ??
          s.modelDisplayName;
        const tokens = cached?.summary.contextTokens ?? 0;
        return {
          ...s,
          modelDisplayName: displayName,
          contextWindow: window,
          contextPct:
            tokens > 0
              ? Math.min(100, Math.round((tokens / window) * 100))
              : s.contextPct,
        };
      });
    },
  };
}
