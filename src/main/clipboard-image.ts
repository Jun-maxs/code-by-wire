import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

interface ImageClipboard {
  readImage(): { isEmpty(): boolean; toPNG(): Buffer };
}

/** A second PNG source for when Electron reads the clipboard image as empty; null = no image. */
export type ClipboardPngFallback = () => Promise<Buffer | null>;

/** Keep clipboard attachments across restarts so resumed Codex sessions can still read them. */
export async function saveClipboardImage(
  clipboard: ImageClipboard,
  directory: string,
  fallback?: ClipboardPngFallback,
): Promise<string | null> {
  const image = clipboard.readImage();
  let png = image.isEmpty() ? null : image.toPNG();
  if (png === null && fallback) png = await fallback();
  if (png === null) return null;
  if (png.length === 0)
    throw new Error("Clipboard image could not be encoded as PNG");
  const filename = createHash("sha256").update(png).digest("hex") + ".png";
  mkdirSync(directory, { recursive: true });
  const destination = join(directory, filename);
  if (!existsSync(destination)) writeFileSync(destination, png, { flag: "wx" });
  return destination;
}

// .NET reads the clipboard bitmap through GDI. Exit 3 = no image on the clipboard.
const EXPORT_SCRIPT = [
  "Add-Type -AssemblyName System.Windows.Forms, System.Drawing",
  "$image = [System.Windows.Forms.Clipboard]::GetImage()",
  "if (-not $image) { exit 3 }",
  "$image.Save($env:JUN_CLIPBOARD_PNG, [System.Drawing.Imaging.ImageFormat]::Png)",
].join("; ");

/**
 * Windows fallback for bitmaps Chromium decodes as empty: a CF_DIBV5 with BI_BITFIELDS and an
 * alpha mask (and no PNG alongside) reads as an empty image in Electron, and Codex's own reader
 * fails on it with "could not be converted to the appropriate format". GDI accepts it.
 */
export function exportClipboardPngWindows(): Promise<Buffer | null> {
  const out = join(tmpdir(), `jun-clipboard-${process.pid}-${Date.now()}.png`);
  const powershell = join(
    process.env.SystemRoot ?? "C:\\Windows",
    "System32",
    "WindowsPowerShell",
    "v1.0",
    "powershell.exe",
  );
  return new Promise((resolve, reject) => {
    execFile(
      powershell,
      ["-NoProfile", "-NonInteractive", "-STA", "-Command", EXPORT_SCRIPT],
      {
        env: { ...process.env, JUN_CLIPBOARD_PNG: out },
        windowsHide: true,
        timeout: 15_000,
      },
      (error) => {
        try {
          if (error && error.code === 3) return resolve(null);
          if (error)
            return reject(
              new Error(`Clipboard PNG export failed: ${error.message}`),
            );
          resolve(readFileSync(out));
        } catch (e) {
          reject(e instanceof Error ? e : new Error(String(e)));
        } finally {
          rmSync(out, { force: true });
        }
      },
    );
  });
}
