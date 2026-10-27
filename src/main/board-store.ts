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
    let out = "";
    let err = "";
    try {
      const child = spawn(
        claudeLauncher(env),
        ["-p", "--model", "haiku", "--tools", "", "--no-session-persistence"],
        { env: childEnv, windowsHide: true, stdio: ["pipe", "pipe", "pipe"] },
      );
      const timer = setTimeout(() => child.kill(), INSIGHT_TIMEOUT_MS);
      child.stdout.setEncoding("utf8");
      child.stderr.setEncoding("utf8");
      child.stdout.on("data", (s: string) => (out += s));
      child.stderr.on("data", (s: string) => (err += s));
      child.on("error", (e) => {
        clearTimeout(timer);
        finish(String(e), null);
      });
      child.on("exit", (code) => {
        clearTimeout(timer);
        if (!state.running) return;
        const insight = parseInsightReply(out, Date.now(), trigger);
        if (insight) finish(null, insight);
        else
          finish(
            (err.trim() || out.trim() || `exit ${code}`).slice(-400),
            null,
          );
      });
      child.stdin.end(prompt, "utf8");
    } catch (e) {
      finish(String(e), null);
    }
    return { ...state };
  }

  return {
    read,
    save,
    runInsight,
    insightState: () => ({ ...state }),
  };
}
