import { useEffect, useMemo, useState } from "react";
import { FormatProvider } from "@agent-hud/ui/format-context";
import { snapshotLanguage } from "@agent-hud/ui/format";
import {
  PanelServicesProvider,
  type PanelServices,
} from "@agent-hud/hud/PanelContext";
import type { HUDConfig } from "@agent-hud/hud/model";
import NativeHUDSurface from "./app/HUDSurface";
import { useHUD } from "./app/lib/use-hud";
import { useHUDGeometry } from "./app/lib/use-hud-geometry";
import { useHUDConfig, type HUDScreenContext } from "./app/lib/use-hud-config";
import { useBotDirections } from "./app/lib/use-bot-directions";
import type { NativeMethod } from "./app/lib/types";

/**
 * The HUD overlay window's page: Agent HUD's App, cut to its `surface=hud` branch. One window per
 * display (main/hud/overlay.ts names the screen in the URL); it polls main for its snapshot, keeps
 * its display preferences in localStorage, and takes geometry and pointer state from main.
 */
export function HudApp() {
  const screenId = new URLSearchParams(location.search).get("screen") ?? "";
  const { snapshot, act } = useHUD({ active: true });
  const { geometries, monitors } = useHUDGeometry(screenId, true);
  const screens = useMemo<HUDScreenContext[]>(
    () =>
      monitors.map((m) => ({
        id: m.screenId,
        monitorIndex: m.index,
        hasNotch: m.notch !== null,
      })),
    [monitors],
  );
  const { config: stored, ready } = useHUDConfig(screenId, screens, true);
  const botDirections = useBotDirections(true);
  const measured = geometries[screenId] ?? null;
  const config: HUDConfig = {
    ...stored,
    hasNotch: false,
    notchWidth: 200,
    notchHeight: measured?.menuBarHeight || 24,
  };

  // The theme follows the main window's (the snapshot carries its appearance setting).
  const [systemLight, setSystemLight] = useState(
    () => matchMedia("(prefers-color-scheme: light)").matches,
  );
  useEffect(() => {
    const media = matchMedia("(prefers-color-scheme: light)");
    const change = () => setSystemLight(media.matches);
    media.addEventListener("change", change);
    return () => media.removeEventListener("change", change);
  }, []);
  const appearance = snapshot?.settings.appearance ?? "dark";
  const theme =
    appearance === "system" ? (systemLight ? "light" : "dark") : appearance;
  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    document.documentElement.classList.toggle("dark", theme === "dark");
  }, [theme]);

  const action = (method: NativeMethod, params?: Record<string, unknown>) =>
    act(method, params);
  const panelServices: PanelServices = {
    query: (method, params) => act(method, params),
    openSession: async (session) => {
      try {
        await act("open_session", { id: session.id });
        return true;
      } catch {
        return false;
      }
    },
    selectSession: (session) => void act("open_session", { id: session.id }),
  };

  if (!snapshot || !ready || !screenId) return null;
  return (
    <FormatProvider
      setting={snapshotLanguage(snapshot)}
      quotaDisplay={snapshot.settings.quotaDisplay}
    >
      <PanelServicesProvider value={panelServices}>
        <NativeHUDSurface
          screenId={screenId}
          snapshot={snapshot}
          config={config}
          geometry={measured}
          monitors={monitors}
          botDirections={botDirections}
          glowHidden={false}
          action={action}
        />
      </PanelServicesProvider>
    </FormatProvider>
  );
}
