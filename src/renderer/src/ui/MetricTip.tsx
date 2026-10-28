import { useId, type ReactNode } from "react";
import { cx } from "./atoms";

/** A tooltip whose TRIGGER is the metric label itself (dotted underline on hover only — a column of always-underlined labels read as links; 2026-10-28), not a separate ⓘ.
 *  CSS-only reveal scoped to this label's `group`, mirroring InfoButton: it survives re-renders and the
 *  cursor can move into the popover. The label is keyboard-focusable so the popover opens on focus too, and
 *  wired via aria-describedby for screen readers. The caller supplies the popover position/width/chrome
 *  through popoverClassName (absolute against the nearest positioned ancestor). */
export function MetricTip({
  label,
  popoverClassName,
  children,
}: {
  label: ReactNode;
  popoverClassName?: string;
  children: ReactNode;
}) {
  const tooltipId = useId();
  return (
    <span className="group relative inline-flex">
      <span
        tabIndex={0}
        aria-describedby={tooltipId}
        className="cursor-help decoration-dotted decoration-fg-muted underline-offset-2 hover:underline focus-visible:underline focus-visible:outline-none"
      >
        {label}
      </span>
      <span
        role="tooltip"
        id={tooltipId}
        className={cx(
          "absolute z-20 hidden group-hover:block group-focus-within:block",
          popoverClassName,
        )}
      >
        {children}
      </span>
    </span>
  );
}
