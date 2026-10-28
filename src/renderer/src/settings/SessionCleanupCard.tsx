import { useEffect, useState } from "react";
import { formatBytes } from "@shared/format";
import {
  CLEANUP_DAY_CHOICES,
  type SessionCleanupSettings,
  type SessionCleanupView,
} from "@shared/session-cleanup";
import { Card } from "../shell/page-primitives";
import { cx } from "../ui/atoms";
import { Icon } from "../ui/icons";
import { useI18n } from "../i18n";

/**
 * Settings → Data & cleanup → "Automatic cleanup" (fork feature, 2026-10-28): the switch, how many
 * idle days count as old, what a run would take right now, and a manual run behind a confirm.
 */
export function SessionCleanupCard() {
  const { t } = useI18n();
  const L = t.settings.cleanup;
  const [view, setView] = useState<SessionCleanupView | null>(null);
  const [armed, setArmed] = useState(false);
  const [running, setRunning] = useState(false);
  useEffect(() => {
    void window.api.getSessionCleanup().then(setView);
  }, []);
  useEffect(() => {
    if (!armed) return;
    const timer = setTimeout(() => setArmed(false), 4000);
    return () => clearTimeout(timer);
  }, [armed]);
  if (!view) return null;

  const save = (next: SessionCleanupSettings) => {
    setView({ ...view, settings: next });
    void window.api.setSessionCleanup(next).then(setView);
  };
  const { enabled, days } = view.settings;
  const { count, bytes, kept } = view.preview;
  const keptAny = kept.pinned + kept.board + kept.renamed > 0;
  const busy = running || view.running;
  const last = view.lastRun;

  return (
    <Card title={L.title}>
      <div className="flex items-center justify-between gap-4 px-4 py-3">
        <div className="min-w-0">
          <div className="text-body text-fg">{L.enabled}</div>
          <div className="mt-0.5 text-meta text-fg-faint">{L.enabledDesc}</div>
        </div>
        <button
          type="button"
          role="switch"
          aria-checked={enabled}
          aria-label={L.enabled}
          onClick={() => save({ enabled: !enabled, days })}
          className={cx(
            "relative h-[18px] w-8 shrink-0 rounded-full transition-colors",
            enabled ? "bg-primary" : "bg-ink-700",
          )}
        >
          <span
            className={cx(
              "absolute top-[2px] h-[14px] w-[14px] rounded-full transition-all",
              enabled ? "right-[2px] bg-ink-900" : "left-[2px] bg-white",
            )}
          />
        </button>
      </div>
      <div className="flex items-center justify-between gap-4 border-t border-ink-850 px-4 py-3">
        <div className="text-body text-fg">{L.days}</div>
        <div
          role="group"
          aria-label={L.days}
          className="flex shrink-0 items-center rounded-sm border border-(--ui-stroke-tertiary) p-[2px]"
        >
          {CLEANUP_DAY_CHOICES.map((d) => (
            <button
              key={d}
              type="button"
              aria-pressed={d === days}
              onClick={() => d !== days && save({ enabled, days: d })}
              className={cx(
                "h-6 rounded-[3px] px-2 text-meta tabular-nums transition-colors",
                d === days
                  ? "bg-ink-800 text-fg"
                  : "text-fg-faint hover:text-fg",
              )}
            >
              {L.daysUnit(d)}
            </button>
          ))}
        </div>
      </div>
      <div className="flex items-center justify-between gap-4 border-t border-ink-850 px-4 py-3">
        <div className="min-w-0">
          <div className="text-body text-fg tabular-nums">
            {L.preview(count, formatBytes(bytes))}
          </div>
          {(keptAny || last) && (
            <div className="mt-0.5 text-meta text-fg-faint tabular-nums">
              {keptAny && L.kept(kept.pinned, kept.board, kept.renamed)}
              {keptAny && last && " · "}
              {last &&
                L.lastRun(
                  new Date(last.at).toLocaleString(undefined, {
                    month: "numeric",
                    day: "numeric",
                    hour: "2-digit",
                    minute: "2-digit",
                  }),
                  last.trashed,
                  formatBytes(last.bytes),
                  last.failed,
                )}
            </div>
          )}
        </div>
        <button
          type="button"
          disabled={busy || count === 0}
          onClick={() => {
            if (!armed) return setArmed(true);
            setArmed(false);
            setRunning(true);
            void window.api
              .runSessionCleanup()
              .then(setView)
              .finally(() => setRunning(false));
          }}
          className={cx(
            "inline-flex h-7 shrink-0 items-center gap-1.5 rounded-md border px-2.5 text-meta transition-colors disabled:opacity-40",
            armed
              ? "border-danger/60 text-danger hover:bg-danger/10"
              : "border-(--ui-stroke-tertiary) text-fg-muted hover:bg-ink-850 hover:text-fg",
          )}
        >
          <Icon
            name={busy ? "loader-circle" : "trash"}
            size={12}
            className={busy ? "animate-spin" : ""}
          />
          {busy ? L.running : armed ? L.confirm(count) : L.run}
        </button>
      </div>
    </Card>
  );
}
