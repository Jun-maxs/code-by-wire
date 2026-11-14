import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  utimesSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  STEP_COMPACTION,
  agyToolInput,
  computeAgyTokenSpeed,
  extractAgyToolResult,
  extractAgyTurnActivity,
  fileUriToPath,
  parseAgyEvents,
  readAgyGenMeta,
  readAgyHead,
  readAgyModel,
  summarizeAgySteps,
  type AgyGenRow,
  type AgyStepRow,
} from "../../src/main/provider/agy/conversation";
import {
  AGY_QUOTA_TTL_MS,
  agyContextWindow,
  agyPoolKind,
  agyQuotaUserAgent,
  createAgyQuotaReader,
  parseAgyAvailableModels,
  parseAgyQuota,
  parseAgyQuotaSummary,
  readAgySettingsModel,
} from "../../src/main/provider/agy/quota";
import {
  agyPoolKindForModel,
  agyPoolQuota,
  parseAgyModelDisplay,
} from "../../src/shared/agy-quota";
import { activeSplitQuotaAgent } from "../../src/renderer/src/settings/accounts-store";
import { pickWindow } from "../../src/shared/statusline";
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

describe("agy live Cloud Code quota refresh & expiration recovery", () => {
  const tempDirs: string[] = [];
  const makeDir = (): string => {
    const d = mkdtempSync(join(tmpdir(), "cbw-agy-quota-"));
    tempDirs.push(d);
    return d;
  };
  afterEach(() => {
    while (tempDirs.length) {
      rmSync(tempDirs.pop()!, { recursive: true, force: true });
    }
  });

  const flushAsync = (): Promise<void> =>
    new Promise((resolve) => setTimeout(resolve, 25));

  it("parses camelCase retrieveUserQuotaSummary and fetchAvailableModels responses", () => {
    const t = Date.parse("2026-11-14T06:00:00Z");
    const models = parseAgyAvailableModels({
      models: {
        "gemini-4-carbon": {
          displayName: "Gemini 4 Carbon (High)",
          maxTokens: 1_048_576,
        },
        "claude-opus-4-6": {
          displayName: "Claude Opus 4.6",
          maxTokens: 250_000,
        },
      },
    });
    expect(models).toEqual([
      {
        name: "gemini-4-carbon",
        displayName: "Gemini 4 Carbon (High)",
        maxTokens: 1_048_576,
      },
      {
        name: "claude-opus-4-6",
        displayName: "Claude Opus 4.6",
        maxTokens: 250_000,
      },
    ]);

    const quota = parseAgyQuotaSummary(
      {
        groups: [
          {
            displayName: "Gemini Models",
            buckets: [
              {
                bucketId: "gemini-weekly",
                window: "weekly",
                resetTime: "2026-11-20T22:59:10Z",
                remainingFraction: 0.8784,
              },
              {
                bucketId: "gemini-5h",
                window: "5h",
                resetTime: "2026-11-14T08:59:10Z",
                remainingFraction: 0.7957,
              },
            ],
          },
          {
            displayName: "Claude and GPT models",
            buckets: [
              {
                bucketId: "3p-weekly",
                window: "weekly",
                resetTime: "2026-11-21T06:00:00Z",
                remainingFraction: 1,
              },
              {
                bucketId: "3p-5h",
                window: "5h",
                resetTime: "2026-11-14T11:00:00Z",
                remainingFraction: 1,
              },
            ],
          },
        ],
      },
      { email: "dev@example.com", tier: "ULTRA", models },
      t,
    )!;

    expect(quota.email).toBe("dev@example.com");
    expect(quota.tier).toBe("ULTRA");
    expect(quota.pools[0]).toEqual({
      kind: "gemini",
      windows: {
        sevenDay: {
          usedPct: 12,
          resetsAt: Date.parse("2026-11-20T22:59:10Z"),
          windowMinutes: 10080,
        },
        fiveHour: {
          usedPct: 20,
          resetsAt: Date.parse("2026-11-14T08:59:10Z"),
          windowMinutes: 300,
        },
      },
    });
  });

  it("builds an aidev_client User-Agent and ignores bare overrides that strip Gemini buckets", () => {
    const dir = makeDir();
    expect(agyQuotaUserAgent(dir, "win32", "x64")).toBe(
      "antigravity/hub/2.28.0 (aidev_client; os_type=windows; arch=amd64; cl=1008300195)",
    );
    writeFileSync(
      join(dir, "gui_config.json"),
      JSON.stringify({ proxy: { user_agent_override: "antigravity/1.0" } }),
    );
    expect(agyQuotaUserAgent(dir, "darwin", "arm64")).toBe(
      "antigravity/hub/2.28.0 (aidev_client; os_type=darwin; arch=arm64; cl=1008300195)",
    );
  });

  it("refreshes stale/expired Tools quota via OAuth + daily-cloudcode-pa and rolls over elapsed reset windows", async () => {
    const root = makeDir();
    const toolsDir = join(root, "tools");
    const agyDir = join(root, "gemini", "antigravity-cli");
    const cachePath = join(root, "agy-quota-cache.json");
    mkdirSync(join(toolsDir, "accounts"), { recursive: true });
    mkdirSync(agyDir, { recursive: true });

    let clock = Date.parse("2026-11-14T06:00:00Z");
    const staleAccount = {
      email: "user@example.com",
      token: {
        access_token: "stale-access-token",
        refresh_token: "valid-refresh-token",
        expiry_timestamp: Math.floor(Date.parse("2026-11-13T17:00:00Z") / 1000),
        project_id: "aicode-consumers",
        oauth_client_key: "antigravity_enterprise",
      },
      quota: {
        last_updated: Math.floor(Date.parse("2026-11-13T16:00:00Z") / 1000),
        subscription_tier: "ULTRA",
        quota_groups: [
          {
            buckets: [
              {
                bucket_id: "gemini-weekly",
                window: "weekly",
                remaining_fraction: 0.45,
                reset_time: "2026-11-19T05:30:15Z",
              },
              {
                bucket_id: "gemini-5h",
                window: "5h",
                remaining_fraction: 0.88,
                // Expired 10h ago — pickWindow drops any resetsAt <= now!
                reset_time: "2026-11-13T19:48:03Z",
              },
            ],
          },
        ],
      },
    };
    const accFile = join(toolsDir, "accounts", "acc-1.json");
    const originalAccJson = JSON.stringify(staleAccount);
    writeFileSync(
      join(toolsDir, "accounts.json"),
      JSON.stringify({ current_agy_account_id: "acc-1" }),
    );
    writeFileSync(accFile, originalAccJson);

    const calls: { url: string; ua?: string; auth?: string }[] = [];
    let summaryRemaining5h = 0.8;
    let summaryReset5h = "2026-11-14T06:01:00Z"; // resets 60s from initial clock

    const jsonRes = (body: unknown, status = 200): Response =>
      new Response(JSON.stringify(body), {
        status,
        headers: { "Content-Type": "application/json" },
      });

    const reader = createAgyQuotaReader({
      toolsDir,
      agyDir,
      cachePath,
      oauthClients: [{ clientId: "test-agy-client", clientSecret: "test-agy-secret" }],
      agyBinPath: null,
      now: () => clock,
      platform: "win32",
      arch: "x64",
      fetchFn: (url, init) => {
        const headers = new Headers(init?.headers);
        calls.push({
          url,
          ua: headers.get("user-agent") ?? undefined,
          auth: headers.get("authorization") ?? undefined,
        });
        if (url === "https://oauth2.googleapis.com/token") {
          return Promise.resolve(
            jsonRes({ access_token: "fresh-access-1", expires_in: 3600 }),
          );
        }
        if (
          url ===
          "https://daily-cloudcode-pa.googleapis.com/v1internal:retrieveUserQuotaSummary"
        ) {
          return Promise.resolve(
            jsonRes({
              groups: [
                {
                  displayName: "Gemini Models",
                  buckets: [
                    {
                      bucketId: "gemini-weekly",
                      window: "weekly",
                      resetTime: "2026-11-20T22:59:10Z",
                      remainingFraction: 0.88,
                    },
                    {
                      bucketId: "gemini-5h",
                      window: "5h",
                      resetTime: summaryReset5h,
                      remainingFraction: summaryRemaining5h,
                    },
                  ],
                },
              ],
            }),
          );
        }
        if (
          url ===
          "https://daily-cloudcode-pa.googleapis.com/v1internal:fetchAvailableModels"
        ) {
          return Promise.resolve(
            jsonRes({
              models: {
                "gemini-4-carbon": {
                  displayName: "Gemini 4 Carbon (High)",
                  maxTokens: 1_048_576,
                },
              },
            }),
          );
        }
        return Promise.resolve(jsonRes({}, 500));
      },
    });

    // Cold read returns Tools fallback synchronously (whose 5h reset had expired) while launching refresh.
    const cold = reader.read()!;
    expect(
      pickWindow(cold.pools[0].windows.fiveHour, undefined, clock),
    ).toBeUndefined();

    await flushAsync();

    // Next poll reads live daily-cloudcode-pa quota with valid future resetsAt!
    const fresh = reader.read()!;
    const gemini = fresh.pools.find((p) => p.kind === "gemini")!;
    expect(pickWindow(gemini.windows.fiveHour, undefined, clock)).toEqual({
      usedPct: 20,
      resetsAt: Date.parse("2026-11-14T06:01:00Z"),
      windowMinutes: 300,
    });
    expect(pickWindow(gemini.windows.sevenDay, undefined, clock)).toEqual({
      usedPct: 12,
      resetsAt: Date.parse("2026-11-20T22:59:10Z"),
      windowMinutes: 10080,
    });
    expect(calls.map((c) => c.url)).toEqual([
      "https://oauth2.googleapis.com/token",
      "https://daily-cloudcode-pa.googleapis.com/v1internal:retrieveUserQuotaSummary",
      "https://daily-cloudcode-pa.googleapis.com/v1internal:fetchAvailableModels",
    ]);
    expect(calls[1].ua).toContain("aidev_client");
    expect(calls[1].auth).toBe("Bearer fresh-access-1");

    // External Tools file is untouched; persisted cache never stores OAuth tokens.
    expect(readFileSync(accFile, "utf8")).toBe(originalAccJson);
    const persistedRaw = readFileSync(cachePath, "utf8");
    expect(persistedRaw).not.toContain("fresh-access-1");
    expect(persistedRaw).not.toContain("valid-refresh-token");

    // When 5h resetTime elapses (+65s, still inside the 120s TTL!), read() immediately triggers a rollover fetch
    // and reuses the in-memory OAuth access token without hitting oauth2.googleapis.com/token again.
    calls.length = 0;
    clock += 65_000;
    summaryRemaining5h = 1;
    summaryReset5h = "2026-11-14T11:01:05Z";

    reader.read();
    await flushAsync();

    const rolled = reader.read()!;
    const rolledGemini = rolled.pools.find((p) => p.kind === "gemini")!;
    expect(pickWindow(rolledGemini.windows.fiveHour, undefined, clock)).toEqual(
      {
        usedPct: 0,
        resetsAt: Date.parse("2026-11-14T11:01:05Z"),
        windowMinutes: 300,
      },
    );
    expect(calls.map((c) => c.url)).toEqual([
      "https://daily-cloudcode-pa.googleapis.com/v1internal:retrieveUserQuotaSummary",
    ]);

    // After TTL elapses (+125s), refreshes summary again while still reusing valid memToken and cached models.
    calls.length = 0;
    clock += AGY_QUOTA_TTL_MS + 5_000;
    summaryRemaining5h = 0.91;
    reader.read();
    await flushAsync();
    expect(reader.read()!.pools[0].windows.fiveHour?.usedPct).toBe(9);
    expect(calls.map((c) => c.url)).toEqual([
      "https://daily-cloudcode-pa.googleapis.com/v1internal:retrieveUserQuotaSummary",
    ]);
  });

  it("falls back to standalone jetski-standalone-oauth-token without Tools and invalidates cache on account switch", async () => {
    const root = makeDir();
    const toolsDir = join(root, "absent-tools");
    const geminiDir = join(root, "gemini");
    const agyDir = join(geminiDir, "antigravity-cli");
    const cachePath = join(root, "agy-quota-cache.json");
    mkdirSync(agyDir, { recursive: true });

    const clock = Date.parse("2026-11-14T06:00:00Z");
    const jetPath = join(geminiDir, "jetski-standalone-oauth-token");
    writeFileSync(
      jetPath,
      JSON.stringify({
        token: JSON.stringify({
          access_token: "jet-valid-token",
          refresh_token: "jet-refresh-1",
          expiry: "2026-11-14T07:00:00Z",
        }),
        auth_method: "consumer",
        id_token_email: "first@example.com",
      }),
    );

    const fraction = 0.65;
    let blockSummary = false;
    const reader = createAgyQuotaReader({
      toolsDir,
      agyDir,
      cachePath,
      now: () => clock,
      fetchFn: (url) => {
        if (blockSummary) return new Promise(() => {});
        if (url.endsWith(":retrieveUserQuotaSummary")) {
          return Promise.resolve(
            new Response(
              JSON.stringify({
                groups: [
                  {
                    displayName: "Gemini Models",
                    buckets: [
                      {
                        bucketId: "gemini-5h",
                        window: "5h",
                        resetTime: "2026-11-14T10:00:00Z",
                        remainingFraction: fraction,
                      },
                    ],
                  },
                ],
              }),
              { status: 200 },
            ),
          );
        }
        return Promise.resolve(new Response("{}", { status: 200 }));
      },
    });

    expect(reader.read()).toBeNull();
    await flushAsync();
    const first = reader.read()!;
    expect(first.email).toBe("first@example.com");
    expect(first.pools[0].windows.fiveHour?.usedPct).toBe(35);

    // Switch account in jetski-standalone-oauth-token: both live runtime reader AND cold cachePath reader
    // must drop first@example.com's quota immediately before the new fetch completes!
    blockSummary = true;
    writeFileSync(
      jetPath,
      JSON.stringify({
        token: JSON.stringify({
          access_token: "jet-second-token",
          refresh_token: "jet-refresh-2",
          expiry: "2026-11-14T07:00:00Z",
        }),
        auth_method: "consumer",
        id_token_email: "second@example.com",
      }),
    );
    const futureDate = new Date(Date.now() + 10_000);
    utimesSync(jetPath, futureDate, futureDate);
    expect(reader.read()).toBeNull();

    const coldSwitchReader = createAgyQuotaReader({
      toolsDir,
      agyDir,
      cachePath,
      now: () => clock,
      fetchFn: () => new Promise(() => {}),
    });
    expect(coldSwitchReader.read()).toBeNull();
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

describe("agy telemetry, thinking, throughput, settings & quota helpers", () => {
  const tempDirs: string[] = [];
  const makeDir = (): string => {
    const d = mkdtempSync(join(tmpdir(), "cbw-agy-overview-"));
    tempDirs.push(d);
    return d;
  };
  afterEach(() => {
    while (tempDirs.length > 0) {
      rmSync(tempDirs.pop()!, { recursive: true, force: true });
    }
  });

  const genRow = (
    idx: number,
    opts: {
      id: string;
      label: string;
      ttftSec?: number;
      streamSec?: number;
      parentCascadeId?: string;
      subagentType?: string;
    },
  ): AgyGenRow => ({
    idx,
    data: pb([
      [
        1,
        [
          ...(opts.ttftSec !== undefined
            ? ([[11, [[1, opts.ttftSec]]]] as Field[])
            : []),
          ...(opts.streamSec !== undefined
            ? ([[12, [[1, opts.streamSec]]]] as Field[])
            : []),
          [19, opts.id],
          [21, opts.label],
          ...(opts.parentCascadeId
            ? ([
                [
                  20,
                  [
                    [1, "parent_cascade_id"],
                    [2, opts.parentCascadeId],
                  ],
                ],
              ] as Field[])
            : []),
          ...(opts.subagentType
            ? ([
                [
                  20,
                  [
                    [1, "subagent_type"],
                    [2, opts.subagentType],
                  ],
                ],
              ] as Field[])
            : []),
        ],
      ],
    ]),
  });

  const timedModelStep = (
    idx: number,
    startSec: number,
    endSec: number,
    gen: { input: number; cacheRead?: number; output: number },
    body: {
      text?: string;
      thinking?: string;
      calls?: [string, string, string][];
    },
    status = 3,
  ): AgyStepRow => ({
    idx,
    stepType: 15,
    status,
    metadata: pb([
      at(startSec),
      [7, [[1, endSec]]],
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
          ...(body.thinking ? ([[3, body.thinking]] as Field[]) : []),
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

  it("reads duration, parent cascade id and effort label from gen_metadata", () => {
    const g = genRow(0, {
      id: "gemini-4-hydrogen",
      label: "Gemini 4 Hydrogen (XHigh)",
      ttftSec: 4,
      streamSec: 6,
      parentCascadeId: "parent-123",
      subagentType: "self",
    });
    const meta = readAgyGenMeta(g.data);
    expect(meta.model).toEqual({
      id: "gemini-4-hydrogen",
      label: "Gemini 4 Hydrogen (XHigh)",
    });
    expect(meta.durationMs).toBe(10_000);
    expect(meta.parentCascadeId).toBe("parent-123");
    expect(meta.subagentType).toBe("self");
    expect(parseAgyModelDisplay("Gemini 4 Hydrogen (XHigh)")).toEqual({
      displayName: "Gemini 4 Hydrogen",
      effortLevel: "xhigh",
    });
    expect(parseAgyModelDisplay("Claude Sonnet 4.6 (Thinking)")).toEqual({
      displayName: "Claude Sonnet 4.6 (Thinking)",
    });
  });

  it("computes usageByModel, compactionCount, merged apiDurationMs and throughput", () => {
    const timedSteps: AgyStepRow[] = [
      userStep(0, "Analyze sidebar layout", 100),
      timedModelStep(
        1,
        100,
        110, // 10s
        { input: 1000, cacheRead: 2000, output: 500 },
        {
          thinking: "Need to inspect chrome.",
          calls: [["c1", "read_file", '{"Path":"C:/repo/chrome.tsx"}']],
        },
      ),
      {
        idx: 2,
        stepType: STEP_COMPACTION,
        status: 3,
        metadata: pb([at(112)]),
        payload: null,
      },
      timedModelStep(
        3,
        105, // overlaps [100,110] -> union [100,120] = 20s!
        120,
        { input: 2000, cacheRead: 3000, output: 1000 },
        { text: "All updated." },
      ),
    ];
    const gens: AgyGenRow[] = [
      genRow(0, { id: "gemini-4-carbon", label: "Gemini 4 Carbon (High)" }),
      genRow(1, {
        id: "gemini-4-hydrogen",
        label: "Gemini 4 Hydrogen (XHigh)",
      }),
    ];

    const summary = summarizeAgySteps(timedSteps, gens);
    expect(summary.compactionCount).toBe(1);
    expect(summary.apiDurationMs).toBe(20_000);
    expect(summary.usageByModel).toEqual([
      {
        modelRaw: "gemini-4-carbon",
        usage: {
          inputTokens: 1000,
          outputTokens: 500,
          cacheReadTokens: 2000,
          cacheCreationTokens: 0,
          cacheCreation5mTokens: 0,
          cacheCreation1hTokens: 0,
        },
      },
      {
        modelRaw: "gemini-4-hydrogen",
        usage: {
          inputTokens: 2000,
          outputTokens: 1000,
          cacheReadTokens: 3000,
          cacheCreationTokens: 0,
          cacheCreation5mTokens: 0,
          cacheCreation1hTokens: 0,
        },
      },
    ]);

    const speed = computeAgyTokenSpeed(timedSteps, gens, 60_000);
    expect(speed).toEqual({
      inputTps: 3000 / 20,
      outputTps: 1500 / 20,
      totalTps: 4500 / 20,
    });

    const events = parseAgyEvents(timedSteps);
    expect(events.events).toContainEqual({
      kind: "thinking",
      text: "Need to inspect chrome.",
    });

    const activity = extractAgyTurnActivity(timedSteps);
    expect(activity.steps).toBe(1);
    expect(activity.lastTool).toEqual({
      name: "read_file",
      target: "chrome.tsx",
    });
    expect(activity.tasks).toHaveLength(1);
    expect(activity.tasks[0]?.text).toBe("Analyze sidebar layout");
  });

  it("reads settings.json fallback and multi-account dual-pool overview", () => {
    const tmp = makeDir();
    const agyDir = join(tmp, "agy");
    const toolsDir = join(tmp, "tools");
    mkdirSync(join(toolsDir, "accounts"), { recursive: true });
    mkdirSync(agyDir, { recursive: true });
    writeFileSync(
      join(agyDir, "settings.json"),
      JSON.stringify({ model: "Gemini 4 Hydrogen (XHigh)" }),
    );
    writeFileSync(
      join(toolsDir, "accounts.json"),
      JSON.stringify({
        current_agy_account_id: "acc-1",
        accounts: [{ id: "acc-1" }, { id: "acc-2" }],
      }),
    );
    const t0 = Date.parse("2026-11-12T13:00:00Z");
    writeFileSync(
      join(toolsDir, "accounts", "acc-1.json"),
      JSON.stringify({
        email: "one@example.com",
        quota: {
          subscription_tier: "ULTRA",
          models: [
            {
              name: "gemini-4-hydrogen",
              display_name: "Gemini 4 Hydrogen (XHigh)",
              max_tokens: 1048576,
            },
          ],
          quota_groups: [
            {
              buckets: [
                {
                  bucket_id: "gemini-5h",
                  window: "5h",
                  remaining_fraction: 0.75,
                  reset_time: "2026-11-12T17:00:00Z",
                },
                {
                  bucket_id: "gemini-weekly",
                  window: "weekly",
                  remaining_fraction: 0.9,
                  reset_time: "2026-11-18T12:00:00Z",
                },
              ],
            },
            {
              buckets: [
                {
                  bucket_id: "3p-5h",
                  window: "5h",
                  remaining_fraction: 0.4,
                  reset_time: "2026-11-12T17:00:00Z",
                },
              ],
            },
          ],
        },
      }),
    );
    writeFileSync(
      join(toolsDir, "accounts", "acc-2.json"),
      JSON.stringify({
        email: "two@example.com",
        quota: { subscription_tier: "PRO", quota_groups: [], models: [] },
      }),
    );

    const reader = createAgyQuotaReader({ toolsDir, agyDir, now: () => t0 });
    const quota = reader.read();
    const overview = reader.readOverview?.();
    expect(overview?.accounts).toHaveLength(1);
    expect(overview?.accounts[0]?.current).toBe(true);
    const account = overview?.accounts[0];
    if (!overview || !account) {
      throw new Error("Expected agy quota overview with one account");
    }
    expect(agyPoolQuota(account, "gemini").fiveHour?.usedPct).toBe(25);
    expect(agyPoolQuota(account, "third-party").fiveHour?.usedPct).toBe(60);

    expect(readAgySettingsModel(agyDir, quota?.models)).toEqual({
      id: "gemini-4-hydrogen",
      label: "Gemini 4 Hydrogen (XHigh)",
      displayName: "Gemini 4 Hydrogen",
      effortLevel: "xhigh",
    });
    expect(agyPoolKindForModel("Gemini 4 Hydrogen")).toBe("gemini");
    expect(agyPoolKindForModel("Claude Sonnet 4.6")).toBe("third-party");

    const claudeOv = {
      accounts: [],
      smart: {
        enabled: false,
        available: false,
        threshold: 95,
        stuck: false,
      },
    };
    expect(activeSplitQuotaAgent("claude", claudeOv, overview)).toBe("claude");
    expect(activeSplitQuotaAgent("agy", claudeOv, overview)).toBe("agy");
    expect(activeSplitQuotaAgent("codex", claudeOv, overview)).toBeNull();
    expect(
      activeSplitQuotaAgent("agy", claudeOv, { accounts: [] }),
    ).toBeNull();
  });

  it("overlays refreshed Cloud Code live quota onto stale overview accounts and synthesizes standalone current account", async () => {
    const t0 = Date.parse("2026-11-14T10:00:00Z");
    const fetchMock = (url: string): Promise<Response> => {
      if (url.includes("oauth2.googleapis.com")) {
        return Promise.resolve(
          new Response(
            JSON.stringify({ access_token: "fresh-token", expires_in: 3600 }),
            { status: 200 },
          ),
        );
      }
      if (url.includes("retrieveUserQuotaSummary")) {
        return Promise.resolve(
          new Response(
            JSON.stringify({
              groups: [
                {
                  displayName: "Gemini Models",
                  buckets: [
                    {
                      bucketId: "gemini-5h",
                      window: "5h",
                      resetTime: "2026-11-14T13:59:10Z",
                      remainingFraction: 0.9,
                    },
                    {
                      bucketId: "gemini-weekly",
                      window: "weekly",
                      resetTime: "2026-11-20T22:59:10Z",
                      remainingFraction: 0.85,
                    },
                  ],
                },
                {
                  displayName: "Claude and GPT models",
                  buckets: [
                    {
                      bucketId: "3p-5h",
                      window: "5h",
                      resetTime: "2026-11-14T14:30:00Z",
                      remainingFraction: 0.8,
                    },
                  ],
                },
              ],
            }),
            { status: 200 },
          ),
        );
      }
      return Promise.resolve(
        new Response(JSON.stringify({ models: {} }), { status: 200 }),
      );
    };

    // Case 1: Standalone (no accounts.json) + stale jetski-standalone-oauth-token -> synthesizes #1 Current
    const soloRoot = makeDir();
    const soloAgyDir = join(soloRoot, "agy");
    mkdirSync(soloAgyDir, { recursive: true });
    const jwtPayload = Buffer.from(
      JSON.stringify({ azp: "preferred-client.apps.googleusercontent.com" }),
    ).toString("base64url");
    writeFileSync(
      join(soloAgyDir, "jetski-standalone-oauth-token"),
      JSON.stringify({
        token: JSON.stringify({
          access_token: "old-token",
          refresh_token: "refresh-1",
          expiry: "2026-11-14T08:00:00Z",
        }),
        auth_method: "consumer",
        id_token_email: "solo@example.com",
        id_token: `eyJhbGciOiJub25lIn0.${jwtPayload}.sig`,
      }),
    );
    const soloReader = createAgyQuotaReader({
      toolsDir: join(soloRoot, "missing-tools"),
      agyDir: soloAgyDir,
      cachePath: join(soloRoot, "cache.json"),
      oauthClients: [
        {
          clientId: "other-client.apps.googleusercontent.com",
          clientSecret: "other-secret",
        },
        {
          clientId: "preferred-client.apps.googleusercontent.com",
          clientSecret: "preferred-secret",
        },
      ],
      agyBinPath: null,
      now: () => t0,
      fetchFn: (url, init) => {
        if (url.includes("oauth2.googleapis.com")) {
          const rawBody = typeof init?.body === "string" ? init.body : "";
          const params = new URLSearchParams(rawBody);
          expect(params.get("client_id")).toBe(
            "preferred-client.apps.googleusercontent.com",
          );
          expect(params.get("client_secret")).toBe("preferred-secret");
        }
        return fetchMock(url);
      },
    });
    expect(soloReader.readOverview?.()).toBeNull();
    await new Promise((r) => setTimeout(r, 20));
    const soloOverview = soloReader.readOverview?.();
    expect(soloOverview?.accounts).toHaveLength(1);
    expect(soloOverview?.accounts[0]).toMatchObject({
      email: "solo@example.com",
      n: 1,
      current: true,
    });
    expect(soloOverview?.accounts[0]?.gemini?.fiveHour?.usedPct).toBe(10);
    expect(soloOverview?.accounts[0]?.gemini?.sevenDay?.usedPct).toBe(15);
    expect(soloOverview?.accounts[0]?.thirdParty?.fiveHour?.usedPct).toBe(20);

    // Case 2: Existing stale account in toolsDir -> live quota overlays matching current account
    const toolsRoot = makeDir();
    const toolsDir = join(toolsRoot, "tools");
    const toolsAgyDir = join(toolsRoot, "agy");
    mkdirSync(join(toolsDir, "accounts"), { recursive: true });
    mkdirSync(toolsAgyDir, { recursive: true });
    writeFileSync(
      join(toolsAgyDir, "jetski-standalone-oauth-token"),
      JSON.stringify({
        token: JSON.stringify({
          access_token: "old-token",
          refresh_token: "refresh-2",
          expiry: "2026-11-14T08:00:00Z",
        }),
        auth_method: "consumer",
        id_token_email: "dev@example.com",
      }),
    );
    writeFileSync(
      join(toolsDir, "accounts.json"),
      JSON.stringify({
        current_agy_account_id: "acc-dev",
        accounts: [{ id: "acc-dev" }],
      }),
    );
    writeFileSync(
      join(toolsDir, "accounts", "acc-dev.json"),
      JSON.stringify({
        email: "dev@example.com",
        quota: {
          last_updated: Math.floor(Date.parse("2026-11-14T01:00:00Z") / 1000),
          subscription_tier: "ULTRA",
          quota_groups: [
            {
              buckets: [
                {
                  bucket_id: "gemini-5h",
                  window: "5h",
                  remaining_fraction: 1,
                  reset_time: "2026-11-14T06:00:00Z", // already expired before t0!
                },
              ],
            },
          ],
        },
      }),
    );
    const syncedReader = createAgyQuotaReader({
      toolsDir,
      agyDir: toolsAgyDir,
      cachePath: join(toolsRoot, "cache.json"),
      oauthClients: [{ clientId: "test-agy-client", clientSecret: "test-agy-secret" }],
      agyBinPath: null,
      now: () => t0,
      fetchFn: fetchMock,
    });
    syncedReader.readOverview?.();
    await new Promise((r) => setTimeout(r, 20));
    const syncedOverview = syncedReader.readOverview?.();
    expect(syncedOverview?.accounts).toHaveLength(1);
    expect(syncedOverview?.accounts[0]?.email).toBe("dev@example.com");
    expect(syncedOverview?.accounts[0]?.gemini?.fiveHour?.usedPct).toBe(10);
    expect(syncedOverview?.accounts[0]?.gemini?.sevenDay?.usedPct).toBe(15);
    expect(syncedOverview?.accounts[0]?.thirdParty?.fiveHour?.usedPct).toBe(20);
  });
});
