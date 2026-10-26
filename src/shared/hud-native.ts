/** What the HUD window's native side tells the vendored Agent HUD page (main/hud/overlay.ts), in
 *  the shapes its hooks declare (renderer/hud/app/lib/use-hud-geometry.ts and HUDSurface.tsx). */

export interface HudRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface HudPointer {
  screenId: string;
  inside: boolean;
  /** Relative to the canvas's top-left. */
  point: { x: number; y: number } | null;
  buttons: number | null;
  altKey: boolean | null;
  ctrlKey: boolean | null;
  metaKey: boolean | null;
  shiftKey: boolean | null;
}

export interface HudMonitor {
  screenId: string;
  persistentId: string | null;
  runtimeId: string;
  windowLabel: string;
  index: number;
  name: string | null;
  primary: boolean;
  bounds: HudRect;
  scaleFactor: number;
  notch: HudRect | null;
}

export interface HudGeometry {
  screenId: string;
  monitorIndex: number;
  scaleFactor: number;
  coordinateSpace:
    | "global-logical-top-left"
    | "monitor-scaled-physical-top-left";
  screen: HudRect;
  menuBarHeight: number;
  hasNotch: boolean;
  notch: HudRect | null;
  /** The window's own area; everything the page draws is relative to it. */
  canvas: HudRect;
  notchInViewport: HudRect | null;
  placementConstrained: boolean;
}
