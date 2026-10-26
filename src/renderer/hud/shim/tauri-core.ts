// Stand-in for @tauri-apps/api/core inside the HUD window (aliased in electron.vite.config.ts):
// the vendored Agent HUD code keeps its native code paths, served by main/hud/overlay.ts.
import { bridge } from "./bridge";

export function isTauri(): boolean {
  return true;
}

export function invoke<T = unknown>(
  command: string,
  args?: Record<string, unknown>,
): Promise<T> {
  return bridge().invoke(command, args) as Promise<T>;
}
