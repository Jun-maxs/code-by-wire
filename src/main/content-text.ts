/** What the full-text index keeps from one transcript line (fork feature, 2026-10-29): prompts, replies
 *  and the paths/commands/URLs a tool was given — never tool output or context the CLI injected.
 *  Separate from content-search.ts so tests can load it without the native SQLite module. */

const MAX_FIELD = 600;
const TOOL_INPUT_KEYS = [
  "file_path",
  "path",
  "command",
  "url",
  "pattern",
  "description",
  "query",
];

/** Context the CLIs inject into user turns; not something the user said. */
const INJECTED =
  /^\s*(<(system-reminder|user_instructions|environment_context|command-|local-command)|# AGENTS\.md|Caveat:)/;

function cleanText(s: string): string | null {
  const t = s
    .replace(/<system-reminder>[\s\S]*?<\/system-reminder>/g, "")
    .trim();
  if (!t || INJECTED.test(t)) return null;
  return t;
}

function pushToolInput(out: string[], input: unknown): void {
  if (!input || typeof input !== "object") return;
  const rec = input as Record<string, unknown>;
  for (const k of TOOL_INPUT_KEYS) {
    const v = rec[k];
    if (typeof v === "string" && v.trim()) out.push(v.slice(0, MAX_FIELD));
  }
}

/** The readable text of one transcript line: Claude Code (`message.content`) or Codex (`payload`). */
export function extractText(obj: unknown): string[] {
  const out: string[] = [];
  const o = obj as {
    type?: string;
    message?: { role?: string; content?: unknown };
    payload?: {
      type?: string;
      role?: string;
      content?: unknown;
      arguments?: unknown;
      message?: unknown;
    };
  };
  if ((o.type === "user" || o.type === "assistant") && o.message) {
    const c = o.message.content;
    if (typeof c === "string") {
      const t = cleanText(c);
      if (t) out.push(t);
    } else if (Array.isArray(c)) {
      for (const part of c as Array<Record<string, unknown>>) {
        if (part.type === "text" && typeof part.text === "string") {
          const t = cleanText(part.text);
          if (t) out.push(t);
        } else if (part.type === "tool_use") pushToolInput(out, part.input);
      }
    }
    return out;
  }
  const p = o.payload;
  if (!p) return out;
  if (p.type === "message" && Array.isArray(p.content)) {
    for (const part of p.content as Array<Record<string, unknown>>) {
      if (typeof part.text === "string") {
        const t = cleanText(part.text);
        if (t) out.push(t);
      }
    }
  } else if (p.type === "function_call" && typeof p.arguments === "string") {
    try {
      pushToolInput(out, JSON.parse(p.arguments));
    } catch {
      // Arguments that aren't JSON carry nothing we index.
    }
  }
  return out;
}
