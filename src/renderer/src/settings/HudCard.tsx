import { useEffect, useState } from "react";
import type { HudSettings, HudSettingsView } from "@shared/ipc";
import { SegmentedSwitch } from "../ui/SegmentedSwitch";
import { Card } from "../shell/page-primitives";
import { cx } from "../ui/atoms";
import { useI18n } from "../i18n";

/**
 * The "HUD" card in Settings → Appearance: turn the overlay (Agent HUD's strip and glow) on or off,
 * and with more than one display attached, pick the screen it sits on. Main applies each change at
 * once and answers with the new view.
 */
export function HudCard() {
  const { t } = useI18n();
  const [view, setView] = useState<HudSettingsView | null>(null);
  useEffect(() => {
    void window.api.getHudSettings().then(setView);
  }, []);
  if (!view) return null;

  const save = (next: HudSettings) => {
    setView({ ...view, settings: next });
    void window.api.setHudSettings(next).then(setView);
  };
  const { enabled } = view.settings;
  const primaryId = view.displays.find((d) => d.primary)?.id ?? "";
  const current =
    view.displays.find((d) => d.id === view.settings.display)?.id ?? primaryId;
  let n = 1;
  const displayOptions = view.displays.map((d) => ({
    value: d.id,
    label: d.primary ? t.settings.hud.primary : t.settings.hud.screen(++n),
    icon: "monitor" as const,
  }));

  return (
    <Card title={t.settings.hud.title}>
      <div className="flex items-center justify-between gap-4 px-4 py-3">
        <div className="min-w-0">
          <div className="text-body text-fg">{t.settings.hud.enabled}</div>
          <div className="mt-0.5 text-meta text-fg-faint">
            {t.settings.hud.enabledDesc}
          </div>
        </div>
        <button
          type="button"
          role="switch"
          aria-checked={enabled}
          aria-label={t.settings.hud.enabled}
          onClick={() => save({ ...view.settings, enabled: !enabled })}
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
      {enabled && view.displays.length > 1 && (
        <div className="flex items-center justify-between gap-4 border-t border-ink-850 px-4 py-3">
          <div className="min-w-0">
            <div className="text-body text-fg">{t.settings.hud.display}</div>
            <div className="mt-0.5 text-meta text-fg-faint">
              {t.settings.hud.displayDesc}
            </div>
          </div>
          <SegmentedSwitch<string>
            ariaLabel={t.settings.hud.display}
            value={current}
            onChange={(id) =>
              save({
                ...view.settings,
                display: id === primaryId ? null : id,
              })
            }
            options={displayOptions}
          />
        </div>
      )}
    </Card>
  );
}
