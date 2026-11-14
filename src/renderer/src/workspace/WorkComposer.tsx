import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type ClipboardEvent,
  type DragEvent,
} from "react";
import { useStore } from "@nanostores/react";
import type { Session } from "@shared/types";
import { AGENTS } from "@shared/agents";
import { useI18n } from "../i18n";
import { cx } from "../ui/atoms";
import { Icon } from "../ui/icons";
import { noteTerminalInput } from "../terminal/input-activity";
import {
  collectDroppedPaths,
  quotePathForShell,
  transferHasDropCandidates,
} from "../xterm/file-drop";
import { WorkIdentityBar } from "./WorkIdentityBar";
import {
  $workDrafts,
  clearWorkDraft,
  getWorkDraft,
  setSessionViewMode,
  setWorkDraft,
} from "./view-mode";

function attachmentLabel(filePath: string): string {
  const trimmed = filePath.replace(/[\\/]+$/, "");
  const parts = trimmed.split(/[\\/]/);
  return parts[parts.length - 1] || filePath;
}

export function WorkComposer({
  session,
  canSpawn,
  compactPane = false,
  hideIdentityBar = false,
  onFork,
  onBeforeAutoResume,
  onAfterAutoResume,
}: {
  session: Session;
  canSpawn: boolean;
  compactPane?: boolean;
  hideIdentityBar?: boolean;
  onFork: (session: Session) => Promise<void>;
  onBeforeAutoResume?: (id: string) => void;
  onAfterAutoResume?: (id: string, draft?: Session) => void;
}) {
  const { t } = useI18n();
  const drafts = useStore($workDrafts);
  const draft = getWorkDraft(drafts, session.id);

  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [sending, setSending] = useState(false);
  const [resuming, setResuming] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [wakeExpanded, setWakeExpanded] = useState(false);

  useEffect(() => {
    setWakeExpanded(false);
  }, [session.id]);

  const caps = AGENTS[session.agent].capabilities;
  const isManagedLive =
    session.management === "managed" && session.state !== "ended";
  const isEndedResumable =
    session.state === "ended" &&
    caps.canResume &&
    session.resumable &&
    canSpawn;
  const isObservedLive =
    session.management === "observed" && session.state !== "ended";
  const canSend = isManagedLive || isEndedResumable;
  const canFork = caps.canFork && canSpawn && session.resumable;

  // Auto-fit textarea height between 1 row and 160px.
  useLayoutEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(160, Math.max(28, el.scrollHeight))}px`;
  }, [draft.text, session.id]);

  const addAttachments = (paths: string[]) => {
    if (paths.length === 0) return;
    const latest = getWorkDraft($workDrafts.get(), session.id);
    const merged = [...new Set([...latest.attachments, ...paths])];
    setWorkDraft(session.id, { attachments: merged });
  };

  const removeAttachment = (target: string) => {
    const latest = getWorkDraft($workDrafts.get(), session.id);
    setWorkDraft(session.id, {
      attachments: latest.attachments.filter((p) => p !== target),
    });
  };

  const attachClipboardImage = async (): Promise<boolean> => {
    try {
      const probe = await window.api.clipboardProbe(session.id, true);
      if (probe.hasImage && probe.imagePath) {
        addAttachments([probe.imagePath]);
        return true;
      }
    } catch {
      // Ignore clipboard read failures.
    }
    return false;
  };

  const handlePaste = (e: ClipboardEvent<HTMLTextAreaElement>) => {
    const plain = e.clipboardData.getData("text/plain");
    if (plain) return; // Native text paste.
    const dropped = collectDroppedPaths(e.clipboardData, (f) =>
      window.api.getPathForFile(f),
    );
    if (dropped.length > 0) {
      e.preventDefault();
      addAttachments(dropped);
      return;
    }
    let hasImageItem = false;
    for (let i = 0; i < (e.clipboardData.items?.length ?? 0); i++) {
      if (e.clipboardData.items[i]?.type.startsWith("image/")) {
        hasImageItem = true;
        break;
      }
    }
    if (hasImageItem || (e.clipboardData.files?.length ?? 0) === 0) {
      e.preventDefault();
      void attachClipboardImage();
    }
  };

  const handleDragOver = (e: DragEvent<HTMLDivElement>) => {
    if (!transferHasDropCandidates(e.dataTransfer)) return;
    e.preventDefault();
    e.stopPropagation();
    e.dataTransfer.dropEffect = "copy";
    if (!dragOver) setDragOver(true);
  };

  const handleDrop = (e: DragEvent<HTMLDivElement>) => {
    setDragOver(false);
    if (!transferHasDropCandidates(e.dataTransfer)) return;
    e.preventDefault();
    e.stopPropagation();
    const paths = collectDroppedPaths(e.dataTransfer, (f) =>
      window.api.getPathForFile(f),
    );
    addAttachments(paths);
    textareaRef.current?.focus();
  };

  const handleInterrupt = async () => {
    if (!isManagedLive) return;
    noteTerminalInput(session.id);
    await window.api.terminal.dispatchWork({
      id: session.id,
      action: { kind: "interrupt" },
    });
  };

  const handleSubmit = async () => {
    if (!canSend || sending) return;
    const quoted = draft.attachments.map((p) => quotePathForShell(p)).join(" ");
    const trimmed = draft.text.trim();
    const payload =
      quoted && trimmed ? `${quoted} ${trimmed}` : quoted || trimmed;
    if (!payload) return;

    setSending(true);
    setError(null);
    const willAutoResume = !isManagedLive && session.state === "ended";
    if (willAutoResume) {
      setResuming(true);
      setSessionViewMode(session.id, "work");
      onBeforeAutoResume?.(session.id);
    }

    try {
      noteTerminalInput(session.id);
      const res = await window.api.terminal.dispatchWork({
        id: session.id,
        action: { kind: "prompt", text: payload },
        expectResume: session.state === "ended",
        cols: 100,
        rows: 30,
      });
      if (!res.ok) {
        setError(t.workView.composer.sendFailed);
        return;
      }
      clearWorkDraft(session.id);
      if (res.resumed) {
        onAfterAutoResume?.(session.id, res.session);
      }
    } catch {
      setError(t.workView.composer.sendFailed);
    } finally {
      setSending(false);
      setResuming(false);
    }
  };

  const placeholder =
    session.state === "ended"
      ? t.workView.composer.placeholderEnded
      : session.state === "working"
        ? t.workView.composer.placeholderWorking
        : session.state === "waiting"
          ? t.workView.composer.placeholderWaiting
          : t.workView.composer.placeholderIdle;

  const submitLabel = resuming
    ? t.workView.composer.resumingStatus
    : session.state === "ended"
      ? t.workView.composer.resumeSend
      : session.state === "working"
        ? t.workView.composer.queue
        : t.workView.composer.send;

  const hasContent =
    draft.text.trim().length > 0 || draft.attachments.length > 0;

  if (
    compactPane &&
    isEndedResumable &&
    !hasContent &&
    !wakeExpanded &&
    !resuming
  ) {
    return (
      <div
        onDragEnter={handleDragOver}
        onDragOver={handleDragOver}
        onDragLeave={() => setDragOver(false)}
        onDrop={(e) => {
          setWakeExpanded(true);
          handleDrop(e);
        }}
        className="shrink-0 border-t border-(--ui-stroke-quaternary) bg-ink-950 px-3 py-1.5"
      >
        <div className="mx-auto flex max-w-3xl min-w-0 items-center justify-between gap-2">
          <div className="min-w-0 flex-1 overflow-hidden">
            {!hideIdentityBar && <WorkIdentityBar session={session} />}
          </div>
          <button
            type="button"
            onClick={() => {
              setWakeExpanded(true);
              requestAnimationFrame(() => textareaRef.current?.focus());
            }}
            className="inline-flex h-6 shrink-0 items-center gap-1 rounded-xs bg-ink-900 px-2.5 text-meta font-medium text-fg-muted transition-colors hover:bg-ink-800 hover:text-fg"
          >
            <span>{t.workView.composer.resumeSend}</span>
            <Icon name="arrow-right" size={11} />
          </button>
        </div>
      </div>
    );
  }

  const showTopRow =
    !hideIdentityBar ||
    resuming ||
    (isManagedLive && session.state === "working") ||
    (session.state === "ended" && isEndedResumable);

  return (
    <div
      onDragEnter={handleDragOver}
      onDragOver={handleDragOver}
      onDragLeave={() => setDragOver(false)}
      onDrop={handleDrop}
      className="shrink-0 border-t border-(--ui-stroke-quaternary) bg-ink-950 px-3 pb-3 pt-2 @min-[32rem]/work:px-6 @min-[32rem]/work:pb-4"
    >
      <div className="mx-auto max-w-3xl space-y-2">
        {showTopRow && (
          <div className="flex min-w-0 flex-wrap items-center justify-between gap-2">
            {!hideIdentityBar && <WorkIdentityBar session={session} />}

            <div className="ml-auto flex shrink-0 items-center gap-2.5 text-meta">
              {resuming ? (
                <span className="text-working">
                  {t.workView.composer.resumingStatus}
                </span>
              ) : isManagedLive && session.state === "working" ? (
                <>
                  <span className="inline-flex items-center gap-1.5 text-working">
                    <span
                      aria-hidden
                      className="size-1.5 rounded-full bg-working animate-pulse-soft"
                    />
                    {t.workView.composer.workingStatus}
                  </span>
                  <span className="hidden text-fg-dim @min-[30rem]/work:inline">
                    {t.workView.composer.queueHint}
                  </span>
                  <button
                    type="button"
                    onClick={() => void handleInterrupt()}
                    title={t.workView.composer.interruptHint}
                    className="inline-flex items-center gap-1 rounded-xs bg-ink-900 px-2 py-0.5 text-meta text-fg-muted transition-colors hover:bg-danger/15 hover:text-danger"
                  >
                    <Icon name="square" size={10} />
                    {t.workView.composer.interrupt}
                  </button>
                </>
              ) : session.state === "ended" && isEndedResumable ? (
                <>
                  <span className="text-fg-faint">
                    {t.workView.composer.endedStatus}
                  </span>
                  <span className="hidden text-fg-dim @min-[30rem]/work:inline">
                    {t.workView.composer.autoResumeHint}
                  </span>
                </>
              ) : null}
            </div>
          </div>
        )}

        {isObservedLive ? (
          <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg bg-well px-3.5 py-2.5 text-aux text-fg-faint">
            <span>{t.workView.composer.observedLiveNotice}</span>
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
        ) : canSend ? (
          <div
            className={cx(
              "rounded-lg bg-well px-3 py-2 transition-colors",
              dragOver
                ? "ring-1 ring-primary/40"
                : "ring-1 ring-(--ui-stroke-tertiary)",
            )}
          >
            {draft.attachments.length > 0 && (
              <div className="mb-2 flex flex-wrap items-center gap-1.5">
                {draft.attachments.map((filePath) => (
                  <span
                    key={filePath}
                    title={filePath}
                    className="inline-flex max-w-full items-center gap-1.5 rounded-sm bg-ink-900 px-2 py-0.5 font-mono text-meta text-fg-muted"
                  >
                    <span className="truncate">
                      {attachmentLabel(filePath)}
                    </span>
                    <button
                      type="button"
                      aria-label={t.workView.composer.removeAttachment}
                      onClick={() => removeAttachment(filePath)}
                      className="text-fg-dim hover:text-fg"
                    >
                      <Icon name="x" size={11} />
                    </button>
                  </span>
                ))}
              </div>
            )}

            <div className="flex items-end gap-2">
              <textarea
                ref={textareaRef}
                rows={1}
                value={draft.text}
                disabled={sending}
                onPaste={handlePaste}
                onChange={(e) => {
                  noteTerminalInput(session.id);
                  setWorkDraft(session.id, { text: e.target.value });
                }}
                onKeyDown={(e) => {
                  if (e.nativeEvent.isComposing) return;
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    void handleSubmit();
                  } else if (
                    e.key === "Escape" &&
                    isManagedLive &&
                    session.state === "working" &&
                    !draft.text
                  ) {
                    e.preventDefault();
                    void handleInterrupt();
                  }
                }}
                placeholder={placeholder}
                className="max-h-40 min-h-[28px] min-w-0 flex-1 resize-none bg-transparent py-1 text-body leading-relaxed text-fg placeholder:text-fg-dim"
              />

              <div className="flex shrink-0 items-center gap-1.5 pb-0.5">
                <input
                  ref={fileInputRef}
                  type="file"
                  multiple
                  tabIndex={-1}
                  aria-hidden
                  className="hidden"
                  onChange={(e) => {
                    const picked = Array.from(e.target.files ?? [])
                      .map((f) => {
                        try {
                          return window.api.getPathForFile(f);
                        } catch {
                          return "";
                        }
                      })
                      .filter(Boolean);
                    addAttachments(picked);
                    e.target.value = "";
                  }}
                />
                <button
                  type="button"
                  title={t.workView.composer.pasteImage}
                  aria-label={t.workView.composer.pasteImage}
                  onClick={() => {
                    void attachClipboardImage().then((attached) => {
                      if (!attached) fileInputRef.current?.click();
                    });
                  }}
                  className="grid size-7 place-items-center rounded-sm text-fg-faint transition-colors hover:bg-ink-900 hover:text-fg"
                >
                  <Icon name="plus" size={14} />
                </button>
                <button
                  type="button"
                  disabled={sending || !hasContent}
                  onClick={() => void handleSubmit()}
                  className={cx(
                    "inline-flex h-7 items-center gap-1.5 rounded-sm px-3 text-aux font-medium transition-colors disabled:bg-ink-850 disabled:text-fg-dim",
                    hideIdentityBar
                      ? "bg-ink-800 text-fg enabled:hover:bg-ink-700"
                      : "bg-primary text-ink-950 enabled:hover:bg-primary-bright",
                  )}
                >
                  {submitLabel}
                  <Icon name="arrow-right" size={13} />
                </button>
              </div>
            </div>
          </div>
        ) : null}

        {error && <p className="text-meta text-danger">{error}</p>}
      </div>
    </div>
  );
}
