import type { AgentId } from "@shared/agents";
import type {
  ResumeRequest,
  ResumeResult,
  WorkDispatchAction,
  WorkDispatchRequest,
  WorkDispatchResult,
  WorkQuestionAnswer,
} from "@shared/terminal";
import type { Session } from "@shared/types";

export interface PtyWriteFrame {
  data: string;
  delayAfterMs: number;
}

const BRACKET_OPEN = "\x1b[200~";
const BRACKET_CLOSE = "\x1b[201~";

/** Strip bracketed-paste delimiters so pasted content can never break out of the paste envelope. */
export function sanitizePastePayload(raw: string): string {
  return raw
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n")
    .replaceAll("\x1b[200~", "")
    .replaceAll("\x1b[201~", "");
}

function encodePasteAndSubmit(
  rawText: string,
  bracketedPasteMode: boolean,
  afterSubmitDelayMs = 0,
): PtyWriteFrame[] {
  const clean = sanitizePastePayload(rawText);
  if (!clean.trim()) return [];
  if (bracketedPasteMode) {
    return [
      { data: `${BRACKET_OPEN}${clean}${BRACKET_CLOSE}`, delayAfterMs: 45 },
      { data: "\r", delayAfterMs: afterSubmitDelayMs },
    ];
  }
  // Fallback when a CLI has not enabled DECSET 2004: collapse internal newlines to spaces so
  // mid-prompt newlines don't prematurely submit partial lines, then send \r in a separate frame.
  const singleLine = clean.replace(/\n+/g, " ");
  return [
    { data: singleLine, delayAfterMs: 35 },
    { data: "\r", delayAfterMs: afterSubmitDelayMs },
  ];
}

function encodeOneQuestionAnswer(
  ans: WorkQuestionAnswer,
  agent: AgentId,
  bracketedPasteMode: boolean,
  isLast: boolean,
): PtyWriteFrame[] {
  const frames: PtyWriteFrame[] = [];
  const stepPause = isLast ? 0 : 60;
  const custom = ans.customText?.trim() ?? "";

  if (custom) {
    const clean = sanitizePastePayload(custom);
    const otherOneBased = ans.optionCount + 1;
    if (agent === "claude" && !ans.multiSelect && otherOneBased <= 9) {
      frames.push({ data: String(otherOneBased), delayAfterMs: 55 });
    } else if (ans.optionCount > 0) {
      frames.push({
        data: "\x1b[B".repeat(ans.optionCount),
        delayAfterMs: 45,
      });
      if (agent !== "claude") {
        frames.push({ data: "\r", delayAfterMs: 45 });
      }
    }
    const payload = bracketedPasteMode
      ? `${BRACKET_OPEN}${clean}${BRACKET_CLOSE}`
      : clean.replace(/\n+/g, " ");
    frames.push({ data: payload, delayAfterMs: 45 });
    frames.push({ data: "\r", delayAfterMs: ans.multiSelect ? 45 : stepPause });
    if (ans.multiSelect) {
      // Advance from "Other" onto the "Submit / Next" row and confirm.
      frames.push({ data: "\x1b[B", delayAfterMs: 30 });
      frames.push({ data: "\r", delayAfterMs: stepPause });
    }
    return frames;
  }

  if (ans.multiSelect) {
    const selected = new Set(ans.selectedIndices);
    // Walk 0..optionCount (optionCount is "Other", optionCount + 1 is "Submit / Next").
    const totalAdvance = Math.max(1, ans.optionCount + 1);
    for (let i = 0; i < totalAdvance; i++) {
      if (i < ans.optionCount && selected.has(i)) {
        frames.push({ data: " ", delayAfterMs: 25 });
      }
      frames.push({ data: "\x1b[B", delayAfterMs: 25 });
    }
    frames.push({ data: "\r", delayAfterMs: stepPause });
    return frames;
  }

  const idx = ans.selectedIndices[0] ?? 0;
  if (agent === "claude" && idx >= 0 && idx < 9) {
    frames.push({ data: String(idx + 1), delayAfterMs: stepPause });
    return frames;
  }
  if (idx > 0) {
    frames.push({ data: "\x1b[B".repeat(idx), delayAfterMs: 35 });
  }
  frames.push({ data: "\r", delayAfterMs: stepPause });
  return frames;
}

/**
 * Pure encoder translating a structured `Work` view user action into timed PTY byte frames.
 * Splitting bracketed paste and trailing `\r` across distinct frames prevents ConPTY + Ink/Ratatui
 * input parsers from treating the trailing carriage return as part of the pasted buffer.
 */
