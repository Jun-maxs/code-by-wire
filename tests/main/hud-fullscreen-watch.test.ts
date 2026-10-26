import { describe, expect, it } from "vitest";
import { parseFullscreenLines } from "../../src/main/hud/fullscreen-watch";

describe("parseFullscreenLines", () => {
  it("reads each state line in a chunk", () => {
    expect(parseFullscreenLines("1\r\n0\n1\n")).toEqual([true, false, true]);
  });

  it("ignores anything that is not a state line", () => {
    expect(parseFullscreenLines("WARNING: x\r\n\r\n 0 \r\n")).toEqual([false]);
  });
});
