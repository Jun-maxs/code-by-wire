import type { ReactNode } from "react";
import type {
  BoardTask,
  Priority,
  RiskLevel,
  TaskRisk,
  TaskStatus,
} from "@shared/board";
import type { ProductInfo } from "@shared/products";
import { cx } from "../ui/atoms";

/** Status hues reuse the app's session-state colors: live teal, waiting amber, ok green, idle gray. */
export const STATUS_BG: Record<TaskStatus, string> = {
  todo: "bg-idle",
  doing: "bg-working",
  decide: "bg-accent",
  done: "bg-ok",
};
export const STATUS_VAR: Record<TaskStatus, string> = {
  todo: "var(--color-idle)",
  doing: "var(--color-working)",
  decide: "var(--color-accent)",
  done: "var(--color-ok)",
};

export const PRIORITY_DOT: Record<Priority, string> = {
  P0: "bg-danger",
  P1: "bg-accent",
  P2: "bg-idle",
};

export const LEVEL_TONE: Record<RiskLevel, string> = {
  high: "border-danger/40 bg-danger/8",
  mid: "border-accent/40 bg-accent/8",
  low: "border-(--ui-stroke-secondary) bg-(--ui-bg-quaternary)",
};
export const LEVEL_TEXT: Record<RiskLevel, string> = {
  high: "text-danger",
  mid: "text-accent",
  low: "text-fg-faint",
};

export function riskLevel(r: TaskRisk): RiskLevel {
  return r === "overdue" ? "high" : r === "tight" ? "mid" : "low";
}

export function Dot({ className }: { className: string }) {
  return (
    <span
      aria-hidden
      className={cx("size-2 shrink-0 rounded-full", className)}
    />
  );
}

/** A small outlined chip: tags, risk labels, topic names. */
export function Chip({
  children,
  tone = "plain",
  color,
}: {
  children: ReactNode;
  tone?: "plain" | RiskLevel;
  /** A topic color: tints the chip's dot. */
  color?: string;
}) {
  return (
    <span
      className={cx(
        "inline-flex h-[18px] shrink-0 items-center gap-1 rounded-sm border px-1.5 text-meta leading-none",
        tone === "plain"
          ? "border-(--ui-stroke-tertiary) text-fg-faint"
          : cx(LEVEL_TONE[tone], LEVEL_TEXT[tone]),
      )}
    >
      {color && (
        <span
          aria-hidden
          className="size-1.5 rounded-full"
          style={{ background: color }}
        />
      )}
      {children}
    </span>
  );
}

export function TopicChip({ topic }: { topic: ProductInfo | undefined }) {
  if (!topic) return null;
  return <Chip color={topic.color}>{shortTopicName(topic.name)}</Chip>;
}

/** "驾驶舱（Code-by-wire/工作台）" → "驾驶舱": the gloss in brackets is for Settings, not chips. */
export function shortTopicName(name: string): string {
  return name.replace(/\s*[（(].*$/, "").trim() || name;
}

/** A thin progress rule. */
export function Progress({
  value,
  status,
  className,
}: {
  value: number;
  status: TaskStatus;
  className?: string;
}) {
  return (
    <div
      className={cx(
        "h-[3px] overflow-hidden rounded-full bg-(--ui-bg-tertiary)",
        className,
      )}
    >
      <div
        className={cx("h-full rounded-full", STATUS_BG[status])}
        style={{ width: `${Math.round(value * 100)}%` }}
      />
    </div>
  );
}

/** A bordered panel, the board's card surface (same skin as Settings/Stats cards). */
export function Panel({
  title,
  lede,
  right,
  children,
  className,
}: {
  title?: string;
  lede?: string;
  right?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section
      className={cx(
        "flex min-w-0 flex-col rounded-xl border border-ink-800 bg-ink-925",
        className,
      )}
    >
      {title && (
        <header className="flex items-start justify-between gap-3 px-4 pt-3.5">
          <div className="min-w-0">
            <h2 className="text-subhead font-semibold text-fg">{title}</h2>
            {lede && <p className="mt-0.5 text-meta text-fg-faint">{lede}</p>}
          </div>
          {right}
        </header>
      )}
      {children}
    </section>
  );
}

/** A ring gauge for a 0–1 fraction, label in the middle. */
export function Ring({
  value,
  size = 44,
  stroke = 3,
  color = "var(--color-fg)",
  children,
}: {
  value: number;
  size?: number;
  stroke?: number;
  color?: string;
  children?: ReactNode;
}) {
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const v = Math.max(0, Math.min(1, value));
  return (
    <div
      className="relative grid shrink-0 place-items-center"
      style={{ width: size, height: size }}
    >
      <svg width={size} height={size} className="-rotate-90">
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          stroke="var(--ui-bg-tertiary)"
          strokeWidth={stroke}
        />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          stroke={color}
          strokeWidth={stroke}
          strokeLinecap="round"
          strokeDasharray={`${c * v} ${c}`}
        />
      </svg>
      <div className="absolute inset-0 grid place-items-center">{children}</div>
    </div>
  );
}

/** Button skins shared across the board. */
export const btn = {
  ghost:
    "inline-flex h-7 items-center gap-1.5 rounded-md px-2 text-body text-fg-muted transition-colors duration-100 hover:bg-(--ui-control-hover-background) hover:text-fg disabled:opacity-50",
  outline:
    "inline-flex h-7 items-center gap-1.5 rounded-md border border-(--ui-stroke-tertiary) px-2.5 text-body text-fg-muted transition-colors duration-100 hover:bg-(--ui-control-hover-background) hover:text-fg disabled:opacity-50",
  primary:
    "inline-flex h-7 items-center gap-1.5 rounded-md bg-primary px-2.5 text-body font-medium text-ink-950 transition-colors duration-100 hover:bg-primary-bright disabled:opacity-50",
};

export const input =
  "h-7 w-full rounded-md border border-(--ui-stroke-tertiary) bg-well px-2 text-body text-fg outline-none placeholder:text-fg-faint focus:border-(--ui-stroke-primary)";

export function taskMatches(t: BoardTask, q: string): boolean {
  if (!q) return true;
  const s = q.toLowerCase();
  return (
    t.title.toLowerCase().includes(s) ||
    t.tags.some((x) => x.toLowerCase().includes(s)) ||
    t.notes.toLowerCase().includes(s)
  );
}
