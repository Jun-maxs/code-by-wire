import { describe, expect, it } from "vitest";
import {
  canvasFor,
  DEFAULT_PLACEMENT,
  dropPlacement,
} from "../../src/main/hud/placement";

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

describe("dropPlacement", () => {
  const screen = { x: 0, y: 0, width: 1920, height: 1080 };
  const runs = { horizontal: 320, vertical: 200 };

  it("snaps to the nearest edge and centres the strip under the cursor", () => {
    expect(
      dropPlacement(screen, { x: 960, y: 10 }, DEFAULT_PLACEMENT, runs),
    ).toMatchObject({ edge: "top", offset: 0.5 });
    expect(
      dropPlacement(screen, { x: 1900, y: 540 }, DEFAULT_PLACEMENT, runs),
    ).toMatchObject({ edge: "right", offset: 0.5 });
    expect(
      dropPlacement(screen, { x: 400, y: 1075 }, DEFAULT_PLACEMENT, runs).edge,
    ).toBe("bottom");
  });

  it("keeps the strip on screen near a corner and on a second display", () => {
    expect(
      dropPlacement(screen, { x: 5, y: 2 }, DEFAULT_PLACEMENT, runs),
    ).toMatchObject({ offset: 0 });
    const right = { x: 1920, y: 0, width: 1920, height: 1080 };
    expect(
      dropPlacement(right, { x: 3835, y: 3 }, DEFAULT_PLACEMENT, runs),
    ).toMatchObject({ edge: "top", offset: 1 });
  });
});
