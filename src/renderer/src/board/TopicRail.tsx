import type { BoardTask } from "@shared/board";
import { cx } from "../ui/atoms";
import { Icon } from "../ui/icons";
import { useBoardCtx } from "./context";
import { shortTopicName } from "./parts";

/** The board's topic column: filter every page to one topic (or to tasks without one), and open
 *  the topic-word editor without leaving the board. Counts are open tasks. */
export function TopicRail({
  topic,
  onTopic,
  onManage,
  tasks,
}: {
  topic: string;
  onTopic: (t: string) => void;
  onManage: () => void;
  /** The whole board's tasks (not the filtered view), for the counts. */
  tasks: BoardTask[];
}) {
  const { s, topics } = useBoardCtx();
  const open = tasks.filter((t) => t.status !== "done");
  const count = (k: string | null) =>
    open.filter((t) => (k === null ? !t.topic : t.topic === k)).length;
  const rows: { id: string; label: string; color?: string; n: number }[] = [
    { id: "all", label: s.topicsAll, n: open.length },
    ...Object.values(topics)
      .map((p) => ({
        id: p.key,
        label: shortTopicName(p.name),
        color: p.color,
        n: count(p.key),
      }))
      .sort((a, b) => b.n - a.n),
    { id: "none", label: s.topicsNone, n: count(null) },
  ];
  return (
    <nav
      aria-label={s.topicsTitle}
      className="flex w-44 shrink-0 flex-col gap-px border-r border-ink-850 px-2 pb-3"
    >
      <p className="px-2 pb-1.5 pt-0.5 text-meta font-medium text-fg-faint">
        {s.topicsTitle}
      </p>
      <div className="flex min-h-0 flex-1 flex-col gap-px overflow-y-auto">
        {rows.map((r) => (
          <button
            key={r.id}
            type="button"
            aria-pressed={topic === r.id}
            onClick={() => onTopic(r.id)}
            className={cx(
              "flex h-7 shrink-0 items-center gap-2 rounded-md px-2 text-left text-body transition-colors duration-100",
              topic === r.id
                ? "bg-(--ui-control-active-background) font-medium text-fg"
                : "text-fg-muted hover:bg-(--ui-control-hover-background) hover:text-fg",
            )}
          >
            {r.color ? (
              <span
                aria-hidden
                className="size-2 shrink-0 rounded-[2px]"
                style={{ background: r.color }}
              />
            ) : (
              <span
                aria-hidden
                className={cx(
                  "size-2 shrink-0 rounded-full",
                  r.id === "all"
                    ? "bg-fg-muted"
                    : "border border-(--ui-stroke-primary)",
                )}
              />
            )}
            <span className="min-w-0 flex-1 truncate">{r.label}</span>
            {r.n > 0 && (
              <span className="font-mono text-meta tabular-nums text-fg-faint">
                {r.n}
              </span>
            )}
          </button>
        ))}
      </div>
      <button
        type="button"
        onClick={onManage}
        className="mt-1 flex h-7 items-center gap-2 rounded-md px-2 text-aux text-fg-faint transition-colors duration-100 hover:bg-(--ui-control-hover-background) hover:text-fg"
      >
        <Icon name="tag" size={13} />
        {s.topicsManage}
      </button>
    </nav>
  );
}
