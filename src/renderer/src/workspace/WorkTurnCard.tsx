import { useStore } from "@nanostores/react";
import type { TranscriptEvent, WaitingPrompt } from "@shared/transcript";
import type {
  WorkErrorItem,
  WorkFileChange,
  WorkTurn,
} from "@shared/work-view";
import { useI18n } from "../i18n";
import { cx } from "../ui/atoms";
import { Icon } from "../ui/icons";
import type { OpenDetail } from "./events";
import type { DispatchDrill } from "./drill-index";
import { toolIcon } from "./tool-icon";
import { MarkdownMessage } from "./markdown/MarkdownMessage";
import { CopyButton } from "./markdown/CopyButton";
import { $expandedSpines, spineKey, toggleSpineExpanded } from "./view-mode";

function fileBasename(filePath: string): string {
  const normalized = filePath.replace(/[\\/]+$/, "");
  const parts = normalized.split(/[\\/]/);
  return parts[parts.length - 1] || filePath;
}

export function WorkTurnCard({
  sessionId,
  turn,
  isRunningTail,
  waitingPrompt = null,
  now,
  dispatchDrill,
  onOpen,
}: {
  sessionId: string;
  turn: WorkTurn;
  isRunningTail: boolean;
  waitingPrompt?: WaitingPrompt | null;
  now: number;
  dispatchDrill?: DispatchDrill;
  onOpen: (detail: OpenDetail) => void;
}) {
  const { t } = useI18n();
  const expandedMap = useStore($expandedSpines);
  const expanded = Boolean(expandedMap[spineKey(sessionId, turn.index)]);

  const isWaiting = Boolean(waitingPrompt);
  const live =
    !turn.queued && !isWaiting && (isRunningTail || turn.spine.hasPending);
  const hasSteps = turn.spine.steps.length > 0;
  const showSpine =
    !turn.queued &&
    (turn.spine.stepCount > 0 ||
      turn.spine.thinkingCount > 0 ||
      live ||
      isWaiting);

  const activePhase = turn.spine.activeStep?.phase ?? "working";
  const phaseLabel = t.workView.phase[activePhase];
  const activeTarget = turn.spine.activeStep?.target ?? "";

  const waitingLabel =
    waitingPrompt?.kind === "permission"
      ? t.workView.phase.waitingPermission
      : t.workView.phase.waitingQuestion;
  const waitingTarget =
    waitingPrompt?.kind === "permission"
      ? waitingPrompt.summary || waitingPrompt.toolName
      : waitingPrompt?.kind === "question"
        ? waitingPrompt.questions
            .map((q) => q.header)
            .filter(Boolean)
            .join(" / ")
        : "";

  const elapsedMs =
    live && turn.startMs > 0
      ? Math.max(0, now - turn.startMs)
      : turn.durationMs;

  return (
    <article className="space-y-2.5">
      {turn.prompt !== null && (
        <div
          className={cx(
            "rounded-lg bg-ink-900 px-3.5 py-2.5",
            turn.queued && "opacity-75",
          )}
        >
          <div className="flex items-start gap-2.5">
            <span className="mt-0.5 shrink-0 font-mono text-meta tabular-nums text-fg-dim">
              #{turn.index}
            </span>
            <div className="min-w-0 flex-1 whitespace-pre-wrap break-words text-body leading-relaxed text-fg">
              {turn.prompt}
            </div>
            {(turn.queued || turn.midTurn) && (
              <span className="mt-0.5 shrink-0 text-meta font-medium text-fg-faint">
                {turn.queued
                  ? t.workView.spine.queuedTag
                  : t.workView.spine.midTurnTag}
              </span>
            )}
          </div>
        </div>
      )}

      {showSpine && (
        <div>
          <button
            type="button"
            disabled={!hasSteps}
            aria-expanded={hasSteps ? expanded : undefined}
            aria-label={
              expanded
                ? t.workView.spine.collapseAria
                : t.workView.spine.expandAria
            }
            onClick={() =>
              hasSteps && toggleSpineExpanded(sessionId, turn.index)
            }
            className={cx(
              "flex w-full min-w-0 items-center gap-2 rounded-md bg-ink-925 px-3 py-2 text-left transition-colors",
              hasSteps ? "cursor-pointer hover:bg-ink-900" : "cursor-default",
              expanded &&
                hasSteps &&
                "sticky top-0 z-10 shadow-[0_4px_0_0_var(--color-ink-950)]",
            )}
          >
            <Icon
              name={expanded ? "chevron-down" : "chevron-right"}
              size={13}
              className={cx(
                "shrink-0 text-fg-faint",
                !hasSteps && "opacity-35",
              )}
            />

            {isWaiting ? (
              <div className="flex min-w-0 flex-1 items-center gap-2">
                <span
                  aria-hidden
                  className="size-1.5 shrink-0 rounded-full bg-accent"
                />
                <span className="shrink-0 text-aux font-medium text-accent">
                  {waitingLabel}
                </span>
                {waitingTarget && (
                  <span className="min-w-0 truncate font-mono text-meta text-fg-muted">
                    {waitingTarget}
                  </span>
                )}
              </div>
            ) : live ? (
              <div className="flex min-w-0 flex-1 items-center gap-2">
                <span
                  aria-hidden
                  className="size-1.5 shrink-0 rounded-full bg-working animate-pulse-soft"
                />
                <span className="shrink-0 text-aux font-medium text-fg">
                  {phaseLabel}
                </span>
                {activeTarget && (
                  <span className="min-w-0 truncate font-mono text-meta text-fg-muted">
                    {activeTarget}
                  </span>
                )}
              </div>
            ) : (
              <div className="flex min-w-0 flex-1 flex-wrap items-center gap-3 font-mono text-meta tabular-nums">
                <span className="font-sans text-aux font-medium text-fg-muted">
                  {turn.spine.stepCount > 0
                    ? t.workView.spine.steps(turn.spine.stepCount)
                    : t.workView.spine.thinkingOnly}
                </span>
                {turn.files.length > 0 && (
                  <span className="text-fg-faint">
                    {t.workView.spine.files(turn.files.length)}
                  </span>
                )}
                {(turn.spine.addedLines > 0 || turn.spine.removedLines > 0) && (
                  <span className="inline-flex items-center gap-1.5">
                    {turn.spine.addedLines > 0 && (
                      <span className="text-ok">+{turn.spine.addedLines}</span>
                    )}
                    {turn.spine.removedLines > 0 && (
                      <span className="text-danger">
                        −{turn.spine.removedLines}
                      </span>
                    )}
                  </span>
                )}
              </div>
            )}

            <div className="ml-auto flex shrink-0 items-center gap-3 font-mono text-meta tabular-nums text-fg-faint">
              {(live || isWaiting) && turn.spine.stepCount > 0 && (
                <span>{t.workView.spine.steps(turn.spine.stepCount)}</span>
              )}
              {elapsedMs > 0 && (
                <span
                  className={
                    live || isWaiting ? "text-fg-muted" : "text-fg-dim"
                  }
                >
                  {t.time.duration(elapsedMs)}
                </span>
              )}
            </div>
          </button>

          {expanded && hasSteps && (
            <div className="ml-2 mt-1.5 space-y-0.5 border-l border-ink-850 pl-3">
              {turn.spine.steps.map((ev, idx) => (
                <SpineStepRow
                  key={idx}
                  event={ev}
                  dispatchDrill={dispatchDrill}
                  onOpen={onOpen}
                />
              ))}
            </div>
          )}
        </div>
      )}

      {!expanded && turn.errors.length > 0 && (
        <div className="space-y-1">
          {turn.errors.map((err, idx) => (
            <SurfacedErrorRow key={idx} item={err} onOpen={onOpen} />
          ))}
        </div>
      )}

      {turn.deliverables.length > 0 && (
        <div className="space-y-3 pt-0.5">
          {turn.deliverables.map((md, idx) => (
            <div key={idx} className="group/deliv">
              <MarkdownMessage
                text={md}
                className="text-body leading-[1.8] text-fg [&_li]:leading-[1.8] [&_p]:leading-[1.8]"
              />
              <div className="mt-1 opacity-0 transition-opacity focus-within:opacity-100 group-hover/deliv:opacity-100">
                <CopyButton text={md} />
              </div>
            </div>
          ))}
        </div>
      )}

      {turn.files.length > 0 && (
        <div className="flex flex-wrap items-center gap-1.5 pt-0.5">
          {turn.files.map((f) => (
            <FileDiffCapsule
              key={f.file}
              change={f}
              onClick={() => onOpen({ kind: "diff", diff: f.mergedDiff })}
            />
          ))}
        </div>
      )}
    </article>
  );
}

