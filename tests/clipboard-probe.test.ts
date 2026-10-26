import { describe, expect, it } from "vitest";
import {
  probeClipboard,
  type ProbeClipboard,
} from "../src/main/clipboard-probe";

function fake(opts: {
  formats?: string[];
  image?: boolean;
  fileName?: string;
  throws?: boolean;
}): ProbeClipboard {
  return {
    availableFormats: () => opts.formats ?? [],
    readImage: () => ({ isEmpty: () => !opts.image }),
    readBuffer: () => {
      if (opts.throws) throw new Error("no such format");
      return Buffer.from(`${opts.fileName ?? ""}\0\0junk`, "utf16le");
    },
  };
}

describe("probeClipboard", () => {
  it("reports an image by format or by a non-empty readImage", () => {
    expect(probeClipboard(fake({ formats: ["image/png"] }), "win32")).toEqual({
      hasImage: true,
      files: [],
    });
    expect(probeClipboard(fake({ image: true }), "linux").hasImage).toBe(true);
  });

  it("reads an Explorer-copied file from FileNameW on Windows only", () => {
    const file = "C:\\Users\\me\\图片\\shot.png";
    expect(probeClipboard(fake({ fileName: file }), "win32")).toEqual({
      hasImage: false,
      files: [file],
    });
    expect(probeClipboard(fake({ fileName: file }), "darwin").files).toEqual(
      [],
    );
  });

  it("treats an unreadable FileNameW as no files", () => {
    expect(probeClipboard(fake({ throws: true }), "win32")).toEqual({
      hasImage: false,
      files: [],
    });
  });
});
