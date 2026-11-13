import { useMemo, useState } from "react";
import {
  addDays,
  cleanDeployTarget,
  formatDayMarkdown,
  groupBriefsByDay,
  hiddenDailyBriefs,
  mergedDailyBriefs,
  parseDay,
  type DailyBrief,
} from "@shared/board";
import { shortTopicName } from "@shared/products";
import { cx } from "../ui/atoms";
import { Icon } from "../ui/icons";
import { useBoardCtx } from "./context";
import {
  Chip,
  InlineCodeText,
  Panel,
  TopicChip,
  btn,
  input,
  inputInline,
} from "./parts";
import { fmtDay } from "./strings";

type DigestFilter = "all" | "manual_task" | "git_deploy";

/**
 * Core Module 2: Daily Implementation Digest (`每日任务实现简述清单`).
 * Aggregates completed tasks, manual quick-jots, `releases.jsonl` commits/deploys, and multi-repo
 * `git log` history into reverse-chronological day groups with inline wording edit and 1-click
 * Markdown export.
 */
export function DailyDigestPanel({
  query,
  scrollBody,
}: {
  query: string;
  scrollBody: "split" | "focus";
}) {
  const ctx = useBoardCtx();
  const {
    rawDoc,
    topicFilter,
    defaultTopic,
    s,
    today,
    topics,
    sessionsById,
    openSession,
    openTask,
    addManualBrief,
    editBriefText,
    removeBrief,
    restoreHiddenBrief,
  } = ctx;

  const [sourceFilter, setSourceFilter] = useState<DigestFilter>("all");
  const [jotText, setJotText] = useState("");
  const [jotTopic, setJotTopic] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingText, setEditingText] = useState("");
  const [copiedKey, setCopiedKey] = useState<string | null>(null);
  const [collapsedDays, setCollapsedDays] = useState<Set<string>>(
    () => new Set(),
  );
  const [showHidden, setShowHidden] = useState(false);

  const toggleDay = (date: string) => {
    setCollapsedDays((prev) => {
      const next = new Set(prev);
      if (next.has(date)) next.delete(date);
      else next.add(date);
      return next;
    });
  };

  const topicNames = useMemo(() => {
    const out: Record<string, string> = {};
    for (const [k, p] of Object.entries(topics))
      out[k] = shortTopicName(p.name);
    return out;
  }, [topics]);

  const allMerged = useMemo(
    () => mergedDailyBriefs(rawDoc, { topic: topicFilter, query }),
    [rawDoc, topicFilter, query],
  );

  const hiddenItems = useMemo(
    () => hiddenDailyBriefs(rawDoc, { topic: topicFilter, query }),
    [rawDoc, topicFilter, query],
  );

  const filtered = useMemo(() => {
    if (sourceFilter === "all") return allMerged;
    if (sourceFilter === "manual_task") {
      return allMerged.filter(
        (b) =>
          b.source === "manual" ||
          b.source === "task" ||
          b.source === "session",
      );
    }
    return allMerged.filter(
      (b) => b.source === "commit" || b.source === "deploy",
    );
  }, [allMerged, sourceFilter]);

  const dayGroups = useMemo(() => groupBriefsByDay(filtered), [filtered]);

  const yesterday = useMemo(() => addDays(today, -1), [today]);
  const primaryCopyGroup = useMemo(() => {
    const todayGroup = dayGroups.find((g) => g.date === today);
    return todayGroup ?? dayGroups[0] ?? null;
  }, [dayGroups, today]);

  const copyDayToClipboard = (
    date: string,
    items: DailyBrief[],
    key: string,
  ) => {
    const md = formatDayMarkdown(
      date,
      items,
      topicNames,
      s.markdownHeading,
      s.markdownUntagged,
    );
    void navigator.clipboard?.writeText(md);
    setCopiedKey(key);
    setTimeout(() => {
      setCopiedKey((cur) => (cur === key ? null : cur));
    }, 1600);
  };

  const submitJot = () => {
    const text = jotText.trim();
    if (!text) return;
    const chosenTopic = defaultTopic ?? (jotTopic || null);
    addManualBrief(text, chosenTopic, today);
    setJotText("");
  };

  return (
    <Panel
      title={s.digestTitle}
      className={cx(
        scrollBody === "focus"
          ? "h-full min-h-0"
          : "max-h-96 min-h-0 @3xl:h-full @3xl:max-h-none",
      )}
      right={
        <div className="flex flex-wrap items-center gap-1.5">
          <div className="flex items-center rounded-md border border-(--ui-stroke-tertiary) p-0.5">
            {(
              [
                { id: "all", label: s.dFilterAll },
                { id: "manual_task", label: s.dFilterManualTask },
                { id: "git_deploy", label: s.dFilterGitDeploy },
              ] as const
            ).map((f) => (
              <button
                key={f.id}
                type="button"
                aria-pressed={sourceFilter === f.id}
                onClick={() => setSourceFilter(f.id)}
                className={cx(
                  "inline-flex h-6 items-center rounded-sm px-2 text-aux transition-colors duration-100",
                  sourceFilter === f.id
                    ? "bg-(--ui-control-active-background) font-medium text-fg"
                    : "text-fg-faint hover:text-fg",
                )}
              >
                {f.label}
              </button>
            ))}
          </div>

          {primaryCopyGroup && (
            <button
              type="button"
              onClick={() =>
                copyDayToClipboard(
                  primaryCopyGroup.date,
                  primaryCopyGroup.items,
                  "top",
                )
              }
              className={btn.soft}
            >
              <Icon
                name={copiedKey === "top" ? "check" : "copy"}
                size={12}
                className={copiedKey === "top" ? "text-ok" : ""}
              />
              {copiedKey === "top"
                ? s.copied
                : primaryCopyGroup.date === today
                  ? s.copyToday
                  : s.copyLatestDay}
            </button>
          )}
        </div>
      }
    >
      {/* Responsive quick-jot bar */}
      <div className="flex flex-wrap items-center gap-1.5 border-b border-ink-850 px-4 py-2">
        <div className="relative flex min-w-[13rem] flex-1 items-center">
          <Icon
            name="plus"
            size={13}
            className="pointer-events-none absolute left-2.5 text-fg-faint"
          />
          <input
            value={jotText}
            onChange={(e) => setJotText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.nativeEvent.isComposing) {
                e.preventDefault();
                submitJot();
              }
            }}
            placeholder={s.quickBriefPlaceholder}
            className={cx(inputInline, "w-full pl-7")}
          />
        </div>

        {defaultTopic === null && Object.keys(topics).length > 0 && (
          <select
            value={jotTopic}
            onChange={(e) => setJotTopic(e.target.value)}
            aria-label={s.fTopic}
            className={cx(inputInline, "w-24 shrink-0 px-1.5 text-aux")}
          >
            <option value="">{s.fNoTopic}</option>
            {Object.values(topics).map((p) => (
              <option key={p.key} value={p.key}>
                {shortTopicName(p.name)}
              </option>
            ))}
          </select>
        )}

        {jotText.trim().length > 0 && (
          <button type="button" onClick={submitJot} className={btn.outline}>
            <Icon name="check" size={13} />
            {s.quickBriefAdd}
          </button>
        )}
      </div>

      {/* Reverse-chronological day groups */}
      <div className="min-h-0 flex-1 overflow-y-auto overflow-x-hidden divide-y divide-ink-850">
        {dayGroups.length === 0 ? (
          <p className="px-4 py-8 text-center text-aux text-fg-faint">
            {query.trim() || sourceFilter !== "all"
              ? s.emptyDigestFiltered
              : s.emptyDigest}
          </p>
        ) : (
          dayGroups.map((group) => {
            const wd = s.weekday[parseDay(group.date).getDay()];
            const relativeLabel =
              group.date === today
                ? s.dayToday
                : group.date === yesterday
                  ? s.dayYesterday
                  : null;
            const isCollapsed = collapsedDays.has(group.date);
            return (
              <div key={group.date} className="flex flex-col">
                <div className="flex items-center justify-between gap-2 bg-ink-950/60 px-4 py-1.5 transition-colors hover:bg-(--ui-row-hover-background)">
                  <button
                    type="button"
                    aria-expanded={!isCollapsed}
                    onClick={() => toggleDay(group.date)}
                    className="flex min-w-0 flex-1 items-center gap-2 py-0.5 text-left"
                  >
                    <Icon
                      name={isCollapsed ? "chevron-right" : "chevron-down"}
                      size={12}
                      className="shrink-0 text-fg-faint"
                    />
                    {relativeLabel && (
                      <span
                        className={cx(
                          "text-aux font-semibold",
                          group.date === today ? "text-fg" : "text-fg-muted",
                        )}
                      >
                        {relativeLabel}
                      </span>
                    )}
                    <span className="font-mono text-aux tabular-nums text-fg-faint">
                      {fmtDay(group.date)}
                    </span>
                    <span className="text-meta text-fg-faint">{wd}</span>
                    <span className="font-mono text-meta tabular-nums text-fg-faint">
                      {s.dayCount(group.items.length)}
                    </span>
                  </button>

                  {group.date !== primaryCopyGroup?.date && (
                    <button
                      type="button"
                      onClick={() =>
                        copyDayToClipboard(group.date, group.items, group.date)
                      }
                      className="inline-flex h-6 shrink-0 items-center gap-1 rounded-sm px-2 text-meta text-fg-faint transition-colors hover:bg-(--ui-control-hover-background) hover:text-fg"
                    >
                      <Icon
                        name={copiedKey === group.date ? "check" : "copy"}
                        size={11}
                        className={copiedKey === group.date ? "text-ok" : ""}
                      />
                      {copiedKey === group.date ? s.copied : s.copyDay}
                    </button>
                  )}
                </div>

                {!isCollapsed && (
                  <div className="divide-y divide-ink-850">
                    {group.items.map((item) => {
                      const topic = item.topic ? topics[item.topic] : undefined;
                      const linkedSession = item.sessionId
                        ? sessionsById.get(item.sessionId)
                        : undefined;
                      const isEditing = editingId === item.id;
                      const cleanTarget =
                        item.source === "deploy"
                          ? cleanDeployTarget(item.ref)
                          : null;

                      return (
                        <div
                          key={item.id}
                          className="group flex items-start gap-2.5 px-4 py-2 transition-colors hover:bg-(--ui-row-hover-background)"
                        >
                          <span
                            aria-hidden
                            className={cx(
                              "mt-2 size-1.5 shrink-0 rounded-full",
                              item.source === "deploy" || item.source === "task"
                                ? "bg-ok"
                                : "bg-fg/45",
                            )}
                          />

                          <div className="min-w-0 flex-1">
                            {isEditing ? (
                              <div className="flex flex-col gap-1.5">
                                <textarea
                                  autoFocus
                                  rows={2}
                                  value={editingText}
                                  onChange={(e) =>
                                    setEditingText(e.target.value)
                                  }
                                  onKeyDown={(e) => {
                                    if (
                                      e.key === "Enter" &&
                                      !e.shiftKey &&
                                      !e.nativeEvent.isComposing
                                    ) {
                                      e.preventDefault();
                                      editBriefText(item, editingText);
                                      setEditingId(null);
                                    } else if (e.key === "Escape") {
                                      setEditingId(null);
                                    }
                                  }}
                                  className={cx(
                                    input,
                                    "h-auto resize-y py-1.5 leading-relaxed",
                                  )}
                                />
                                <div className="flex items-center justify-end gap-1.5">
                                  <button
                                    type="button"
                                    onClick={() => setEditingId(null)}
                                    className={btn.ghost}
                                  >
                                    {s.cancelEdit}
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() => {
                                      editBriefText(item, editingText);
                                      setEditingId(null);
                                    }}
                                    className={btn.compact}
                                  >
                                    {s.saveBrief}
                                  </button>
                                </div>
                              </div>
                            ) : (
                              <div className="text-body leading-relaxed text-fg">
                                <TopicChip
                                  topic={topic}
                                  className="mr-1.5 align-middle"
                                />
                                {item.taskId ? (
                                  <span
                                    role="button"
                                    tabIndex={0}
                                    onClick={() =>
                                      item.taskId && openTask(item.taskId)
                                    }
                                    onKeyDown={(e) => {
                                      if (
                                        (e.key === "Enter" || e.key === " ") &&
                                        item.taskId
                                      ) {
                                        e.preventDefault();
                                        openTask(item.taskId);
                                      }
                                    }}
                                    className="cursor-pointer align-middle hover:underline"
                                  >
                                    <InlineCodeText text={item.text} />
                                  </span>
                                ) : (
                                  <span className="align-middle">
                                    <InlineCodeText text={item.text} />
                                  </span>
                                )}
                                {item.source === "deploy" && (
                                  <Chip
                                    tone="ok"
                                    className="ml-1.5 align-middle"
                                  >
                                    {cleanTarget
                                      ? s.deployedTo(cleanTarget)
                                      : s.briefSource.deploy}
                                  </Chip>
                                )}
                                {item.source === "task" && (
                                  <Chip className="ml-1.5 align-middle">
                                    {s.briefSource.task}
                                  </Chip>
                                )}
                                {item.source === "manual" && (
                                  <Chip className="ml-1.5 align-middle">
                                    {s.briefSource.manual}
                                  </Chip>
                                )}
                                {item.source === "commit" && item.ref && (
                                  <span className="ml-1.5 inline-block align-middle font-mono text-meta tabular-nums text-fg-faint">
                                    {item.ref}
                                  </span>
                                )}
                              </div>
                            )}
                          </div>

                          {!isEditing && (
                            <div className="flex shrink-0 items-center gap-1.5">
                              {linkedSession && (
                                <button
                                  type="button"
                                  onClick={() => openSession(linkedSession.id)}
                                  title={s.openSessionBtn}
                                  aria-label={s.openSessionBtn}
                                  className="grid size-6 place-items-center rounded-sm text-fg-faint hover:bg-(--ui-control-hover-background) hover:text-fg"
                                >
                                  <Icon name="arrow-up-right" size={12} />
                                </button>
                              )}

                              <button
                                type="button"
                                onClick={() => {
                                  setEditingId(item.id);
                                  setEditingText(item.text);
                                }}
                                title={s.editBrief}
                                aria-label={s.editBrief}
                                className="grid size-6 place-items-center rounded-sm text-fg-faint opacity-55 transition-opacity group-hover:opacity-100 focus:opacity-100 hover:bg-(--ui-control-hover-background) hover:text-fg"
                              >
                                <Icon name="pencil" size={12} />
                              </button>

                              <button
                                type="button"
                                onClick={() => removeBrief(item)}
                                title={s.hideBrief}
                                aria-label={s.hideBrief}
                                className="grid size-6 place-items-center rounded-sm text-fg-faint opacity-0 transition-opacity group-hover:opacity-100 focus:opacity-100 hover:bg-(--ui-control-hover-background) hover:text-fg"
                              >
                                <Icon name="x" size={13} />
                              </button>
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            );
          })
        )}

        {hiddenItems.length > 0 && (
          <div className="flex flex-col">
            <button
              type="button"
              aria-expanded={showHidden}
              onClick={() => setShowHidden((v) => !v)}
              className="flex items-center gap-1.5 px-4 py-2 text-left text-aux text-fg-faint transition-colors hover:bg-(--ui-row-hover-background) hover:text-fg"
            >
              <Icon
                name={showHidden ? "chevron-down" : "chevron-right"}
                size={12}
              />
              <span>{s.hiddenBriefsToggle(hiddenItems.length)}</span>
            </button>
            {showHidden && (
              <div className="divide-y divide-ink-850 border-t border-ink-850">
                {hiddenItems.map((b) => {
                  const tp = b.topic ? topics[b.topic] : undefined;
                  return (
                    <div
                      key={b.id}
                      className="flex items-center gap-2 px-4 py-2 text-aux text-fg-faint"
                    >
                      <TopicChip topic={tp} className="shrink-0" />
                      <span className="min-w-0 flex-1 truncate">
                        <InlineCodeText text={b.text} />
                      </span>
                      <span className="shrink-0 font-mono text-meta tabular-nums">
                        {fmtDay(b.date)}
                      </span>
                      <button
                        type="button"
                        onClick={() => restoreHiddenBrief(b)}
                        className={btn.compact}
                      >
                        {s.restoreBriefBtn}
                      </button>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}
      </div>
    </Panel>
  );
}
