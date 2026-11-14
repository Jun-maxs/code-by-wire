import { useEffect, useState, type Dispatch, type SetStateAction } from "react";
import type { Session } from "@shared/types";
import type { WaitingPrompt } from "@shared/transcript";
import type { WorkQuestionAnswer } from "@shared/terminal";
import { AGENTS } from "@shared/agents";
import { useI18n } from "../i18n";
import { cx } from "../ui/atoms";
import { Icon } from "../ui/icons";
import { noteTerminalInput } from "../terminal/input-activity";
import { WorkIdentityBar } from "./WorkIdentityBar";

interface QuestionDraft {
  selected: number[];
  customOpen: boolean;
  customText: string;
}

const RECOMMENDED_RE = /\s*[（(]\s*(?:推荐|Recommended)\s*[)）]\s*/i;

function splitRecommendedLabel(raw: string): {
  label: string;
  recommended: boolean;
} {
  if (!RECOMMENDED_RE.test(raw)) return { label: raw, recommended: false };
  const cleaned = raw.replace(RECOMMENDED_RE, " ").trim();
  return { label: cleaned || raw, recommended: true };
}

export function WorkWaitingCard({
  session,
  prompt,
  canSpawn,
  onFork,
}: {
  session: Session;
  prompt: WaitingPrompt;
  canSpawn: boolean;
  onFork: (session: Session) => Promise<void>;
}) {
  const { t } = useI18n();
  const isManaged =
    session.management === "managed" && session.state !== "ended";
  const canFork = AGENTS[session.agent].capabilities.canFork && canSpawn;

  const [qIdx, setQIdx] = useState(0);
  const [drafts, setDrafts] = useState<QuestionDraft[]>([]);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  const promptKey =
    prompt.kind === "question"
      ? `q:${prompt.toolUseId}:${prompt.questions.length}`
      : `p:${prompt.toolUseId}:${prompt.summary}`;

  useEffect(() => {
    setQIdx(0);
    setBusy(false);
    setNotice(null);
    if (prompt.kind === "question") {
      setDrafts(
        prompt.questions.map(() => ({
          selected: [],
          customOpen: false,
          customText: "",
        })),
      );
    } else {
      setDrafts([]);
    }
  }, [promptKey, prompt]);

  async function submitPermission(
    decision: "allow" | "allow-session" | "deny",
  ): Promise<void> {
    if (busy || !isManaged || prompt.kind !== "permission") return;
    setBusy(true);
    setNotice(null);
    try {
      noteTerminalInput(session.id);
      const res = await window.api.terminal.dispatchWork({
        id: session.id,
        action: {
          kind: "permission",
          toolUseId: prompt.toolUseId,
          decision,
        },
      });
      if (!res.ok) {
        setNotice(
          res.reason === "stale"
            ? t.workView.waiting.staleNotice
            : t.workView.composer.sendFailed,
        );
      }
    } finally {
      setBusy(false);
    }
  }

  async function submitQuestionAnswers(
    nextDrafts: QuestionDraft[],
  ): Promise<void> {
    if (busy || !isManaged || prompt.kind !== "question") return;
    const answers: WorkQuestionAnswer[] = prompt.questions.map((q, i) => {
      const d = nextDrafts[i] ?? {
        selected: [],
        customOpen: false,
        customText: "",
      };
      const custom = d.customOpen ? d.customText.trim() : "";
      return {
        selectedIndices: custom ? [] : d.selected,
        optionCount: q.options.length,
        multiSelect: q.multiSelect,
        customText: custom || undefined,
      };
    });
    setBusy(true);
    setNotice(null);
    try {
      noteTerminalInput(session.id);
      const res = await window.api.terminal.dispatchWork({
        id: session.id,
        action: {
          kind: "question",
          toolUseId: prompt.toolUseId,
          answers,
        },
      });
      if (!res.ok) {
        setNotice(
          res.reason === "stale"
            ? t.workView.waiting.staleNotice
            : t.workView.composer.sendFailed,
        );
      }
    } finally {
      setBusy(false);
    }
  }

  const heading =
    prompt.kind === "permission"
      ? t.workView.waiting.permissionHeading
      : t.workView.waiting.heading;

  return (
    <section
      aria-label={heading}
      className="rounded-r-lg border-l-2 border-accent bg-ink-925 p-3.5 @min-[32rem]/work:p-4"
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <span
            aria-hidden
            className="size-2 shrink-0 rounded-full bg-accent animate-glyph-breathe"
          />
          <span className="text-aux font-semibold text-accent">{heading}</span>
        </div>
        <WorkIdentityBar session={session} />
      </div>

      {prompt.kind === "permission" ? (
        <div className="mt-3 space-y-3">
          <div className="rounded-md bg-well px-3 py-2 font-mono text-meta leading-relaxed text-fg-muted break-words">
            {prompt.toolName && (
              <span className="mr-2 font-semibold text-fg">
                {prompt.toolName}
              </span>
            )}
            <span>{prompt.summary || t.transcript.waitingFallback}</span>
          </div>

          {isManaged ? (
            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                disabled={busy}
                onClick={() => void submitPermission("allow")}
                className="inline-flex h-7 items-center gap-1.5 rounded-sm bg-primary px-3 text-aux font-medium text-ink-950 transition-colors enabled:hover:bg-primary-bright disabled:opacity-40"
              >
                <Icon name="check" size={13} />
                {t.workView.waiting.allowOnce}
              </button>
              <button
                type="button"
                disabled={busy}
                onClick={() => void submitPermission("allow-session")}
                className="inline-flex h-7 items-center rounded-sm bg-ink-900 px-3 text-aux text-fg transition-colors enabled:hover:bg-ink-800 disabled:opacity-40"
              >
                {t.workView.waiting.allowSession}
              </button>
              <button
                type="button"
                disabled={busy}
                onClick={() => void submitPermission("deny")}
                className="inline-flex h-7 items-center gap-1 rounded-sm bg-ink-900 px-3 text-aux text-fg-muted transition-colors enabled:hover:bg-ink-800 enabled:hover:text-fg disabled:opacity-40"
              >
                <Icon name="x" size={13} className="text-danger" />
                {t.workView.waiting.deny}
              </button>
            </div>
          ) : (
            <ObservedDecisionFooter
              session={session}
              canFork={canFork}
              onFork={onFork}
            />
          )}
        </div>
      ) : (
        <QuestionBody
          session={session}
          prompt={prompt}
          isManaged={isManaged}
          canFork={canFork}
          onFork={onFork}
          qIdx={qIdx}
          setQIdx={setQIdx}
          drafts={drafts}
          setDrafts={setDrafts}
          busy={busy}
          onSubmit={submitQuestionAnswers}
        />
      )}

      {notice && <p className="mt-2 text-meta text-fg-muted">{notice}</p>}
    </section>
  );
}

