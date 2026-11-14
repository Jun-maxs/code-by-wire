import { createHash } from "node:crypto";
import {
  createReadStream,
  existsSync,
  readFileSync,
  realpathSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { homedir } from "node:os";
import { delimiter, dirname, join } from "node:path";
import {
  agyPoolKindForModel,
  parseAgyModelDisplay,
  type AgyAccountQuota,
  type AgyQuotaOverview,
} from "@shared/agy-quota";
import type { RateLimit, RateLimitWindows } from "@shared/types";
import { resolveAgyDir } from "./store";

/**
 * Antigravity (agy) plan limits and official model context windows.
 *
 * Google's Cloud Code internal API (`daily-cloudcode-pa.googleapis.com` for Gemini 4 / 3.8 CLI
 * traffic, `cloudcode-pa.googleapis.com` fallback) meters two rolling pools — Gemini models and
 * third-party Claude/GPT-OSS models — each with a 5-hour and a weekly window.
 *
 * Historically Jun-Code only passively read `~/.antigravity_tools/accounts/<id>.json`. When
 * Antigravity Tools wasn't running, couldn't reach Google (its Rust client ignores the OS proxy
 * unless manually configured), queried the legacy host instead of `daily-cloudcode-pa`, or when a
 * user signed into `agy` directly (`~/.gemini/jetski-standalone-oauth-token`), the file froze and
 * any elapsed `reset_time` (`resetsAt <= now`) caused `pickWindow`/`liveWindow` to drop the window.
 *
 * `createAgyQuotaReader` now actively refreshes quota on a 2-minute TTL (and immediately whenever a
 * window's `resetsAt` elapses) via Electron's `net.fetch` (honoring the OS proxy and certificates),
 * reading OAuth credentials read-only from Tools or `agy` standalone login and persisting only the
 * non-sensitive quota snapshot to `<userData>/agy-quota-cache.json`.
 */

export const AGY_QUOTA_TTL_MS = 120_000;
export const AGY_MODELS_TTL_MS = 15 * 60_000;
export const AGY_ERROR_BACKOFF_MS = 30_000;
export const AGY_RATE_LIMIT_BACKOFF_MS = 300_000;
export const AGY_TIMEOUT_MS = 8_000;
const TOKEN_EXPIRY_SKEW_MS = 60_000;

const OAUTH_TOKEN_URL = "https://oauth2.googleapis.com/token";
const CLOUD_CODE_BASES = [
  "https://daily-cloudcode-pa.googleapis.com",
  "https://cloudcode-pa.googleapis.com",
] as const;

const DEFAULT_HUB_VERSION = "2.28.0";
const DEFAULT_HUB_CL = "1008300195";

const CLIENT_ID_RE =
  /[1-9]\d{10,13}-[a-z0-9-]{20,40}\.apps\.googleusercontent\.com/g;
const CLIENT_SECRET_RE = /GOCSPX-[A-Za-z0-9_-]{28}/g;

export interface AgyOAuthClient {
  clientId: string;
  clientSecret: string;
}

const discoveredBinaryCache = new Map<
  string,
  { sig: string; ids: string[]; secrets: string[] }
>();
const resolvedClientById = new Map<string, string>();

function extractJwtClientId(idToken: string): string {
  const parts = idToken.split(".");
  if (parts.length < 2 || !parts[1]) return "";
  try {
    const payload = rec(
      JSON.parse(Buffer.from(parts[1], "base64url").toString("utf8")),
    );
    const candidate = str(payload?.azp) || str(payload?.aud);
    return /\.apps\.googleusercontent\.com$/i.test(candidate) ? candidate : "";
  } catch {
    return "";
  }
}

function resolveAgyBinaryPath(
  overridePath?: string | null,
  env: NodeJS.ProcessEnv = process.env,
  platform: NodeJS.Platform = process.platform,
): string | null {
  if (overridePath !== undefined) {
    return overridePath && existsSync(overridePath) ? overridePath : null;
  }
  const candidates: string[] = [];
  if (env.CBW_AGY_BIN) candidates.push(env.CBW_AGY_BIN);
  const exeName = platform === "win32" ? "agy.exe" : "agy";
  if (platform === "win32") {
    const localAppData =
      env.LOCALAPPDATA || join(homedir(), "AppData", "Local");
    candidates.push(join(localAppData, "agy", "bin", "agy.exe"));
  } else {
    candidates.push(
      "/opt/homebrew/bin/agy",
      "/usr/local/bin/agy",
      join(homedir(), ".local", "bin", "agy"),
    );
  }
  const pathVal = env.PATH || env.Path || "";
  for (const dir of pathVal.split(delimiter)) {
    if (dir) candidates.push(join(dir, exeName));
  }
  for (const candidate of candidates) {
    try {
      if (!existsSync(candidate)) continue;
      const resolved = realpathSync(candidate);
      if (statSync(resolved).isFile()) return resolved;
    } catch {
      continue;
    }
  }
  return null;
}

async function discoverBinaryOAuthCandidates(
  binPath: string,
): Promise<{ ids: string[]; secrets: string[] }> {
  let st: { mtimeMs: number; size: number };
  try {
    st = statSync(binPath);
  } catch {
    return { ids: [], secrets: [] };
  }
  const sig = `${st.mtimeMs}:${st.size}`;
  const hit = discoveredBinaryCache.get(binPath);
  if (hit && hit.sig === sig) {
    return { ids: hit.ids, secrets: hit.secrets };
  }
  const ids = new Set<string>();
  const secrets = new Set<string>();
  await new Promise<void>((resolve) => {
    const stream = createReadStream(binPath, {
      highWaterMark: 4 * 1024 * 1024,
    });
    let tail: Buffer = Buffer.alloc(0);
    stream.on("data", (chunk: Buffer | string) => {
      const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      const combined = tail.length > 0 ? Buffer.concat([tail, buf]) : buf;
      const text = combined.toString("latin1");
      for (const m of text.matchAll(CLIENT_ID_RE)) ids.add(m[0]);
      for (const m of text.matchAll(CLIENT_SECRET_RE)) secrets.add(m[0]);
      tail = combined.subarray(Math.max(0, combined.length - 128));
    });
    stream.on("error", () => resolve());
    stream.on("end", () => resolve());
  });
  const result = { ids: [...ids], secrets: [...secrets] };
  discoveredBinaryCache.set(binPath, { sig, ...result });
  return result;
}

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
  /** When this quota snapshot was fetched (epoch ms). */
  updatedMs: number;
  pools: AgyPool[];
  models: AgyModelInfo[];
}

