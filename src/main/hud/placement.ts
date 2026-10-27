import type * as Hud from "@shared/hud-native";

/** The overlay window's width: room for the strip beside an open panel (Agent HUD's plan wants at
 *  least 940 points); the rest of a wide display stays out of the window. */
const CANVAS_WIDTH = 1100;

/** Where the page wants its strip: Agent HUD's mode, edge and offset along it, and the panel's width. */
export interface HudPlacement {
  mode: "notch" | "logos" | "simple";
  edge: "top" | "right" | "bottom" | "left";
  offset: number;
  panelWidth: number;
}

export const DEFAULT_PLACEMENT: HudPlacement = {
  mode: "logos",
  edge: "top",
  offset: 0.5,
  panelWidth: 540,
};

/** The window's frame on a display (Agent HUD's `edge_frame` over its plan): the full height, wide
 *  enough for the strip beside an open panel, slid along the edge by `offset` (0 = start, 1 = end).
 *  Notch mode always sits at the top centre. */
export function canvasFor(
  bounds: Hud.HudRect,
  placement: HudPlacement = DEFAULT_PLACEMENT,
): Hud.HudRect {
  const notch = placement.mode === "notch";
  const edge = notch ? "top" : placement.edge;
  const offset = notch ? 0.5 : Math.min(1, Math.max(0, placement.offset));
  const width = Math.min(
    bounds.width,
    Math.max(CANVAS_WIDTH, Math.max(placement.panelWidth, 470) + 32 + 330),
  );
  const height = bounds.height;
  const across = Math.round((bounds.width - width) * offset);
  const x =
    edge === "left" ? 0 : edge === "right" ? bounds.width - width : across;
  return { x: bounds.x + x, y: bounds.y, width, height };
}