function QuestionBody({
  session,
  prompt,
  isManaged,
  canFork,
  onFork,
  qIdx,
  setQIdx,
  drafts,
  setDrafts,
  busy,
  onSubmit,
}: {
  session: Session;
  prompt: Extract<WaitingPrompt, { kind: "question" }>;
  isManaged: boolean;
  canFork: boolean;
  onFork: (s: Session) => Promise<void>;
  qIdx: number;
  setQIdx: (idx: number) => void;
  drafts: QuestionDraft[];
  setDrafts: Dispatch<SetStateAction<QuestionDraft[]>>;
  busy: boolean;
  onSubmit: (next: QuestionDraft[]) => Promise<void>;
}) {
  const { t } = useI18n();
  const total = prompt.questions.length;
  const safeIdx = Math.min(qIdx, Math.max(0, total - 1));
  const q = prompt.questions[safeIdx];
  if (!q) return null;

  const current: QuestionDraft = drafts[safeIdx] ?? {
    selected: [],
    customOpen: false,
    customText: "",
  };
  const isLast = safeIdx >= total - 1;

  const buildNextDrafts = (
    prev: QuestionDraft[],
    patch: Partial<QuestionDraft>,
  ): QuestionDraft[] => {
    const next = prompt.questions.map(
      (_, i) => prev[i] ?? { selected: [], customOpen: false, customText: "" },
    );
    const cur = next[safeIdx] ?? {
      selected: [],
      customOpen: false,
      customText: "",
    };
    next[safeIdx] = { ...cur, ...patch };
    return next;
  };

  const updateCurrent = (patch: Partial<QuestionDraft>): void => {
    setDrafts((prev) => buildNextDrafts(prev, patch));
  };

  const handleOptionClick = (optIdx: number) => {
    if (!isManaged || busy) return;
    if (q.multiSelect) {
      setDrafts((prev) => {
        const cur = prev[safeIdx] ?? {
          selected: [],
          customOpen: false,
          customText: "",
        };
        const exists = cur.selected.includes(optIdx);
        const selected = exists
          ? cur.selected.filter((x) => x !== optIdx)
          : [...cur.selected, optIdx];
        return buildNextDrafts(prev, { selected, customOpen: false });
      });
      return;
    }
    const next = buildNextDrafts(drafts, {
      selected: [optIdx],
      customOpen: false,
      customText: "",
    });
    setDrafts(next);
    if (isLast) {
      void onSubmit(next);
    } else {
      setQIdx(safeIdx + 1);
    }
  };

  const handleConfirmStep = () => {
    if (!isManaged || busy) return;
    const hasAnswer = current.customOpen
      ? current.customText.trim().length > 0
      : current.selected.length > 0;
    if (!hasAnswer) return;
    if (isLast) {
      void onSubmit(drafts);
    } else {
      setQIdx(safeIdx + 1);
    }
  };

  return (
    <div className="mt-3 space-y-2.5">
      {((total === 1 && q.header) || total > 1 || q.multiSelect) && (
        <div className="flex flex-wrap items-center gap-2">
          {total === 1 && q.header && (
            <span className="text-meta font-medium text-fg-faint">
              {q.header}
            </span>
          )}
          {total > 1 && (
            <div className="flex items-center gap-1">
              {prompt.questions.map((item, i) => (
                <button
                  key={i}
                  type="button"
                  onClick={() => setQIdx(i)}
                  className={cx(
                    "rounded-xs px-1.5 py-0.5 font-mono text-meta tabular-nums transition-colors",
                    i === safeIdx
                      ? "bg-ink-800 text-fg"
                      : "text-fg-faint hover:text-fg-muted",
                  )}
                >
                  {item.header || t.workView.waiting.questionStep(i + 1, total)}
                </button>
              ))}
            </div>
          )}
          {q.multiSelect && (
            <span className="text-meta text-fg-faint">
              {t.workView.waiting.multiSelectHint}
            </span>
          )}
        </div>
      )}

      <p className="text-body leading-relaxed text-fg">{q.question}</p>

      <div className="space-y-1.5">
        {q.options.map((opt, idx) => {
          const active = !current.customOpen && current.selected.includes(idx);
          const parsed = splitRecommendedLabel(opt.label);
          const defaultFocus =
            !q.multiSelect &&
            current.selected.length === 0 &&
            !current.customOpen &&
            parsed.recommended;
          return (
            <button
              key={idx}
              type="button"
              disabled={!isManaged || busy}
              onClick={() => handleOptionClick(idx)}
              className={cx(
                "flex w-full items-start gap-2.5 rounded-md px-3 py-2 text-left transition-colors disabled:cursor-default",
                active
                  ? "bg-ink-800 text-fg"
                  : defaultFocus
                    ? "bg-ink-850 text-fg enabled:hover:bg-ink-800"
                    : "bg-ink-900 text-fg enabled:hover:bg-ink-850",
              )}
            >
              {q.multiSelect ? (
                <span
                  className={cx(
                    "mt-0.5 grid size-4 shrink-0 place-items-center rounded-xs font-mono text-meta tabular-nums",
                    active
                      ? "bg-primary font-semibold text-ink-950"
                      : "bg-ink-850 text-fg-dim",
                  )}
                >
                  {active ? "✓" : ""}
                </span>
              ) : (
                <span className="mt-0.5 w-4 shrink-0 font-mono text-meta tabular-nums text-fg-faint">
                  {idx + 1}.
                </span>
              )}
              <span className="min-w-0 flex-1">
                <span className="flex flex-wrap items-center gap-2 text-aux font-medium text-fg">
                  <span>{parsed.label}</span>
                  {parsed.recommended && (
                    <span className="rounded-xs bg-ink-800 px-1.5 py-0.5 text-meta font-medium text-fg-muted">
                      {t.workView.waiting.recommendedBadge}
                    </span>
                  )}
                </span>
                {opt.description && (
                  <span className="mt-0.5 block text-meta leading-relaxed text-fg-muted">
                    {opt.description}
                  </span>
                )}
              </span>
            </button>
          );
        })}

        {isManaged && (
          <div className="rounded-md bg-ink-900 px-3 py-2">
            <button
              type="button"
              disabled={busy}
              onClick={() =>
                updateCurrent({
                  customOpen: !current.customOpen,
                  selected: [],
                })
              }
              className="flex w-full items-center gap-2.5 text-left text-aux text-fg-muted hover:text-fg"
            >
              {q.multiSelect ? (
                <span className="grid size-4 shrink-0 place-items-center rounded-xs bg-ink-850 font-mono text-meta tabular-nums text-fg-dim">
                  {current.customOpen ? "✓" : ""}
                </span>
              ) : (
                <span className="w-4 shrink-0 font-mono text-meta tabular-nums text-fg-faint">
                  {q.options.length + 1}.
                </span>
              )}
              <span>{t.workView.waiting.otherOption}</span>
            </button>
            {current.customOpen && (
              <div className="mt-2 flex items-center gap-2">
                <input
                  type="text"
                  autoFocus
                  value={current.customText}
                  onChange={(e) =>
                    updateCurrent({ customText: e.target.value })
                  }
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && !e.nativeEvent.isComposing) {
                      e.preventDefault();
                      handleConfirmStep();
                    }
                  }}
                  placeholder={t.workView.waiting.otherPlaceholder}
                  className="h-7 min-w-0 flex-1 rounded-sm bg-well px-2.5 text-aux text-fg placeholder:text-fg-dim"
                />
                <button
                  type="button"
                  disabled={busy || !current.customText.trim()}
                  onClick={handleConfirmStep}
                  className="h-7 shrink-0 rounded-sm bg-primary px-3 text-aux font-medium text-ink-950 transition-colors enabled:hover:bg-primary-bright disabled:opacity-40"
                >
                  {isLast
                    ? t.workView.waiting.submit
                    : t.workView.waiting.nextQuestion}
                </button>
              </div>
            )}
          </div>
        )}
      </div>

      {isManaged && q.multiSelect && !current.customOpen && (
        <div className="pt-1">
          <button
            type="button"
            disabled={busy || current.selected.length === 0}
            onClick={handleConfirmStep}
            className="inline-flex h-7 items-center gap-1.5 rounded-sm bg-primary px-3 text-aux font-medium text-ink-950 transition-colors enabled:hover:bg-primary-bright disabled:opacity-40"
          >
            <Icon name="check" size={13} />
            {busy
              ? t.workView.waiting.submitting
              : isLast
                ? t.workView.waiting.submit
                : t.workView.waiting.nextQuestion}
          </button>
        </div>
      )}

      {!isManaged && (
        <ObservedDecisionFooter
          session={session}
          canFork={canFork}
          onFork={onFork}
        />
      )}
    </div>
  );
}

function ObservedDecisionFooter({
  session,
  canFork,
  onFork,
}: {
  session: Session;
  canFork: boolean;
  onFork: (s: Session) => Promise<void>;
}) {
  const { t } = useI18n();
  return (
    <div className="flex flex-wrap items-center justify-between gap-2 pt-1 text-meta text-fg-faint">
      <span>{t.workView.waiting.observedHint}</span>
      {canFork && (
        <button
          type="button"
          onClick={() => void onFork(session)}
          className="rounded-sm bg-ink-900 px-2.5 py-1 text-aux font-medium text-fg transition-colors hover:bg-ink-800"
        >
          {t.workView.composer.forkAction}
        </button>
      )}
    </div>
  );
}
