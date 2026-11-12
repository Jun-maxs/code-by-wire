import { describe, expect, it } from "vitest";
import {
  agyToolInput,
  extractAgyToolResult,
  fileUriToPath,
  parseAgyEvents,
  readAgyHead,
  readAgyModel,
  summarizeAgySteps,
  type AgyStepRow,
} from "../../src/main/provider/agy/conversation";
import {
  agyContextWindow,
  agyPoolKind,
  parseAgyQuota,
} from "../../src/main/provider/agy/quota";
import { agyProxyEnv, proxyUrlFromPac } from "../../src/main/agy-proxy";
import {
  buildResumeCommand,
  buildSpawnCommand,
} from "../../src/main/terminal/command";
import { gateResume } from "../../src/main/terminal/resume-gate";
import { validateExtraArgs } from "../../src/shared/extra-args";

// A minimal protobuf encoder for fixtures: a message is a list of [field, value] pairs, where a
// number is a varint, a string is UTF-8 bytes and a nested list is a sub-message.
type Field = [number, number | string | Field[]];
function varint(n: number): number[] {
  const out: number[] = [];
  do {
    let b = n % 128;
    n = Math.floor(n / 128);
    if (n > 0) b |= 0x80;
    out.push(b);
  } while (n > 0);
  return out;
}
function pb(fields: Field[]): Uint8Array {
  const out: number[] = [];
  for (const [f, v] of fields) {
    if (typeof v === "number") {
      out.push(...varint(f * 8), ...varint(v));
    } else {
      const bytes = typeof v === "string" ? new TextEncoder().encode(v) : pb(v);
      out.push(...varint(f * 8 + 2), ...varint(bytes.length), ...bytes);
    }
  }
  return Uint8Array.from(out);
}

const at = (sec: number): Field => [1, [[1, sec]]];
const userStep = (idx: number, text: string, sec: number): AgyStepRow => ({
  idx,
  stepType: 14,
  status: 3,
  metadata: pb([at(sec)]),
  payload: pb([[19, [[2, text]]]]),
});
const modelStep = (
  idx: number,
  sec: number,
  gen: { input: number; cacheRead?: number; output: number },
  body: { text?: string; calls?: [string, string, string][] },
): AgyStepRow => ({
  idx,
  stepType: 15,
  status: 3,
  metadata: pb([
    at(sec),
    [
      9,
      [
        [2, gen.input],
        [3, gen.output],
        ...(gen.cacheRead ? ([[5, gen.cacheRead]] as Field[]) : []),
      ],
    ],
  ]),
  payload: pb([
    [
      20,
      [
        ...(body.text ? ([[1, body.text]] as Field[]) : []),
        ...(body.calls ?? []).map(
          ([id, name, args]): Field => [
            7,
            [
              [1, id],
              [2, name],
              [3, args],
            ],
          ],
        ),
      ],
    ],
  ]),
});
const resultStep = (
  idx: number,
  sec: number,
  callId: string,
  output: string,
  status = 3,
): AgyStepRow => ({
  idx,
  stepType: 132,
  status,
  metadata: pb([at(sec), [4, [[1, callId]]]]),
  payload: pb([[140, [[2, [[1, output]]]]]]),
});

const steps: AgyStepRow[] = [
  userStep(0, "Fix the build\nplease", 100),
  modelStep(
    1,
    101,
    { input: 8000, output: 30 },
    {
      calls: [
        [
          "call_1",
          "run_command",
          '{"CommandLine":"pnpm build","toolSummary":"Build"}',
        ],
      ],
    },
  ),
  resultStep(2, 103, "call_1", "line 1\nline 2\n"),
  modelStep(
    3,
    104,
    { input: 1000, cacheRead: 8200, output: 40 },
    { calls: [["call_2", "read_file", '{"Path":"C:/repo/a.ts"}']] },
  ),
  resultStep(4, 105, "call_2", "boom", 6),
  modelStep(5, 106, { input: 9500, output: 12 }, { text: "Done." }),
];

