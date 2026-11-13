import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { addDays, mergedDailyBriefs, splitPendingQueue } from "@shared/board";
import { shortTopicName } from "@shared/products";
import { cx } from "../ui/atoms";
import { Icon } from "../ui/icons";
import { buildLiveByTask, useBoardCtx } from "./context";
import { btn } from "./parts";

const MAX_INLINE_TOPICS = 5;

/**
 * Single-row borderless product filter strip replacing the old 176px vertical `TopicRail`.
 * Overflow topics tuck into a compact `More N` menu so narrow desktop windows (`1084×655`) never
 * wrap into a multi-row header stack.
 */
export function TopicBar({
  topic,
  onTopic,
  onManage,
}: {
  topic: string;
  onTopic: (key: string) => void;
  onManage: () => void;
}) {
  const { rawDoc, topics, sessionsById, today, s } = useBoardCtx();
  const [moreOpen, setMoreOpen] = useState(false);
  const moreRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!moreOpen) return;
    const onDown = (e: MouseEvent) => {
      if (moreRef.current && !moreRef.current.contains(e.target as Node)) {
        setMoreOpen(false);
      }
    };
    window.addEventListener("mousedown", onDown);
    return () => window.removeEventListener("mousedown", onDown);
  }, [moreOpen]);

  const stats = useMemo(() => {
    const liveByTask = buildLiveByTask(rawDoc.tasks, sessionsById);
    const { confirm, execute } = splitPendingQueue(
      rawDoc.tasks,
      today,
      liveByTask,
    );
    const openByTopic = new Map<string, number>();
    const confirmByTopic = new Set<string>();
    for (const t of confirm) {
      const k = t.topic ?? "none";
      openByTopic.set(k, (openByTopic.get(k) ?? 0) + 1);
      confirmByTopic.add(k);
    }
    for (const t of execute) {
      const k = t.topic ?? "none";
      openByTopic.set(k, (openByTopic.get(k) ?? 0) + 1);
    }

    const cutoff = addDays(today, -6);
    const recentBriefByTopic = new Map<string, number>();
    for (const b of mergedDailyBriefs(rawDoc)) {
      if (b.date < cutoff) continue;
      const k = b.topic ?? "none";
      recentBriefByTopic.set(k, (recentBriefByTopic.get(k) ?? 0) + 1);
    }

    const totalOpen = confirm.length + execute.length;
    const list = Object.values(topics).sort((a, b) => {
      const ac = confirmByTopic.has(a.key) ? 0 : 1;
      const bc = confirmByTopic.has(b.key) ? 0 : 1;
      if (ac !== bc) return ac - bc;
      const ao = openByTopic.get(a.key) ?? 0;
      const bo = openByTopic.get(b.key) ?? 0;
      if (ao !== bo) return bo - ao;
      const ab = recentBriefByTopic.get(a.key) ?? 0;
      const bb = recentBriefByTopic.get(b.key) ?? 0;
      if (ab !== bb) return bb - ab;
      return a.name.localeCompare(b.name, "zh-Hans-CN");
    });

    const untaggedCount =
      (openByTopic.get("none") ?? 0) + (recentBriefByTopic.get("none") ?? 0);

    return {
      totalOpen,
      list,
      openByTopic,
      confirmByTopic,
      untaggedOpen: openByTopic.get("none") ?? 0,
      hasUntagged: untaggedCount > 0,
    };
  }, [rawDoc, topics, sessionsById, today]);

  if (stats.list.length === 0) return null;

  // Keep the active product visible inline even if it falls outside the top 5.
  const inlineTopics = (() => {
    const head = stats.list.slice(0, MAX_INLINE_TOPICS);
    if (
      topic !== "all" &&
      topic !== "none" &&
      !head.some((x) => x.key === topic)
    ) {
      const activeItem = stats.list.find((x) => x.key === topic);
      if (activeItem) {
        return [...head.slice(0, MAX_INLINE_TOPICS - 1), activeItem];
      }
    }
    return head;
  })();

  const inlineKeys = new Set(inlineTopics.map((x) => x.key));
  const overflowTopics = stats.list.filter((x) => !inlineKeys.has(x.key));
  const showUntaggedInMenu = stats.hasUntagged && topic !== "none";
  const overflowCount = overflowTopics.length + (showUntaggedInMenu ? 1 : 0);
  const overflowAttention =
    overflowTopics.some((x) => stats.confirmByTopic.has(x.key)) ||
    (showUntaggedInMenu && stats.confirmByTopic.has("none"));

  return (
    <div className="flex shrink-0 items-center justify-between gap-2 border-b border-ink-850 px-5 pb-2">
      <div className="flex min-w-0 flex-1 items-center gap-1">
        <FilterPill
          active={topic === "all"}
          onClick={() => onTopic("all")}
          count={stats.totalOpen > 0 ? stats.totalOpen : undefined}
        >
          {s.topicsAll}
        </FilterPill>

        {inlineTopics.map((p) => {
          const open = stats.openByTopic.get(p.key) ?? 0;
          const hasConfirm = stats.confirmByTopic.has(p.key);
          return (
            <FilterPill
              key={p.key}
              active={topic === p.key}
              onClick={() => onTopic(topic === p.key ? "all" : p.key)}
              squareColor={p.color}
              attention={hasConfirm}
              count={open > 0 ? open : undefined}
            >
              {shortTopicName(p.name)}
            </FilterPill>
          );
        })}

        {topic === "none" && (
          <FilterPill
            active
            onClick={() => onTopic("all")}
            attention={stats.confirmByTopic.has("none")}
            count={stats.untaggedOpen > 0 ? stats.untaggedOpen : undefined}
          >
            {s.topicsNone}
          </FilterPill>
        )}

        {overflowCount > 0 && (
          <div ref={moreRef} className="relative">
            <button
              type="button"
              aria-expanded={moreOpen}
              onClick={() => setMoreOpen((v) => !v)}
              className={cx(
                "inline-flex h-6 shrink-0 items-center gap-1 rounded-md px-2 text-aux transition-colors duration-100",
                moreOpen
                  ? "bg-(--ui-control-active-background) text-fg"
                  : "text-fg-faint hover:bg-(--ui-control-hover-background) hover:text-fg",
              )}
            >
              {overflowAttention && (
                <span aria-hidden className="size-1.5 rounded-full bg-accent" />
              )}
              <span>{s.topicsMore(overflowCount)}</span>
              <Icon name="chevron-down" size={12} />
            </button>

            {moreOpen && (
              <div className="absolute left-0 top-7 z-20 flex min-w-44 flex-col gap-0.5 rounded-lg border border-ink-800 bg-ink-900 p-1 shadow-xl">
                {overflowTopics.map((p) => {
                  const open = stats.openByTopic.get(p.key) ?? 0;
                  const hasConfirm = stats.confirmByTopic.has(p.key);
                  return (
                    <button
                      key={p.key}
                      type="button"
                      onClick={() => {
                        onTopic(p.key);
                        setMoreOpen(false);
                      }}
                      className="flex h-7 items-center gap-2 rounded-md px-2 text-left text-aux text-fg-muted hover:bg-(--ui-row-hover-background) hover:text-fg"
                    >
                      <span
                        aria-hidden
                        className="size-2 shrink-0 rounded-[2px]"
                        style={{ background: p.color }}
                      />
                      <span className="min-w-0 flex-1 truncate">
                        {shortTopicName(p.name)}
                      </span>
                      {hasConfirm && (
                        <span
                          aria-hidden
                          className="size-1.5 rounded-full bg-accent"
                        />
                      )}
                      {open > 0 && (
                        <span className="font-mono text-meta tabular-nums text-fg-faint">
                          {open}
                        </span>
                      )}
                    </button>
                  );
                })}
                {showUntaggedInMenu && (
                  <button
                    type="button"
                    onClick={() => {
                      onTopic("none");
                      setMoreOpen(false);
                    }}
                    className="flex h-7 items-center gap-2 rounded-md px-2 text-left text-aux text-fg-muted hover:bg-(--ui-row-hover-background) hover:text-fg"
                  >
                    <span className="min-w-0 flex-1 truncate">
                      {s.topicsNone}
                    </span>
                    {stats.untaggedOpen > 0 && (
                      <span className="font-mono text-meta tabular-nums text-fg-faint">
                        {stats.untaggedOpen}
                      </span>
                    )}
                  </button>
                )}
              </div>
            )}
          </div>
        )}
      </div>

      <button
        type="button"
        onClick={onManage}
        className={cx(btn.ghost, "h-6 px-2 text-aux text-fg-faint")}
      >
        <Icon name="settings" size={12} />
        {s.topicsManage}
      </button>
    </div>
  );
}

function FilterPill({
  active,
  onClick,
  squareColor,
  attention,
  count,
  children,
}: {
  active: boolean;
  onClick: () => void;
  squareColor?: string;
  attention?: boolean;
  count?: number;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={onClick}
      className={cx(
        "inline-flex h-6 shrink-0 items-center gap-1.5 rounded-md px-2 text-aux transition-colors duration-100",
        active
          ? "bg-(--ui-control-active-background) font-medium text-fg"
          : "text-fg-faint hover:bg-(--ui-control-hover-background) hover:text-fg",
      )}
    >
      {squareColor && (
        <span
          aria-hidden
          className="size-2 shrink-0 rounded-[2px]"
          style={{ background: squareColor }}
        />
      )}
      <span>{children}</span>
      {count !== undefined && (
        <span
          className={cx(
            "inline-flex items-center gap-1 font-mono text-meta tabular-nums",
            active ? "text-fg-muted" : "text-fg-faint",
          )}
        >
          {attention && (
            <span aria-hidden className="size-1.5 rounded-full bg-accent" />
          )}
          {count}
        </span>
      )}
    </button>
  );
}
