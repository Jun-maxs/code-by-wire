import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  createQoderProvider,
  resolveQoderDir,
} from "../../src/main/provider/qoder";
import {
  firstQoderCwd,
  formatQoderModelLabel,
  summarizeQoderTranscript,
} from "../../src/main/provider/qoder/transcript";
import {
  buildResumeCommand,
  buildSpawnCommand,
  launchForm,
} from "../../src/main/terminal/command";
import {
  gateRelaunch,
  gateResume,
  type FreshLaunch,
} from "../../src/main/terminal/resume-gate";
import { windowsSystemTool } from "../../src/main/terminal/windows-system";
import { validateExtraArgs } from "../../src/shared/extra-args";
import { fromTranscriptWire } from "../../src/shared/transcript";
import type { Session } from "@shared/types";

const tempDirs: string[] = [];
function makeQoderDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "cbw-qoder-"));
  tempDirs.push(dir);
  return dir;
}

afterEach(() => {
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop()!;
    rmSync(dir, { recursive: true, force: true });
  }
});

const jsonl = (...rows: Record<string, unknown>[]): string =>
  rows.map((r) => JSON.stringify(r)).join("\n") + "\n";

describe("resolveQoderDir", () => {
  it("prefers explicit override, then QODER_CONFIG_DIR, then ~/.qoder", () => {
    expect(resolveQoderDir("/custom/qoder", { QODER_CONFIG_DIR: "/env" })).toBe(
      "/custom/qoder",
    );
    expect(resolveQoderDir(undefined, { QODER_CONFIG_DIR: "/env/qoder" })).toBe(
      "/env/qoder",
    );
    expect(resolveQoderDir(undefined, {})).toBe(join(homedir(), ".qoder"));
  });
});

describe("summarizeQoderTranscript", () => {
  it("reads cwd from workspace-directories and runtime-config metadata on startup-only files", () => {
    const raw = jsonl(
      {
        type: "workspace-directories",
        directories: ["E:\\repo\\app"],
        sessionId: "s-blank",
      },
      {
        type: "runtime-config",
        timestamp: 1794624676818,
        sessionId: "s-blank",
        version: "1.1.89",
        model: "auto",
        reasoningEffort: "high",
        contextWindow: 1_000_000,
      },
    );
    expect(firstQoderCwd(raw)).toBe("E:\\repo\\app");
    const s = summarizeQoderTranscript(raw);
    expect(s.cwd).toBe("E:\\repo\\app");
    expect(s.createdMs).toBe(1794624676818);
    expect(s.lastActivityMs).toBe(1794624676818);
    expect(s.modelRaw).toBe("auto");
    expect(s.modelDisplayName).toBe("Auto");
    expect(s.effortLevel).toBe("high");
    expect(s.contextWindow).toBe(1_000_000);
    expect(s.hasTurns).toBe(false);
  });

  it("extracts businessModelKey, ai-title, custom-title precedence, and context usage", () => {
    const raw = jsonl(
      {
        type: "workspace-directories",
        directories: ["/w/app"],
        sessionId: "s-turn",
      },
      {
        type: "runtime-config",
        timestamp: 1_700_000_000_000,
        sessionId: "s-turn",
        model: "auto",
        reasoningEffort: "high",
        contextWindow: 1_000_000,
      },
      {
        type: "user",
        uuid: "u1",
        cwd: "/w/app",
        gitBranch: "feat/qoder",
        timestamp: "2026-11-14T02:51:16.820Z",
        message: { role: "user", content: "Inspect the gateway config" },
      },
      {
        type: "assistant",
        uuid: "a1",
        timestamp: "2026-11-14T02:51:20.100Z",
        businessModelKey: "qmodel_latest",
        message: {
          id: "msg_1",
          role: "assistant",
          model: "auto",
          content: [{ type: "text", text: "Gateway verified." }],
          usage: {
            input_tokens: 12_000,
            cache_read_input_tokens: 48_000,
            cache_creation_input_tokens: 0,
            output_tokens: 350,
          },
        },
      },
      {
        type: "ai-title",
        sessionId: "s-turn",
        aiTitle: "Gateway Config Check",
      },
    );

    const s = summarizeQoderTranscript(raw);
    expect(s.hasTurns).toBe(true);
    expect(s.title).toBe("Gateway Config Check");
    expect(s.branch).toBe("feat/qoder");
    expect(s.modelRaw).toBe("qmodel_latest");
    expect(s.modelDisplayName).toBe("QModel Latest");
    expect(s.contextTokens).toBe(60_000);
    expect(s.usage.outputTokens).toBe(350);
    expect(s.awaitingUser).toBe(false);

    const renamed = summarizeQoderTranscript(
      raw +
        JSON.stringify({
          type: "custom-title",
          sessionId: "s-turn",
          customTitle: "Pinned Gateway Audit",
        }) +
        "\n",
    );
    expect(renamed.title).toBe("Pinned Gateway Audit");
  });

  it("formats Qoder tier keys cleanly", () => {
    expect(formatQoderModelLabel("auto")).toBe("Auto");
    expect(formatQoderModelLabel("qmodel_latest")).toBe("QModel Latest");
    expect(formatQoderModelLabel("qfmodel")).toBe("QFModel");
    expect(formatQoderModelLabel("qoder/ultimate")).toBe("Ultimate");
    expect(formatQoderModelLabel("<synthetic>")).toBeUndefined();
  });
});