export function encodeWorkActionFrames(
  action: WorkDispatchAction,
  agent: AgentId,
  bracketedPasteMode: boolean,
  platform: NodeJS.Platform = process.platform,
): PtyWriteFrame[] {
  switch (action.kind) {
    case "prompt":
      return encodePasteAndSubmit(action.text, bracketedPasteMode);

    case "interrupt":
      return [{ data: "\x1b", delayAfterMs: 0 }];

    case "paste-image":
      return [
        {
          data: platform === "win32" ? "\x1bv" : "\x16",
          delayAfterMs: 0,
        },
      ];

    case "permission": {
      if (action.decision === "deny") {
        return [{ data: "\x1b", delayAfterMs: 0 }];
      }
      if (agent === "codex") {
        return [
          {
            data: action.decision === "allow-session" ? "a" : "y",
            delayAfterMs: 0,
          },
        ];
      }
      return [
        {
          data: action.decision === "allow-session" ? "2" : "1",
          delayAfterMs: 0,
        },
      ];
    }

    case "question": {
      if (action.answers.length === 0) return [];
      const frames: PtyWriteFrame[] = [];
      action.answers.forEach((ans, idx) => {
        const isLast = idx === action.answers.length - 1;
        frames.push(
          ...encodeOneQuestionAnswer(ans, agent, bracketedPasteMode, isLast),
        );
      });
      // Multi-question AskUserQuestion in Claude Code lands on a final "Review your answers"
      // screen with "1. Submit answers" pre-focused. Confirm it after a short settle delay.
      if (agent === "claude" && action.answers.length > 1) {
        const last = frames[frames.length - 1];
        if (last) last.delayAfterMs = Math.max(last.delayAfterMs, 65);
        frames.push({ data: "\r", delayAfterMs: 0 });
      }
      return frames;
    }
  }
}

export interface WorkDispatcherDeps {
  hasPty: (id: string) => boolean;
  modes: (id: string) => Promise<{ bracketedPasteMode: boolean } | null>;
  writeFrames: (id: string, frames: PtyWriteFrame[]) => Promise<boolean>;
  waitForPromptReady: (id: string) => Promise<boolean>;
  resumeSession: (req: ResumeRequest) => ResumeResult;
  agentOf: (id: string) => AgentId;
  platform?: NodeJS.Platform;
  isToolStillPending?: (
    id: string,
    toolUseId: string,
  ) => Promise<boolean> | boolean;
  /** True when provider liveness already marks the session ended while ConPTY is still draining `pty.onExit`. */
  isSessionEnded?: (id: string, expectResume?: boolean) => boolean;
  /** Drain/reap a closing PTY handle whose CLI process has already exited before re-spawning `--resume`. */
  waitForPtyClosed?: (id: string) => Promise<boolean>;
}

/**
 * State-gated dispatcher for `Work` view interactions:
 * 1. Anti-replay token set + transcript `isToolStillPending` guard on `permission` and `question` actions.
 * 2. Automatic `gateResume` + TUI prompt-readiness wait when sending a prompt to an `ended` session.
 * 3. Bracketed-paste + split `\r` frame emission onto `node-pty`.
 */
export function createWorkDispatcher(
  deps: WorkDispatcherDeps,
): (req: WorkDispatchRequest) => Promise<WorkDispatchResult> {
  const dispatchedToolTokens = new Set<string>();
  const rememberToolToken = (token: string): void => {
    dispatchedToolTokens.add(token);
    if (dispatchedToolTokens.size > 512) {
      const oldest = dispatchedToolTokens.values().next();
      if (!oldest.done) dispatchedToolTokens.delete(oldest.value);
    }
  };

  return async (req: WorkDispatchRequest): Promise<WorkDispatchResult> => {
    const { id, action } = req;
    if (action.kind === "prompt" && !action.text.trim()) {
      return { ok: false, reason: "empty" };
    }

    let resumed = false;
    let resumedSession: Session | undefined;

    if (action.kind === "permission" || action.kind === "question") {
      if (!deps.hasPty(id)) return { ok: false, reason: "not-live" };
      if (action.toolUseId) {
        const token = `${id}:${action.toolUseId}`;
        if (dispatchedToolTokens.has(token)) {
          return { ok: false, reason: "stale" };
        }
        if (deps.isToolStillPending) {
          const pending = await deps.isToolStillPending(id, action.toolUseId);
          if (!pending) return { ok: false, reason: "stale" };
        }
        if (dispatchedToolTokens.has(token)) {
          return { ok: false, reason: "stale" };
        }
        if (!deps.hasPty(id)) return { ok: false, reason: "not-live" };
        rememberToolToken(token);
      }
    } else {
      if (
        action.kind === "prompt" &&
        deps.hasPty(id) &&
        deps.isSessionEnded?.(id, req.expectResume)
      ) {
        await deps.waitForPtyClosed?.(id);
      }
      if (action.kind === "prompt" && !deps.hasPty(id)) {
        const r = deps.resumeSession({
          id,
          cols: req.cols ?? 100,
          rows: req.rows ?? 30,
        });
        if (!r.ok) return { ok: false, reason: r.reason };
        resumed = true;
        resumedSession = r.session;
        const ready = await deps.waitForPromptReady(id);
        if (!ready) return { ok: false, reason: "not-live" };
      } else if (!deps.hasPty(id)) {
        return { ok: false, reason: "not-live" };
      }
    }

    const modeSnapshot = await deps.modes(id);
    if (!modeSnapshot) return { ok: false, reason: "not-live" };

    const frames = encodeWorkActionFrames(
      action,
      deps.agentOf(id),
      modeSnapshot.bracketedPasteMode,
      deps.platform,
    );
    if (frames.length === 0) return { ok: false, reason: "empty" };

    const wrote = await deps.writeFrames(id, frames);
    if (!wrote) return { ok: false, reason: "not-live" };

    return {
      ok: true,
      ...(resumed ? { resumed: true } : {}),
      ...(resumedSession ? { session: resumedSession } : {}),
    };
  };
}
