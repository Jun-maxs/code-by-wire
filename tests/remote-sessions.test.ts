import { describe, it, expect, afterEach } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  createRemoteSessionStore,
  remoteCommand,
} from "../src/main/remote-sessions";

describe("createRemoteSessionStore", () => {
  const dirs: string[] = [];
  afterEach(() => {
    for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
  });
  function tmp(): string {
    const d = mkdtempSync(join(tmpdir(), "cbw-remote-"));
    dirs.push(d);
    return d;
  }

  it("remembers a remote session across instances and forgets it when unset", () => {
    const dir = tmp();
    createRemoteSessionStore({ dir }).set("a", true);
    const store = createRemoteSessionStore({ dir });
    expect(store.has("a")).toBe(true);
    expect(store.has("b")).toBe(false);
    store.set("a", false);
    expect(store.read()).toEqual({});
  });
  it("follows a /clear re-key, and never overwrites an existing target", () => {
    const store = createRemoteSessionStore({ dir: tmp() });
    store.set("a", true);
    store.rename("a", "b");
    expect(store.read()).toEqual({ b: true });
    store.rename("missing", "c");
    expect(store.read()).toEqual({ b: true });
  });
  it("reads a corrupt or hand-edited file as nothing remote", () => {
    const dir = tmp();
    writeFileSync(join(dir, "remote-sessions.json"), "{oops");
    expect(createRemoteSessionStore({ dir }).read()).toEqual({});
    writeFileSync(
      join(dir, "remote-sessions.json"),
      JSON.stringify({ a: "yes", b: true }),
    );
    expect(createRemoteSessionStore({ dir }).read()).toEqual({ b: true });
  });
});

describe("remoteCommand", () => {
  it("defaults to claude-r and honours CBW_REMOTE_COMMAND", () => {
    expect(remoteCommand({})).toBe("claude-r");
    expect(remoteCommand({ CBW_REMOTE_COMMAND: " hapi claude " })).toBe(
      "hapi claude",
    );
    expect(remoteCommand({ CBW_REMOTE_COMMAND: "  " })).toBe("claude-r");
  });
});