describe("createQoderProvider", () => {
  it("discovers sessions on disk and pending managed PTYs, reads transcripts, and overlays 1M context", async () => {
    const qoderDir = makeQoderDir();
    const projDir = join(qoderDir, "projects", "E--repo");
    mkdirSync(projDir, { recursive: true });

    const blankPath = join(projDir, "s-blank.jsonl");
    writeFileSync(
      blankPath,
      jsonl(
        {
          type: "workspace-directories",
          directories: ["E:\\repo"],
          sessionId: "s-blank",
        },
        {
          type: "runtime-config",
          timestamp: 1_700_000_001_000,
          sessionId: "s-blank",
          model: "auto",
          contextWindow: 1_000_000,
        },
      ),
    );

    const activePath = join(projDir, "s-active.jsonl");
    writeFileSync(
      activePath,
      jsonl(
        {
          type: "workspace-directories",
          directories: ["E:\\repo"],
          sessionId: "s-active",
        },
        {
          type: "runtime-config",
          timestamp: 1_700_000_002_000,
          sessionId: "s-active",
          model: "auto",
          reasoningEffort: "high",
          contextWindow: 1_000_000,
        },
        {
          type: "user",
          uuid: "u1",
          cwd: "E:\\repo",
          timestamp: "2026-11-14T03:00:00.000Z",
          message: { role: "user", content: "Run tests" },
        },
        {
          type: "assistant",
          uuid: "a1",
          timestamp: "2026-11-14T03:00:02.000Z",
          businessModelKey: "qmodel_latest",
          message: {
            id: "msg_a1",
            role: "assistant",
            model: "auto",
            content: [
              {
                type: "tool_use",
                id: "toolu_1",
                name: "Bash",
                input: { command: "npm test" },
              },
            ],
            usage: {
              input_tokens: 100_000,
              cache_read_input_tokens: 150_000,
              cache_creation_input_tokens: 0,
              output_tokens: 120,
            },
          },
        },
        {
          type: "user",
          uuid: "u2",
          cwd: "E:\\repo",
          timestamp: "2026-11-14T03:00:04.000Z",
          message: {
            role: "user",
            content: [
              {
                type: "tool_result",
                tool_use_id: "toolu_1",
                content: "PASS all green\n",
              },
            ],
          },
        },
      ),
    );

    const provider = createQoderProvider({
      qoderDir,
      now: () => Date.now() + 60_000,
      managed: {
        has: (id) => id === "s-pending",
        cwdOf: (id) => (id === "s-pending" ? "E:\\repo\\new" : undefined),
        qoderEntries: () => [
          {
            id: "s-pending",
            cwd: "E:\\repo\\new",
            spawnedAtMs: 1_700_000_005_000,
          },
        ],
      },
    });

    const cands = await provider.listCandidates();
    expect(cands.map((c) => c.id).sort()).toEqual([
      "s-active",
      "s-blank",
      "s-pending",
    ]);

    // Blank startup file reports transcript: false so Resume relaunches cleanly via gateRelaunch.
    expect(provider.resolveResumeTarget("s-blank")).toEqual({
      alive: false,
      cwd: "E:\\repo",
      transcript: false,
    });
    expect(provider.resolveResumeTarget("s-active")).toEqual({
      alive: false,
      cwd: "E:\\repo",
      transcript: true,
    });

    const activeCand = cands.find((c) => c.id === "s-active")!;
    const persisted = await provider.summarize(activeCand);
    expect(persisted.agent).toBe("qoder");
    expect(persisted.modelRaw).toBe("qmodel_latest");
    expect(persisted.contextTokens).toBe(250_000);

    const doc = fromTranscriptWire(await provider.readTranscript("s-active"));
    expect(doc.status).toBe("changed");
    if (doc.status === "changed") {
      expect(doc.doc.events.map((e) => e.kind)).toEqual(["user", "tool"]);
    }
    const tr = await provider.getToolResult("s-active", "toolu_1");
    expect(tr.found).toBe(true);
    if (tr.found) {
      expect(tr.output).toContain("PASS all green");
    }

    const overlaid = provider.overlaySessions([
      {
        ...persisted,
        resumable: true,
        modelDisplayName: "qmodel_latest",
        contextWindow: 200_000,
        contextPct: 100,
      } satisfies Session,
    ]);
    expect(overlaid[0].modelDisplayName).toBe("QModel Latest");
    expect(overlaid[0].contextWindow).toBe(1_000_000);
    expect(overlaid[0].contextPct).toBe(25);
  });
});

