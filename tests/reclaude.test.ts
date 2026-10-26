import { describe, expect, it } from "vitest";
import { join } from "node:path";
import {
  adoptReclaude,
  detectReclaude,
  type ReclaudeDeps,
} from "../src/main/reclaude";

const HOME = join("/", "home", "me");
const LOCAL = join("/", "local");
const CONFIG = join(HOME, ".rec", "claude", "accounts", "45797", "config");
const REC = join(LOCAL, "Programs", "reclaude", "bin", "rec.exe");

function deps(
  over: Partial<ReclaudeDeps> & { current?: string } = {},
): ReclaudeDeps {
  return {
    home: HOME,
    env: { LOCALAPPDATA: LOCAL },
    readText: (p) =>
      p === join(HOME, ".rec", "claude", "current")
        ? (over.current ?? "45797\n")
        : null,
    isDir: (p) => p === CONFIG,
    isFile: (p) => p === REC,
    ...over,
  };
}

describe("detectReclaude", () => {
  it("names the current account's config dir and rec.exe", () => {
    expect(detectReclaude(deps())).toEqual({
      configDir: CONFIG,
      launcher: REC,
    });
  });

  it("is null without an account, its folder, or rec.exe", () => {
    expect(detectReclaude(deps({ readText: () => null }))).toBeNull();
    expect(detectReclaude(deps({ isDir: () => false }))).toBeNull();
    expect(detectReclaude(deps({ isFile: () => false }))).toBeNull();
    expect(detectReclaude(deps({ env: {} }))).toBeNull();
  });

  it("refuses an account name that leaves the accounts folder", () => {
    expect(detectReclaude(deps({ current: "../x" }))).toBeNull();
    expect(detectReclaude(deps({ current: "a/b" }))).toBeNull();
  });
});

describe("adoptReclaude", () => {
  const found = { configDir: CONFIG, launcher: REC };

  it("sets the config dir and launcher when the user set neither", () => {
    const env: NodeJS.ProcessEnv = {};
    expect(adoptReclaude(env, () => found)).toEqual(found);
    expect(env.CLAUDE_CONFIG_DIR).toBe(CONFIG);
    expect(env.CBW_CLAUDE_LAUNCHER).toBe(REC);
  });

  it("leaves a user-set CLAUDE_CONFIG_DIR alone", () => {
    const env: NodeJS.ProcessEnv = { CLAUDE_CONFIG_DIR: "/mine" };
    expect(adoptReclaude(env, () => found)).toBeNull();
    expect(env.CBW_CLAUDE_LAUNCHER).toBeUndefined();
  });

  it("keeps a launcher the user already chose", () => {
    const env: NodeJS.ProcessEnv = { CBW_CLAUDE_LAUNCHER: "/x/claude" };
    adoptReclaude(env, () => found);
    expect(env.CBW_CLAUDE_LAUNCHER).toBe("/x/claude");
  });
});
