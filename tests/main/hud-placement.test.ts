import { describe, expect, it } from "vitest";
import { canvasFor, DEFAULT_PLACEMENT } from "../../src/main/hud/placement";

const screen = { x: -1920, y: 0, width: 1920, height: 1080 };

describe("canvasFor", () => {
  it("sits at the top centre by default, the full height of the display", () => {
    expect(canvasFor(screen)).toEqual({
      x: -1920 + 410,
      y: 0,
      width: 1100,
      height: 1080,
    });
  });

  it("hugs the left or right edge of the display", () => {
    const left = canvasFor(screen, { ...DEFAULT_PLACEMENT, edge: "left" });
    const right = canvasFor(screen, { ...DEFAULT_PLACEMENT, edge: "right" });
    expect(left.x).toBe(-1920);
    expect(right.x + right.width).toBe(0);
  });

  it("slides along the top edge by offset; notch mode ignores edge and offset", () => {
    const start = { ...DEFAULT_PLACEMENT, offset: 0 };
    expect(canvasFor(screen, start).x).toBe(-1920);
    expect(canvasFor(screen, { ...start, mode: "notch", edge: "left" }).x).toBe(
      -1920 + 410,
    );
  });

  it("widens for a wide panel but never past the display", () => {
    const wide = { ...DEFAULT_PLACEMENT, panelWidth: 900 };
    expect(canvasFor(screen, wide).width).toBe(1262);
    expect(canvasFor({ ...screen, width: 1000 }, wide).width).toBe(1000);
  });
});
