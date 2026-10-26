import { AGENT_IDS, AGENTS, type AgentId } from "@shared/agents";
import type {
  Account,
  RateLimit,
  RateLimitWindows,
  Session,
} from "@shared/types";
import type * as Hud from "@shared/hud-protocol";

/**
 * The HUD overlay's data, in the shape Agent HUD's panel (vendored under renderer/hud) reads: this
 * app's own sessions, account windows and relay usage, re-expressed as Agent HUD's Snapshot. Pure —
 * every input is passed in — so the overlay shows exactly what the main window knows.
 */
export interface HudSnapshotInput {
  sessions: Session[];
  /** Claude's account windows (the statusLine / usage API Account the main window shows). */
  account: Account | null;
  /** Hourly token totals, oldest first, for the panel's 24-hour chart. */
  timeline: Hud.TimelinePoint[];
  now: number;
  language: "zh" | "en";
  appearance: "dark" | "light" | "system";
}

const iso = (ms: number): string => new Date(ms).toISOString();

/** Agent HUD's quota level: warning from 70% used, critical from 90%. */
function level(pct: number): Hud.Quota["status"] {
  return pct >= 90 ? "critical" : pct >= 70 ? "warning" : "normal";
}

/** A session's state in Agent HUD's vocabulary. An ended session still lists, as idle: the panel
 *  shows recent sessions, and only counts the running ones as live. */
function hudState(state: Session["state"]): Hud.SessionState {
  return state === "working"
    ? "running"
    : state === "waiting"
      ? "waiting"
      : "idle";
}

interface WindowSpec {
  key: keyof RateLimitWindows;
  name: string;
  short: string;
  seconds: number | null;
  allModels: boolean;
}

const WINDOWS: WindowSpec[] = [
  {
    key: "fiveHour",
    name: "Current session",
    short: "5h",
    seconds: 5 * 3600,
    allModels: true,
  },
  {
    key: "sevenDay",
    name: "Weekly limit · All models",
    short: "Weekly",
    seconds: 7 * 86400,
    allModels: true,
  },
  {
    key: "sevenDaySonnet",
    name: "Weekly limit · Sonnet",
    short: "Sonnet",
    seconds: 7 * 86400,
    allModels: false,
  },
  {
    key: "sevenDayOpus",
    name: "Weekly limit · Opus",
    short: "Opus",
    seconds: 7 * 86400,
    allModels: false,
  },
];

function quotasFor(
  vendor: string,
  windows: RateLimitWindows,
  account: string | null,
  now: number,
): Hud.Quota[] {
  const out: Hud.Quota[] = [];
  for (const spec of WINDOWS) {
    const w: RateLimit | undefined = windows[spec.key];
    if (!w) continue;
    const seconds =
      w.windowMinutes != null ? w.windowMinutes * 60 : spec.seconds;
    out.push({
      id: `${vendor}:${spec.key}`,
      accountId: `${vendor}:account`,
      vendor,
      name: spec.name,
      shortLabel: spec.short,
      allModels: spec.allModels,
      windowDurationSeconds: seconds,
      usedPercent: w.usedPct,
      resetAt: iso(w.resetsAt),
      // A window whose reset has passed holds a stale reading until the next one lands.
      status: w.resetsAt <= now ? "stale" : level(w.usedPct),
      account,
      observedAt: iso(now),
    });
  }
  return out;
}

const tokensOf = (s: Session): number =>
  s.usage.inputTokens +
  s.usage.outputTokens +
  s.usage.cacheReadTokens +
  s.usage.cacheCreationTokens;

function hudSession(s: Session): Hud.Session {
  return {
    id: s.id,
    title: s.title,
    source: s.agent,
    model: s.modelRaw ?? s.model,
    modelName: s.modelDisplayName ?? null,
    vendorName: AGENTS[s.agent].label,
    cwd: s.cwd ?? null,
    project: s.project,
    startedAt: s.createdMs ? iso(s.createdMs) : null,
    updatedAt: iso(s.lastActivityMs),
    state: hudState(s.state),
    tokens: tokensOf(s),
    contextPercent: Number.isFinite(s.contextPct) ? s.contextPct : null,
    cost: s.costUsd ?? null,
    logPath: null,
    parentId: s.parentSessionId ?? null,
  };
}

