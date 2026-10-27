import type * as Hud from "@shared/hud-protocol";

/**
 * The two panel queries Agent HUD's sections send besides the snapshot — the token chart's
 * `statistics` and the session list's `sessions` — answered from this app's analytics turns and
 * session rows. Pure: rows in, Agent HUD's response shape out.
 */

/** Token sums per bucket, agent and model, as the analytics turns table yields them. */
export interface TurnBucketRow {
  /** Bucket index: floor(ts / bucket length). */
  bucket: number;
  agent: string;
  model: string | null;
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
}

/** The SQL that yields TurnBucketRows: ? = bucket ms, from ms, to ms. The bucket length is cast
 *  because better-sqlite3 binds a JS number as REAL, which would make the bucket index fractional. */
export const TURN_BUCKETS_SQL = `
  SELECT ts / CAST(? AS INTEGER) AS bucket, agent, model_raw AS model,
         SUM(input_tokens) AS input,
         SUM(output_tokens) AS output,
         SUM(cache_read_tokens) AS cacheRead,
         SUM(cache_creation_tokens) AS cacheWrite
  FROM turns
  WHERE ts >= ? AND ts < ?
  GROUP BY bucket, agent, model_raw`;

const zeroTokens = (): Hud.StatisticsTokens => ({
  input: 0,
  output: 0,
  cacheRead: 0,
  cacheWrite: 0,
  reasoning: 0,
});

function selected(
  tokens: Hud.StatisticsTokens,
  kinds: Hud.StatisticsTokenKind[],
): number {
  return kinds.reduce((sum, kind) => sum + (tokens[kind] ?? 0), 0);
}

const coverage = (notice: string | null = null): Hud.StatisticsCoverage => ({
  state: "complete",
  partial: false,
  observedFrom: null,
  observedTo: null,
  pendingSources: 0,
  unattributedEvents: 0,
  unavailableProviders: [],
  notice,
});

const HOUR = 3_600_000;
const DAY = 86_400_000;

/** A model's id across agents: the agent, then the logged model. */
const modelId = (r: TurnBucketRow) => `${r.agent}:${r.model ?? "unknown"}`;

const tokensOfRow = (r: TurnBucketRow): Hud.StatisticsTokens => ({
  input: r.input,
  output: r.output,
  cacheRead: r.cacheRead,
  cacheWrite: r.cacheWrite,
  reasoning: 0,
});

function addTokens(into: Hud.StatisticsTokens, t: Hud.StatisticsTokens) {
  for (const k of Object.keys(t) as Hud.StatisticsTokenKind[])
    into[k] = (into[k] ?? 0) + t[k];
}

const totalOfKinds = (
  tokens: Hud.StatisticsTokens,
  kinds: Hud.StatisticsTokenKind[],
): Hud.StatisticsTotal => ({
  tokens,
  selectedTokens: selected(tokens, kinds),
  cost: null,
});

/** Per-model totals of some rows, largest first. */
function modelsOf(
  rows: TurnBucketRow[],
  kinds: Hud.StatisticsTokenKind[],
): Hud.StatisticsModel[] {
  const by = new Map<string, { row: TurnBucketRow; t: Hud.StatisticsTokens }>();
  for (const r of rows) {
    const e = by.get(modelId(r)) ?? { row: r, t: zeroTokens() };
    addTokens(e.t, tokensOfRow(r));
    by.set(modelId(r), e);
  }
  return [...by]
    .map(([id, { row, t }]) => ({
      id,
      provider: row.agent,
      name: row.model ?? "unknown",
      ...totalOfKinds(t, kinds),
    }))
    .sort((a, b) => b.selectedTokens - a.selectedTokens);
}

/** Rows kept by the query's provider and model filters. */
function filtered(query: Hud.StatisticsQuery, rows: TurnBucketRow[]) {
  const providers = query.providers ? new Set(query.providers) : null;
  const models = query.models ? new Set(query.models) : null;
  return rows.filter(
    (r) =>
      (!providers || providers.has(r.agent)) &&
      (!models || models.has(modelId(r))),
  );
}

/** Longer views besides the query's own buckets: hourly rows of the last 7 days (heatmap, today,
 *  7 days) and daily rows of the last 30 days. */
export interface StatisticsHistory {
  hours: TurnBucketRow[];
  days: TurnBucketRow[];
}

/** The token chart's answer: every bucket of [from, to) split by model, per-agent totals and series,
 *  the recent periods and the week's heatmap. No costs: the turns table records no prices. */
