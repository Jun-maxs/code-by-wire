import { realpathSync } from "node:fs";
import { parseAgyModelDisplay } from "@shared/agy-quota";
import { normalizeModelId } from "@shared/models";
import { toTranscriptWire, type TranscriptReadWire } from "@shared/transcript";
import type {
  PersistedSession,
  Session,
  SessionCandidate,
} from "@shared/types";
import { readGit } from "../../git/read-git";
import { readPr } from "../../git/read-pr";
import { projectFromCwd } from "../../project-name";
import { deriveSessionState } from "../claude/state";
import { SPEED_WINDOW_MS } from "../claude/transcript-speed";
import type { ClaimableRollout } from "../codex/claim";
import { metricsToken } from "../metrics-token";
import type { Provider } from "../types";
import {
  computeAgyTokenSpeed,
  extractAgyToolResult,
  extractAgyTurnActivity,
  parseAgyEvents,
  summarizeAgySteps,
  type AgyStepRow,
  type AgySummary,
} from "./conversation";
import {
  agyContextWindow,
  agyPoolKind,
  readAgySettingsModel,
  type AgyModelInfo,
  type AgyQuotaReader,
} from "./quota";
import {
  listAgyConversations,
  readAgyConversationHead,
  readAgyConversationStats,
  readAgyPresence,
  readAgySteps,
  readAgySummaries,
  resolveAgyDir,
  type AgyConversationHead,
  type AgyFile,
  type AgyPresenceState,
  type AgySummaryRow,
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
  /** Override presence lock probe in tests. */
  readPresence?: (agyDir: string, id: string) => AgyPresenceState;
  /** Off-thread step protobuf parsing + WorkTurn projection via parse-worker, with in-process fallback. */
  remote?: {
    parseTranscript?: (
      mtimeMs: number,
      steps: AgyStepRow[],
    ) => Promise<TranscriptReadWire>;
  };
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
  const probePresence = deps.readPresence ?? readAgyPresence;

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
    const s = {
      ...summarizeAgySteps(read.steps, read.genMeta),
      model: read.model,
    };
    stats.set(f.path, { mtimeMs: f.mtimeMs, stats: s });
    return s;
  };
  const fileFor = (id: string): AgyFile | null =>
    listAgyConversations(agyDir).find((f) => f.id === id) ?? null;

  const settingsModel = (models: AgyModelInfo[] = []) =>
    readAgySettingsModel(agyDir, models);

  const signals = (
    mtimeMs: number,
    id: string,
    st: Stats | null,
    summaryRow: AgySummaryRow | undefined,
    childWorking: boolean,
  ) => {
    const presence = probePresence(agyDir, id);
    const fresh = mtimeMs > 0 && now() - mtimeMs < AGY_WORKING_WINDOW_MS;
    const isManaged = managed.has(id);
    const awaitingUser = Boolean(st?.awaitingPermission || st?.awaitingUser);

    let alive: boolean;
    if (isManaged || presence === "locked") {
      alive = true;
    } else if (presence === "unlocked") {
      alive = false;
    } else if (summaryRow) {
      if (summaryRow.killed) alive = false;
      else if (
        summaryRow.status === "CASCADE_RUN_STATUS_IDLE" &&
        !summaryRow.notFullyIdle
      )
        alive = false;
      else if (
        summaryRow.status === "CASCADE_RUN_STATUS_RUNNING" ||
        summaryRow.notFullyIdle
      )
        alive = fresh || Boolean(st?.hasInFlightStep);
      else alive = fresh;
    } else {
      alive = fresh || Boolean(st?.hasInFlightStep);
    }

    let status: string | undefined;
    if (alive) {
      if (awaitingUser) {
        status = "waiting";
      } else if (childWorking || st?.hasInFlightStep) {
        status = "busy";
      } else if (summaryRow) {
        if (
          summaryRow.status === "CASCADE_RUN_STATUS_RUNNING" ||
          summaryRow.notFullyIdle
        ) {
          status = "busy";
        } else if (
          summaryRow.status === "CASCADE_RUN_STATUS_IDLE" &&
          !summaryRow.notFullyIdle
        ) {
          status = undefined;
        } else if (fresh || st?.hasUnansweredWork) {
          status = "busy";
        }
      } else if (fresh || st?.hasUnansweredWork) {
        status = "busy";
      }
    }

    return { alive, status, awaitingUser };
  };

  /** Determine which parents have an actively executing child subagent this pass. */
  const collectWorkingParents = (
    files: AgyFile[],
    summaries: Map<string, AgySummaryRow>,
  ): Set<string> => {
    const out = new Set<string>();
    for (const f of files) {
      const sum = summaries.get(f.id);
      const parentId =
        sum?.parentConversationId || statsFor(f)?.parentSessionId;
      if (!parentId) continue;
      const sig = signals(f.mtimeMs, f.id, statsFor(f), sum, false);
      if (deriveSessionState(sig) === "working") out.add(parentId);
    }
    return out;
  };

  const resolveModelInfo = (st: Stats | null, models: AgyModelInfo[] = []) => {
    if (st?.model) {
      const parsed = parseAgyModelDisplay(st.model.label);
      return {
        modelRaw: st.model.id || st.model.label,
        modelDisplayName: parsed.displayName,
        effortLevel: parsed.effortLevel,
      };
    }
    const cfg = settingsModel(models);
    if (cfg) {
      return {
        modelRaw: cfg.id || cfg.label,
        modelDisplayName: cfg.displayName,
        effortLevel: cfg.effortLevel,
      };
    }
    return {
      modelRaw: undefined,
      modelDisplayName: undefined,
      effortLevel: undefined,
    };
  };

  const summarize = (
    c: SessionCandidate,
    summaries: Map<string, AgySummaryRow> = readAgySummaries(agyDir),
    workingParents: ReadonlySet<string> = new Set(),
  ): PersistedSession => {
    const file = c.transcriptPath ? fileFor(c.id) : null;
    const st = file ? statsFor(file) : null;
    const sum = summaries.get(c.id);
    const project = projectFromCwd(c.cwd);
    const tNow = now();
    const mInfo = resolveModelInfo(st);
    const sig = signals(
      c.transcriptMtimeMs,
      c.id,
      st,
      sum,
      workingParents.has(c.id),
    );
    const state = deriveSessionState(sig);
    const parentSessionId =
      c.parentSessionId || sum?.parentConversationId || st?.parentSessionId;
    const lastActivityMs = Math.max(
      c.transcriptMtimeMs,
      st?.lastStepMs ?? 0,
      sum?.lastModifiedMs ?? 0,
      c.updatedAt || 0,
    );
    const createdMs =
      c.updatedAt || st?.firstStepMs || c.transcriptMtimeMs || 0;
    const liveFlightMs =
      state === "working" && st?.inFlightStartMs
        ? Math.max(0, tNow - st.inFlightStartMs)
        : 0;
    const apiDurationMs =
      (st?.apiDurationMs ?? 0) + liveFlightMs > 0
        ? (st?.apiDurationMs ?? 0) + liveFlightMs
        : undefined;

    return {
      id: c.id,
      agent: "agy",
      title: st?.title || sum?.title || project,
      project,
      cwd: c.cwd,
      originCwd: c.cwd,
      branch: undefined,
      state,
      management: managed.has(c.id) ? "managed" : "observed",
      ...(parentSessionId
        ? { parentSessionId, threadKind: "subagent" as const }
        : {}),
      model: normalizeModelId(mInfo.modelRaw),
      modelRaw: mInfo.modelRaw,
      ...(mInfo.effortLevel ? { effortLevel: mInfo.effortLevel } : {}),
      lastActivityMs,
      createdMs,
      awaitingUser: sig.awaitingUser,
      transcriptMtimeMs: c.transcriptMtimeMs,
      usage: st?.usage ?? emptyUsage(),
      usageByModel: st?.usageByModel ?? [],
      contextTokens: st?.contextTokens ?? 0,
      ...(apiDurationMs !== undefined ? { apiDurationMs } : {}),
      ...(st && st.compactionCount > 0
        ? { compactionCount: st.compactionCount }
        : {}),
    };
  };

  return {
    id: "agy",
    listCandidates: () => {
      const cutoff = now() - recentWindowMs;
      const files = listAgyConversations(agyDir);
      const summaries = readAgySummaries(agyDir);
      const workingParents = collectWorkingParents(files, summaries);
      const out: SessionCandidate[] = [];
      const seen = new Set<string>();
      for (const f of files) {
        const isManaged = managed.has(f.id);
        if (f.mtimeMs < cutoff && !isManaged) continue;
        const head = headFor(f);
        // A launch that never took a message leaves an empty conversation; only ours are kept.
        if (!head || (!head.hasSteps && !isManaged)) continue;
        seen.add(f.id);
        const st = statsFor(f);
        const sum = summaries.get(f.id);
        const sig = signals(f.mtimeMs, f.id, st, sum, workingParents.has(f.id));
        const parentSessionId =
          sum?.parentConversationId || st?.parentSessionId || undefined;
        out.push({
          id: f.id,
          agent: "agy",
          alive: sig.alive,
          status: sig.status,
          cwd: head.cwd,
          ...(parentSessionId
            ? { parentSessionId, threadKind: "subagent" as const }
            : {}),
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
    summarize: (c) => {
      const files = listAgyConversations(agyDir);
      const summaries = readAgySummaries(agyDir);
      const workingParents = collectWorkingParents(files, summaries);
      return Promise.resolve(summarize(c, summaries, workingParents));
    },
    restate: (c, prev) => {
      const files = listAgyConversations(agyDir);
      const summaries = readAgySummaries(agyDir);
      const workingParents = collectWorkingParents(files, summaries);
      const file = c.transcriptPath ? files.find((f) => f.id === c.id) : null;
      const st = file ? statsFor(file) : null;
      const sum = summaries.get(c.id);
      const sig = signals(
        c.transcriptMtimeMs,
        c.id,
        st,
        sum,
        workingParents.has(c.id),
      );
      const parentSessionId =
        c.parentSessionId || sum?.parentConversationId || prev.parentSessionId;
      return {
        ...prev,
        title: st?.title || sum?.title || prev.title,
        management: managed.has(c.id) ? "managed" : "observed",
        ...(parentSessionId
          ? { parentSessionId, threadKind: "subagent" as const }
          : {}),
        state: deriveSessionState(sig),
        awaitingUser: sig.awaitingUser,
        lastActivityMs: Math.max(
          prev.lastActivityMs,
          c.transcriptMtimeMs,
          sum?.lastModifiedMs ?? 0,
        ),
      };
    },
    readTranscript: (id, sinceMtimeMs) => {
      const file = fileFor(id);
      if (!file) return { status: "absent" };
      if (sinceMtimeMs !== undefined && file.mtimeMs === sinceMtimeMs)
        return { status: "unchanged", mtimeMs: file.mtimeMs };
      const steps = readAgySteps(file.path);
      if (steps === null) return { status: "error" };
      const localParse = (): TranscriptReadWire =>
        toTranscriptWire({
          status: "changed",
          mtimeMs: file.mtimeMs,
          doc: { ...parseAgyEvents(steps), subagents: [] },
        });
      if (deps.remote?.parseTranscript) {
        return deps.remote
          .parseTranscript(file.mtimeMs, steps)
          .catch(() => localParse());
      }
      return localParse();
    },
    getToolResult: (id, toolUseId) => {
      const file = fileFor(id);
      const steps = file ? readAgySteps(file.path) : null;
      return steps === null
        ? { found: false }
        : extractAgyToolResult(steps, toolUseId);
    },
    readSubagentTranscript: (_id, agentId, sinceMtimeMs) => {
      const childFile = fileFor(agentId);
      if (!childFile) return { status: "absent" };
      if (sinceMtimeMs !== undefined && childFile.mtimeMs === sinceMtimeMs)
        return { status: "unchanged", mtimeMs: childFile.mtimeMs };
      const steps = readAgySteps(childFile.path);
      if (steps === null) return { status: "error" };
      return toTranscriptWire({
        status: "changed",
        mtimeMs: childFile.mtimeMs,
        doc: { ...parseAgyEvents(steps), subagents: [] },
      });
    },
    readTurnActivity: (id, sinceMtimeMs) => {
      const file = fileFor(id);
      if (!file) return { status: "absent" };
      if (sinceMtimeMs !== undefined && file.mtimeMs === sinceMtimeMs)
        return { status: "unchanged", mtimeMs: file.mtimeMs };
      const steps = readAgySteps(file.path);
      if (steps === null) return { status: "error" };
      return {
        status: "changed",
        mtimeMs: file.mtimeMs,
        activity: extractAgyTurnActivity(steps),
      };
    },
    readTasks: () => ({ status: "absent" }),
    readShells: () => ({ status: "absent" }),
    readShellOutput: () => ({ status: "absent" }),
    readMonitors: () => ({ status: "absent" }),
    readMonitorOutput: () => ({ status: "absent" }),
    readMetrics: (id, sinceMtimeMs) => {
      try {
        const file = fileFor(id);
        const cwd =
          (file ? headFor(file)?.cwd : undefined) || managed.cwdOf?.(id) || "";
        if (!file && !cwd) return { status: "absent" };
        const mtimeMs = file?.mtimeMs ?? 0;
        const git = cwd ? readGit(cwd) : null;
        const pr = cwd && git && git.remoteUrl ? readPr(cwd, git.branch) : null;
        const token = metricsToken(mtimeMs, {
          git,
          pr,
          voice: null,
          remote: null,
        });
        if (token === sinceMtimeMs)
          return { status: "unchanged", mtimeMs: token };
        const read = file ? readAgyConversationStats(file.path) : null;
        return {
          status: "changed",
          mtimeMs: token,
          metrics: {
            tokenSpeed: read
              ? computeAgyTokenSpeed(read.steps, read.genMeta, SPEED_WINDOW_MS)
              : null,
            git,
            pr,
            voiceEnabled: null,
            remoteControl: null,
          },
        };
      } catch {
        return { status: "error" };
      }
    },
    resolveResumeTarget: (id) => {
      const file = fileFor(id);
      const cwd = file ? headFor(file)?.cwd : undefined;
      if (!file || !cwd) return null;
      const summaries = readAgySummaries(agyDir);
      const st = statsFor(file);
      const sig = signals(file.mtimeMs, id, st, summaries.get(id), false);
      return {
        alive: sig.alive,
        cwd,
        rolloutPath: file.path,
      };
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
      const summaries = readAgySummaries(agyDir);
      const tNow = now();
      return sessions.map((s) => {
        if (s.agent !== "agy") return s;
        const file = files.get(s.id);
        const st = file ? statsFor(file) : null;
        const sum = summaries.get(s.id);
        const mInfo = resolveModelInfo(st, quota?.models);
        const label = st?.model?.label ?? mInfo.modelRaw ?? s.modelRaw;
        const window = agyContextWindow(
          { id: st?.model?.id, label },
          quota?.models,
        );
        const pool = quota?.pools.find(
          (p) =>
            p.kind === agyPoolKind(`${label ?? ""} ${st?.model?.id ?? ""}`),
        );
        const tokens = st?.contextTokens ?? 0;
        const liveFlightMs =
          s.state === "working" && st?.inFlightStartMs
            ? Math.max(0, tNow - st.inFlightStartMs)
            : 0;
        const rawApiMs =
          (st?.apiDurationMs ?? s.apiDurationMs ?? 0) + liveFlightMs;
        const clockEnd =
          s.state === "ended"
            ? s.lastActivityMs
            : Math.max(s.lastActivityMs, tNow);
        const sessionClockMs =
          s.createdMs > 0 ? Math.max(0, clockEnd - s.createdMs) : undefined;
        const apiDurationMs =
          rawApiMs > 0 || (st && st.usageByModel.length > 0)
            ? sessionClockMs !== undefined && sessionClockMs > 0
              ? Math.min(rawApiMs, sessionClockMs)
              : rawApiMs
            : s.apiDurationMs;

        const parentId =
          s.parentSessionId || sum?.parentConversationId || st?.parentSessionId;
        return {
          ...s,
          ...(mInfo.modelRaw ? { modelRaw: mInfo.modelRaw } : {}),
          modelDisplayName: mInfo.modelDisplayName ?? s.modelDisplayName,
          effortLevel: mInfo.effortLevel ?? s.effortLevel,
          ...(st && st.usageByModel.length > 0
            ? { usage: st.usage, usageByModel: st.usageByModel }
            : {}),
          ...(st && st.compactionCount > 0
            ? { compactionCount: st.compactionCount }
            : {}),
          ...(parentId && !s.parentSessionId
            ? {
                parentSessionId: parentId,
                threadKind: "subagent" as const,
              }
            : {}),
          contextWindow: window,
          contextPct:
            tokens > 0
              ? Math.min(100, Math.round((tokens / window) * 100))
              : s.contextPct,
          liveContext: st?.context ?? s.liveContext,
          rateLimits: pool?.windows ?? s.rateLimits,
          ...(apiDurationMs !== undefined ? { apiDurationMs } : {}),
          ...(sessionClockMs !== undefined ? { sessionClockMs } : {}),
        };
      });
    },
  };
}
