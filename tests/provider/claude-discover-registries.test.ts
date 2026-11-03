import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  readSessionFiles,
  sessionRegistryDirs,
} from "../../src/main/provider/claude/discover";

const reg = (dir: string, pid: number, sessionId: string) => {
  mkdirSync(join(dir, "sessions"), { recursive: true });
  writeFileSync(
    join(dir, "sessions", `${pid}.json`),
    JSON.stringify({ pid, sessionId, cwd: "C:/x", status: "idle" }),
  );
};

describe("session registries across reclaude bindings", () => {
  it("reads every binding's sessions/ when the config dir is a reclaude binding", () => {
    const root = mkdtempSync(join(tmpdir(), "rec-"));
    const accounts = join(root, ".rec", "claude", "accounts");
    const a = join(accounts, "111", "config");
    const b = join(accounts, "222", "config");
    reg(a, 10, "on-a");
    reg(b, 20, "on-b");
    expect(sessionRegistryDirs(a)).toHaveLength(2);
    expect(
      readSessionFiles(a)
        .map((s) => s.sessionId)
        .sort(),
    ).toEqual(["on-a", "on-b"]);
  });

  it("reads only its own registry elsewhere", () => {
    const dir = mkdtempSync(join(tmpdir(), "claude-"));
    reg(dir, 30, "own");
    expect(sessionRegistryDirs(dir)).toEqual([join(dir, "sessions")]);
    expect(readSessionFiles(dir).map((s) => s.sessionId)).toEqual(["own"]);
  });
});