export interface AgyCredentials {
  email: string;
  tier: string;
  accessToken: string;
  refreshToken: string;
  expiresAtMs: number;
  projectId: string;
  /** Client ID from token JSON or JWT `azp`/`aud` claim, when available. */
  clientId: string;
  /** Optional client secret present directly in token/config JSON. */
  clientSecret: string;
  /** Truncated SHA-256 of the credential identity — invalidates cached quota on account switch. */
  credHash: string;
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

function bucketLimit(
  b: Rec,
  now: number,
  fallbackResetFromNow = false,
): RateLimit | null {
  const remaining = num(b.remaining_fraction) ?? num(b.remainingFraction);
  const win = str(b.window);
  const windowMinutes = WINDOW_MINUTES[win];
  const rawReset = str(b.reset_time) || str(b.resetTime);
  let resetsAt = Date.parse(rawReset);
  if (
    !Number.isFinite(resetsAt) &&
    fallbackResetFromNow &&
    remaining === 1 &&
    windowMinutes
  ) {
    resetsAt = now + windowMinutes * 60_000;
  }
  if (remaining === null || !Number.isFinite(resetsAt)) return null;
  // A window whose reset has passed has refilled, whatever Tools last saw.
  const usedPct =
    resetsAt <= now
      ? 0
      : Math.min(100, Math.max(0, Math.round((1 - remaining) * 100)));
  return windowMinutes
    ? { usedPct, resetsAt, windowMinutes }
    : { usedPct, resetsAt };
}

function classifyBucketPool(id: string, groupName: string): AgyPool["kind"] {
  if (id.startsWith("gemini")) return "gemini";
  if (id.startsWith("3p")) return "third-party";
  if (/gemini/i.test(groupName)) return "gemini";
  return "third-party";
}

function parseQuotaGroups(
  rawGroups: unknown,
  now: number,
  liveFetch = false,
): AgyPool[] {
  const pools: AgyPool[] = [];
  for (const rawGroup of arr(rawGroups)) {
    const group = rec(rawGroup);
    if (!group) continue;
    const groupName = str(group.display_name) || str(group.displayName);
    const windows: RateLimitWindows = {};
    let kind: AgyPool["kind"] | null = null;
    for (const raw of arr(group.buckets)) {
      const b = rec(raw);
      if (!b) continue;
      const id = str(b.bucket_id) || str(b.bucketId);
      kind = classifyBucketPool(id, groupName);
      const limit = bucketLimit(b, now, liveFetch);
      if (!limit) continue;
      const win = str(b.window);
      if (win === "5h") windows.fiveHour = limit;
      else if (win === "weekly") windows.sevenDay = limit;
    }
    if (kind && (windows.fiveHour || windows.sevenDay)) {
      pools.push({ kind, windows });
    }
  }
  return pools;
}

function parseModelsCollection(rawModels: unknown): AgyModelInfo[] {
  const models: AgyModelInfo[] = [];
  if (Array.isArray(rawModels)) {
    for (const raw of rawModels) {
      const m = rec(raw);
      const maxTokens = num(m?.max_tokens) ?? num(m?.maxTokens);
      const name = str(m?.name);
      if (!m || !name || !maxTokens) continue;
      models.push({
        name,
        displayName: str(m.display_name) || str(m.displayName),
        maxTokens,
      });
    }
    return models;
  }
  const map = rec(rawModels);
  if (!map) return models;
  for (const [name, raw] of Object.entries(map)) {
    const m = rec(raw);
    const maxTokens = num(m?.maxTokens) ?? num(m?.max_tokens);
    if (!m || !name || !maxTokens) continue;
    models.push({
      name,
      displayName: str(m.displayName) || str(m.display_name),
      maxTokens,
    });
  }
  return models;
}

/** The `quota` block of a Tools account file → pools and models. Null when it carries neither. */
export function parseAgyQuota(
  account: unknown,
  now: number = Date.now(),
): AgyQuota | null {
  const a = rec(account);
  const q = rec(a?.quota);
  if (!a || !q) return null;
  const pools = parseQuotaGroups(
    q.quota_groups ?? q.quotaGroups ?? q.groups,
    now,
    false,
  );
  const models = parseModelsCollection(q.models);
  if (pools.length === 0 && models.length === 0) return null;
  const updated = num(q.last_updated) ?? num(q.lastUpdated);
  return {
    email: str(a.email),
    tier: str(q.subscription_tier) || str(q.subscriptionTier),
    updatedMs: updated ? (updated > 1e12 ? updated : updated * 1000) : 0,
    pools,
    models,
  };
}

/** Decode Google Cloud Code's `v1internal:retrieveUserQuotaSummary` response. */
export function parseAgyQuotaSummary(
  body: unknown,
  meta: { email?: string; tier?: string; models?: AgyModelInfo[] } = {},
  now: number = Date.now(),
): AgyQuota | null {
  const root = rec(body);
  if (!root) return null;
  const pools = parseQuotaGroups(
    root.groups ?? root.quotaGroups ?? root.quota_groups,
    now,
    true,
  );
  if (pools.length === 0) return null;
  return {
    email: meta.email ?? "",
    tier: meta.tier ?? "",
    updatedMs: now,
    pools,
    models: meta.models ?? [],
  };
}

/** Decode Google Cloud Code's `v1internal:fetchAvailableModels` response. */
export function parseAgyAvailableModels(body: unknown): AgyModelInfo[] {
  const root = rec(body);
  return root ? parseModelsCollection(root.models) : [];
}

/** Which pool a model draws from: Claude and GPT-OSS are the third-party pool, the rest Gemini. */
export function agyPoolKind(model: string): AgyPool["kind"] {
  return agyPoolKindForModel(model);
}

export interface AgySettingsModel {
  id: string;
  label: string;
  displayName: string;
  effortLevel?: string;
}

/**
 * Read the user's configured default Antigravity model from `<agyDir>/settings.json`, falling back
 * nicely when absent. Gives brand-new sessions an accurate model & effort before turn 1 lands.
 */
export function readAgySettingsModel(
  agyDir: string,
  models: AgyModelInfo[] = [],
): AgySettingsModel | null {
  try {
    const raw = JSON.parse(
      readFileSync(join(agyDir, "settings.json"), "utf8"),
    ) as unknown;
    const label = str(rec(raw)?.model).trim();
    if (!label) return null;
    const { displayName, effortLevel } = parseAgyModelDisplay(label);
    const lower = label.toLowerCase();
    const hit =
      models.find((m) => m.displayName.toLowerCase() === lower) ||
      models.find((m) => m.name.toLowerCase() === lower);
    const id =
      hit?.name ||
      label.toLowerCase().replace(/[()]/g, "").trim().replace(/\s+/g, "-");
    return { id, label, displayName, effortLevel };
  } catch {
    return null;
  }
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

/** Build the `aidev_client` User-Agent required for Cloud Code to include the Gemini Models pool. */
export function agyQuotaUserAgent(
  toolsDir?: string,
  platform: NodeJS.Platform = process.platform,
  arch: string = process.arch,
): string {
  let hubVersion = DEFAULT_HUB_VERSION;
  let hubCl = DEFAULT_HUB_CL;
  if (toolsDir) {
    try {
      const cfg = rec(
        JSON.parse(readFileSync(join(toolsDir, "gui_config.json"), "utf8")),
      );
      const proxy = rec(cfg?.proxy);
      const custom =
        str(proxy?.user_agent_override).trim() ||
        str(proxy?.saved_user_agent).trim();
      if (
        custom &&
        (custom.includes("aidev_client") || custom.includes("antigravity/hub/"))
      ) {
        return custom;
      }
      const ver = str(proxy?.hub_version).trim();
      const cl = str(proxy?.hub_cl).trim();
      if (ver) hubVersion = ver;
      if (cl) hubCl = cl;
    } catch {
      // absent or unreadable gui_config.json → built-in hub UA
    }
  }
  const osType =
    platform === "win32"
      ? "windows"
      : platform === "darwin"
        ? "darwin"
        : "linux";
  const cpuArch = arch === "arm64" ? "arm64" : "amd64";
  return `antigravity/hub/${hubVersion} (aidev_client; os_type=${osType}; arch=${cpuArch}; cl=${hubCl})`;
}

const safeMtimeMs = (path: string): number => {
  try {
    return statSync(path).mtimeMs;
  } catch {
    return 0;
  }
};

const credFingerprint = (seed: string): string =>
  createHash("sha256").update(seed).digest("hex").slice(0, 16);

function parseExpiryMs(v: unknown): number {
  const n = num(v);
  if (n !== null && n > 0) return n > 1e12 ? n : n * 1000;
  const s = str(v);
  if (!s) return 0;
  const parsed = Date.parse(s);
  return Number.isFinite(parsed) ? parsed : 0;
}

interface RawCredCandidate {
  email: string;
  tier: string;
  accessToken: string;
  refreshToken: string;
  expiresAtMs: number;
  projectId: string;
  clientId: string;
  clientSecret: string;
  mtimeMs: number;
}

function readToolsCandidate(toolsDir: string): RawCredCandidate | null {
  const indexPath = join(toolsDir, "accounts.json");
  try {
    const indexMtime = safeMtimeMs(indexPath);
    if (!indexMtime) return null;
    const index = rec(JSON.parse(readFileSync(indexPath, "utf8")));
    const id =
      str(index?.current_agy_account_id) || str(index?.current_account_id);
    if (!id) return null;
    const accPath = join(toolsDir, "accounts", `${id}.json`);
    const accMtime = safeMtimeMs(accPath);
    if (!accMtime) return null;
    const acc = rec(JSON.parse(readFileSync(accPath, "utf8")));
    const tok = rec(acc?.token);
    const quota = rec(acc?.quota);
    const accessToken = str(tok?.access_token);
    const refreshToken = str(tok?.refresh_token);
    if (!accessToken && !refreshToken) return null;
    return {
      email: str(acc?.email) || str(tok?.email),
      tier: str(quota?.subscription_tier) || str(quota?.subscriptionTier),
      accessToken,
      refreshToken,
      expiresAtMs: parseExpiryMs(tok?.expiry_timestamp ?? tok?.expiry),
      projectId: str(tok?.project_id),
      clientId: str(tok?.client_id) || extractJwtClientId(str(tok?.id_token)),
      clientSecret: str(tok?.client_secret),
      mtimeMs: Math.max(indexMtime, accMtime),
    };
  } catch {
    return null;
  }
}

function readStandaloneCandidate(agyDir: string): RawCredCandidate | null {
  const candidates = [
    join(dirname(agyDir), "jetski-standalone-oauth-token"),
    join(agyDir, "jetski-standalone-oauth-token"),
  ];
  for (const path of candidates) {
    const mtimeMs = safeMtimeMs(path);
    if (!mtimeMs) continue;
    try {
      const outer = rec(JSON.parse(readFileSync(path, "utf8")));
      if (!outer) continue;
      let tok = rec(outer.token);
      if (!tok && typeof outer.token === "string") {
        tok = rec(JSON.parse(outer.token));
      }
      const accessToken = str(tok?.access_token);
      const refreshToken = str(tok?.refresh_token);
      if (!accessToken && !refreshToken) continue;
      return {
        email: str(outer.id_token_email) || str(tok?.email),
        tier: "",
        accessToken,
        refreshToken,
        expiresAtMs: parseExpiryMs(tok?.expiry ?? tok?.expiry_timestamp),
        projectId: str(tok?.project_id),
        clientId:
          str(tok?.client_id) ||
          str(outer.client_id) ||
          extractJwtClientId(str(outer.id_token) || str(tok?.id_token)),
        clientSecret: str(tok?.client_secret) || str(outer.client_secret),
        mtimeMs,
      };
    } catch {
      continue;
    }
  }
  return null;
}

/** Read-only resolution of the OAuth credentials `agy` is currently signed in with. */
export function readAgyCredentials(
  toolsDir: string,
  agyDir: string,
): AgyCredentials | null {
  const tools = readToolsCandidate(toolsDir);
  const standalone = readStandaloneCandidate(agyDir);
  if (!tools && !standalone) return null;

  let chosen: RawCredCandidate;
  if (tools && standalone) {
    const sameEmail =
      !tools.email ||
      !standalone.email ||
      tools.email.toLowerCase() === standalone.email.toLowerCase();
    if (sameEmail) {
      const pickStandalone =
        standalone.expiresAtMs > tools.expiresAtMs &&
        Boolean(standalone.refreshToken || !tools.refreshToken);
      const primary = pickStandalone ? standalone : tools;
      const secondary = pickStandalone ? tools : standalone;
      chosen = {
        email: primary.email || secondary.email,
        tier: tools.tier || standalone.tier,
        accessToken: primary.accessToken || secondary.accessToken,
        refreshToken: primary.refreshToken || secondary.refreshToken,
        expiresAtMs: Math.max(primary.expiresAtMs, secondary.expiresAtMs),
        projectId: tools.projectId || standalone.projectId,
        clientId: primary.clientId || secondary.clientId,
        clientSecret: primary.clientSecret || secondary.clientSecret,
        mtimeMs: Math.max(tools.mtimeMs, standalone.mtimeMs),
      };
    } else {
      chosen = standalone.mtimeMs > tools.mtimeMs ? standalone : tools;
    }
  } else {
    chosen = (tools ?? standalone)!;
  }

  const seed = chosen.refreshToken || chosen.accessToken || chosen.email;
  if (!seed) return null;
  return {
    email: chosen.email,
    tier: chosen.tier,
    accessToken: chosen.accessToken,
    refreshToken: chosen.refreshToken,
    expiresAtMs: chosen.expiresAtMs,
    projectId: chosen.projectId,
    clientId: chosen.clientId,
    clientSecret: chosen.clientSecret,
    credHash: credFingerprint(seed),
  };
}

function parseRetryAfterMs(value: string | null, nowMs: number): number | null {
  if (!value) return null;
  const secs = Number(value);
  if (Number.isFinite(secs) && secs >= 0) return secs * 1000;
  const at = Date.parse(value);
  return Number.isNaN(at) ? null : Math.max(0, at - nowMs);
}

function hasExpiredWindow(quota: AgyQuota, nowMs: number): boolean {
  for (const pool of quota.pools) {
    if (pool.windows.fiveHour && pool.windows.fiveHour.resetsAt <= nowMs)
      return true;
    if (pool.windows.sevenDay && pool.windows.sevenDay.resetsAt <= nowMs)
      return true;
  }
  return false;
}

function hasGeminiPool(quota: AgyQuota): boolean {
  return quota.pools.some(
    (p) =>
      p.kind === "gemini" && Boolean(p.windows.fiveHour || p.windows.sevenDay),
  );
}

function reevaluateQuotaAt(quota: AgyQuota, nowMs: number): AgyQuota {
  return {
    ...quota,
    pools: quota.pools.map((p) => {
      const fiveHour = p.windows.fiveHour
        ? {
            ...p.windows.fiveHour,
            usedPct:
              p.windows.fiveHour.resetsAt <= nowMs
                ? 0
                : p.windows.fiveHour.usedPct,
          }
        : undefined;
      const sevenDay = p.windows.sevenDay
        ? {
            ...p.windows.sevenDay,
            usedPct:
              p.windows.sevenDay.resetsAt <= nowMs
                ? 0
                : p.windows.sevenDay.usedPct,
          }
        : undefined;
      return {
        kind: p.kind,
        windows: {
          ...(fiveHour ? { fiveHour } : {}),
          ...(sevenDay ? { sevenDay } : {}),
        },
      };
    }),
  };
}

export interface AgyQuotaReader {
  read(): AgyQuota | null;
  readOverview?(): AgyQuotaOverview | null;
}

export interface AgyQuotaReaderDeps {
  toolsDir?: string;
  agyDir?: string;
  /** Narrow fetch surface (`net.fetch.bind(net)` in prod). When omitted, reads Tools disk file only. */
  fetchFn?: (url: string, init?: RequestInit) => Promise<Response>;
  /** `<userData>/agy-quota-cache.json` in prod; persists parsed quota only (never OAuth tokens). */
  cachePath?: string;
  /** Optional explicit OAuth client pairs for testing/overrides; otherwise discovered at runtime. */
  oauthClients?: AgyOAuthClient[];
  /** Override `agy` binary path for OAuth client discovery (pass `null` in unit tests). */
  agyBinPath?: string | null;
  now?: () => number;
  platform?: NodeJS.Platform;
  arch?: string;
}

interface PersistedQuotaCache {
  quota: AgyQuota;
  fetchedAt: number;
  modelsFetchedAt: number;
  credHash: string;
}

/**
 * Reads and actively maintains the Antigravity quota for the signed-in `agy` account.
 * `read()` stays synchronous so `overviewNow()` never blocks on IPC or network I/O; stale or
 * reset-elapsed windows kick off a single-flight background refresh picked up on the next poll.
 */
export function createAgyQuotaReader(
  deps: AgyQuotaReaderDeps = {},
): AgyQuotaReader {
  const toolsDir = deps.toolsDir ?? resolveAgyToolsDir();
  const agyDir = deps.agyDir ?? resolveAgyDir();
  const now = deps.now ?? (() => Date.now());

  let toolsCache: { path: string; mtimeMs: number; raw: unknown } | null = null;
  let credCache: { sig: string; cred: AgyCredentials | null } | null = null;
  let live: PersistedQuotaCache | null = null;
  let memToken: {
    credHash: string;
    accessToken: string;
    expiresAtMs: number;
  } | null = null;
  let backoffUntil = 0;
  let inflight: Promise<void> | null = null;

  if (deps.cachePath) {
    try {
      const parsed = rec(JSON.parse(readFileSync(deps.cachePath, "utf8")));
      const q = rec(parsed?.quota);
      const fetchedAt = num(parsed?.fetchedAt);
      const modelsFetchedAt = num(parsed?.modelsFetchedAt) ?? 0;
      const credHash = str(parsed?.credHash);
      if (q && fetchedAt && credHash && Array.isArray(q.pools)) {
        live = {
          quota: q as unknown as AgyQuota,
          fetchedAt,
          modelsFetchedAt,
          credHash,
        };
      }
    } catch {
      // absent or corrupt cache file → rebuilt on first refresh
    }
  }

  const persist = (): void => {
    if (!deps.cachePath || !live) return;
    try {
      writeFileSync(deps.cachePath, JSON.stringify(live));
    } catch {
      // unwritable cache → memory-only operation
    }
  };

  const currentAccountPath = (): string | null => {
    try {
      const index = rec(
        JSON.parse(readFileSync(join(toolsDir, "accounts.json"), "utf8")),
      );
      const id =
        str(index?.current_agy_account_id) || str(index?.current_account_id);
      return id ? join(toolsDir, "accounts", `${id}.json`) : null;
    } catch {
      return null;
    }
  };

  const readToolsQuota = (nowMs: number): AgyQuota | null => {
    const path = currentAccountPath();
    if (!path) return null;
    try {
      const mtimeMs = statSync(path).mtimeMs;
      if (
        !toolsCache ||
        toolsCache.path !== path ||
        toolsCache.mtimeMs !== mtimeMs
      ) {
        toolsCache = {
          path,
          mtimeMs,
          raw: JSON.parse(readFileSync(path, "utf8")),
        };
      }
    } catch {
      return null;
    }
    return parseAgyQuota(toolsCache.raw, nowMs);
  };

  const readCachedCredentials = (): AgyCredentials | null => {
    const idxPath = join(toolsDir, "accounts.json");
    const accPath = currentAccountPath();
    const jetParent = join(dirname(agyDir), "jetski-standalone-oauth-token");
    const jetDirect = join(agyDir, "jetski-standalone-oauth-token");
    const sig = `${safeMtimeMs(idxPath)}:${accPath ? safeMtimeMs(accPath) : 0}:${safeMtimeMs(jetParent)}:${safeMtimeMs(jetDirect)}`;
    if (credCache && credCache.sig === sig) return credCache.cred;
    const cred = readAgyCredentials(toolsDir, agyDir);
    credCache = { sig, cred };
    return cred;
  };

  const obtainAccessToken = async (
    cred: AgyCredentials,
    forceRefresh: boolean,
  ): Promise<{ token: string; refreshed: boolean } | null> => {
    const fetchFn = deps.fetchFn;
    if (!fetchFn) return null;
    const t = now();
    if (!forceRefresh) {
      if (
        memToken &&
        memToken.credHash === cred.credHash &&
        memToken.expiresAtMs - t > TOKEN_EXPIRY_SKEW_MS
      ) {
        return { token: memToken.accessToken, refreshed: false };
      }
      if (cred.accessToken && cred.expiresAtMs - t > TOKEN_EXPIRY_SKEW_MS) {
        memToken = {
          credHash: cred.credHash,
          accessToken: cred.accessToken,
          expiresAtMs: cred.expiresAtMs,
        };
        return { token: cred.accessToken, refreshed: false };
      }
      if (!cred.refreshToken && cred.accessToken) {
        return { token: cred.accessToken, refreshed: false };
      }
    }
    if (!cred.refreshToken) return null;

    const seenPairs = new Set<string>();
    const collectPairs = (
      target: AgyOAuthClient[],
      clientId: string,
      clientSecret: string,
    ): void => {
      if (!clientId || !clientSecret) return;
      const key = `${clientId}\0${clientSecret}`;
      if (seenPairs.has(key)) return;
      seenPairs.add(key);
      target.push({ clientId, clientSecret });
    };

    const tryPairs = async (
      pairs: AgyOAuthClient[],
    ): Promise<{ token: string; refreshed: boolean } | "network-error" | null> => {
      for (const client of pairs) {
        let res: Response;
        try {
          res = await fetchFn(OAUTH_TOKEN_URL, {
            method: "POST",
            headers: { "Content-Type": "application/x-www-form-urlencoded" },
            body: new URLSearchParams({
              client_id: client.clientId,
              client_secret: client.clientSecret,
              refresh_token: cred.refreshToken,
              grant_type: "refresh_token",
            }).toString(),
            signal: AbortSignal.timeout(AGY_TIMEOUT_MS),
          });
        } catch {
          return "network-error";
        }
        if (res.status === 400 || res.status === 401) {
          if (resolvedClientById.get(client.clientId) === client.clientSecret) {
            resolvedClientById.delete(client.clientId);
          }
          continue;
        }
        if (!res.ok) return null;
        let body: unknown;
        try {
          body = await res.json();
        } catch {
          return null;
        }
        const parsed = rec(body);
        const accessToken = str(parsed?.access_token);
        if (!accessToken) return null;
        resolvedClientById.set(client.clientId, client.clientSecret);
        const expiresIn = num(parsed?.expires_in) ?? 3600;
        memToken = {
          credHash: cred.credHash,
          accessToken,
          expiresAtMs: now() + expiresIn * 1000,
        };
        return { token: accessToken, refreshed: true };
      }
      return null;
    };

    const fastPairs: AgyOAuthClient[] = [];
    if (cred.clientId && cred.clientSecret) {
      collectPairs(fastPairs, cred.clientId, cred.clientSecret);
    }
    if (process.env.CBW_AGY_CLIENT_ID && process.env.CBW_AGY_CLIENT_SECRET) {
      collectPairs(
        fastPairs,
        process.env.CBW_AGY_CLIENT_ID,
        process.env.CBW_AGY_CLIENT_SECRET,
      );
    }
    const injected = deps.oauthClients ?? [];
    if (cred.clientId) {
      for (const c of injected) {
        if (c.clientId === cred.clientId) {
          collectPairs(fastPairs, c.clientId, c.clientSecret);
        }
      }
      const cachedSecret = resolvedClientById.get(cred.clientId);
      if (cachedSecret) collectPairs(fastPairs, cred.clientId, cachedSecret);
    }
    for (const c of injected) {
      collectPairs(fastPairs, c.clientId, c.clientSecret);
    }

    const fastOutcome = await tryPairs(fastPairs);
    if (fastOutcome === "network-error") return null;
    if (fastOutcome) return fastOutcome;
    if (deps.oauthClients) return null;

    const binPath = resolveAgyBinaryPath(
      deps.agyBinPath,
      process.env,
      deps.platform,
    );
    if (!binPath) return null;
    const { ids, secrets } = await discoverBinaryOAuthCandidates(binPath);
    const orderedIds = cred.clientId
      ? [cred.clientId, ...ids.filter((id) => id !== cred.clientId)]
      : ids;
    const binaryPairs: AgyOAuthClient[] = [];
    for (const id of orderedIds) {
      const cached = resolvedClientById.get(id);
      if (cached) collectPairs(binaryPairs, id, cached);
      for (const sec of secrets) collectPairs(binaryPairs, id, sec);
    }
    const binaryOutcome = await tryPairs(binaryPairs);
    return binaryOutcome && binaryOutcome !== "network-error"
      ? binaryOutcome
      : null;
  };

  type SummaryOutcome =
    | { kind: "ok"; base: string; quota: AgyQuota }
    | { kind: "unauthorized" }
    | { kind: "rate_limited"; backoffMs: number }
    | { kind: "failed" };

  const fetchSummaryWithToken = async (
    accessToken: string,
    cred: AgyCredentials,
    ua: string,
  ): Promise<SummaryOutcome> => {
    const fetchFn = deps.fetchFn!;
    const reqBody = JSON.stringify(
      cred.projectId ? { project: cred.projectId } : {},
    );
    let fallbackHit: { base: string; quota: AgyQuota } | null = null;
    for (const base of CLOUD_CODE_BASES) {
      let res: Response;
      try {
        res = await fetchFn(`${base}/v1internal:retrieveUserQuotaSummary`, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${accessToken}`,
            "Content-Type": "application/json",
            "User-Agent": ua,
          },
          body: reqBody,
          signal: AbortSignal.timeout(AGY_TIMEOUT_MS),
        });
      } catch {
        continue;
      }
      if (res.status === 401) return { kind: "unauthorized" };
      if (res.status === 429) {
        const retryMs =
          parseRetryAfterMs(res.headers.get("retry-after"), now()) ??
          AGY_RATE_LIMIT_BACKOFF_MS;
        return { kind: "rate_limited", backoffMs: retryMs };
      }
      if (!res.ok) continue;
      let json: unknown;
      try {
        json = await res.json();
      } catch {
        continue;
      }
      const parsed = parseAgyQuotaSummary(
        json,
        { email: cred.email, tier: cred.tier },
        now(),
      );
      if (!parsed) continue;
      if (hasGeminiPool(parsed)) return { kind: "ok", base, quota: parsed };
      fallbackHit ??= { base, quota: parsed };
    }
    return fallbackHit ? { kind: "ok", ...fallbackHit } : { kind: "failed" };
  };

  const refresh = async (cred: AgyCredentials): Promise<void> => {
    const fetchFn = deps.fetchFn;
    if (!fetchFn) return;
    const ua = agyQuotaUserAgent(toolsDir, deps.platform, deps.arch);

    const auth = await obtainAccessToken(cred, false);
    if (!auth) {
      backoffUntil = now() + AGY_ERROR_BACKOFF_MS;
      return;
    }

    let activeToken = auth.token;
    let outcome = await fetchSummaryWithToken(activeToken, cred, ua);
    if (
      outcome.kind === "unauthorized" &&
      !auth.refreshed &&
      cred.refreshToken
    ) {
      memToken = null;
      const retryAuth = await obtainAccessToken(cred, true);
      if (retryAuth) {
        activeToken = retryAuth.token;
        outcome = await fetchSummaryWithToken(activeToken, cred, ua);
      }
    }

    if (outcome.kind === "rate_limited") {
      backoffUntil = now() + outcome.backoffMs;
      return;
    }
    if (outcome.kind !== "ok") {
      backoffUntil = now() + AGY_ERROR_BACKOFF_MS;
      return;
    }

    const prevModels =
      live && live.credHash === cred.credHash ? live.quota.models : [];
    let models = prevModels;
    let modelsFetchedAt =
      live && live.credHash === cred.credHash ? live.modelsFetchedAt : 0;

    if (models.length === 0 || now() - modelsFetchedAt >= AGY_MODELS_TTL_MS) {
      try {
        const mRes = await fetchFn(
          `${outcome.base}/v1internal:fetchAvailableModels`,
          {
            method: "POST",
            headers: {
              Authorization: `Bearer ${activeToken}`,
              "Content-Type": "application/json",
              "User-Agent": ua,
            },
            body: JSON.stringify(
              cred.projectId ? { project: cred.projectId } : {},
            ),
            signal: AbortSignal.timeout(AGY_TIMEOUT_MS),
          },
        );
        if (mRes.ok) {
          const parsedModels = parseAgyAvailableModels(await mRes.json());
          if (parsedModels.length > 0) {
            models = parsedModels;
            modelsFetchedAt = now();
          }
        }
      } catch {
        // model list fetch is non-fatal — existing models or family fallbacks stand in
      }
    }

    const fetchedAt = now();
    live = {
      quota: {
        ...outcome.quota,
        updatedMs: fetchedAt,
        models,
      },
      fetchedAt,
      modelsFetchedAt,
      credHash: cred.credHash,
    };
    backoffUntil = 0;
    persist();
  };

  const parsePools = (
    q: AgyQuota | null,
  ): Pick<AgyAccountQuota, "gemini" | "thirdParty"> => {
    const gem = q?.pools.find((p) => p.kind === "gemini")?.windows ?? {};
    const third = q?.pools.find((p) => p.kind === "third-party")?.windows ?? {};
    return {
      gemini: { fiveHour: gem.fiveHour, sevenDay: gem.sevenDay },
      thirdParty: { fiveHour: third.fiveHour, sevenDay: third.sevenDay },
    };
  };

  const overviewFileCache = new Map<
    string,
    { mtimeMs: number; raw: unknown }
  >();
  const readJsonCached = (path: string): unknown => {
    try {
      const mtimeMs = statSync(path).mtimeMs;
      const hit = overviewFileCache.get(path);
      if (!hit || hit.mtimeMs !== mtimeMs) {
        const entry = {
          mtimeMs,
          raw: JSON.parse(readFileSync(path, "utf8")) as unknown,
        };
        overviewFileCache.set(path, entry);
        return entry.raw;
      }
      return hit.raw;
    } catch {
      return null;
    }
  };

  const read = (): AgyQuota | null => {
    const t = now();
    const toolsQuota = readToolsQuota(t);
    if (!deps.fetchFn) return toolsQuota;

    const cred = readCachedCredentials();
    if (cred && live && live.credHash !== cred.credHash) {
      live = null;
    }

    const fresh =
      live !== null &&
      t - live.fetchedAt < AGY_QUOTA_TTL_MS &&
      !hasExpiredWindow(live.quota, t) &&
      hasGeminiPool(live.quota);

    if (!fresh && cred && !inflight && t >= backoffUntil) {
      inflight = refresh(cred).finally(() => {
        inflight = null;
      });
    }

    if (live) {
      const evaluated = reevaluateQuotaAt(live.quota, t);
      return {
        ...evaluated,
        email: evaluated.email || cred?.email || toolsQuota?.email || "",
        tier: evaluated.tier || cred?.tier || toolsQuota?.tier || "",
        models:
          evaluated.models.length > 0
            ? evaluated.models
            : (toolsQuota?.models ?? []),
      };
    }

    if (
      toolsQuota &&
      (!cred?.email ||
        !toolsQuota.email ||
        toolsQuota.email.toLowerCase() === cred.email.toLowerCase())
    ) {
      return toolsQuota;
    }
    return null;
  };

  return {
    read,
    readOverview: (): AgyQuotaOverview | null => {
      const liveQuota = read();
      const t = now();
      const index = rec(readJsonCached(join(toolsDir, "accounts.json")));
      const accounts: AgyAccountQuota[] = [];
      let matchedLive = false;

      if (index) {
        const curId =
          str(index.current_agy_account_id) || str(index.current_account_id);
        const ids: string[] = [];
        for (const entry of arr(index.accounts)) {
          const id = str(rec(entry)?.id);
          if (id && !ids.includes(id)) ids.push(id);
        }
        if (curId && !ids.includes(curId)) ids.unshift(curId);

        for (const id of ids) {
          const raw = readJsonCached(join(toolsDir, "accounts", `${id}.json`));
          const rawRec = rec(raw);
          if (!rawRec) continue;
          if (rawRec.banned === true || rawRec.disabled === true) continue;
          const diskParsed = parseAgyQuota(raw, t);
          const diskEmail = diskParsed?.email || str(rawRec.email) || "";
          const isCurrent = id === curId;

          let quota = diskParsed;
          if (liveQuota) {
            const sameEmail =
              Boolean(liveQuota.email) &&
              Boolean(diskEmail) &&
              liveQuota.email.toLowerCase() === diskEmail.toLowerCase();
            const matchCurrent =
              isCurrent && (!liveQuota.email || !diskEmail || sameEmail);
            if (sameEmail || matchCurrent) {
              matchedLive = true;
              if (
                liveQuota.updatedMs > (diskParsed?.updatedMs ?? 0) ||
                !diskParsed ||
                hasExpiredWindow(diskParsed, t)
              ) {
                quota = liveQuota;
              }
            }
          }
          if (!quota) continue;
          accounts.push({
            id,
            email: quota.email || diskEmail || id,
            n: accounts.length + 1,
            current: isCurrent,
            tier: quota.tier || diskParsed?.tier || null,
            ...parsePools(quota),
            ...(quota.updatedMs > 0 ? { seenAt: quota.updatedMs } : {}),
          });
        }
      }

      if (!matchedLive && liveQuota && liveQuota.pools.length > 0) {
        for (const a of accounts) a.current = false;
        accounts.unshift({
          id: liveQuota.email || "standalone",
          email: liveQuota.email || "Antigravity",
          n: 1,
          current: true,
          tier: liveQuota.tier || null,
          ...parsePools(liveQuota),
          ...(liveQuota.updatedMs > 0 ? { seenAt: liveQuota.updatedMs } : {}),
        });
        accounts.forEach((a, idx) => {
          a.n = idx + 1;
        });
      }

      return accounts.length > 0 ? { accounts } : null;
    },
  };
}
