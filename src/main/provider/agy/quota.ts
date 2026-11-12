import { readFileSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import type { RateLimit, RateLimitWindows } from "@shared/types";

/**
 * The Antigravity plan's limits and each model's official context window. Antigravity Tools (the
 * account manager that signs agy in) refreshes them from Google's model list on its own schedule and
 * keeps them per account under `~/.antigravity_tools/accounts/<id>.json` → `quota`; agy itself
 * writes nothing readable. So this reads the account Tools last put into agy
 * (`accounts.json` → `current_agy_account_id`). Absent Tools, or an account it has never refreshed,
 * reads as null — the Pressure panel then shows the context only.
 *
 * The plan meters two pools — Gemini models, and the third-party Claude/GPT-OSS models — each with
 * a 5-hour and a weekly window (`quota_groups[].buckets[]`, `remaining_fraction` 0–1). A session
 * shows the pool its model draws from.
 */

export function resolveAgyToolsDir(
  env: NodeJS.ProcessEnv = process.env,
): string {
  return env.CBW_AGY_TOOLS_DIR || join(homedir(), ".antigravity_tools");
}

export interface AgyModelInfo {
  name: string;
  displayName: string;
  /** The model's context window in tokens, as Google's model list states it. */
  maxTokens: number;
}

export interface AgyPool {
  /** "gemini" for the Gemini pool, "third-party" for Claude/GPT-OSS. */
  kind: "gemini" | "third-party";
  windows: RateLimitWindows;
}

export interface AgyQuota {
  email: string;
  tier: string;
  /** When Tools last refreshed this account (epoch ms). */
  updatedMs: number;
  pools: AgyPool[];
  models: AgyModelInfo[];
}

type Rec = Record<string, unknown>;
const rec = (v: unknown): Rec | null =>
  v && typeof v === "object" && !Array.isArray(v) ? (v as Rec) : null;
const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
const str = (v: unknown): string => (typeof v === "string" ? v : "");
const num = (v: unknown): number | null =>
  typeof v === "number" && Number.isFinite(v) ? v : null;

const WINDOW_MINUTES: Record<string, number> = {
  "5h": 300,
  weekly: 7 * 24 * 60,
};

function bucketLimit(b: Rec, now: number): RateLimit | null {
  const remaining = num(b.remaining_fraction);
  const resetsAt = Date.parse(str(b.reset_time));
  if (remaining === null || !Number.isFinite(resetsAt)) return null;
  // A window whose reset has passed has refilled, whatever Tools last saw.
  const usedPct =
    resetsAt <= now
      ? 0
      : Math.min(100, Math.max(0, Math.round((1 - remaining) * 100)));
  const windowMinutes = WINDOW_MINUTES[str(b.window)];
  return windowMinutes
    ? { usedPct, resetsAt, windowMinutes }
    : { usedPct, resetsAt };
}

/** The `quota` block of a Tools account file → pools and models. Null when it carries neither. */
export function parseAgyQuota(
  account: unknown,
  now: number = Date.now(),
): AgyQuota | null {
  const a = rec(account);
  const q = rec(a?.quota);
  if (!a || !q) return null;
  const pools: AgyPool[] = [];
  for (const group of arr(q.quota_groups)) {
    const windows: RateLimitWindows = {};
    let kind: AgyPool["kind"] | null = null;
    for (const raw of arr(rec(group)?.buckets)) {
      const b = rec(raw);
      if (!b) continue;
      const id = str(b.bucket_id);
      kind = id.startsWith("gemini") ? "gemini" : "third-party";
      const limit = bucketLimit(b, now);
      if (!limit) continue;
      if (b.window === "5h") windows.fiveHour = limit;
      else if (b.window === "weekly") windows.sevenDay = limit;
    }
    if (kind && (windows.fiveHour || windows.sevenDay))
      pools.push({ kind, windows });
  }
  const models: AgyModelInfo[] = [];
  for (const raw of arr(q.models)) {
    const m = rec(raw);
    const maxTokens = num(m?.max_tokens);
    if (!m || !maxTokens) continue;
    models.push({
      name: str(m.name),
      displayName: str(m.display_name),
      maxTokens,
    });
  }
  if (pools.length === 0 && models.length === 0) return null;
  const updated = num(q.last_updated);
  return {
    email: str(a.email),
    tier: str(q.subscription_tier),
    updatedMs: updated ? updated * 1000 : 0,
    pools,
    models,
  };
}

/** Which pool a model draws from: Claude and GPT-OSS are the third-party pool, the rest Gemini. */
export function agyPoolKind(model: string): AgyPool["kind"] {
  return /claude|gpt/i.test(model) ? "third-party" : "gemini";
}

/** The official context windows Google's model list states, for when Tools has no list to read. */
const FALLBACK_WINDOWS: [RegExp, number][] = [
  [/claude/i, 250_000],
  [/gpt-oss/i, 131_072],
  [/image/i, 65_536],
];
const GEMINI_WINDOW = 1_048_576;

/** A model's official context window: Google's model list via Tools (matched by display name, then
 *  id), else the per-family figure that list states. `label` is the display name agy recorded
 *  ("Gemini 3.8 Flash (Low)"), `id` its model id ("gemini-3.8-flash"). */
export function agyContextWindow(
  model: { id?: string; label?: string },
  models: AgyModelInfo[] = [],
): number {
  const label = model.label?.trim().toLowerCase();
  const id = model.id?.trim().toLowerCase();
  const hit =
    (label && models.find((m) => m.displayName.toLowerCase() === label)) ||
    (id && models.find((m) => m.name.toLowerCase() === id)) ||
    (id && models.find((m) => m.name.toLowerCase().startsWith(id)));
  if (hit) return hit.maxTokens;
  const text = `${model.label ?? ""} ${model.id ?? ""}`;
  for (const [re, size] of FALLBACK_WINDOWS) if (re.test(text)) return size;
  return GEMINI_WINDOW;
}

export interface AgyQuotaReader {
  read(): AgyQuota | null;
}

/** Reads the Tools account agy is signed in with; re-parses only when the account file changes. */
export function createAgyQuotaReader(
  deps: { toolsDir?: string; now?: () => number } = {},
): AgyQuotaReader {
  const dir = deps.toolsDir ?? resolveAgyToolsDir();
  const now = deps.now ?? (() => Date.now());
  let cache: { path: string; mtimeMs: number; raw: unknown } | null = null;
  const currentAccountPath = (): string | null => {
    try {
      const index = rec(
        JSON.parse(readFileSync(join(dir, "accounts.json"), "utf8")),
      );
      const id =
        str(index?.current_agy_account_id) || str(index?.current_account_id);
      return id ? join(dir, "accounts", `${id}.json`) : null;
    } catch {
      return null;
    }
  };
  return {
    read: () => {
      const path = currentAccountPath();
      if (!path) return null;
      try {
        const mtimeMs = statSync(path).mtimeMs;
        if (!cache || cache.path !== path || cache.mtimeMs !== mtimeMs)
          cache = {
            path,
            mtimeMs,
            raw: JSON.parse(readFileSync(path, "utf8")),
          };
      } catch {
        return null;
      }
      return parseAgyQuota(cache.raw, now());
    },
  };
}
