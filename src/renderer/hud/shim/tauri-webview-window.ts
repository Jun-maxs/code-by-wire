// Stand-in for @tauri-apps/api/webviewWindow inside the HUD window (see tauri-core.ts).
import { bridge } from "./bridge";
import { listen } from "./tauri-event";

export function getCurrentWebviewWindow() {
  return { label: bridge().label, listen };
}
