import { readFileSync } from "node:fs";
import { join } from "node:path";
import { parse as parseToml } from "smol-toml";
import type { RelayUsage } from "@shared/types";
import { createTtlFetch, type TtlFetch } from "../util/ttl-fetch";

/** A relay an agent's configuration points at, with the key it already uses there. */
export interface RelayTarget {
  /** The relay's origin, e.g. `https://dafeyu.com`. */
  origin: string;
  host: string;
  key: string;
}

type Env = NodeJS.ProcessEnv;
const usableKey = (key: unknown): key is string =>
  typeof key === "string" &&
  key.trim() !== "" &&
  !/[\0\r\n]/.test(key) &&
  !key.startsWith("!");

function target(baseUrl: unknown, key: unknown): RelayTarget | null {
  if (typeof baseUrl !== "string" || !usableKey(key)) return null;
  let url: URL;
  try {
    url = new URL(baseUrl);
  } catch {
    return null;
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") return null;
  return { origin: url.origin, host: url.hostname, key };
}

const record = (v: unknown): Record<string, unknown> | null =>
  v && typeof v === "object" && !Array.isArray(v)
    ? (v as Record<string, unknown>)
    : null;

/**
 * The relay Codex's `config.toml` selects: `model_provider` naming an entry of `model_providers`
 * with a `base_url`, keyed by `experimental_bearer_token` or the variable `env_key` names. Null when
 * Codex talks to OpenAI itself (no provider, or `openai`), or the file can't be read or parsed.
 */
export function codexRelay(configToml: string, env: Env): RelayTarget | null {
  let config: Record<string, unknown>;
  try {
    config = parseToml(configToml);
  } catch {
    return null;
  }
  const id = config.model_provider;
  if (typeof id !== "string" || id === "openai") return null;
  const provider = record(record(config.model_providers)?.[id]);
  if (!provider) return null;
  const envKey = provider.env_key;
  const key =
    provider.experimental_bearer_token ??
    (typeof envKey === "string" ? env[envKey] : undefined);
  return target(provider.base_url, key);
}

/**
 * The relay Pi's `models.json` names: the first provider with an http(s) `baseUrl` and a usable
 * `apiKey`. Pi reads `apiKey` as an environment variable's name when one is set, else as the key
 * itself; a `!command` key is never run here.
 */
export function piRelay(modelsJson: string, env: Env): RelayTarget | null {
  let models: unknown;
  try {
    models = JSON.parse(modelsJson);
  } catch {
    return null;
  }
  const providers = record(record(models)?.providers);
  for (const provider of Object.values(providers ?? {})) {
    const p = record(provider);
    const raw = p?.apiKey;
    const key = typeof raw === "string" ? (env[raw] ?? raw) : raw;
    const found = target(p?.baseUrl, key);
    if (found) return found;
  }
  return null;
}

/** new-api's default QuotaPerUnit: quota points per US dollar. */
const POINTS_PER_USD = 500_000;

/** How the relay turns quota points into money, from its public `/api/status` (new-api's
 *  `quota_per_unit`, `quota_display_type`, `usd_exchange_rate`). Dollars at the default rate
 *  when the status is missing or shows another unit. */
export interface RelayMoney {
  pointsPerUnit: number;
  currency: "CNY" | "USD";
  rate: number;
}

export function relayMoney(status: unknown): RelayMoney {
  const data = record(record(status)?.data);
  const positive = (k: string): number | null => {
    const v = data?.[k];
    return typeof v === "number" && Number.isFinite(v) && v > 0 ? v : null;
  };
  const pointsPerUnit = positive("quota_per_unit") ?? POINTS_PER_USD;
  const rate = positive("usd_exchange_rate");
  return data?.quota_display_type === "CNY" && rate !== null
    ? { pointsPerUnit, currency: "CNY", rate }
    : { pointsPerUnit, currency: "USD", rate: 1 };
}

/** A key's usage from new-api's `/api/usage/token/` body, or null when it isn't that shape. An
 *  unlimited key reports only what it spent. */
export function relayUsage(
  body: unknown,
  host: string,
  money: RelayMoney,
): RelayUsage | null {
  const data = record(record(body)?.data);
  const used = data?.total_used;
  const granted = data?.total_granted;
  if (typeof used !== "number" || typeof granted !== "number") return null;
  const amount = (points: number): number =>
    (points / money.pointsPerUnit) * money.rate;
  const usage: RelayUsage = {
    host,
    spent: amount(used),
    currency: money.currency,
  };
  if (data?.unlimited_quota !== true && granted > 0) {
    usage.remaining = amount(Math.max(0, granted - used));
    usage.usedPct = Math.min(100, Math.max(0, (used / granted) * 100));
  }
  return usage;
}

export type FetchFn = (url: string, init?: RequestInit) => Promise<Response>;

/** One reading of `relay`: its money settings (best effort, no key sent), then the key's usage. */
export async function fetchRelayUsage(
  relay: RelayTarget,
  fetchFn: FetchFn,
): Promise<RelayUsage | null> {
  let money = relayMoney(null);
  try {
    const res = await fetchFn(`${relay.origin}/api/status`);
    if (res.ok) money = relayMoney(await res.json());
  } catch {
    // Unreadable status: the usage still reads, in dollars.
  }
  const res = await fetchFn(`${relay.origin}/api/usage/token/`, {
    headers: { Authorization: `Bearer ${relay.key}` },
  });
  if (!res.ok) return null;
  return relayUsage(await res.json(), relay.host, money);
}

const RELAY_TTL_MS = 5 * 60_000;
const RELAY_FAILURE_TTL_MS = 60_000;

const readOrNull = (path: string): string | null => {
  try {
    return readFileSync(path, "utf8");
  } catch {
    return null;
  }
};

export interface RelayServiceDeps {
  /** The agent's relay right now, or null when it doesn't use one. Re-read on every fetch, so a
   *  config edit takes effect at the next refresh. */
  locate: () => RelayTarget | null;
  fetchFn: FetchFn;
  now?: () => number;
}

/** A relay's usage on the same lazy, poll-driven TTL contract as the Codex limits service. */
export function createRelayUsageService(
  deps: RelayServiceDeps,
): TtlFetch<RelayUsage> {
  return createTtlFetch<RelayUsage>({
    fetch: async () => {
      const relay = deps.locate();
      return relay ? fetchRelayUsage(relay, deps.fetchFn) : null;
    },
    successTtlMs: RELAY_TTL_MS,
    failureTtlMs: RELAY_FAILURE_TTL_MS,
    now: deps.now,
  });
}

/** Codex's relay, from `<codexDir>/config.toml`. */
export const locateCodexRelay =
  (codexDir: string, env: Env = process.env) =>
  (): RelayTarget | null => {
    const text = readOrNull(join(codexDir, "config.toml"));
    return text === null ? null : codexRelay(text, env);
  };

/** Pi's relay, from `<piDir>/models.json`. */
export const locatePiRelay =
  (piDir: string, env: Env = process.env) =>
  (): RelayTarget | null => {
    const text = readOrNull(join(piDir, "models.json"));
    return text === null ? null : piRelay(text, env);
  };
