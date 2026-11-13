import { cx, focusRing } from "./atoms";
import { Icon, type IconName } from "./icons";

/** One tab in a {@link Tabs} bar. */
export interface TabItem<T extends string> {
  id: T;
  label: string;
  /** Optional leading glyph. */
  icon?: IconName;
  /** Optional status circle class (e.g. `bg-accent` or `bg-working`; DESIGN.md: circle = status). */
  dotClassName?: string;
  /** Optional product color swatch (`2px` corner square; DESIGN.md: square = product). */
  swatchColor?: string;
  /** Optional trailing count badge (the Activity dock's Tasks/Subagents/Shells tabs). */
  count?: number;
}

/**
 * The app's tab control: a single trackless underline switcher (active = a 2px rule under the label,
 * pulled down 1px to sit on the bar's own border). The Activity dock is its sole consumer. Each tab can
 * carry a leading icon/status/product mark, a trailing count, or both.
 */
export function Tabs<T extends string>({
  tabs,
  value,
  onChange,
}: {
  tabs: TabItem<T>[];
  value: T;
  onChange: (id: T) => void;
}) {
  return (
    <div className="flex items-stretch">
      {tabs.map((t) => {
        const active = value === t.id;
        return (
          <button
            key={t.id}
            type="button"
            onClick={() => onChange(t.id)}
            aria-pressed={active}
            className={cx(
              "-mb-px inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap border-b-2 px-3 text-aux transition-colors",
              focusRing,
              active
                ? "border-(--ui-text-primary) font-medium text-fg"
                : "border-transparent text-fg-faint hover:text-fg",
            )}
          >
            {t.icon && <Icon name={t.icon} size={13} />}
            {t.swatchColor && (
              <span
                aria-hidden
                className="size-2 shrink-0 rounded-[2px]"
                style={{ background: t.swatchColor }}
              />
            )}
            {t.dotClassName && (
              <span
                aria-hidden
                className={cx("size-1.5 shrink-0 rounded-full", t.dotClassName)}
              />
            )}
            {t.label}
            {t.count !== undefined && (
              <span className="font-mono text-meta tabular-nums text-fg-faint">
                {t.count}
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}
