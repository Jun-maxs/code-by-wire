import type { ClipboardProbe } from "@shared/ipc";

/** The slice of Electron's `clipboard` the probe reads, injected for tests. */
export interface ProbeClipboard {
  availableFormats(): string[];
  readImage(): { isEmpty(): boolean };
  readBuffer(format: string): Buffer;
}

/**
 * What a text-less clipboard holds, for terminal paste: an image (a screenshot), or on Windows the
 * file Explorer's Copy put there. Explorer writes CF_HDROP plus `FileNameW` (the first file's path,
 * UTF-16, NUL-terminated) and no text, so the path is read from `FileNameW`. A failed read is
 * "no files", never an error.
 */
export function probeClipboard(
  clipboard: ProbeClipboard,
  platform: NodeJS.Platform,
): ClipboardProbe {
  const hasImage =
    clipboard.availableFormats().some((f) => f.startsWith("image/")) ||
    !clipboard.readImage().isEmpty();
  if (hasImage || platform !== "win32") return { hasImage, files: [] };
  try {
    const path = clipboard
      .readBuffer("FileNameW")
      .toString("utf16le")
      .replace(/\0[\s\S]*$/, "");
    return { hasImage, files: path ? [path] : [] };
  } catch {
    return { hasImage, files: [] };
  }
}
