import type * as Hud from "@shared/hud-protocol";

/**
 * The two panel queries Agent HUD's sections send besides the snapshot — the token chart's
 * `statistics` and the session list's `sessions` — answered from this app's analytics turns and
 * session rows. Pure: rows in, Agent HUD's response shape out.
 */

/** Token sums per bucket and agent, as the analytics turns table yields them. */
export interface TurnBucketRow {
  /** Bucket index: floor(ts / bucket length). */
  bucket: number;
  agent: string;
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
}

/** The SQL that yields TurnBucketRow for one statistics query: ? = bucket ms, from ms, to ms. */
export const TURN_BUCKETS_SQL = `
  SELECT ts / ? AS bucket, agent,
         SUM(input_tokens) AS input,
         SUM(output_tokens) AS output,
         SUM(cache_read_tokens) AS cacheRead,
         SUM(cache_creation_tokens) AS cacheWrite
  FROM turns
  WHERE ts >= ? AND ts < ?
  GROUP BY bucket, agent`;

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

/** The token chart's answer: every bucket of [from, to), filtered to the query's agents. Costs,
 *  models and the heatmap stay empty — the chart draws from buckets and totals alone. */
export function statisticsResponse(
  query: Hud.StatisticsQuery,
  rows: TurnBucketRow[],
  providers: { id: string; name: string }[],
  now: number,
): Hud.StatisticsResponse {
  const bucketMs = query.bucketMinutes * 60_000;
  const from = Date.parse(query.from);
  const to = Date.parse(query.to);
  const wanted = query.providers ? new Set(query.providers) : null;
  const byBucket = new Map<number, Hud.StatisticsTokens>();
  for (const row of rows) {
    if (wanted && !wanted.has(row.agent)) continue;
    const t = byBucket.get(row.bucket) ?? zeroTokens();
    t.input += row.input;
    t.output += row.output;
    t.cacheRead += row.cacheRead;
    t.cacheWrite += row.cacheWrite;
    byBucket.set(row.bucket, t);
  }
  const buckets: Hud.StatisticsBucket[] = [];
  const total = zeroTokens();
  for (let b = Math.floor(from / bucketMs); b * bucketMs < to; b++) {
    const tokens = byBucket.get(b) ?? zeroTokens();
    for (const k of Object.keys(total) as (keyof Hud.StatisticsTokens)[])
      total[k] += tokens[k];
    buckets.push({
      timestamp: new Date(b * bucketMs).toISOString(),
      tokens,
      selectedTokens: selected(tokens, query.tokenKinds),
      models: {},
    });
  }
  const empty: Hud.StatisticsCoverage = coverage();
  return {
    kind: "statistics",
    dataRevision: 0,
    generatedAt: new Date(now).toISOString(),
    query,
    totals: {
      tokens: total,
      selectedTokens: selected(total, query.tokenKinds),
      cost: null,
    },
    buckets,
    providers: [],
    models: [],
    available: { providers, models: [] },
    coverage: empty,
    recent: [],
    heatmap: {
      from: query.from,
      to: query.to,
      tokens: [],
      intensity: [],
      models: [],
      coverage: empty,
    },
  };
}

const DAY = 86_400_000;

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
