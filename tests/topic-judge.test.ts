import { mkdtempSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  buildPrompt,
  cardPositioning,
  createTopicJudge,
  extractPrompts,
  isDue,
  isMeaningful,
  parseAnswer,
  REJUDGE_EVERY,
} from "../src/main/topic-judge";
import type { ProductsData } from "../src/shared/products";

const userRow = (content: unknown, extra: Record<string, unknown> = {}) =>
  JSON.stringify({
    type: "user",
    message: { role: "user", content },
    ...extra,
  });

describe("extractPrompts", () => {
  it("keeps the user's own words and drops tool results, meta rows and wrappers", () => {
    const text = [
      userRow("优化左栏排序"),
      userRow([{ type: "tool_result", tool_use_id: "x", content: "ok" }]),
      userRow("<command-name>/model</command-name>"),
      userRow("hidden", { isMeta: true }),
      userRow([{ type: "text", text: "再加一个共享池" }]),
      JSON.stringify({ type: "assistant", message: { content: "好的" } }),
      userRow("This session is being continued from a previous conversation"),
    ].join("\n");
    expect(extractPrompts(text)).toEqual(["优化左栏排序", "再加一个共享池"]);
  });

  it("clips pasted blocks to a marker", () => {
    expect(
      extractPrompts(
        userRow(
          '看这个 <pasted_content id="a">很长的内容</pasted_content id="a"> 怎么改',
        ),
      ),
    ).toEqual(["看这个 [贴入的内容] 怎么改"]);
  });
});

describe("judging rules", () => {
  it("counts only prompts that say something", () => {
    expect(
      ["继续", "ok", "/model", "好的", "改一下左栏"].map(isMeaningful),
    ).toEqual([false, false, false, false, true]);
  });

  it("judges at the first real prompt, then every few more", () => {
    expect(isDue(0, undefined)).toBe(false);
    expect(isDue(1, undefined)).toBe(true);
    expect(isDue(1 + REJUDGE_EVERY - 1, { prompts: 1 })).toBe(false);
    expect(isDue(1 + REJUDGE_EVERY, { prompts: 1 })).toBe(true);
  });

  it("reads the answer, mapping 无 to no topic and unknown keys to no answer", () => {
    const keys = new Set(["nido", "cockpit"]);
    expect(parseAnswer("标题：左栏排序\n主题：cockpit", keys)).toEqual({
      title: "左栏排序",
      topic: "cockpit",
    });
    expect(parseAnswer("标题：「简历修改」\n主题：无", keys)).toEqual({
      title: "简历修改",
      topic: "",
    });
    expect(parseAnswer("标题：x\n主题：teach", keys).topic).toBeNull();
  });

  it("keeps the first prompt and the latest ones when a session runs long", () => {
    const prompts = Array.from({ length: 12 }, (_, i) => `第${i + 1}句话内容`);
    const text = buildPrompt({ topics: "- a：A", prompts });
    expect(text).toContain("第1句话内容");
    expect(text).toContain("第12句话内容");
    expect(text).not.toContain("第3句话内容");
  });

  it("reads a card's positioning", () => {
    expect(
      cardPositioning("# X\n\n## 定位\n手机远程控制电脑\n\n## 人群\n…"),
    ).toBe("手机远程控制电脑");
  });
});

describe("createTopicJudge", () => {
  const products = {
    products: {
      cockpit: {
        key: "cockpit",
        name: "驾驶舱",
        color: "#06b6d4",
        domains: [],
        loose: [],
        decide: [],
        hasCard: false,
        keywords: ["jun-code"],
        repos: [],
        updatedAt: null,
      },
    },
    bySession: {},
    triggers: [],
    titles: {},
    runs: {},
  } as unknown as ProductsData;

  function setup(answer: string) {
    const root = mkdtempSync(join(tmpdir(), "judge-"));
    const projects = join(root, "projects", "p");
    mkdirSync(projects, { recursive: true });
    const data = join(root, "data");
    mkdirSync(data);
    writeFileSync(
      join(projects, "s1.jsonl"),
      userRow("给 Jun-Code 加自动更新") + "\n",
    );
    writeFileSync(join(projects, "s2.jsonl"), userRow("继续") + "\n");
    const calls: string[] = [];
    const judge = createTopicJudge({
      chat: (_model, messages) => {
        calls.push(messages[0].content);
        return Promise.resolve(answer);
      },
      signedIn: () => true,
      projectsDir: () => join(root, "projects"),
      cardsDir: join(root, "cards"),
      dataDir: data,
      readProducts: () => products,
      stateFile: join(root, "state.json"),
    });
    return { judge, data, calls };
  }

  it("titles and files a session at its first real prompt, once", async () => {
    const { judge, data, calls } = setup("标题：自动更新\n主题：cockpit");
    expect(await judge.tick()).toBe(1);
    expect(await judge.tick()).toBe(0);
    expect(calls).toHaveLength(1);
    const title = JSON.parse(
      readFileSync(join(data, "session-titles.jsonl"), "utf8"),
    ) as { sid: string; title: string };
    expect(title).toMatchObject({ sid: "s1", title: "自动更新" });
    const topic = JSON.parse(
      readFileSync(join(data, "session-products.jsonl"), "utf8"),
    ) as { product: string; by: string };
    expect(topic).toMatchObject({ product: "cockpit", by: "llm" });
    // The heartbeat tells the workbench hook to stand down.
    expect(readFileSync(join(data, "jun-code-judge.json"), "utf8")).toContain(
      '"ts"',
    );
  });

  it("does nothing signed out", async () => {
    const { judge, calls } = setup("标题：x\n主题：无");
    const signedOut = createTopicJudge({
      ...({} as Parameters<typeof createTopicJudge>[0]),
      chat: () => Promise.reject(new Error("no")),
      signedIn: () => false,
      projectsDir: () => "",
      cardsDir: "",
      dataDir: "",
      readProducts: () => products,
      stateFile: "",
    });
    expect(await signedOut.tick()).toBe(0);
    expect(judge).toBeDefined();
    expect(calls).toHaveLength(0);
  });
});
