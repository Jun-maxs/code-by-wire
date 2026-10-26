/** The HUD window's bridge to main (preload's `hudBridge`): Agent HUD's Tauri commands become one
 *  invoke channel, its native events one subscription channel. See main/hud/overlay.ts. */
export interface HudBridge {
  /** This window's label, which main addresses its events to. */
  label: string;
  invoke(command: string, args?: unknown): Promise<unknown>;
  emit(event: string, payload?: unknown): void;
  /** Subscribe to one native event; returns the unsubscribe. */
  on(event: string, handler: (payload: unknown) => void): () => void;
}

declare global {
  interface Window {
    hudBridge?: HudBridge;
  }
}

export function bridge(): HudBridge {
  if (!window.hudBridge)
    throw new Error("The HUD bridge is only available in the HUD window");
  return window.hudBridge;
}