export function statisticsResponse(
  query: Hud.StatisticsQuery,
  rows: TurnBucketRow[],
  providers: { id: string; name: string }[],
  now: number,
  history: StatisticsHistory = { hours: [], days: [] },
): Hud.StatisticsResponse {
  const kinds = query.tokenKinds;
  const bucketMs = query.bucketMinutes * 60_000;
  const from = Date.parse(query.from);
  const to = Date.parse(query.to);
  const kept = filtered(query, rows);
  const first = Math.floor(from / bucketMs);
  const count = Math.max(0, Math.ceil(to / bucketMs) - first);

  const buckets: Hud.StatisticsBucket[] = Array.from(
    { length: count },
    (_, i) => ({
      timestamp: new Date((first + i) * bucketMs).toISOString(),
      tokens: zeroTokens(),
      selectedTokens: 0,
      models: {},
    }),
  );
  const total = zeroTokens();
  const perAgent = new Map<
    string,
    { t: Hud.StatisticsTokens; series: number[] }
  >();
  for (const r of kept) {
    const b = buckets[r.bucket - first];
    if (!b) continue;
    const t = tokensOfRow(r);
    const sel = selected(t, kinds);
    addTokens(b.tokens, t);
    b.selectedTokens += sel;
    b.models[modelId(r)] = (b.models[modelId(r)] ?? 0) + sel;
    addTokens(total, t);
    const a = perAgent.get(r.agent) ?? {
      t: zeroTokens(),
      series: new Array<number>(count).fill(0),
    };
    addTokens(a.t, t);
    a.series[r.bucket - first] += sel;
    perAgent.set(r.agent, a);
  }

  const name = (id: string) => providers.find((p) => p.id === id)?.name ?? id;
  const providerRows: Hud.StatisticsProvider[] = [...perAgent]
    .map(([id, a]) => ({
      id,
      name: name(id),
      ...totalOfKinds(a.t, kinds),
      models: modelsOf(
        kept.filter((r) => r.agent === id),
        kinds,
      ),
      topSessions: [],
      series: a.series,
    }))
    .sort((a, b) => b.selectedTokens - a.selectedTokens);

  // Recent periods and the heatmap read the longer history, under the same filters.
  const hours = filtered(query, history.hours);
  const days = filtered(query, history.days);
  const midnight = new Date(now);
  midnight.setHours(0, 0, 0, 0);
  const period = (
    id: Hud.StatisticsPeriod["id"],
    since: number,
    source: TurnBucketRow[],
    length: number,
  ): Hud.StatisticsPeriod => {
    const inside = source.filter((r) => r.bucket * length >= since);
    const t = zeroTokens();
    for (const r of inside) addTokens(t, tokensOfRow(r));
    return {
      id,
      from: new Date(since).toISOString(),
      to: new Date(now).toISOString(),
      totals: totalOfKinds(t, kinds),
      models: modelsOf(inside, kinds),
      coverage: coverage(),
    };
  };
  const recent = [
    period("today", midnight.getTime(), hours, HOUR),
    period("7d", now - 7 * DAY, hours, HOUR),
    period("30d", now - 30 * DAY, days, DAY),
  ];

  // Monday-first 7 × 24 cells in local time.
  const heat = Array.from({ length: 7 }, () => new Array<number>(24).fill(0));
  const heatModels = Array.from({ length: 7 }, () =>
    Array.from({ length: 24 }, () => ({})),
  );
  for (const r of hours) {
    const at = new Date(r.bucket * HOUR);
    const day = (at.getDay() + 6) % 7;
    const hour = at.getHours();
    const sel = selected(tokensOfRow(r), kinds);
    heat[day][hour] += sel;
    heatModels[day][hour][modelId(r)] =
      (heatModels[day][hour][modelId(r)] ?? 0) + sel;
  }
  const peak = Math.max(0, ...heat.flat());
  const intensity = heat.map((row) => row.map((v) => (peak ? v / peak : 0)));

  const empty: Hud.StatisticsCoverage = coverage();
  return {
    kind: "statistics",
    dataRevision: 0,
    generatedAt: new Date(now).toISOString(),
    query,
    totals: totalOfKinds(total, kinds),
    buckets,
    providers: providerRows,
    models: modelsOf(kept, kinds),
    available: {
      providers,
      models: modelsOf([...rows, ...history.days], kinds).map((m) => ({
        id: m.id,
        provider: m.provider,
        name: m.name,
      })),
    },
    coverage: empty,
    recent,
    heatmap: {
      from: new Date(now - 7 * DAY).toISOString(),
      to: new Date(now).toISOString(),
      tokens: heat,
      intensity,
      models: heatModels,
      coverage: empty,
    },
  };
}

/** The session list's answer: `scope` "active" is a day or in flight, "recent" a week or in flight;
 *  `sort` "active" puts running and waiting sessions first; one page of `limit` from `offset`. */