function FileDiffCapsule({
  change,
  onClick,
}: {
  change: WorkFileChange;
  onClick: () => void;
}) {
  const { t } = useI18n();
  return (
    <button
      type="button"
      onClick={onClick}
      title={t.transcript.viewDiff(change.mergedDiff.tool, change.file)}
      className="inline-flex max-w-full items-center gap-1.5 rounded-sm bg-ink-900 px-2 py-1 font-mono text-meta transition-colors hover:bg-ink-800"
    >
      <Icon
        name="pencil"
        size={11}
        className={cx(
          "shrink-0",
          change.status === "error" ? "text-danger" : "text-fg-faint",
        )}
      />
      <span className="truncate text-fg-muted">
        {fileBasename(change.file)}
      </span>
      {(change.added > 0 || change.removed > 0) && (
        <span className="inline-flex shrink-0 items-center gap-1 tabular-nums">
          {change.added > 0 && <span className="text-ok">+{change.added}</span>}
          {change.removed > 0 && (
            <span className="text-danger">−{change.removed}</span>
          )}
        </span>
      )}
    </button>
  );
}

function SurfacedErrorRow({
  item,
  onOpen,
}: {
  item: WorkErrorItem;
  onOpen: (detail: OpenDetail) => void;
}) {
  const { t } = useI18n();
  const toolName = item.kind === "tool" ? item.event.name : item.event.tool;
  const target = item.kind === "tool" ? item.event.input : item.event.file;
  return (
    <button
      type="button"
      onClick={() =>
        item.kind === "tool"
          ? onOpen({ kind: "tool", tool: item.event })
          : onOpen({ kind: "diff", diff: item.event })
      }
      className="flex w-full min-w-0 items-center gap-2 rounded-r-sm border-l-2 border-danger bg-ink-925 px-2.5 py-1.5 text-left font-mono text-meta transition-colors hover:bg-ink-900"
    >
      <Icon name="triangle-alert" size={12} className="shrink-0 text-danger" />
      <span className="shrink-0 font-medium text-fg">{toolName}</span>
      <span className="min-w-0 flex-1 truncate text-fg-muted">{target}</span>
      <span className="shrink-0 font-sans text-fg-faint">
        {t.workView.spine.failedStep}
      </span>
    </button>
  );
}

