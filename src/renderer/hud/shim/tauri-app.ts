// Stand-in for @tauri-apps/api/app inside the HUD windows (see tauri-core.ts).
import { bridge } from "./bridge";

export function getVersion(): Promise<string> {
  return bridge().invoke("app_version") as Promise<string>;
}
