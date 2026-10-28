import { describe, expect, it } from "vitest";
import { stripItalic } from "../../src/renderer/src/xterm/strip-italic";

describe("stripItalic", () => {
  it("removes a bare italic-on sequence", () => {
    expect(stripItalic("a\x1b[3mquote\x1b[23mb")).toBe("aquote\x1b[23mb");
  });
  it("keeps the other attributes of a combined sequence", () => {
    expect(stripItalic("\x1b[2;3;37m")).toBe("\x1b[2;37m");
  });
  it("leaves color numbers that happen to be 3 alone", () => {
    expect(stripItalic("\x1b[38;5;3m")).toBe("\x1b[38;5;3m");
    expect(stripItalic("\x1b[38;2;3;3;3;3m")).toBe("\x1b[38;2;3;3;3m");
    expect(stripItalic("\x1b[33m\x1b[13m")).toBe("\x1b[33m\x1b[13m");
  });
});
