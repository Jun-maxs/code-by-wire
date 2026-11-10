import { describe, expect, it } from "vitest";
import {
  buildSpawnCommand,
  buildResumeCommand,
} from "../../src/main/terminal/command";

describe("Codex session defaults", () => {
  it("new sessions set full access and 900k context without selecting a model", () => {
    expect(
      buildSpawnCommand({ agent: "codex", id: "new", model: "default" }),
    ).toEqual({
      file: "codex",
      args: [
        "-c",
        "approval_policy=never",
        "-c",
        "sandbox_mode=danger-full-access",
        "-c",
        "model_context_window=900000",
      ],
    });
  });
  it("resume reapplies the defaults before the stored session arguments", () => {
    expect(
      buildResumeCommand({
        agent: "codex",
        id: "old",
        extraArgs: ["--sandbox", "read-only", "-m", "custom-model"],
      }),
    ).toEqual({
      file: "codex",
      args: [
        "resume",
        "old",
        "-c",
        "approval_policy=never",
        "-c",
        "sandbox_mode=danger-full-access",
        "-c",
        "model_context_window=900000",
        "--sandbox",
        "read-only",
        "-m",
        "custom-model",
      ],
    });
  });
});
