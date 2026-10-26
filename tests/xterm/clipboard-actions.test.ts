import { describe, it, expect, vi } from "vitest";
import {
  attachClipboardContextMenu,
  runClipboardAction,
  type ClipboardActionDeps,
  type ClipboardTermLike,
} from "../../src/renderer/src/xterm/clipboard-actions";

function fakeDeps(opts?: {
  selection?: string;
  clipboardText?: string;
  bracketed?: boolean;
  readRejects?: boolean;
  writeRejects?: boolean;
  probe?: { hasImage: boolean; files: string[] };
  os?: "mac" | "windows" | "linux";
  mouseTracking?: string;
}) {
  let selection = opts?.selection ?? "";
  const pastes: string[] = [];
  const ptyWrites: string[] = [];
  const clearSelection = vi.fn(() => {
    selection = "";
  });
  const focus = vi.fn();
  const term: ClipboardTermLike = {
    hasSelection: () => selection.length > 0,
    getSelection: () => selection,
    clearSelection,
    paste: (data) => {
      pastes.push(data);
    },
    focus,
    modes: {
      bracketedPasteMode: opts?.bracketed ?? false,
      mouseTrackingMode: opts?.mouseTracking ?? "none",
    },
  };
  const readText = vi.fn(() =>
    opts?.readRejects
      ? Promise.reject(new Error("ipc down"))
      : Promise.resolve(opts?.clipboardText ?? ""),
  );
  const writeText = vi.fn(() =>
    opts?.writeRejects
      ? Promise.reject(new Error("ipc down"))
      : Promise.resolve(),
  );
  const deps: ClipboardActionDeps = {
    term,
    writePty: (data) => {
      ptyWrites.push(data);
    },
    clipboard: {
      readText,
      writeText,
      ...(opts?.probe ? { probe: () => Promise.resolve(opts.probe!) } : {}),
    },
    os: opts?.os,
  };
  return {
    deps,
    term,
    pastes,
    ptyWrites,
    readText,
    writeText,
    clearSelection,
    focus,
  };
}

describe("runClipboardAction — copy", () => {
  it("copy writes the selection to the clipboard and keeps the selection", async () => {
    const f = fakeDeps({ selection: "picked" });
    await runClipboardAction("copy", f.deps);
    expect(f.writeText).toHaveBeenCalledWith("picked");
    expect(f.clearSelection).not.toHaveBeenCalled();
  });

  it("copy-and-clear also clears the selection (VS Code's Windows Ctrl+C)", async () => {
    const f = fakeDeps({ selection: "picked" });
    await runClipboardAction("copy-and-clear", f.deps);
    expect(f.writeText).toHaveBeenCalledWith("picked");
    expect(f.clearSelection).toHaveBeenCalled();
  });

  it("copy with an empty selection is a no-op (unreachable via dispatch, guarded anyway)", async () => {
    const f = fakeDeps();
    await runClipboardAction("copy", f.deps);
    expect(f.writeText).not.toHaveBeenCalled();
  });

  it("a clipboard write failure is swallowed (never rejects, selection kept)", async () => {
    const f = fakeDeps({ selection: "picked", writeRejects: true });
    await expect(
      runClipboardAction("copy-and-clear", f.deps),
    ).resolves.toBeUndefined();
    expect(f.clearSelection).not.toHaveBeenCalled();
  });
});

describe("runClipboardAction — paste", () => {
  it("pastes clipboard text through xterm's paste path", async () => {
    const f = fakeDeps({ clipboardText: "hello" });
    await runClipboardAction("paste", f.deps);
    expect(f.pastes).toEqual(["hello"]);
    expect(f.ptyWrites).toEqual([]);
  });

  it("strips a trailing newline when not in bracketed paste mode (hijack mitigation)", async () => {
    const f = fakeDeps({ clipboardText: "cmd\n" });
    await runClipboardAction("paste", f.deps);
    expect(f.pastes).toEqual(["cmd"]);
  });

  it("keeps the trailing newline in bracketed paste mode", async () => {
    const f = fakeDeps({ clipboardText: "cmd\n", bracketed: true });
    await runClipboardAction("paste", f.deps);
    expect(f.pastes).toEqual(["cmd\n"]);
  });

  it("empty read + 'paste' writes the ^V byte to the pty (Claude CLI image paste)", async () => {
    const f = fakeDeps({ clipboardText: "" });
    await runClipboardAction("paste", f.deps);
    expect(f.ptyWrites).toEqual(["\x16"]);
    expect(f.pastes).toEqual([]);
  });

  it("empty read + 'paste-no-fallback' does nothing (Ctrl+Shift+V / right-click)", async () => {
    const f = fakeDeps({ clipboardText: "" });
    await runClipboardAction("paste-no-fallback", f.deps);
    expect(f.ptyWrites).toEqual([]);
    expect(f.pastes).toEqual([]);
  });

  it("'paste-selection' reads the X11 selection clipboard", async () => {
    const f = fakeDeps({ clipboardText: "primary" });
    await runClipboardAction("paste-selection", f.deps);
    expect(f.readText).toHaveBeenCalledWith("selection");
    expect(f.pastes).toEqual(["primary"]);
  });

  it("a read failure is a total no-op — never the fallback byte on error", async () => {
    const f = fakeDeps({ readRejects: true });
    await expect(runClipboardAction("paste", f.deps)).resolves.toBeUndefined();
    expect(f.ptyWrites).toEqual([]);
    expect(f.pastes).toEqual([]);
  });

  it("non-empty read that preparePasteText reduces to null: no paste AND no fallback byte", async () => {
    // A bare newline is a successful, NON-empty read, but preparePasteText returns null for
    // it (not bracketed). The ^V fallback is gated on the raw read being empty, so it must
    // NOT fire here — this pins the last seam of the fallback invariant.
    const f = fakeDeps({ clipboardText: "\n" });
    await runClipboardAction("paste", f.deps);
    expect(f.pastes).toEqual([]);
    expect(f.ptyWrites).toEqual([]);
  });
});

