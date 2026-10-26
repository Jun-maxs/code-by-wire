import { BrowserWindow, ipcMain, screen, type Display } from "electron";
import type * as Hud from "@shared/hud-native";
import { logWarn } from "../log-buffer";
import { watchFullscreen } from "./fullscreen-watch";

/**
 * The HUD overlay: Agent HUD's edge strip, glow and hover panel (vendored under renderer/hud) in a
 * transparent, always-on-top window along the top of the primary display. The vendored page keeps
 * its native code paths; this module answers them the way Agent HUD's Tauri host did:
 *
 * - The page reports the rectangles it draws in (`hud_report_regions`). The window ignores the mouse
 *   everywhere else, so the apps beneath stay usable; a cursor poll flips that per position and
 *   sends `hud:pointer`, which drives the strip's hover and the panel's open/close.
 * - Data rides `native_request`, which the page polls (main runs no data timer).
 * - Geometry is the canvas this window covers on its display.
 * - While a full-screen app (a game) is in front the overlays hide, so they never sit over it.
 */

type Rect = Hud.HudRect;

export interface HudOverlayDeps {
  preload: string;
  /** Load the HUD page (hud.html?screen=<id>) into the window: dev server URL or built file. */
  load(win: BrowserWindow, query: Record<string, string>): void;
  /** Answers `native_request`: snapshot, refresh, statistics, sessions, open_session, …. */
  request(method: string, params: Record<string, unknown>): unknown;
  /** Bring the main window forward, at a session when one is given. */
  showMain(sessionId?: string): void;
}

/** The overlay window's width: room for the strip beside an open panel (Agent HUD's plan wants at
 *  least 940 points); the rest of a wide display stays out of the window. */
const CANVAS_WIDTH = 1100;
const POINTER_POLL_MS = 33;

interface Overlay {
  screenId: string;
  display: Display;
  win: BrowserWindow;
  canvas: Rect;
  regions: Rect[];
  pointer: Hud.HudPointer;
  focused: boolean;
}

const outside = (screenId: string): Hud.HudPointer => ({
  screenId,
  inside: false,
  point: null,
  buttons: null,
  altKey: null,
  ctrlKey: null,
  metaKey: null,
  shiftKey: null,
});

const screenIdOf = (d: Display) => String(d.id);

const hudWindows = new WeakSet<BrowserWindow>();
/** Whether `win` is a HUD overlay rather than an app window. */
export const isHudWindow = (win: BrowserWindow): boolean => hudWindows.has(win);
/** The app's own windows: every window but the HUD overlays. */
export const appWindows = (): BrowserWindow[] =>
  BrowserWindow.getAllWindows().filter((w) => !isHudWindow(w));

function canvasFor(d: Display): Rect {
  const width = Math.min(d.bounds.width, CANVAS_WIDTH);
  return {
    x: Math.round(d.bounds.x + (d.bounds.width - width) / 2),
    y: d.bounds.y,
    width,
    height: d.bounds.height,
  };
}

