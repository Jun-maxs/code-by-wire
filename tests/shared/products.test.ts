import { describe, expect, it } from "vitest";
import {
  classifyText,
  colorForProduct,
  parseProductCard,
  productForSession,
  type ProductsData,
} from "@shared/products";

const CARD = `# 词屿

## 定位
"聚焦于背单词"（10-13）

## 线上现状
- R110 发音已上线（10-24，abc123）

## 最近在做
- 词根词族×语境预览：37 族 425 词（10-26）

## 没收尾的
- AI 速背：实现计划暂停
- 约 11-23 跑 evaluate_r108.py

## 等你决定
- 词根词族做成单独入口，还是并进 AI 速背？（10-26）

## 资料与位置
- https://cet.yuanai.best/agent/#/today
- E:/0项目/04.英语学习/ciyu
- 看 https://cet.yuanai.best/b307/ 的版面
`;

describe("parseProductCard", () => {
  it("reads the name, distinct domains, and the progress sections", () => {
    const p = parseProductCard("ciyu", CARD);
    expect(p.name).toBe("词屿");
    expect(p.domains).toEqual(["cet.yuanai.best"]);
    expect(p.doing).toBe("词根词族×语境预览：37 族 425 词（10-26）");
    expect(p.loose).toEqual([
      "AI 速背：实现计划暂停",
      "约 11-23 跑 evaluate_r108.py",
    ]);
    expect(p.decide).toEqual([
      "词根词族做成单独入口，还是并进 AI 速背？（10-26）",
    ]);
  });

  it("has no domains when the card lists no URL", () => {
    const p = parseProductCard(
      "desktidy",
      "# 桌面整理\n\n## 资料与位置\n- E:/0项目/07.桌面整理\n\n## 没收尾的\n- 无\n",
    );
    expect(p.domains).toEqual([]);
    expect(p.loose).toEqual([]);
    expect(p.doing).toBeUndefined();
  });
});

const TRIGGERS = [
  {
    key: "shiyu",
    include: ["max\\.yuanhk\\.top", "时屿"],
    exclude: ["max\\.yuanhk\\.top/code-map"],
  },
  { key: "ciyu", include: ["cet\\.yuanai\\.best", "词屿"], exclude: [] },
  {
    key: "teach",
    include: ["teach\\.yuanhk\\.top(?!/ai-gateway)", "学屿"],
    exclude: [],
  },
];

describe("classifyText", () => {
  it("picks the product mentioned first", () => {
    expect(classifyText(TRIGGERS, "词屿和时屿都看看")).toBe("ciyu");
    expect(
      classifyText(TRIGGERS, "https://max.yuanhk.top/updates 紧凑点"),
    ).toBe("shiyu");
  });
  it("respects exclusions and lookaheads", () => {
    expect(
      classifyText(TRIGGERS, "https://max.yuanhk.top/code-map 好看吗"),
    ).toBeNull();
    expect(
      classifyText(TRIGGERS, "teach.yuanhk.top/ai-gateway 加渠道"),
    ).toBeNull();
  });
  it("ignores a broken pattern instead of throwing", () => {
    expect(
      classifyText([{ key: "x", include: ["(oops"], exclude: [] }], "oops"),
    ).toBeNull();
  });
});

const EXTRA = {
  hasCard: true,
  keywords: [],
  repos: [],
  updatedAt: null,
};

describe("productForSession", () => {
  const data: ProductsData = {
    products: {
      ciyu: { ...parseProductCard("ciyu", CARD), ...EXTRA },
      shiyu: { ...parseProductCard("shiyu", "# 时屿\n"), ...EXTRA },
    },
    bySession: { "s-known": "shiyu", "s-cleared": "" },
    triggers: TRIGGERS,
    titles: {},
    runs: {},
  };
  it("prefers what the workbench hook recorded for the session", () => {
    expect(productForSession(data, { id: "s-known", title: "词屿发音" })).toBe(
      "shiyu",
    );
  });
  it("falls back to classifying the title", () => {
    expect(
      productForSession(data, { id: "s-2", title: "cet.yuanai.best 发音卡" }),
    ).toBe("ciyu");
  });
  it("drops a recorded key that is no topic", () => {
    const d = { ...data, bySession: { s: "cockpit" } };
    expect(productForSession(d, { id: "s", title: "无关" })).toBeNull();
  });
  it("keeps a session the user cleared untagged even when its title matches", () => {
    expect(
      productForSession(data, { id: "s-cleared", title: "cet.yuanai.best" }),
    ).toBeNull();
  });
});

describe("colorForProduct", () => {
  it("is stable per key and uses an explicit color when given", () => {
    expect(colorForProduct("ciyu")).toBe(colorForProduct("ciyu"));
    expect(colorForProduct("ciyu", "#123456")).toBe("#123456");
  });
});