describe("qoder spawn, resume, relaunch, and extra-args", () => {
  it("spawns and resumes qodercli with --dangerously-skip-permissions by default", () => {
    const spawn = buildSpawnCommand({
      agent: "qoder",
      id: "sid-q1",
      model: "default",
      extraArgs: ["--max-turns", "20"],
    });
    expect(spawn).toEqual({
      file: "qodercli",
      args: [
        "--session-id",
        "sid-q1",
        "--dangerously-skip-permissions",
        "--max-turns",
        "20",
      ],
    });
    expect(launchForm(spawn, "win32")).toEqual({
      file: windowsSystemTool("cmd.exe"),
      args: [
        "/c",
        "qodercli",
        "--session-id",
        "sid-q1",
        "--dangerously-skip-permissions",
        "--max-turns",
        "20",
      ],
    });

    expect(
      buildResumeCommand({
        agent: "qoder",
        id: "sid-q1",
        extraArgs: ["--verbose"],
      }),
    ).toEqual({
      file: "qodercli",
      args: [
        "--resume",
        "sid-q1",
        "--dangerously-skip-permissions",
        "--verbose",
      ],
    });
  });

  it("relaunches blank qoder sessions and resumes sessions with turns", () => {
    const launch: FreshLaunch = {
      cwd: "E:\\repo",
      model: "default",
      agent: "qoder",
    };
    expect(
      gateRelaunch(
        "qoder",
        { alive: false, cwd: "E:\\repo", transcript: false },
        launch,
        false,
      ),
    ).toEqual({ ok: true, launch });
    expect(
      gateRelaunch(
        "qoder",
        { alive: false, cwd: "E:\\repo", transcript: true },
        launch,
        false,
      ),
    ).toBeNull();
    expect(
      gateResume("qoder", { alive: false, cwd: "E:\\repo", transcript: true }),
    ).toMatchObject({ ok: true, cwd: "E:\\repo", agent: "qoder" });
  });

  it("blocks reserved session/print flags and subcommands in extra-args", () => {
    for (const bad of [
      "--session-id abc",
      "--resume abc",
      "-r abc",
      "--continue",
      "-c",
      "-p hello",
      "--print hello",
      "--no-session-persistence",
      "update",
    ]) {
      expect(validateExtraArgs("qoder", bad).ok).toBe(false);
    }
    expect(validateExtraArgs("qoder", "--model auto --max-turns 10")).toEqual({
      ok: true,
      tokens: ["--model", "auto", "--max-turns", "10"],
    });
  });
});