export function sessionsResponse(
  query: Hud.SessionsQuery,
  sessions: Hud.Session[],
  now: number,
): Hud.SessionsResponse {
  const live = (s: Hud.Session) =>
    s.state === "running" || s.state === "waiting";
  const idle = new Set(query.idleSources ?? []);
  const rows = sessions.map((s) =>
    idle.has(s.source) ? { ...s, state: "idle" as const } : s,
  );
  const window =
    query.scope === "all" ? Infinity : query.scope === "recent" ? 7 * DAY : DAY;
  const inScope = rows.filter(
    (s) => live(s) || now - Date.parse(s.updatedAt) <= window,
  );
  const sources = [...new Set(inScope.map((s) => s.source))];
  const projects = [...new Set(inScope.map((s) => s.project ?? null))];
  const filtered = inScope.filter(
    (s) =>
      (!query.source || s.source === query.source) &&
      (!query.sources || query.sources.includes(s.source)) &&
      (!query.projects ||
        query.projects.includes(s.project ?? s.cwd ?? "unassigned")) &&
      (!query.states || query.states.includes(s.state)) &&
      (!query.search ||
        s.title.toLowerCase().includes(query.search.toLowerCase())),
  );
  const byDate = (a: Hud.Session, b: Hud.Session) =>
    Date.parse(b.updatedAt) - Date.parse(a.updatedAt);
  filtered.sort(
    query.sort === "active"
      ? (a, b) => Number(live(b)) - Number(live(a)) || byDate(a, b)
      : byDate,
  );
  const offset = query.offset ?? 0;
  const limit = Math.min(query.limit ?? 100, 200);
  const items = filtered.slice(offset, offset + limit);
  return {
    kind: "sessions",
    revision: 0,
    generatedAt: new Date(now).toISOString(),
    items,
    total: filtered.length,
    activeCount: filtered.filter(live).length,
    nextOffset: offset + limit < filtered.length ? offset + limit : null,
    sources,
    projects,
  };
}

/** One assistant call of a session, as the analytics turns table records it. */
export interface SessionTurnRow {
  id: string;
  ts: number;
  model: string | null;
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
}

/** The SQL that yields a session's SessionTurnRows, oldest first: ? = session id. */
export const SESSION_TURNS_SQL = `
  SELECT message_id AS id, ts, model_raw AS model,
         input_tokens AS input,
         output_tokens AS output,
         cache_read_tokens AS cacheRead,
         cache_creation_tokens AS cacheWrite
  FROM turns
  WHERE session_id = ?
  ORDER BY ts`;

/** Agent HUD keeps the newest 200 turns of a session's detail. */
const DETAIL_TURNS = 200;

const tokensOf = (r: SessionTurnRow): Hud.StatisticsTokens => ({
  input: r.input,
  output: r.output,
  cacheRead: r.cacheRead,
  cacheWrite: r.cacheWrite,
  reasoning: 0,
});

const add = (a: Hud.StatisticsTokens, b: Hud.StatisticsTokens) => {
  for (const k of Object.keys(b) as Hud.StatisticsTokenKind[])
    a[k] = (a[k] ?? 0) + b[k];
};

const totalOf = (t: Hud.StatisticsTokens) =>
  t.input + t.output + t.cacheRead + t.cacheWrite + (t.reasoning ?? 0);

/** Cache reads as a share of every prompt; null when nothing was prompted. */
const hitRate = (t: Hud.StatisticsTokens) => {
  const prompted = t.input + t.cacheRead + t.cacheWrite;
  return prompted > 0 ? t.cacheRead / prompted : null;
};

/** The Statistics window's session page: the session's calls (one turn each — this app's turns
 *  table records calls, not prompts) with per-model totals. No messages: the main window shows the
 *  conversation. */
export function sessionDetailResponse(
  session: Hud.Session,
  rows: SessionTurnRow[],
): Hud.SessionDetail {
  const usage = zeroTokens();
  const byModel = new Map<string, Hud.StatisticsTokens>();
  for (const r of rows) {
    const t = tokensOf(r);
    add(usage, t);
    const key = r.model ?? "unknown";
    const m = byModel.get(key) ?? zeroTokens();
    add(m, t);
    byModel.set(key, m);
  }
  const kept = rows.slice(-DETAIL_TURNS);
  const first = rows.length - kept.length;
  const last = rows.at(-1);
  return {
    session,
    callCount: rows.length,
    turnCount: rows.length,
    cacheHitRate: hitRate(usage),
    contextTokens: last ? last.input + last.cacheRead + last.cacheWrite : null,
    startedAt: rows[0] ? new Date(rows[0].ts).toISOString() : null,
    updatedAt: last ? new Date(last.ts).toISOString() : null,
    usage: { ...usage, total: totalOf(usage) },
    models: [...byModel].map(([id, t]) => ({
      id,
      name: id,
      agentId: session.source,
      tokens: { ...t, total: totalOf(t) },
      cacheHitRate: hitRate(t),
    })),
    turns: kept.map((r, i) => ({
      id: r.id,
      index: first + i + 1,
      timestamp: new Date(r.ts).toISOString(),
      input: r.input,
      output: r.output,
      cache: r.cacheRead + r.cacheWrite,
      cacheRead: r.cacheRead,
      cacheWrite: r.cacheWrite,
      context: r.input + r.cacheRead + r.cacheWrite,
      model: r.model,
      message: null,
      newTokens: r.input + r.output + r.cacheWrite,
    })),
    calls: [],
    messages: [],
    messagesComplete: true,
  };
}