function SpineStepRow({
  event,
  dispatchDrill,
  onOpen,
}: {
  event: TranscriptEvent;
  dispatchDrill?: DispatchDrill;
  onOpen: (detail: OpenDetail) => void;
}) {
  const { t } = useI18n();

  if (event.kind === "thinking") {
    return (
      <details className="px-2 py-0.5 text-meta text-fg-faint">
        <summary className="cursor-pointer select-none hover:text-fg-muted">
          {t.transcript.thinking}
        </summary>
        <p className="mt-1 whitespace-pre-wrap pl-3 leading-relaxed text-fg-faint">
          {event.text}
        </p>
      </details>
    );
  }

  if (event.kind === "assistant") {
    return (
      <div className="px-2 py-1 text-aux leading-relaxed text-fg-muted">
        <MarkdownMessage
          text={event.text}
          className="text-aux leading-relaxed text-fg-muted"
        />
      </div>
    );
  }

  if (event.kind === "tool") {
    return (
      <button
        type="button"
        onClick={() => onOpen({ kind: "tool", tool: event })}
        className="flex w-full min-w-0 items-center gap-2 rounded-sm px-2 py-1 text-left font-mono text-meta transition-colors hover:bg-ink-900"
      >
        <Icon
          name={toolIcon(event.name)}
          size={12}
          className={cx(
            "shrink-0",
            event.status === "error" ? "text-danger" : "text-fg-faint",
          )}
        />
        <span className="shrink-0 text-fg-muted">{event.name}</span>
        <span className="min-w-0 flex-1 truncate text-fg-faint">
          {event.input}
        </span>
        {event.status === "error" ? (
          <span className="shrink-0 text-danger">✕</span>
        ) : event.status === "pending" ? (
          <span
            aria-hidden
            className="size-1.5 shrink-0 rounded-full bg-working animate-pulse-soft"
          />
        ) : null}
      </button>
    );
  }

  if (event.kind === "diff") {
    return (
      <button
        type="button"
        onClick={() => onOpen({ kind: "diff", diff: event })}
        className="flex w-full min-w-0 items-center gap-2 rounded-sm px-2 py-1 text-left font-mono text-meta transition-colors hover:bg-ink-900"
      >
        <Icon
          name="pencil"
          size={12}
          className={cx(
            "shrink-0",
            event.status === "error" ? "text-danger" : "text-fg-faint",
          )}
        />
        <span className="min-w-0 flex-1 truncate text-fg-muted">
          {event.file}
        </span>
        <span className="inline-flex shrink-0 items-center gap-1.5 tabular-nums">
          {event.hunk.added.length > 0 && (
            <span className="text-ok">+{event.hunk.added.length}</span>
          )}
          {event.hunk.removed.length > 0 && (
            <span className="text-danger">−{event.hunk.removed.length}</span>
          )}
          {event.status === "error" ? (
            <span className="text-danger">✕</span>
          ) : event.status === "pending" ? (
            <span
              aria-hidden
              className="size-1.5 shrink-0 rounded-full bg-working animate-pulse-soft"
            />
          ) : null}
        </span>
      </button>
    );
  }

  if (event.kind === "subagent") {
    const canDrill = Boolean(dispatchDrill?.index.has(event.toolUseId));
    return (
      <button
        type="button"
        disabled={!canDrill}
        onClick={() => canDrill && dispatchDrill?.onDrill(event.toolUseId)}
        className={cx(
          "flex w-full min-w-0 items-center gap-2 rounded-sm px-2 py-1 text-left font-mono text-meta transition-colors",
          canDrill ? "hover:bg-ink-900" : "cursor-default",
        )}
      >
        <Icon name="bot" size={12} className="shrink-0 text-fg-faint" />
        <span className="shrink-0 text-fg-muted">{event.agentType}</span>
        <span className="min-w-0 flex-1 truncate font-sans text-fg-faint">
          {event.description}
        </span>
        {canDrill && (
          <Icon
            name="chevron-right"
            size={12}
            className="shrink-0 text-fg-dim"
          />
        )}
      </button>
    );
  }

  return null;
}