export function buildHudSnapshot(input: HudSnapshotInput): Hud.Snapshot {
  const { sessions, account, now } = input;
  const byAgent = (agent: AgentId) => sessions.filter((s) => s.agent === agent);

  const quotas: Hud.Quota[] = [];
  if (account)
    quotas.push(...quotasFor("claude", account, account.email ?? null, now));
  // Codex windows are account-wide; every codex row carries the same reading.
  const codexWindows = byAgent("codex").find((s) => s.rateLimits)?.rateLimits;
  if (codexWindows) quotas.push(...quotasFor("codex", codexWindows, null, now));

  // A relay's usage is the key's, shared by every session of that agent.
  const billing: Hud.BillingAccount[] = [];
  for (const agent of AGENT_IDS) {
    const relay = byAgent(agent).find((s) => s.relayUsage)?.relayUsage;
    if (!relay) continue;
    const zh = input.language === "zh";
    billing.push({
      id: `${agent}:relay:spent`,
      accountId: `${agent}:relay`,
      vendor: agent,
      label: zh ? `${relay.host} 已用` : `Used on ${relay.host}`,
      amount: relay.spent,
      currency: relay.currency,
      notice: null,
      level: "normal",
    });
    if (relay.remaining != null)
      billing.push({
        id: `${agent}:relay:left`,
        accountId: `${agent}:relay`,
        vendor: agent,
        label: zh ? `${relay.host} 剩余` : `Left on ${relay.host}`,
        amount: relay.remaining,
        currency: relay.currency,
        notice: null,
        level:
          relay.usedPct != null
            ? level(relay.usedPct) === "normal"
              ? "normal"
              : "warning"
            : "normal",
      });
  }

  const providers: Hud.Provider[] = AGENT_IDS.map((agent) => {
    const rows = byAgent(agent);
    const ready =
      quotas.some((q) => q.vendor === agent) ||
      billing.some((b) => b.vendor === agent);
    return {
      id: agent,
      name: AGENTS[agent].label,
      detected: rows.length > 0 || ready,
      enabled: true,
      notice: null,
      sessions: rows.filter((s) => s.state !== "ended").length,
      accountStatus: {
        status: ready ? "ready" : "unavailable",
        checkedAt: iso(now),
        notice: null,
      },
      dataStatus: "supported",
    };
  });

  const accounts: Hud.Account[] = account?.email
    ? [
        {
          id: "claude:account",
          provider: "claude",
          label: account.email,
          plan: account.billingMode === "subscription" ? "subscription" : "api",
          checkedAt: iso(now),
          stale: false,
          current: true,
        },
      ]
    : [];

  const totals = input.timeline.reduce<Hud.TokenTotals>(
    (sum, p) => ({
      ...sum,
      input: sum.input + p.input,
      output: sum.output + p.output,
      cacheRead: sum.cacheRead + p.cache,
      total: sum.total + p.tokens,
    }),
    {
      input: 0,
      output: 0,
      cacheRead: 0,
      cacheWrite: 0,
      reasoning: 0,
      total: 0,
      usd: null,
      cny: null,
    },
  );

  return {
    language: input.language,
    schemaVersion: 1,
    generatedAt: iso(now),
    sessionScope: "recent",
    mode: "live",
    connection: {
      status: "connected",
      platform: process.platform,
      message: null,
    },
    totals,
    quotas,
    sessions: [...sessions]
      .sort((a, b) => b.lastActivityMs - a.lastActivityMs)
      .map(hudSession),
    timeline: input.timeline,
    providers,
    accounts,
    approvals: [],
    settings: {
      quotaDisplay: "consumed",
      appearance: input.appearance,
      language: input.language,
      clientHooks: false,
      launchAtLogin: false,
      animations: true,
      hudVisible: true,
    },
    capabilities: [],
    billing,
  };
}

/** Hourly token totals for the last `hours` hours, oldest first, from the analytics turns table
 *  (one row per assistant turn, `ts` in epoch ms). Hours with no turns read as zero, so the chart
 *  keeps its time axis. */
export function hourlyTimeline(
  rows: { hour: number; input: number; output: number; cache: number }[],
  now: number,
  hours = 24,
): Hud.TimelinePoint[] {
  const HOUR = 3_600_000;
  const last = Math.floor(now / HOUR);
  const byHour = new Map(rows.map((r) => [r.hour, r]));
  const out: Hud.TimelinePoint[] = [];
  for (let h = last - hours + 1; h <= last; h++) {
    const r = byHour.get(h);
    const input = r?.input ?? 0;
    const output = r?.output ?? 0;
    const cache = r?.cache ?? 0;
    out.push({
      timestamp: iso(h * HOUR),
      input,
      output,
      cache,
      tokens: input + output + cache,
    });
  }
  return out;
}

/** The SQL `hourlyTimeline` reads: turns since `sinceMs`, summed per hour. */
export const HOURLY_TOKENS_SQL = `
  SELECT ts / 3600000 AS hour,
         SUM(input_tokens) AS input,
         SUM(output_tokens) AS output,
         SUM(cache_read_tokens + cache_creation_tokens) AS cache
  FROM turns
  WHERE ts >= ?
  GROUP BY hour`;
