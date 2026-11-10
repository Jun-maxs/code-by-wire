import { afterEach, describe, expect, it, vi } from "vitest";
import { mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { saveClipboardImage } from "../src/main/clipboard-image";

const png = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9Zl1sAAAAASUVORK5CYII=",
  "base64",
);
const directories: string[] = [];
afterEach(() => {
  for (const directory of directories.splice(0))
    rmSync(directory, { recursive: true, force: true });
});
function directory(): string {
  const result = mkdtempSync(join(tmpdir(), "jun-clipboard-test-"));
  directories.push(result);
  return result;
}
function reader(empty = false, bytes = png) {
  return { readImage: () => ({ isEmpty: () => empty, toPNG: () => bytes }) };
}
describe("saveClipboardImage", () => {
  it("persists a readable PNG attachment and reuses identical content", async () => {
    const root = directory();
    const path = await saveClipboardImage(reader(), join(root, "images"));
    expect(path).toMatch(/\.png$/);
    expect(readFileSync(path!)).toEqual(png);
    expect(await saveClipboardImage(reader(), join(root, "images"))).toBe(path);
    expect(readdirSync(join(root, "images"))).toHaveLength(1);
  });
  it("does not create an attachment for an empty image or failed encoding", async () => {
    const root = directory();
    expect(await saveClipboardImage(reader(true), root)).toBeNull();
    await expect(
      saveClipboardImage(reader(false, Buffer.alloc(0)), root),
    ).rejects.toThrow();
    expect(readdirSync(root)).toEqual([]);
  });
  it("uses the fallback only when Electron reads the image as empty", async () => {
    const root = directory();
    const fallback = vi.fn(() => Promise.resolve<Buffer | null>(png));
    expect(await saveClipboardImage(reader(), root, fallback)).toMatch(
      /\.png$/,
    );
    expect(fallback).not.toHaveBeenCalled();
    const path = await saveClipboardImage(reader(true), root, fallback);
    expect(readFileSync(path!)).toEqual(png);
    fallback.mockResolvedValueOnce(null);
    expect(await saveClipboardImage(reader(true), root, fallback)).toBeNull();
  });
  it("reports unreadable clipboard data instead of returning a broken attachment", async () => {
    const root = directory();
    await expect(
      saveClipboardImage(
        {
          readImage: () => {
            throw new Error("format unavailable");
          },
        },
        root,
      ),
    ).rejects.toThrow("format unavailable");
    expect(readdirSync(root)).toEqual([]);
  });
});
