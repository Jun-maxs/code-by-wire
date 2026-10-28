import { useState } from "react";
import { normalizeAi, type AiTestResult, type BoardAi } from "@shared/board";
import { cx } from "../ui/atoms";
import { Icon } from "../ui/icons";
import { useBoardCtx } from "./context";
import { btn, input } from "./parts";

/** Starting points for the OpenAI-compatible fields: one click fills address and a model. */
const PRESETS: { label: string; baseUrl: string; model: string }[] = [
  {
    label: "Ollama",
    baseUrl: "http://127.0.0.1:11434/v1",
    model: "qwen2.5:7b",
  },
  { label: "LM Studio", baseUrl: "http://127.0.0.1:1234/v1", model: "" },
  {
    label: "DeepSeek",
    baseUrl: "https://api.deepseek.com/v1",
    model: "deepseek-chat",
  },
];

const CLAUDE_MODELS = ["haiku", "sonnet", "opus"];

/**
 * Where the insight's model lives: the Claude CLI (rec, the default) or any OpenAI-compatible
 * endpoint. Edits are a draft until saved; "Test" sends a one-line prompt through the draft, so a
 * wrong address never replaces a working one.
 */
export function AiSettings() {
  const { doc, s, update } = useBoardCtx();
  const [draft, setDraft] = useState<BoardAi>(doc.ai);
  const [testing, setTesting] = useState(false);
  const [result, setResult] = useState<AiTestResult | null>(null);
  const [showKey, setShowKey] = useState(false);
  const dirty = JSON.stringify(normalizeAi(draft)) !== JSON.stringify(doc.ai);
  const set = (patch: Partial<BoardAi>) => {
    setDraft((d) => ({ ...d, ...patch }));
    setResult(null);
  };

  return (
    <div className="flex flex-col gap-2.5">
      <p className="text-meta font-medium text-fg-faint">{s.aiTitle}</p>
      <div className="flex rounded-md border border-(--ui-stroke-tertiary) p-[2px]">
        {(["claude", "openai"] as const).map((p) => (
          <button
            key={p}
            type="button"
            aria-pressed={draft.provider === p}
            onClick={() => set({ provider: p })}
            className={cx(
              "h-6 flex-1 rounded-sm text-aux transition-colors duration-100",
              draft.provider === p
                ? "bg-(--ui-control-active-background) font-medium text-fg"
                : "text-fg-faint hover:text-fg",
            )}
          >
            {p === "claude" ? s.aiClaude : s.aiOpenai}
          </button>
        ))}
      </div>

      {draft.provider === "claude" ? (
        <label className="flex flex-col gap-1 text-aux text-fg-muted">
          {s.aiModel}
          <div className="flex gap-1">
            {CLAUDE_MODELS.map((m) => (
              <button
                key={m}
                type="button"
                aria-pressed={draft.claudeModel === m}
                onClick={() => set({ claudeModel: m })}
                className={cx(
                  "h-7 flex-1 rounded-md border font-mono text-aux transition-colors duration-100",
                  draft.claudeModel === m
                    ? "border-(--ui-stroke-primary) bg-(--ui-control-active-background) text-fg"
                    : "border-(--ui-stroke-tertiary) text-fg-faint hover:text-fg",
                )}
              >
                {m}
              </button>
            ))}
          </div>
          <span className="text-meta text-fg-faint">{s.aiClaudeHint}</span>
        </label>
      ) : (
        <>
          <div className="flex flex-wrap gap-1">
            {PRESETS.map((p) => (
              <button
                key={p.label}
                type="button"
                onClick={() =>
                  set({ baseUrl: p.baseUrl, model: p.model || draft.model })
                }
                className="h-6 rounded-sm border border-(--ui-stroke-tertiary) px-2 text-meta text-fg-faint hover:text-fg"
              >
                {p.label}
              </button>
            ))}
          </div>
          <label className="flex flex-col gap-1 text-aux text-fg-muted">
            {s.aiBaseUrl}
            <input
              value={draft.baseUrl}
              placeholder="http://127.0.0.1:11434/v1"
              onChange={(e) => set({ baseUrl: e.target.value })}
              className={cx(input, "font-mono")}
            />
          </label>
          <label className="flex flex-col gap-1 text-aux text-fg-muted">
            {s.aiKey}
            <div className="flex gap-1">
              <input
                type={showKey ? "text" : "password"}
                value={draft.apiKey}
                placeholder={s.aiKeyHint}
                onChange={(e) => set({ apiKey: e.target.value })}
                className={cx(input, "font-mono")}
              />
              <button
                type="button"
                aria-label={showKey ? "hide" : "show"}
                onClick={() => setShowKey((v) => !v)}
                className={btn.ghost}
              >
                <Icon name={showKey ? "eye-off" : "eye"} size={13} />
              </button>
            </div>
          </label>
          <label className="flex flex-col gap-1 text-aux text-fg-muted">
            {s.aiModel}
            <input
              value={draft.model}
              placeholder="qwen2.5:7b"
              onChange={(e) => set({ model: e.target.value })}
              className={cx(input, "font-mono")}
            />
          </label>
        </>
      )}

      {result && (
        <p
          className={cx(
            "rounded-md border px-2 py-1.5 text-meta",
            result.ok
              ? "border-ok/40 bg-ok/8 text-ok"
              : "border-danger/40 bg-danger/8 text-danger",
          )}
        >
          {result.ok ? s.aiTestOk(result.ms) : s.aiTestFail(result.message)}
        </p>
      )}
      <div className="flex justify-end gap-1.5">
        <button
          type="button"
          disabled={testing}
          onClick={() => {
            setTesting(true);
            setResult(null);
            void window.api
              .testBoardAi(normalizeAi(draft))
              .then(setResult)
              .finally(() => setTesting(false));
          }}
          className={btn.outline}
        >
          <Icon
            name={testing ? "loader-circle" : "zap"}
            size={13}
            className={testing ? "animate-spin" : ""}
          />
          {s.aiTest}
        </button>
        <button
          type="button"
          disabled={!dirty}
          onClick={() => update((d) => ({ ...d, ai: normalizeAi(draft) }))}
          className={btn.primary}
        >
          {dirty ? s.aiSave : s.aiSaved}
        </button>
      </div>
    </div>
  );
}