describe("agy conversation reader", () => {
  it("summarizes title, summed usage and the last prompt as context", () => {
    const s = summarizeAgySteps(steps);
    expect(s.title).toBe("Fix the build");
    expect(s.usage.inputTokens).toBe(18500);
    expect(s.usage.cacheReadTokens).toBe(8200);
    expect(s.usage.outputTokens).toBe(82);
    expect(s.contextTokens).toBe(9500);
    expect(s.context).toEqual({ input: 9500, cacheRead: 0, cacheCreation: 0 });
  });

  it("renders user, tool and assistant events with tool results resolved", () => {
    const doc = parseAgyEvents(steps);
    expect(doc.events).toEqual([
      { kind: "user", text: "Fix the build\nplease" },
      {
        kind: "tool",
        name: "run_command",
        input: "pnpm build",
        toolUseId: "call_1",
        status: "ok",
        outputLines: 2,
      },
      {
        kind: "tool",
        name: "read_file",
        input: "C:/repo/a.ts",
        toolUseId: "call_2",
        status: "error",
        outputLines: 1,
      },
      { kind: "assistant", text: "Done." },
    ]);
    expect(doc.turns).toEqual([
      {
        index: 1,
        prompt: "Fix the build",
        startMs: 100_000,
        endMs: 106_000,
        durationMs: 6_000,
        toolCount: 2,
      },
    ]);
  });

  it("extracts one tool call's command and output", () => {
    expect(extractAgyToolResult(steps, "call_1")).toEqual({
      found: true,
      command: "pnpm build",
      output: "line 1\nline 2\n",
      status: "ok",
    });
    expect(extractAgyToolResult(steps, "nope")).toEqual({ found: false });
  });

  it("reads the workspace, start time and model", () => {
    const head = readAgyHead(
      pb([
        [1, [[1, "file:///c:/Users/me/My%20Repo"]]],
        [
          2,
          [
            [1, 1794489717],
            [2, 52_000_000],
          ],
        ],
      ]),
      "win32",
    );
    expect(head).toEqual({
      cwd: "C:\\Users\\me\\My Repo",
      createdMs: 1794489717052,
    });
    expect(
      readAgyModel(
        pb([
          [
            1,
            [
              [19, "gemini-3.8-flash"],
              [21, "Gemini 3.8 Flash (Low)"],
            ],
          ],
        ]),
      ),
    ).toEqual({ id: "gemini-3.8-flash", label: "Gemini 3.8 Flash (Low)" });
  });

  it("tolerates garbage blobs and odd URIs", () => {
    const junk = Uint8Array.from([0xff, 0xff, 0xff]);
    expect(readAgyHead(junk)).toBeNull();
    expect(readAgyModel(junk)).toBeNull();
    expect(fileUriToPath("https://x")).toBe("");
    expect(fileUriToPath("file:///f%3A/code", "win32")).toBe("F:\\code");
    expect(fileUriToPath("file:///home/me/x", "linux")).toBe("/home/me/x");
    expect(agyToolInput("not json")).toBe("not json");
  });
});