describe("attachClipboardContextMenu — Windows right-click copyPaste", () => {
  function contextMenu(el: HTMLElement, shiftKey = false): MouseEvent {
    const e = new MouseEvent("contextmenu", {
      bubbles: true,
      cancelable: true,
      shiftKey,
    });
    el.dispatchEvent(e);
    return e;
  }

  it("windows + selection: consumes the event and copies-and-clears", async () => {
    const f = fakeDeps({ selection: "picked" });
    const el = document.createElement("div");
    attachClipboardContextMenu(el, "windows", f.deps);
    const e = contextMenu(el);
    expect(e.defaultPrevented).toBe(true);
    await vi.waitFor(() => expect(f.writeText).toHaveBeenCalledWith("picked"));
    expect(f.clearSelection).toHaveBeenCalled();
  });

  it("windows + no selection: focuses the terminal and pastes (no fallback byte)", async () => {
    const f = fakeDeps({ clipboardText: "hello" });
    const el = document.createElement("div");
    attachClipboardContextMenu(el, "windows", f.deps);
    const e = contextMenu(el);
    expect(e.defaultPrevented).toBe(true);
    expect(f.focus).toHaveBeenCalled();
    await vi.waitFor(() => expect(f.pastes).toEqual(["hello"]));
    expect(f.ptyWrites).toEqual([]);
  });

  it("windows + shift: untouched (event not consumed, nothing runs)", () => {
    const f = fakeDeps({ selection: "picked" });
    const el = document.createElement("div");
    attachClipboardContextMenu(el, "windows", f.deps);
    const e = contextMenu(el, true);
    expect(e.defaultPrevented).toBe(false);
    expect(f.writeText).not.toHaveBeenCalled();
  });

  it("mac: right-click is untouched", () => {
    const f = fakeDeps({ selection: "picked" });
    const el = document.createElement("div");
    attachClipboardContextMenu(el, "mac", f.deps);
    expect(contextMenu(el).defaultPrevented).toBe(false);
  });

  it("the returned cleanup detaches the listener", () => {
    const f = fakeDeps({ selection: "picked" });
    const el = document.createElement("div");
    const detach = attachClipboardContextMenu(el, "windows", f.deps);
    detach();
    expect(contextMenu(el).defaultPrevented).toBe(false);
    expect(f.writeText).not.toHaveBeenCalled();
  });
});

describe("text-less clipboard: screenshots and copied files", () => {
  it("an image on Windows sends Claude Code's Alt+V, not ^V", async () => {
    const f = fakeDeps({ os: "windows", probe: { hasImage: true, files: [] } });
    await runClipboardAction("paste", f.deps);
    expect(f.ptyWrites).toEqual(["\x1bv"]);
  });

  it("an image elsewhere sends ^V", async () => {
    const f = fakeDeps({ os: "linux", probe: { hasImage: true, files: [] } });
    await runClipboardAction("paste-no-fallback", f.deps);
    expect(f.ptyWrites).toEqual(["\x16"]);
  });

  it("Explorer-copied files paste as quoted paths", async () => {
    const f = fakeDeps({
      os: "windows",
      probe: { hasImage: false, files: ["C:\\My Pics\\a.png"] },
    });
    await runClipboardAction("paste", f.deps);
    expect(f.pastes).toEqual(["'C:\\My Pics\\a.png'"]);
    expect(f.ptyWrites).toEqual([]);
  });

  it("nothing to probe keeps the ^V fallback for Ctrl+V", async () => {
    const f = fakeDeps({
      os: "windows",
      probe: { hasImage: false, files: [] },
    });
    await runClipboardAction("paste", f.deps);
    expect(f.ptyWrites).toEqual(["\x16"]);
  });
});

describe("right-click while the app tracks the mouse", () => {
  function contextMenu(el: HTMLElement): MouseEvent {
    const e = new MouseEvent("contextmenu", {
      bubbles: true,
      cancelable: true,
    });
    el.dispatchEvent(e);
    return e;
  }

  it("leaves text to the app (no double paste)", async () => {
    const f = fakeDeps({ clipboardText: "hello", mouseTracking: "any" });
    const el = document.createElement("div");
    attachClipboardContextMenu(el, "windows", f.deps);
    expect(contextMenu(el).defaultPrevented).toBe(true);
    await vi.waitFor(() => expect(f.readText).toHaveBeenCalled());
    expect(f.pastes).toEqual([]);
    expect(f.focus).not.toHaveBeenCalled();
  });

  it("still pastes a screenshot the app can't read", async () => {
    const f = fakeDeps({
      os: "windows",
      mouseTracking: "any",
      probe: { hasImage: true, files: [] },
    });
    const el = document.createElement("div");
    attachClipboardContextMenu(el, "windows", f.deps);
    contextMenu(el);
    await vi.waitFor(() => expect(f.ptyWrites).toEqual(["\x1bv"]));
  });
});
