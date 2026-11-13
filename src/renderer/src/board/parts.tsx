import type { ReactNode } from "react";
import type { Priority, RiskLevel, TaskStatus } from "@shared/board";
import { shortTopicName, type ProductInfo } from "@shared/products";
import { cx } from "../ui/atoms";

/** Status hues reuse the app's session-state colors: live teal, waiting amber, ok green, idle gray. */
export const STATUS_BG: Record<TaskStatus, string> = {
  todo: "bg-idle",
  doing: "bg-working",
  decide: "bg-accent",
  done: "bg-ok",
};

/** Priority reads as weight, not hue or circle dots (DESIGN.md): amber means "waiting on you", circles mean state. */
export const PRIORITY_DOT: Record<Priority, string> = {
  P0: "bg-fg",
  P1: "bg-fg-faint",
  P2: "bg-ink-600",
};

export const PRIORITY_TEXT: Record<Priority, string> = {
  P0: "font-semibold text-fg",
  P1: "text-fg-muted",
  P2: "text-fg-faint",
};

/** Risk levels mark a dot, not the whole chip (DESIGN.md: state hues only on state marks). */
export const LEVEL_DOT: Record<RiskLevel, string> = {
  high: "bg-danger",
  mid: "bg-accent",
  low: "bg-idle",
};
export const LEVEL_TEXT: Record<RiskLevel, string> = {
  high: "text-danger",
  mid: "text-accent",
  low: "text-fg-faint",
};

export function Dot({ className }: { className: string }) {
  return (
    <span
      aria-hidden
      className={cx("size-2 shrink-0 rounded-full", className)}
    />
  );
}

/** A small tag/status/topic pill. Topic pills use soft fill + sharp square mark (no harsh border). */
export function Chip({
  children,
  tone = "plain",
  color,
  className,
}: {
  children: ReactNode;
  tone?: "plain" | RiskLevel | "ok";
  /** A topic color: tints the chip's sharp square mark (DESIGN.md: square = topic, circle = state). */
  color?: string;
  className?: string;
}) {
  return (
    <span
      className={cx(
        "inline-flex h-[18px] shrink-0 items-center gap-1.5 rounded-sm px-1.5 text-meta leading-none",
        color
          ? "bg-ink-900 text-fg-muted"
          : tone === "plain"
            ? "bg-ink-900 text-fg-faint"
            : "bg-(--ui-bg-quaternary) text-fg-muted",
        className,
      )}
    >
      {tone === "ok" && (
        <span aria-hidden className="size-1.5 rounded-full bg-ok" />
      )}
      {tone !== "plain" && tone !== "ok" && (
        <span
          aria-hidden
          className={cx("size-1.5 rounded-full", LEVEL_DOT[tone])}
        />
      )}
      {color && (
        <span
          aria-hidden
          className="size-2 shrink-0 rounded-[2px]"
          style={{ background: color }}
        />
      )}
      {children}
    </span>
  );
}

export function TopicChip({
  topic,
  className,
}: {
  topic: ProductInfo | undefined;
  className?: string;
}) {
  if (!topic) return null;
  return (
    <Chip color={topic.color} className={className}>
      {shortTopicName(topic.name)}
    </Chip>
  );
}

/** Render inline Markdown backticks (`code`) as quiet borderless monospace pills instead of raw `` ` `` chars. */
export function InlineCodeText({ text }: { text: string }) {
  if (!text.includes("`")) return <>{text}</>;
  const parts = text.split(/(`[^`\n]+`)/g);
  return (
    <>
      {parts.map((part, i) =>
        part.length >= 3 && part.startsWith("`") && part.endsWith("`") ? (
          <code
            key={i}
            className="rounded-sm bg-ink-900 px-1 py-px font-mono text-aux text-fg-muted"
          >
            {part.slice(1, -1)}
          </code>
        ) : (
          <span key={i}>{part}</span>
        ),
      )}
    </>
  );
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
        className={cx(
          "h-full rounded-full",
          status === "done" ? "bg-fg/30" : "bg-fg/60",
        )}
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
        "@container flex min-w-0 flex-col rounded-xl border border-ink-800 bg-ink-925",
        className,
      )}
    >
      {title && (
        <header className="flex flex-col gap-1 border-b border-ink-850 px-4 py-2.5">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className="text-subhead font-semibold text-fg">{title}</h2>
            {right}
          </div>
          {lede && (
            <p className="line-clamp-1 text-meta text-fg-faint">{lede}</p>
          )}
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
    "inline-flex h-7 shrink-0 items-center gap-1.5 whitespace-nowrap rounded-md px-2 text-body text-fg-muted transition-colors duration-100 hover:bg-(--ui-control-hover-background) hover:text-fg disabled:opacity-50",
  outline:
    "inline-flex h-7 shrink-0 items-center gap-1.5 whitespace-nowrap rounded-md border border-(--ui-stroke-tertiary) px-2.5 text-body text-fg-muted transition-colors duration-100 hover:bg-(--ui-control-hover-background) hover:text-fg disabled:opacity-50",
  primary:
    "inline-flex h-7 shrink-0 items-center gap-1.5 whitespace-nowrap rounded-md bg-primary px-2.5 text-body font-medium text-ink-950 transition-colors duration-100 hover:bg-primary-bright disabled:opacity-50",
  compact:
    "inline-flex h-6 shrink-0 items-center gap-1 whitespace-nowrap rounded-sm border border-(--ui-stroke-tertiary) px-2 text-aux text-fg-muted transition-colors duration-100 hover:bg-(--ui-control-hover-background) hover:text-fg disabled:opacity-50",
  soft: "inline-flex h-6 shrink-0 items-center gap-1 whitespace-nowrap rounded-sm bg-ink-900 px-2 text-aux text-fg-muted transition-colors duration-100 hover:bg-ink-800 hover:text-fg disabled:opacity-50",
};

export const inputInline =
  "h-7 rounded-md border border-(--ui-stroke-tertiary) bg-well px-2 text-ellipsis text-body text-fg outline-none placeholder:text-fg-dim focus:border-(--ui-stroke-primary)";

export const input = `${inputInline} w-full`;