export function createHudOverlay(deps: HudOverlayDeps) {
  const overlays = new Map<string, Overlay>();
  let timer: NodeJS.Timeout | null = null;
  let unwatch: (() => void) | null = null;
  let fullscreen = false;

  const send = (o: Overlay, event: string, payload: unknown) => {
    if (!o.win.isDestroyed())
      o.win.webContents.send("hud:event", event, payload);
  };

  const monitors = (): Hud.HudMonitor[] => {
    const primary = screen.getPrimaryDisplay().id;
    return screen.getAllDisplays().map((d, index) => ({
      screenId: screenIdOf(d),
      persistentId: null,
      runtimeId: screenIdOf(d),
      windowLabel: `hud-${d.id}`,
      index,
      name: d.label || null,
      primary: d.id === primary,
      bounds: d.bounds,
      scaleFactor: d.scaleFactor,
      notch: null,
    }));
  };

  const geometry = (o: Overlay): Hud.HudGeometry => ({
    screenId: o.screenId,
    monitorIndex: screen
      .getAllDisplays()
      .findIndex((d) => d.id === o.display.id),
    scaleFactor: o.display.scaleFactor,
    coordinateSpace: "global-logical-top-left",
    screen: o.display.bounds,
    menuBarHeight: 0,
    hasNotch: false,
    notch: null,
    canvas: o.canvas,
    notchInViewport: null,
    placementConstrained: false,
  });

  /** Where the cursor is relative to each overlay, and whether it is over the HUD there. */
  const poll = () => {
    const cursor = screen.getCursorScreenPoint();
    if (fullscreen) return;
    for (const o of overlays.values()) {
      const point = { x: cursor.x - o.canvas.x, y: cursor.y - o.canvas.y };
      const inside = o.regions.some(
        (r) =>
          point.x >= r.x &&
          point.x <= r.x + r.width &&
          point.y >= r.y &&
          point.y <= r.y + r.height,
      );
      const moved =
        o.pointer.point?.x !== point.x || o.pointer.point?.y !== point.y;
      if (inside !== o.pointer.inside) {
        // Over the HUD the window takes the mouse; elsewhere clicks fall through to the apps.
        if (!o.win.isDestroyed())
          o.win.setIgnoreMouseEvents(!inside && !o.focused, { forward: true });
      }
      if (inside !== o.pointer.inside || moved) {
        o.pointer = { ...outside(o.screenId), inside, point };
        send(o, "hud:pointer", o.pointer);
      }
    }
  };

  const overlayOf = (sender: Electron.WebContents) =>
    [...overlays.values()].find((o) => o.win.webContents === sender);

  const commands: Record<
    string,
    (o: Overlay | undefined, args: Record<string, unknown>) => unknown
  > = {
    startup_mode: () => ({ demo: false }),
    cached_snapshot: () => ({ snapshot: null, error: null }),
    native_request: (_o, args) =>
      deps.request(
        String(args.method),
        (args.params as Record<string, unknown>) ?? {},
      ),
    hud_monitors: () => monitors(),
    hud_geometry: (o) => (o ? geometry(o) : null),
    window_activity: () => ({ active: true }),
    hud_bot_directions: () => ({ startedAt: 0, directions: {} }),
    hud_update_notice: () => null,
    hud_report_regions: (o, args) => {
      if (!o) return { pointer: outside("") };
      o.regions = (args.regions as Rect[]) ?? [];
      poll();
      return { pointer: o.pointer };
    },
    hud_text_focus: (o, args) => {
      // A text field in a card (answering a question) needs keyboard focus; the strip never does.
      if (!o || o.win.isDestroyed()) return null;
      o.focused = args.active === true;
      o.win.setFocusable(o.focused);
      if (o.focused) {
        o.win.setIgnoreMouseEvents(false);
        o.win.focus();
      }
      return null;
    },
    hud_show_main: () => deps.showMain(),
    open_statistics: (_o, args) =>
      deps.showMain(
        typeof args.sessionId === "string" ? args.sessionId : undefined,
      ),
    open_update: () => deps.showMain(),
    hud_bot_looked: () => null,
    hud_drag_start: () => null,
  };

  ipcMain.handle(
    "hud:invoke",
    (e, command: string, args?: Record<string, unknown>) => {
      const handler = commands[command];
      if (!handler) throw new Error(`HUD command not supported: ${command}`);
      return handler(overlayOf(e.sender), args ?? {});
    },
  );
  // The page publishes its display preferences; they live in its own storage here.
  ipcMain.on("hud:emit", () => {});

  const open = (d: Display) => {
    const canvas = canvasFor(d);
    const win = new BrowserWindow({
      ...canvas,
      frame: false,
      transparent: true,
      backgroundColor: "#00000000",
      hasShadow: false,
      resizable: false,
      movable: false,
      minimizable: false,
      maximizable: false,
      fullscreenable: false,
      skipTaskbar: true,
      focusable: false,
      alwaysOnTop: true,
      show: false,
      title: "Code-by-wire HUD",
      webPreferences: { preload: deps.preload, sandbox: false },
    });
    hudWindows.add(win);
    win.setAlwaysOnTop(true, "screen-saver");
    win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
    win.setIgnoreMouseEvents(true, { forward: true });
    const o: Overlay = {
      screenId: screenIdOf(d),
      display: d,
      win,
      canvas,
      regions: [],
      pointer: outside(screenIdOf(d)),
      focused: false,
    };
    overlays.set(o.screenId, o);
    // The page's own failures land in the app log, where a diagnostic report can find them.
    win.webContents.on("console-message", (e) => {
      if (e.level === "error" || e.level === "warning")
        logWarn("hud-page", `HUD page ${e.level}: ${e.message}`);
    });
    win.webContents.on("render-process-gone", (_e, d) =>
      logWarn("hud-page", `HUD page gone: ${d.reason}`),
    );
    win.once("ready-to-show", () => {
      if (!fullscreen) win.showInactive();
    });
    win.on("closed", () => overlays.delete(o.screenId));
    deps.load(win, { screen: o.screenId, label: `hud-${d.id}` });
  };

  const relayout = () => {
    for (const o of overlays.values()) {
      const d = screen.getAllDisplays().find((x) => x.id === o.display.id);
      if (!d) {
        o.win.destroy();
        continue;
      }
      o.display = d;
      o.canvas = canvasFor(d);
      o.win.setBounds(o.canvas);
      send(o, "hud:geometry", geometry(o));
    }
    for (const o of overlays.values()) send(o, "hud:monitors", monitors());
  };

  /** Hide every overlay while a full-screen app is in front; bring them back after. */
  const setFullscreen = (next: boolean) => {
    if (next === fullscreen) return;
    fullscreen = next;
    for (const o of overlays.values()) {
      if (o.win.isDestroyed()) continue;
      if (next) {
        o.win.hide();
        o.pointer = outside(o.screenId);
        o.win.setIgnoreMouseEvents(true, { forward: true });
        send(o, "hud:pointer", o.pointer);
      } else o.win.showInactive();
    }
  };

  return {
    /** Show the HUD along the top of the primary display. */
    start() {
      if (overlays.size) return;
      open(screen.getPrimaryDisplay());
      screen.on("display-metrics-changed", relayout);
      screen.on("display-removed", relayout);
      timer = setInterval(poll, POINTER_POLL_MS);
      unwatch = watchFullscreen(setFullscreen);
    },
    stop() {
      if (timer) clearInterval(timer);
      timer = null;
      unwatch?.();
      unwatch = null;
      fullscreen = false;
      screen.off("display-metrics-changed", relayout);
      screen.off("display-removed", relayout);
      for (const o of overlays.values()) o.win.destroy();
      overlays.clear();
    },
  };
}
