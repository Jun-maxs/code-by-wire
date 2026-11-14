import type { RateLimit } from "./types";

/**
 * Antigravity Tools' quota pools (`~/.antigravity_tools/accounts/*.json`): Gemini models vs
 * third-party models (Claude / GPT-OSS), shared across the right sidebar's quota block and
 * the Pressure panel's fallback rate bars.
 */
export type AgyPoolKind = "gemini" | "third-party";

export interface AgyPoolQuota {
  fiveHour?: RateLimit;
  sevenDay?: RateLimit;
}

export interface AgyAccountQuota {
  id: string;
  email: string;
  /** 1-based badge number in account order. */
  n: number;
  current: boolean;
  tier: string | null;
  gemini: AgyPoolQuota;
  thirdParty: AgyPoolQuota;
  seenAt?: number;
}

export interface AgyQuotaOverview {
  accounts: AgyAccountQuota[];
}

export function agyPoolQuota(
  account: AgyAccountQuota,
  pool: AgyPoolKind,
): AgyPoolQuota {
  return pool === "third-party" ? account.thirdParty : account.gemini;
}

/** Which pool an Antigravity model draws from: Claude and GPT-OSS use the third-party pool; the rest use Gemini. */
export function agyPoolKindForModel(model: string): AgyPoolKind {
  return /claude|gpt/i.test(model) ? "third-party" : "gemini";
}

const EFFORT_SUFFIX_RE = /^(.*?)\s*\((low|medium|high|xhigh|max)\)\s*$/i;

/**
 * Split an Antigravity CLI display string like `"Gemini 4 Hydrogen (XHigh)"` into its model name
 * (`"Gemini 4 Hydrogen"`) and normalized effort (`"xhigh"`). Non-effort tags such as
 * `"Claude Sonnet 4.6 (Thinking)"` remain intact in `displayName`.
 */
export function parseAgyModelDisplay(raw: string): {
  displayName: string;
  effortLevel?: string;
} {
  const trimmed = raw.trim();
  const match = EFFORT_SUFFIX_RE.exec(trimmed);
  if (!match) return { displayName: trimmed };
  const base = match[1].trim();
  return {
    displayName: base || trimmed,
    effortLevel: match[2].toLowerCase(),
  };
}
