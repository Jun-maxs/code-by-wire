import { useMemo, useState } from "react";
import {
  addDays,
  formatDayMarkdown,
  groupBriefsByDay,
  mergedDailyBriefs,
  parseDay,
  type DailyBrief,
} from "@shared/board";
import { shortTopicName } from "@shared/products";
import { cx } from "../ui/atoms";
import { Icon } from "../ui/icons";
import { useBoardCtx } from "./context";
import { Chip, Panel, TopicChip, btn, input, inputInline } from "./parts";
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
  } = ctx;

  const [sourceFilter, setSourceFilter] = useState<DigestFilter>("all");
  const [jotText, setJotText] = useState("");
  const [jotTopic, setJotTopic] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingText, setEditingText] = useState("");
  const [copiedKey, setCopiedKey] = useState<string | null>(null);

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
    const md = formatDayMarkdown(date, items, topicNames, s.markdownHeading);
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
      {/* 1-line quick-jot bar */}
      <div className="flex items-center gap-1.5 border-b border-ink-850 px-4 py-2">
        <div className="relative flex min-w-0 flex-1 items-center">
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
            className={cx(inputInline, "w-20 shrink-0 px-1.5 text-aux")}
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
            return (
              <div key={group.date} className="flex flex-col">
                <div className="flex items-center justify-between gap-2 bg-ink-950/60 px-4 py-2">
                  <div className="flex items-center gap-2">
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
                  </div>

                  {group.date !== primaryCopyGroup?.date && (
                    <button
                      type="button"
                      onClick={() =>
                        copyDayToClipboard(group.date, group.items, group.date)
                      }
                      className="inline-flex h-6 items-center gap-1 rounded-sm px-2 text-meta text-fg-faint transition-colors hover:bg-(--ui-control-hover-background) hover:text-fg"
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

                <div className="divide-y divide-ink-850">
                  {group.items.map((item) => {
                    const topic = item.topic ? topics[item.topic] : undefined;
                    const linkedSession = item.sessionId
                      ? sessionsById.get(item.sessionId)
                      : undefined;
                    const isEditing = editingId === item.id;

                    return (
                      <div
                        key={item.id}
                        className="group flex items-start gap-2.5 px-4 py-2.5 transition-colors hover:bg-(--ui-row-hover-background)"
                      >
                        <span
                          aria-hidden
                          className={cx(
                            "mt-1.5 size-1.5 shrink-0 rounded-full",
                            item.source === "deploy" || item.source === "task"
                              ? "bg-ok"
                              : "bg-fg/45",
                          )}
                        />

                        {topic && (
                          <div className="mt-0.5">
                            <TopicChip topic={topic} />
                          </div>
                        )}

                        <div className="min-w-0 flex-1">
                          {isEditing ? (
                            <div className="flex items-center gap-1.5">
                              <input
                                autoFocus
                                value={editingText}
                                onChange={(e) => setEditingText(e.target.value)}
                                onKeyDown={(e) => {
                                  if (
                                    e.key === "Enter" &&
                                    !e.nativeEvent.isComposing
                                  ) {
                                    e.preventDefault();
                                    editBriefText(item, editingText);
                                    setEditingId(null);
                                  } else if (e.key === "Escape") {
                                    setEditingId(null);
                                  }
                                }}
                                className={input}
                              />
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
                              <button
                                type="button"
                                onClick={() => setEditingId(null)}
                                className={btn.ghost}
                              >
                                {s.cancelEdit}
                              </button>
                            </div>
                          ) : (
                            <p className="text-body leading-relaxed text-fg">
                              {item.taskId ? (
                                <button
                                  type="button"
                                  onClick={() =>
                                    item.taskId && openTask(item.taskId)
                                  }
                                  className="text-left hover:underline"
                                >
                                  {item.text}
                                </button>
                              ) : (
                                item.text
                              )}
                            </p>
                          )}
                        </div>

                        {!isEditing && (
                          <div className="flex shrink-0 items-center gap-1.5">
                            {item.source === "deploy" && (
                              <Chip tone="ok">
                                {item.ref
                                  ? s.deployedTo(item.ref)
                                  : s.briefSource.deploy}
                              </Chip>
                            )}
                            {item.source === "task" && (
                              <Chip>{s.briefSource.task}</Chip>
                            )}
                            {item.source === "manual" && (
                              <Chip>{s.briefSource.manual}</Chip>
                            )}
                            {item.source === "commit" && item.ref && (
                              <span className="font-mono text-meta tabular-nums text-fg-faint">
                                {item.ref}
                              </span>
                            )}

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
                              className="grid size-6 place-items-center rounded-sm text-fg-faint opacity-50 transition-opacity group-hover:opacity-100 focus:opacity-100 hover:bg-(--ui-control-hover-background) hover:text-fg"
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
              </div>
            );
          })
        )}
      </div>
    </Panel>
  );
}
