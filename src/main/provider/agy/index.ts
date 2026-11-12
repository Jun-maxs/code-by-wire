import { realpathSync } from "node:fs";
import type {
  PersistedSession,
  Session,
  SessionCandidate,
} from "@shared/types";
import { normalizeModelId } from "@shared/models";
import { toTranscriptWire } from "@shared/transcript";
import type { Provider } from "../types";
import type { ClaimableRollout } from "../codex/claim";
import { deriveSessionState } from "../claude/state";
import { projectFromCwd } from "../../project-name";
import {
  extractAgyToolResult,
  parseAgyEvents,
  summarizeAgySteps,
  type AgySummary,
} from "./conversation";
import { agyContextWindow, agyPoolKind, type AgyQuotaReader } from "./quota";
import {
  listAgyConversations,
  readAgyConversationHead,
  readAgyConversationStats,
  readAgySteps,
  resolveAgyDir,
  type AgyConversationHead,
  type AgyFile,
} from "./store";

/** A conversation written to within this long counts as a session at work. */
export const AGY_WORKING_WINDOW_MS = 10_000;
const DEFAULT_RECENT_WINDOW_MS = 30 * 24 * 60 * 60 * 1000;

/** A live agy pty this app spawned, with its claim state (see claim pass in main/index.ts). */
interface ManagedAgyPty {
  id: string;
  cwd: string;
  spawnedAtMs: number;
  claimedRollout?: string;
}

export interface AgyProviderDeps {
  agyDir?: string;
  now?: () => number;
  recentWindowMs?: number;
  managed?: {
    has(id: string): boolean;
    cwdOf?(id: string): string | undefined;
    agyEntries?(): ManagedAgyPty[];
  };
  quota?: AgyQuotaReader;
}

export interface AgyProvider extends Provider {
  overlaySessions(sessions: Session[]): Session[];
}

/** realpath for comparing with a managed pty's (realpath'd) spawn cwd; the path itself on failure. */
export function canonicalCwd(cwd: string): string {
  try {
    return realpathSync(cwd);
  } catch {
    return cwd;
  }
}

/**
 * Conversations a pending agy pty could claim: created at/after `earliestMs`, not already bound.
 * agy takes no id up front, so a spawn is matched to the conversation that appears in its folder
 * after it starts — the same claim the codex rollouts go through (detectClaims).
 */
export function scanClaimableAgy(
  agyDir: string,
  earliestMs: number,
  claimed: ReadonlySet<string>,
): ClaimableRollout[] {
  const out: ClaimableRollout[] = [];
  for (const f of listAgyConversations(agyDir)) {
    if (f.mtimeMs < earliestMs || claimed.has(f.path)) continue;
    const head = readAgyConversationHead(f.path);
    if (!head || head.createdMs < earliestMs) continue;
    out.push({
      path: f.path,
      id: f.id,
      timestampMs: head.createdMs,
      cwd: canonicalCwd(head.cwd),
    });
  }
  return out;
}

const emptyUsage = () => ({
  inputTokens: 0,
  outputTokens: 0,
  cacheReadTokens: 0,
  cacheCreationTokens: 0,
  cacheCreation5mTokens: 0,
  cacheCreation1hTokens: 0,
});

/**
 * The Antigravity CLI read-side provider: sidebar rows from each conversation db's head, the
 * transcript pane from its steps, and — at overview time — the plan's limits and the model's
 * official context window (quota.ts). Liveness is the db's freshness plus this app's own ptys
 * (agy keeps no readable process registry), the same accepted gap as codex and Pi.
 */
