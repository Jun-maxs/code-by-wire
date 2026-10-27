// Stand-in for @tauri-apps/api/window inside the HUD windows (see tauri-core.ts). Only Settings'
// "match screen" appearance asks for these; it reads no monitor here and keeps the chosen appearance.
import type { UnlistenFn } from "./tauri-event";

export function getCurrentWindow() {
  return {
    onMoved: (_handler: () => void): Promise<UnlistenFn> =>
      Promise.resolve(() => {}),
  };
}

export function currentMonitor(): Promise<{
  position: { x: number; y: number };
  scaleFactor: number;
} | null> {
  return Promise.resolve(null);
}
