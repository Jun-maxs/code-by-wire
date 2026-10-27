import { app, BrowserWindow } from "electron";
import { logWarn } from "../log-buffer";
import { markHudWindow } from "./overlay";

/**
 * Agent HUD's own Settings and Statistics windows (its `?window=` pages, vendored under
 * renderer/hud/vendor/app), opened from the HUD panel's gear and its token chart. They load the
 * overlay's page, so they share its localStorage: Settings → Display edits the overlay's preferences
 * in place, and the overlay picks the change up from the storage event.
 */
export interface HudWindowsDeps {
  preload: string;
  /** Load the HUD page with a query (the overlay's loader). */
  load(win: BrowserWindow, query: Record<string, string>): void;
}

type Kind = "settings" | "statistics";

const SIZE: Record<Kind, { width: number; height: number; title: string }> = {
  settings: { width: 880, height: 680, title: "HUD 设置" },
  statistics: { width: 1040, height: 760, title: "HUD 用量统计" },
};

export function createHudWindows(deps: HudWindowsDeps) {
  const windows = new Map<Kind, BrowserWindow>();
  // What a window should show when it asks (`take_*`): set on open, taken once by the page.
  let settingsPage: string | null = null;
  let statisticsTarget: { tab?: string; sessionId?: string } | null = null;

  const send = (kind: Kind, event: string, payload: unknown) =>
    windows.get(kind)?.webContents.send("hud:event", event, payload);

  /** Raise the window, creating it the first time; returns whether it already existed. */
  const show = (kind: Kind): boolean => {
    const existing = windows.get(kind);
    if (existing && !existing.isDestroyed()) {
      if (existing.isMinimized()) existing.restore();
      existing.show();
      existing.focus();
      return true;
    }
    const { width, height, title } = SIZE[kind];
    const win = new BrowserWindow({
      width,
      height,
      minWidth: 640,
      minHeight: 480,
      title,
      autoHideMenuBar: true,
      // Black like the page (the owner's pick): no grey system title bar, its buttons kept.
      backgroundColor: "#000000",
      titleBarStyle: "hidden",
      titleBarOverlay: { color: "#000000", symbolColor: "#f5f5f7", height: 36 },
      show: false,
      webPreferences: { preload: deps.preload, sandbox: false },
    });
    markHudWindow(win);
    windows.set(kind, win);
    win.webContents.on("console-message", (e) => {
      if (e.level === "error")
        logWarn("hud-page", `HUD ${kind} page error: ${e.message}`);
    });
    // The page sets its own <title>; keep the window's.
    win.on("page-title-updated", (e) => e.preventDefault());
    win.once("ready-to-show", () => win.show());
    win.on("closed", () => windows.delete(kind));
    deps.load(win, { window: kind, label: kind });
    return false;
  };

  const openSettings = (page?: string) => {
    settingsPage = page ?? null;
    if (show("settings") && settingsPage)
      send("settings", "settings:page", page);
  };

  const openStatistics = (target: { tab?: string; sessionId?: string }) => {
    statisticsTarget = target;
    if (!show("statistics")) return;
    if (target.sessionId)
      send("statistics", "statistics:session", target.sessionId);
    else if (target.tab) send("statistics", "statistics:tab", target.tab);
  };

  const str = (v: unknown) => (typeof v === "string" ? v : undefined);

  return {
    openSettings,
    openStatistics,
    /** The Tauri commands these windows (and the overlay's gear and chart) call. */
    commands: {
      hud_show_main: (args: Record<string, unknown>) =>
        openSettings(str(args.page)),
      open_statistics: (args: Record<string, unknown>) =>
        openStatistics({ tab: str(args.tab), sessionId: str(args.sessionId) }),
      take_settings_page: () => {
        const page = settingsPage;
        settingsPage = null;
        return page;
      },
      take_statistics_target: () => {
        const target = statisticsTarget;
        statisticsTarget = null;
        return target;
      },
      app_version: () => app.getVersion(),
      quit_app: () => app.quit(),
      native_system_status: () => null,
    } satisfies Record<string, (args: Record<string, unknown>) => unknown>,
    closeAll() {
      for (const w of windows.values()) if (!w.isDestroyed()) w.close();
    },
  };
}
