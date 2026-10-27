import { invoke, isTauri } from "@tauri-apps/api/core";
import { useEffect, useState } from "react";
import { TooltipProvider } from "@agent-hud/ui/components/tooltip";
import {
  Divider,
  Menu,
  Row,
  secondary,
  Section,
  Segments,
  ToggleRow,
  useText,
  type SettingsPaneProps,
} from "./SettingsPrimitives";

export function GeneralPane({ snapshot, action }: SettingsPaneProps) {
  useEffect(() => {
    if (isTauri())
      void invoke("native_system_status").catch((error) =>
        console.warn("System preferences could not be refreshed", error),
      );
  }, []);
  const t = useText(snapshot);
  const [hookPending, setHookPending] = useState(false);
  const [hookError, setHookError] = useState<string | null>(null);
  const hookStatus = snapshot.connection.clientHooks;
  const configureHooks = async (
    key: "clientHooks" | "approvalWaitMinutes",
    value: unknown,
  ) => {
    if (hookPending) return;
    setHookPending(true);
    setHookError(null);
    try {
      await action("set_setting", { key, value });
    } catch (failure) {
      setHookError(
        failure instanceof Error ? failure.message : String(failure),
      );
    } finally {
      setHookPending(false);
    }
  };
  const setting = (key: string, value: unknown) => {
    void configureHooks(key as "clientHooks", value);
  };
  const system = snapshot.connection.system;
  return (
    <TooltipProvider delayDuration={300}>
      <div
        className="source-settings-pane"
        style={{
          width: "100%",
          maxWidth: 640,
          display: "flex",
          flexDirection: "column",
          gap: 28,
        }}
      >
        <Section title={t("Appearance & language", "外观与语言")}>
          <Row title={t("Appearance", "外观")}>
            <Segments
              label={t("Appearance", "外观")}
              value={snapshot.settings.appearance}
              disabled={Boolean(snapshot.settings.appearanceFollowsScreen)}
              options={[
                ["system", t("System", "跟随系统")],
                ["light", t("Light", "浅色")],
                ["dark", t("Dark", "深色")],
              ]}
              change={(value) => setting("appearance", value)}
            />
          </Row>
          <Divider />
          <ToggleRow
            title={t("Match screen", "跟随所在屏幕")}
            tag={t("Experimental", "实验")}
            subtitle={t(
              "Match window appearance to the display's HUD.",
              "让窗口外观跟随所在屏幕的 HUD。",
            )}
            checked={snapshot.settings.appearanceFollowsScreen ?? false}
            change={(value) => setting("appearanceFollowsScreen", value)}
          />
          <Divider />
          <Row title={t("Language", "语言")}>
            <Menu
              label={t("Language", "语言")}
              value={
                snapshot.settings.language === "zh-Hans"
                  ? "zh-CN"
                  : snapshot.settings.language
              }
              options={[
                ["system", t("System", "跟随系统")],
                ["zh-CN", "中文"],
                ["en", "English"],
              ]}
              change={(value) => setting("language", value)}
            />
          </Row>
        </Section>
        <Section title={t("Usage display", "用量显示")}>
          <Row
            title={t("Quota percentage", "额度百分比")}
            subtitle={t(
              "Choose whether percentages, rings and bars show used or remaining quota.",
              "选择百分比、圆环和进度条显示已用额度还是剩余额度。",
            )}
          >
            <Menu
              label={t("Quota percentage", "额度百分比")}
              value={snapshot.settings.quotaDisplay ?? "consumed"}
              options={[
                ["consumed", t("Consumed (0% → 100%)", "已用（0% → 100%）")],
                ["remaining", t("Remaining (100% → 0%)", "剩余（100% → 0%）")],
              ]}
              change={(value) => setting("quotaDisplay", value)}
            />
          </Row>
        </Section>
        <Section title={t("Startup", "启动")}>
          <ToggleRow
            title={t("Launch at login", "登录时启动")}
            subtitle={t(
              "Keep an eye on usage whenever you start your Mac.",
              "登录 Mac 后，自动开始监测用量。",
            )}
            checked={
              system?.launchAtLogin.enabled ?? snapshot.settings.launchAtLogin
            }
            disabled={hookPending || !system?.launchAtLogin.supported}
            reason={system?.launchAtLogin.notice ?? undefined}
            change={(value) => setting("launchAtLogin", value)}
          />
        </Section>
        {/* Code-by-wire: no client hooks (permission requests stay in each client). */}
      </div>
    </TooltipProvider>
  );
}