export function createAgyProvider(deps: AgyProviderDeps = {}): AgyProvider {
  const agyDir = deps.agyDir ?? resolveAgyDir();
  const now = deps.now ?? (() => Date.now());
  const recentWindowMs = deps.recentWindowMs ?? DEFAULT_RECENT_WINDOW_MS;
  const managed = deps.managed ?? { has: () => false };

  // Heads never change once written, but `hasSteps` does — keyed by path + mtime.
  const heads = new Map<
    string,
    { mtimeMs: number; head: AgyConversationHead | null }
  >();
  const headFor = (f: AgyFile): AgyConversationHead | null => {
    const hit = heads.get(f.path);
    if (hit && hit.mtimeMs === f.mtimeMs) return hit.head;
    const head = readAgyConversationHead(f.path);
    // A locked db reads null for a pass; keep the last good head rather than dropping the row.
    if (head || !hit) heads.set(f.path, { mtimeMs: f.mtimeMs, head });
    return head ?? hit?.head ?? null;
  };
  interface Stats extends AgySummary {
    model: { id: string; label: string } | null;
  }
  const stats = new Map<string, { mtimeMs: number; stats: Stats }>();
  const statsFor = (f: AgyFile): Stats | null => {
    const hit = stats.get(f.path);
    if (hit && hit.mtimeMs === f.mtimeMs) return hit.stats;
    const read = readAgyConversationStats(f.path);
    if (!read) return hit?.stats ?? null;
    const s = { ...summarizeAgySteps(read.steps), model: read.model };
    stats.set(f.path, { mtimeMs: f.mtimeMs, stats: s });
    return s;
  };
  const fileFor = (id: string): AgyFile | null =>
    listAgyConversations(agyDir).find((f) => f.id === id) ?? null;
  const signals = (mtimeMs: number, id: string) => {
    const fresh = now() - mtimeMs < AGY_WORKING_WINDOW_MS;
    return {
      alive: managed.has(id) || fresh,
      status: fresh ? "busy" : undefined,
      awaitingUser: false,
    };
  };

  const summarize = (c: SessionCandidate): PersistedSession => {
    const file = c.transcriptPath ? fileFor(c.id) : null;
    const s = file ? statsFor(file) : null;
    const project = projectFromCwd(c.cwd);
    const label = s?.model?.label;
    return {
      id: c.id,
      agent: "agy",
      title: s?.title ?? project,
      project,
      cwd: c.cwd,
      originCwd: c.cwd,
      branch: undefined,
      state: deriveSessionState(signals(c.transcriptMtimeMs, c.id)),
      management: managed.has(c.id) ? "managed" : "observed",
      model: normalizeModelId(label),
      modelRaw: label,
      lastActivityMs: c.transcriptMtimeMs || c.updatedAt || 0,
      createdMs: c.updatedAt || 0,
      awaitingUser: false,
      transcriptMtimeMs: c.transcriptMtimeMs,
      usage: s?.usage ?? emptyUsage(),
      usageByModel: [],
      contextTokens: s?.contextTokens ?? 0,
    };
  };

  return {
    id: "agy",
    listCandidates: () => {
      const cutoff = now() - recentWindowMs;
      const out: SessionCandidate[] = [];
      const seen = new Set<string>();
      for (const f of listAgyConversations(agyDir)) {
        const isManaged = managed.has(f.id);
        if (f.mtimeMs < cutoff && !isManaged) continue;
        const head = headFor(f);
        // A launch that never took a message leaves an empty conversation; only ours are kept.
        if (!head || (!head.hasSteps && !isManaged)) continue;
        seen.add(f.id);
        const sig = signals(f.mtimeMs, f.id);
        out.push({
          id: f.id,
          agent: "agy",
          alive: sig.alive,
          status: sig.status,
          cwd: head.cwd,
          transcriptPath: f.path,
          transcriptMtimeMs: f.mtimeMs,
          updatedAt: head.createdMs,
        });
      }
      // A live pty of ours whose conversation hasn't been claimed yet (agy may write it only once
      // it starts) — without this the optimistic draft would never be superseded.
      for (const pty of managed.agyEntries?.() ?? []) {
        if (seen.has(pty.id) || pty.claimedRollout !== undefined) continue;
        out.push({
          id: pty.id,
          agent: "agy",
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
      const steps = readAgySteps(file.path);
      if (steps === null) return { status: "error" };
      return toTranscriptWire({
        status: "changed",
        mtimeMs: file.mtimeMs,
        doc: { ...parseAgyEvents(steps), subagents: [] },
      });
    },
    getToolResult: (id, toolUseId) => {
      const file = fileFor(id);
      const steps = file ? readAgySteps(file.path) : null;
      return steps === null
        ? { found: false }
        : extractAgyToolResult(steps, toolUseId);
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
      const cwd = file ? headFor(file)?.cwd : undefined;
      return file && cwd
        ? {
            alive: signals(file.mtimeMs, id).alive,
            cwd,
            rolloutPath: file.path,
          }
        : null;
    },
    resolveSessionCwd: (id) => {
      const file = fileFor(id);
      return (file && headFor(file)?.cwd) || managed.cwdOf?.(id) || null;
    },
    // A SQLite file, not a JSONL transcript: nothing for the line-scanning diagnostics to read.
    resolveTranscriptPath: () => null,
    overlaySessions: (sessions) => {
      if (!sessions.some((s) => s.agent === "agy")) return sessions;
      const quota = deps.quota?.read() ?? null;
      const files = new Map(listAgyConversations(agyDir).map((f) => [f.id, f]));
      return sessions.map((s) => {
        if (s.agent !== "agy") return s;
        const file = files.get(s.id);
        const st = file ? statsFor(file) : null;
        const label = st?.model?.label ?? s.modelRaw;
        const window = agyContextWindow(
          { id: st?.model?.id, label },
          quota?.models,
        );
        const pool = quota?.pools.find(
          (p) =>
            p.kind === agyPoolKind(`${label ?? ""} ${st?.model?.id ?? ""}`),
        );
        const tokens = st?.contextTokens ?? 0;
        return {
          ...s,
          modelDisplayName: label ?? s.modelDisplayName,
          contextWindow: window,
          contextPct:
            tokens > 0
              ? Math.min(100, Math.round((tokens / window) * 100))
              : s.contextPct,
          liveContext: st?.context ?? s.liveContext,
          rateLimits: pool?.windows ?? s.rateLimits,
        };
      });
    },
  };
}
