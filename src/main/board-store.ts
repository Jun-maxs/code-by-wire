import { spawn } from "node:child_process";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readTextOrNull } from "./claude-config";
import { claudeLauncher } from "./terminal/command";
import {
  MAX_INSIGHTS,
  normalizeBoard,
  parseInsightReply,
  type AiTestResult,
  type BoardAi,
  type BoardDoc,
  type Insight,
  type InsightRunState,
} from "@shared/board";

/**
 * The work board's document (fork feature, 2026-10-28): `board.json` under userData, beside
 * session-pins.json. The renderer owns edits and saves the whole document; main sanitizes on both
 * read and write so a corrupt or hand-edited file reads as an empty board instead of crashing.
 */
export interface BoardStore {
  read(): BoardDoc;
  save(doc: unknown): BoardDoc;
  /** Start an insight run with the renderer-built prompt; no-op while one is running. */
  runInsight(prompt: string, trigger: Insight["trigger"]): InsightRunState;
  /** Send a one-line prompt through `ai` and report whether it answered. */
  testAi(ai: BoardAi): Promise<AiTestResult>;
  insightState(): InsightRunState;
}

/** A model run that never answers must not block the next one forever. */
const INSIGHT_TIMEOUT_MS = 3 * 60_000;

export function createBoardStore(deps: {
  dir: string;
  env?: NodeJS.ProcessEnv;
}): BoardStore {
  const file = join(deps.dir, "board.json");
  const env = deps.env ?? process.env;
  const state: InsightRunState = {
    running: false,
    startedAt: null,
    error: null,
  };

  function read(): BoardDoc {
    const raw = readTextOrNull(file);
    if (raw === null) return normalizeBoard(null);
    try {
      return normalizeBoard(JSON.parse(raw));
    } catch {
      return normalizeBoard(null);
    }
  }

  function save(doc: unknown): BoardDoc {
    const next = normalizeBoard(doc);
    mkdirSync(deps.dir, { recursive: true });
    writeFileSync(file, JSON.stringify(next, null, 2) + "\n");
    return next;
  }

  function finish(error: string | null, insight: Insight | null): void {
    state.running = false;
    state.error = error;
    if (insight) {
      // Re-read: the renderer may have saved edits while the model was thinking.
      const doc = read();
      doc.insights = [insight, ...doc.insights].slice(0, MAX_INSIGHTS);
      save(doc);
    }
  }

  function runInsight(
    prompt: string,
    trigger: Insight["trigger"],
  ): InsightRunState {
    if (state.running) return { ...state };
    state.running = true;
    state.startedAt = Date.now();
    state.error = null;
    complete(read().ai, prompt, env).then(
      (out) => {
        const insight = parseInsightReply(out, Date.now(), trigger);
        if (insight) finish(null, insight);
        else finish(out.trim().slice(-400) || "empty reply", null);
      },
      (e: unknown) =>
        finish((e instanceof Error ? e.message : String(e)).slice(-400), null),
    );
    return { ...state };
  }

  async function testAi(ai: BoardAi): Promise<AiTestResult> {
    const started = Date.now();
    try {
      const out = await complete(ai, "只回复两个字母：OK", env, 60_000);
      return {
        ok: /ok/i.test(out),
        message: out.trim().slice(0, 200) || "empty reply",
        ms: Date.now() - started,
      };
    } catch (e) {
      return {
        ok: false,
        message: (e instanceof Error ? e.message : String(e)).slice(-300),
        ms: Date.now() - started,
      };
    }
  }

  return {
    read,
    save,
    runInsight,
    testAi,
    insightState: () => ({ ...state }),
  };
}

/** One prompt in, the model's text out, through whichever service the board is set to. */
export async function complete(
  ai: BoardAi,
  prompt: string,
  env: NodeJS.ProcessEnv,
  timeoutMs = INSIGHT_TIMEOUT_MS,
): Promise<string> {
  if (ai.provider === "openai") {
    if (!ai.baseUrl || !ai.model) throw new Error("接口地址或模型没填");
    const res = await fetch(
      `${ai.baseUrl.replace(/\/+$/, "")}/chat/completions`,
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          ...(ai.apiKey ? { authorization: `Bearer ${ai.apiKey}` } : {}),
        },
        body: JSON.stringify({
          model: ai.model,
          messages: [{ role: "user", content: prompt }],
          temperature: 0.3,
          max_tokens: 2000,
          stream: false,
        }),
        signal: AbortSignal.timeout(timeoutMs),
      },
    ).catch((e: unknown) => {
      // Node's fetch says only "fetch failed"; the reason (refused, DNS, TLS) is in `cause`.
      const cause = (e as { cause?: { code?: string; message?: string } })
        .cause;
      throw new Error(
        cause?.code === "ECONNREFUSED"
          ? `连不上 ${ai.baseUrl}（服务没开？）`
          : `${(e as Error).message}${cause ? `: ${cause.code ?? cause.message}` : ""}`,
      );
    });
    const text = await res.text();
    if (!res.ok) throw new Error(`HTTP ${res.status}: ${text.slice(0, 300)}`);
    const body = JSON.parse(text) as {
      choices?: { message?: { content?: string } }[];
    };
    return body.choices?.[0]?.message?.content ?? "";
  }
  return runClaude(ai.claudeModel, prompt, env, timeoutMs);
}

/** `claude -p` (rec when CBW_CLAUDE_LAUNCHER is set) with no tools and no saved session. */
function runClaude(
  model: string,
  prompt: string,
  env: NodeJS.ProcessEnv,
  timeoutMs: number,
): Promise<string> {
  // The workbench's UserPromptSubmit hook injects product cards and can block prompts that mention
  // several products; point it at an empty data dir flagged HOOKS_OFF, as refresh_cards.py does.
  let childEnv: NodeJS.ProcessEnv = { ...env };
  try {
    const off = mkdtempSync(join(tmpdir(), "cbw-board-"));
    writeFileSync(join(off, "HOOKS_OFF"), "");
    childEnv = { ...childEnv, WB_DATA: off };
  } catch {
    // without the flag the run still works, just with the hook's extra context
  }
  return new Promise((resolve, reject) => {
    let out = "";
    let err = "";
    const child = spawn(
      claudeLauncher(env),
      ["-p", "--model", model, "--tools", "", "--no-session-persistence"],
      { env: childEnv, windowsHide: true, stdio: ["pipe", "pipe", "pipe"] },
    );
    const timer = setTimeout(() => child.kill(), timeoutMs);
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (s: string) => (out += s));
    child.stderr.on("data", (s: string) => (err += s));
    child.on("error", (e) => {
      clearTimeout(timer);
      reject(e);
    });
    child.on("exit", (code) => {
      clearTimeout(timer);
      if (code === 0 && out.trim()) resolve(out);
      else reject(new Error(err.trim() || out.trim() || `exit ${code}`));
    });
    child.stdin.end(prompt, "utf8");
  });
}
