import { normalizeModelId } from "@shared/models";
import {
  firstTranscriptCwd,
  parseTranscript,
  type TranscriptSummary,
} from "../claude/transcript";

/** Qoder CLI's default context window (1M tokens in runtime-config / settings.json). */
export const QODER_DEFAULT_CONTEXT_WINDOW = 1_000_000;

const QODER_MODEL_LABELS: Record<string, string> = {
  auto: "Auto",
  fast: "Fast",
  ultimate: "Ultimate",
  performance: "Performance",
  efficient: "Efficient",
  lite: "Lite",
  qmodel: "QModel",
  qmodel_latest: "QModel Latest",
  qfmodel: "QFModel",
  q35model: "Q3.5 Model",
  gmodel: "GModel",
  kmodel: "KModel",
  mmodel: "MModel",
};

/** Human-readable display label for Qoder's tier aliases and model keys. */
export function formatQoderModelLabel(
  raw: string | undefined,
): string | undefined {
  const trimmed = raw?.trim();
  if (!trimmed || trimmed === "<synthetic>") return undefined;
  const bare = trimmed.replace(/^qoder\//i, "");
  return QODER_MODEL_LABELS[bare.toLowerCase()] ?? bare;
}

export interface QoderTranscriptSummary extends TranscriptSummary {
  /** Whether the transcript has recorded at least one user or assistant message. */
  hasTurns: boolean;
  /** Effective context window in tokens (`runtime-config.contextWindow` or 1M default). */
  contextWindow: number;
  /** Display name for non-Claude model keys (`Auto`, `QModel Latest`, `Qwen4-Max-Preview`, …). */
  modelDisplayName?: string;
}

export { firstTranscriptCwd as firstQoderCwd };

/**
 * Summarize a Qoder CLI JSONL transcript by layering Qoder's preamble/metadata rows
 * (`workspace-directories`, `runtime-config`, `ai-title`, numeric timestamps, `businessModelKey`)
 * onto the shared Claude-compatible transcript parser.
 */
export function summarizeQoderTranscript(
  jsonl: string,
  fallbackCwd = "",
): QoderTranscriptSummary {
  let workspaceCwd = "";
  let hasTurns = false;
  let hasCustomTitle = false;
  let aiTitle: string | undefined;
  let minNumTs = 0;
  let maxNumTs = 0;
  let runtimeModel: string | undefined;
  let runtimeEffort: string | undefined;
  let runtimeWindow: number | undefined;
  let businessModel: string | undefined;

  for (const line of jsonl.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    let parsed: unknown;
    try {
      parsed = JSON.parse(trimmed);
    } catch {
      continue;
    }
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed))
      continue;
    const row = parsed as Record<string, unknown>;
    const type = typeof row.type === "string" ? row.type : "";

    if (
      !workspaceCwd &&
      type === "workspace-directories" &&
      Array.isArray(row.directories) &&
      typeof row.directories[0] === "string" &&
      row.directories[0]
    ) {
      workspaceCwd = row.directories[0];
    }

    if (type === "user" || type === "assistant") {
      hasTurns = true;
    }

    if (
      type === "custom-title" &&
      typeof row.customTitle === "string" &&
      row.customTitle.trim()
    ) {
      hasCustomTitle = true;
    }

    if (
      type === "ai-title" &&
      typeof row.aiTitle === "string" &&
      row.aiTitle.trim()
    ) {
      aiTitle = row.aiTitle.trim();
    }

    if (
      typeof row.timestamp === "number" &&
      Number.isFinite(row.timestamp) &&
      row.timestamp > 0
    ) {
      if (minNumTs === 0 || row.timestamp < minNumTs) minNumTs = row.timestamp;
      if (row.timestamp > maxNumTs) maxNumTs = row.timestamp;
    }

    if (type === "runtime-config") {
      if (typeof row.model === "string" && row.model.trim()) {
        runtimeModel = row.model.trim();
      }
      if (
        typeof row.reasoningEffort === "string" &&
        row.reasoningEffort.trim()
      ) {
        runtimeEffort = row.reasoningEffort.trim();
      }
      if (
        typeof row.contextWindow === "number" &&
        Number.isFinite(row.contextWindow) &&
        row.contextWindow > 0
      ) {
        runtimeWindow = row.contextWindow;
      }
    }

    if (
      typeof row.businessModelKey === "string" &&
      row.businessModelKey.trim()
    ) {
      businessModel = row.businessModelKey.trim();
    }
  }

  const effectiveFallbackCwd = workspaceCwd || fallbackCwd;
  const base = parseTranscript(jsonl, effectiveFallbackCwd);

  const assistantModel = base.modelRaw?.trim() || undefined;
  // Qoder assistant rows often report `"auto"` even when `runtime-config` or `businessModelKey`
  // names a concrete tier/model (`qmodel_latest`, `ultimate`, `Qwen4-Max-Preview`). Prefer a
  // specific key over `"auto"`, falling back to `"auto"` when that is all the session recorded.
  const specificModel = [assistantModel, runtimeModel, businessModel].find(
    (m) => m !== undefined && m.toLowerCase() !== "auto" && m !== "<synthetic>",
  );
  const modelRaw = [
    specificModel,
    assistantModel,
    runtimeModel,
    businessModel,
  ].find((m) => m !== undefined && m !== "<synthetic>");

  const createdMs =
    base.createdMs > 0 && minNumTs > 0
      ? Math.min(base.createdMs, minNumTs)
      : base.createdMs || minNumTs;
  const lastActivityMs = Math.max(base.lastActivityMs, maxNumTs);

  // Title precedence: explicit `/rename` (`custom-title`) -> Qoder's `ai-title` -> first user prompt / project.
  const title = !hasCustomTitle && aiTitle ? aiTitle : base.title;

  return {
    ...base,
    title,
    originCwd: base.originCwd || effectiveFallbackCwd,
    model: normalizeModelId(modelRaw),
    modelRaw,
    modelDisplayName: formatQoderModelLabel(modelRaw),
    effortLevel: base.effortLevel ?? runtimeEffort,
    createdMs,
    lastActivityMs,
    hasTurns,
    contextWindow: runtimeWindow ?? QODER_DEFAULT_CONTEXT_WINDOW,
  };
}
