import type { OsKind } from "@shared/platform";
import {
  preparePasteText,
  rightClickAction,
  type ClipboardKeyAction,
} from "./clipboard-keys";
import { quotePathForShell } from "./file-drop";
import type { ClipboardProbe } from "@shared/ipc";

/** The xterm slice the clipboard actions touch. Declared structurally so a real `@xterm/xterm`
 *  Terminal satisfies it (its `modes` object carries more fields) AND a test fake can stand in. */
export interface ClipboardTermLike {
  hasSelection(): boolean;
  getSelection(): string;
  clearSelection(): void;
  /** Feed text through xterm's paste path (bracketed-paste wrapping, \n → \r normalization). */
  paste(data: string): void;
  focus(): void;
  readonly modes: {
    readonly bracketedPasteMode: boolean;
    /** xterm's mouse reporting state; anything but "none" means the app gets mouse events. */
    readonly mouseTrackingMode?: string;
  };
}

/** The main-process clipboard IPC pair (window.api.clipboardReadText / clipboardWriteText),
 *  injected so the stores and tests never touch `window`. */
export interface ClipboardIpc {
  readText(type?: "selection"): Promise<string>;
  writeText(text: string): Promise<void>;
  /** What the clipboard holds when it has no text; absent where the host can't tell. */
  probe?(): Promise<ClipboardProbe>;
}

export interface ClipboardActionDeps {
  term: ClipboardTermLike;
  /** Renderer → pty bytes — the ^V image-paste fallback. Callers close over their live session
   *  id (the Claude terminal reads handle.id so a /clear rename re-points it). */
  writePty: (data: string) => void;
  clipboard: ClipboardIpc;
  /** The OS family, which picks the CLI's image-paste key; ^V when absent. */
  os?: OsKind;
}

/** The key Claude Code binds to "paste image from clipboard": Alt+V on Windows (ESC v), Ctrl+V
 *  (0x16) everywhere else. ^V on Windows did nothing — the CLI leaves it unbound there. */
export function imagePasteKey(os: OsKind | undefined): string {
  return os === "windows" ? "\x1bv" : "\x16";
}

/** Paste what a text-less clipboard holds: an image goes to the CLI as its image-paste key, copied
 *  files as their quoted paths through xterm's paste (bracketed, so the CLI attaches images by
 *  path). False when there's nothing of either, or the host can't probe the clipboard. */
async function pasteNonText(deps: ClipboardActionDeps): Promise<boolean> {
  if (!deps.clipboard.probe) return false;
  const probe = await deps.clipboard.probe();
  if (probe.hasImage) {
    deps.writePty(imagePasteKey(deps.os));
    return true;
  }
  if (probe.files.length > 0) {
    deps.term.paste(probe.files.map((p) => quotePathForShell(p)).join(" "));
    return true;
  }
  return false;
}

/**
 * Execute a clipboard verdict from clipboard-keys. Fired as `void runClipboardAction(...)` from
 * sync event handlers, so it NEVER rejects: any clipboard IPC failure is a silent no-op. In
 * particular the ^V fallback only fires on a SUCCESSFUL read that returns empty text (a
 * screenshot — or nothing — on the clipboard); an IPC hiccup must never type a stray control
 * byte into the prompt.
 */
export async function runClipboardAction(
  action: ClipboardKeyAction,
  deps: ClipboardActionDeps,
): Promise<void> {
  const { term, clipboard } = deps;
  try {
    if (action === "copy" || action === "copy-and-clear") {
      const selection = term.getSelection();
      if (!selection) return; // unreachable via the dispatchers (hasSelection gates); guarded anyway
      await clipboard.writeText(selection);
      if (action === "copy-and-clear") term.clearSelection();
      return;
    }
    const text = await clipboard.readText(
      action === "paste-selection" ? "selection" : undefined,
    );
    if (text.length === 0) {
      // Successful read, no text: a screenshot or copied files, when the host can tell.
      if (action !== "paste-selection" && (await pasteNonText(deps))) return;
      // Otherwise only the Ctrl+V trigger hands the CLI its ^V byte — the Claude CLI binds it to
      // "paste image from clipboard", and \x16 is exactly what xterm would have sent had we not
      // intercepted. Other triggers natively send nothing.
      if (action === "paste") deps.writePty("\x16");
      return;
    }
    const prepared = preparePasteText(text, term.modes.bracketedPasteMode);
    if (prepared !== null) term.paste(prepared);
  } catch {
    // Clipboard IPC failure — no-op by design (see doc comment).
  }
}

/** Wire VS Code's Windows right-click copyPaste onto a terminal's mount element. Returns the
 *  detach cleanup. On non-Windows platforms the listener still attaches but every event returns
 *  null from rightClickAction, leaving the browser default untouched. */
export function attachClipboardContextMenu(
  el: Pick<HTMLElement, "addEventListener" | "removeEventListener">,
  os: OsKind,
  deps: ClipboardActionDeps,
): () => void {
  const onContextMenu = (e: MouseEvent): void => {
    const action = rightClickAction(os, deps.term.hasSelection(), e.shiftKey);
    if (action === null) return;
    e.preventDefault();
    if (
      action === "paste-no-fallback" &&
      (deps.term.modes.mouseTrackingMode ?? "none") !== "none"
    ) {
      // xterm already reported this right-click to the app (Claude Code's fullscreen mode tracks
      // the mouse), which pastes clipboard text itself; pasting here too doubled it. Cover only
      // what the app can't read: a screenshot or copied files.
      void (async () => {
        try {
          if ((await deps.clipboard.readText()).length === 0)
            await pasteNonText(deps);
        } catch {
          // Clipboard IPC failure — no-op, as in runClipboardAction.
        }
      })();
      return;
    }
    if (action === "paste-no-fallback") deps.term.focus(); // vscode focuses before a mouse paste
    void runClipboardAction(action, deps);
  };
  el.addEventListener("contextmenu", onContextMenu);
  return () => el.removeEventListener("contextmenu", onContextMenu);
}
