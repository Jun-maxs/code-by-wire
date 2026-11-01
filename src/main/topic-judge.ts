import {
  appendFileSync,
  existsSync,
  readFileSync,
  readdirSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { basename, join } from "node:path";
import type { ProductsData } from "@shared/products";

/**
 * Fork feature (2026-11-01): Jun-Code titles each Claude session and decides which topic it is about,
 * by asking Claude Haiku through the hub account's chat relay (zz; its keys stay on the server). Only
 * while signed in: signed out, the workbench hook keeps doing it with `rec -p`.
 *
 * Why here and not in the hook: the hook judged only after two prompts and then every five, guessed
 * from keywords before that, and its `rec -p` popped console windows. Here a session is judged at its
 * first real prompt and again after every four more, with the topics' own descriptions in the prompt.
 *
 * Writes the same files the hook did, so the sidebar and the workbench read one record:
 * `<dataDir>/session-titles.jsonl` (`by: "jun-code"`) and `<dataDir>/session-products.jsonl`
 * (`by: "llm"`, product "" for "none of them" — which also stops the keyword guess). A heartbeat in
 * `<dataDir>/jun-code-judge.json` tells the hook to stand down while this runs.
 */

export const JUDGE_MODEL = "claude-haiku-5.5";
/** A session is judged at its first real prompt, then again after this many more. */
export const REJUDGE_EVERY = 4;
/** Sessions whose transcript moved within this window are considered. */
const RECENT_MS = 24 * 60 * 60 * 1000;
/** At most this many model calls per tick, so a backlog drains over a few minutes. */
const PER_TICK = 3;

/** The user's own words in a transcript, oldest first: real prompts only — not tool results, slash
 *  command wrappers, interrupted markers or the compaction summary. Long pastes are clipped. */
export function extractPrompts(transcript: string): string[] {
  const out: string[] = [];
  for (const line of transcript.split("\n")) {
    if (!line.includes('"type":"user"')) continue;
    let row: {
      type?: string;
      isMeta?: boolean;
      isSidechain?: boolean;
      message?: { content?: unknown };
    };
    try {
      row = JSON.parse(line) as typeof row;
    } catch {
      continue;
    }
    if (row.type !== "user" || row.isMeta || row.isSidechain) continue;
    const content = row.message?.content;
    let text = "";
    if (typeof content === "string") text = content;
    else if (Array.isArray(content))
      text = content
        .map((b: { type?: string; text?: string }) =>
          b?.type === "text" && typeof b.text === "string" ? b.text : "",
        )
        .join(" ");
    text = text
      .replace(
        /<pasted_content[^>]*>[\s\S]*?<\/pasted_content[^>]*>/g,
        " [贴入的内容] ",
      )
      .replace(/\s+/g, " ")
      .trim();
    if (
      !text ||
      text.startsWith("<") ||
      text.startsWith("[Request interrupted") ||
      text.startsWith("This session is being continued")
    )
      continue;
    out.push(text.slice(0, 400));
  }
  return out;
}

/** A prompt that says something about the work (not "继续", "ok", a slash command). */
export function isMeaningful(prompt: string): boolean {
  const t = prompt.trim();
  if (t.startsWith("/")) return false;
  if ([...t].length < 4) return false;
  return !/^(继续|continue|ok|好的?|可以|开始|是的?|对|嗯|go on)[!！。.\s]*$/i.test(
    t,
  );
}

/** The positioning line of a topic card (its 定位 section), for the topic list in the prompt. */
export function cardPositioning(md: string): string {
  const m = /##\s*定位\s*\n([\s\S]*?)(?:\n##|$)/.exec(md);
  return m ? m[1].replace(/\s+/g, " ").trim().slice(0, 160) : "";
}

export function topicListText(
  data: ProductsData,
  positioning: (key: string) => string,
): string {
  return Object.values(data.products)
    .map((p) => {
      const where = [
        ...p.domains,
        ...p.keywords.map((k) =>
          k.replace(/\\[sbd.]/g, (m) => (m === "\\." ? "." : " ")),
        ),
      ]
        .slice(0, 14)
        .join("、");
      const what = positioning(p.key);
      return `- ${p.key}：${p.name}${what ? `。${what}` : ""}${where ? `。线索：${where}` : ""}`;
    })
    .join("\n");
}

export function buildPrompt(opts: {
  topics: string;
  prompts: string[];
  oldTitle?: string;
  oldTopic?: string;
}): string {
  // The first prompt says what the session set out to do; the latest ones say what it does now.
  const ps = opts.prompts;
  const picked =
    ps.length <= 7 ? ps : [ps[0], "……", ...ps.slice(ps.length - 6)];
  return [
    "下面是一场编程会话里用户说的话（从早到晚）。做两件事。",
    "",
    "一、写一个侧栏标题，让用户一眼认出这场会话现在在做什么：中文，不超过 14 个字，动宾或名词短语，例如「刘海模式消失修复」「主题管理页」。写现在在做的事（以最后几句为准）；和旧标题说的是同一件事就原样输出旧标题。不写产品名。",
    "",
    "二、判断这场会话现在主要在改哪个产品：看用户要动手改的是哪个，不是话里顺带提到了谁；拿别的产品对比、借鉴都不算。和列表里哪个都不沾边（简历、课程作业、闲聊、问模型知识、别的网站）就答「无」。",
    "",
    "产品列表（键：名称。定位。线索）：",
    opts.topics,
    "",
    opts.oldTitle ? `旧标题：${opts.oldTitle}` : "旧标题：（没有）",
    opts.oldTopic ? `之前判断的产品：${opts.oldTopic}` : "",
    "",
    "用户的话：",
    ...picked.map((p, i) => (p === "……" ? "……" : `${i + 1}. ${p}`)),
    "",
    "只回答两行：",
    "标题：<标题>",
    "主题：<键或无>",
  ]
    .filter((l) => l !== "")
    .join("\n");
}

/** The model's two lines → title and topic ("" = none of the topics; null = not answered or unknown). */
export function parseAnswer(
  text: string,
  keys: ReadonlySet<string>,
): { title: string | null; topic: string | null } {
  const title = /标题[:：]\s*(.+)/
    .exec(text)?.[1]
    ?.trim()
    .replace(/^[「"']|[」"']$/g, "");
  const raw = /主题[:：]\s*([A-Za-z0-9_-]+|无)/.exec(text)?.[1];
  const topic =
    raw === undefined ? null : raw === "无" ? "" : keys.has(raw) ? raw : null;
  return {
    title: title ? [...title].slice(0, 24).join("") : null,
    topic,
  };
}

interface JudgeState {
  [sid: string]: { prompts: number; at: number };
}

/** Whether a session is due: never judged and has a real prompt, or REJUDGE_EVERY real prompts since. */
export function isDue(
  meaningful: number,
  last: { prompts: number } | undefined,
): boolean {
  if (meaningful === 0) return false;
  return !last || meaningful - last.prompts >= REJUDGE_EVERY;
}

export function createTopicJudge(deps: {
  /** The hub account's chat; throws `status: 401` when signed out. */
  chat: (
    model: string,
    messages: { role: "system" | "user"; content: string }[],
  ) => Promise<string>;
  signedIn: () => boolean;
  /** Where transcripts live (`<claude config>/projects`). */
  projectsDir: () => string;
  cardsDir: string;
  dataDir: string;
  readProducts: () => ProductsData | null;
  /** How many real prompts each session had when last judged (userData). */
  stateFile: string;
  now?: () => number;
  log?: (msg: string, err?: unknown) => void;
}) {
  const now = deps.now ?? Date.now;
  let running = false;
  const readState = (): JudgeState => {
    try {
      return JSON.parse(readFileSync(deps.stateFile, "utf8")) as JudgeState;
    } catch {
      return {};
    }
  };

  /** Recent transcripts, newest first. */
  function recentTranscripts(): { sid: string; path: string }[] {
    const root = deps.projectsDir();
    const out: { sid: string; path: string; mtime: number }[] = [];
    let dirs: string[];
    try {
      dirs = readdirSync(root);
    } catch {
      return [];
    }
    for (const d of dirs) {
      let names: string[];
      try {
        names = readdirSync(join(root, d));
      } catch {
        continue;
      }
      for (const n of names) {
        if (!n.endsWith(".jsonl")) continue;
        const path = join(root, d, n);
        try {
          const mtime = statSync(path).mtimeMs;
          if (now() - mtime < RECENT_MS)
            out.push({ sid: basename(n, ".jsonl"), path, mtime });
        } catch {
          // vanished between the listing and the stat
        }
      }
    }
    return out.sort((a, b) => b.mtime - a.mtime);
  }

  async function tick(): Promise<number> {
    if (running || !deps.signedIn()) return 0;
    const data = deps.readProducts();
    if (!data) return 0;
    running = true;
    let judged = 0;
    try {
      writeFileSync(
        join(deps.dataDir, "jun-code-judge.json"),
        JSON.stringify({ ts: now(), pid: process.pid }),
      );
      const state = readState();
      const manual = manualSessions(
        join(deps.dataDir, "session-products.jsonl"),
      );
      const keys = new Set(Object.keys(data.products));
      const positions = new Map<string, string>();
      const positioning = (key: string) => {
        if (!positions.has(key)) {
          const card = join(deps.cardsDir, `${key}.md`);
          positions.set(
            key,
            existsSync(card) ? cardPositioning(readFileSync(card, "utf8")) : "",
          );
        }
        return positions.get(key)!;
      };
      for (const t of recentTranscripts()) {
        if (judged >= PER_TICK) break;
        let prompts: string[];
        try {
          prompts = extractPrompts(readFileSync(t.path, "utf8"));
        } catch {
          continue;
        }
        const meaningful = prompts.filter(isMeaningful);
        if (!isDue(meaningful.length, state[t.sid])) continue;
        const text = buildPrompt({
          topics: topicListText(data, positioning),
          prompts: meaningful,
          oldTitle: data.titles?.[t.sid],
          oldTopic: data.bySession[t.sid] || undefined,
        });
        let answer: string;
        try {
          answer = await deps.chat(JUDGE_MODEL, [
            { role: "user", content: text },
          ]);
        } catch (err) {
          deps.log?.("topic judge: model call failed", err);
          if ((err as { status?: number }).status === 401) break;
          continue;
        }
        judged += 1;
        state[t.sid] = { prompts: meaningful.length, at: now() };
        const { title, topic } = parseAnswer(answer, keys);
        const ts = new Date(now()).toISOString();
        if (title && title !== data.titles?.[t.sid])
          appendFileSync(
            join(deps.dataDir, "session-titles.jsonl"),
            JSON.stringify({ sid: t.sid, title, ts, by: "jun-code" }) + "\n",
          );
        if (
          topic !== null &&
          !manual.has(t.sid) &&
          topic !== (data.bySession[t.sid] ?? null)
        )
          appendFileSync(
            join(deps.dataDir, "session-products.jsonl"),
            JSON.stringify({ sid: t.sid, product: topic, by: "llm", ts }) +
              "\n",
          );
      }
      writeFileSync(deps.stateFile, JSON.stringify(state));
    } finally {
      running = false;
    }
    return judged;
  }

  return { tick };
}

/** Sessions filed by hand (归到主题): the judge never moves them. */
function manualSessions(path: string): Set<string> {
  const out = new Set<string>();
  let text: string;
  try {
    text = readFileSync(path, "utf8");
  } catch {
    return out;
  }
  for (const line of text.split("\n")) {
    if (!line.includes('"manual"')) continue;
    try {
      const r = JSON.parse(line) as { sid?: string; by?: string };
      if (r.by === "manual" && r.sid) out.add(r.sid);
    } catch {
      // a torn line
    }
  }
  return out;
}
