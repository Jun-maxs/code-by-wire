import { useEffect, useState } from "react";
import type { LoginItem } from "@shared/ipc";
import { Card } from "../shell/page-primitives";
import { cx } from "../ui/atoms";
import { useI18n } from "../i18n";

/**
 * Fork (2026-11-09): "Launch at login" in Settings → Appearance. It lived on the HUD's General page;
 * the HUD is gone (DeskTidy's top island took over), so the switch moved here. Hidden where the OS
 * login item can't be set. Main applies the change and answers with what the OS now has.
 */
export function LaunchAtLoginCard() {
  const { t } = useI18n();
  const [item, setItem] = useState<LoginItem | null>(null);
  useEffect(() => {
    void window.api.getLoginItem().then(setItem);
  }, []);
  if (!item?.supported) return null;

  const { enabled } = item;
  const toggle = () => {
    setItem({ ...item, enabled: !enabled });
    void window.api.setLoginItem(!enabled).then(setItem);
  };

  return (
    <Card title={t.settings.launchAtLogin.title}>
      <div className="flex items-center justify-between gap-4 px-4 py-3">
        <div className="min-w-0">
          <div className="text-body text-fg">
            {t.settings.launchAtLogin.enabled}
          </div>
          <div className="mt-0.5 text-meta text-fg-faint">
            {t.settings.launchAtLogin.enabledDesc}
          </div>
        </div>
        <button
          type="button"
          role="switch"
          aria-checked={enabled}
          aria-label={t.settings.launchAtLogin.enabled}
          onClick={toggle}
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
    </Card>
  );
}