describe("agy quota (via Antigravity Tools)", () => {
  const now = Date.parse("2026-11-12T13:00:00Z");
  const account = {
    email: "a@b.c",
    quota: {
      last_updated: 1794489374,
      subscription_tier: "ULTRA",
      models: [
        {
          name: "gemini-3.8-flash-low",
          display_name: "Gemini 3.8 Flash (Low)",
          max_tokens: 1048576,
        },
        {
          name: "claude-opus-4-6-thinking",
          display_name: "Claude Opus 4.6 (Thinking)",
          max_tokens: 250000,
        },
      ],
      quota_groups: [
        {
          buckets: [
            {
              bucket_id: "gemini-weekly",
              window: "weekly",
              remaining_fraction: 0.9273,
              reset_time: "2026-11-19T05:30:15Z",
            },
            {
              bucket_id: "gemini-5h",
              window: "5h",
              remaining_fraction: 0.4,
              reset_time: "2026-11-12T15:30:15Z",
            },
          ],
        },
        {
          buckets: [
            {
              bucket_id: "3p-5h",
              window: "5h",
              remaining_fraction: 0.1,
              reset_time: "2026-11-12T12:00:00Z",
            },
          ],
        },
      ],
    },
  };

  it("maps each pool's buckets to 5h / weekly windows", () => {
    const q = parseAgyQuota(account, now)!;
    expect(q.tier).toBe("ULTRA");
    expect(q.pools[0]).toEqual({
      kind: "gemini",
      windows: {
        sevenDay: {
          usedPct: 7,
          resetsAt: Date.parse("2026-11-19T05:30:15Z"),
          windowMinutes: 10080,
        },
        fiveHour: {
          usedPct: 60,
          resetsAt: Date.parse("2026-11-12T15:30:15Z"),
          windowMinutes: 300,
        },
      },
    });
    // Its reset already passed: the window has refilled.
    expect(q.pools[1].kind).toBe("third-party");
    expect(q.pools[1].windows.fiveHour?.usedPct).toBe(0);
  });

  it("picks the pool and the official window by model", () => {
    const q = parseAgyQuota(account, now)!;
    expect(agyPoolKind("Claude Opus 4.6 (Thinking)")).toBe("third-party");
    expect(agyPoolKind("GPT-OSS 120B (Medium)")).toBe("third-party");
    expect(agyPoolKind("Gemini 4 Carbon (High)")).toBe("gemini");
    expect(
      agyContextWindow({ label: "Claude Opus 4.6 (Thinking)" }, q.models),
    ).toBe(250000);
    expect(agyContextWindow({ id: "gemini-3.8-flash" }, q.models)).toBe(
      1048576,
    );
    // No model list (Tools absent): the per-family figure.
    expect(agyContextWindow({ label: "GPT-OSS 120B (Medium)" })).toBe(131072);
    expect(agyContextWindow({ label: "Gemini 4 Argon (High)" })).toBe(1048576);
  });

  it("reads nothing from an account Tools never refreshed", () => {
    expect(parseAgyQuota({ email: "a@b.c" })).toBeNull();
    expect(parseAgyQuota(null)).toBeNull();
  });
});

describe("agy launch", () => {
  it("starts and resumes with full permissions", () => {
    expect(
      buildSpawnCommand({ agent: "agy", id: "draft", model: "default" }),
    ).toEqual({ file: "agy", args: ["--dangerously-skip-permissions"] });
    expect(
      buildResumeCommand({
        agent: "agy",
        id: "c1",
        extraArgs: ["--effort", "high"],
      }),
    ).toEqual({
      file: "agy",
      args: [
        "--conversation",
        "c1",
        "--dangerously-skip-permissions",
        "--effort",
        "high",
      ],
    });
  });

  it("binds a resume to its conversation db", () => {
    expect(
      gateResume("agy", { alive: false, cwd: "C:\\r", rolloutPath: "x.db" }),
    ).toEqual({ ok: true, cwd: "C:\\r", agent: "agy", claimedRollout: "x.db" });
  });

  it("refuses the conversation flags the app manages", () => {
    expect(validateExtraArgs("agy", "--conversation abc")).toEqual({
      ok: false,
      kind: "reserved",
      token: "--conversation",
    });
    expect(validateExtraArgs("agy", "-p hi").ok).toBe(false);
    expect(validateExtraArgs("agy", "--effort high")).toEqual({
      ok: true,
      tokens: ["--effort", "high"],
    });
  });

  it("hands agy the system proxy unless the environment names one", () => {
    expect(proxyUrlFromPac("PROXY 127.0.0.1:17891; DIRECT")).toBe(
      "http://127.0.0.1:17891",
    );
    expect(proxyUrlFromPac("SOCKS5 127.0.0.1:1080")).toBe(
      "socks5://127.0.0.1:1080",
    );
    expect(proxyUrlFromPac("DIRECT")).toBeNull();
    expect(agyProxyEnv("http://127.0.0.1:17891", {})).toEqual({
      HTTP_PROXY: "http://127.0.0.1:17891",
      HTTPS_PROXY: "http://127.0.0.1:17891",
      ALL_PROXY: "http://127.0.0.1:17891",
      NO_PROXY: "localhost,127.0.0.1,::1",
    });
    expect(
      agyProxyEnv("http://127.0.0.1:17891", { HTTPS_PROXY: "http://x:1" }),
    ).toBeUndefined();
    expect(agyProxyEnv(null, {})).toBeUndefined();
  });
});
