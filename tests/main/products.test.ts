import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  assignSession,
  deleteTopic,
  readProducts,
  saveTopic,
} from "../../src/main/products";

let root: string;
let cards: string;
let state: string;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "cbw-products-"));
  cards = join(root, "cards");
  state = join(root, "data", "state");
  mkdirSync(cards, { recursive: true });
  mkdirSync(state, { recursive: true });
  writeFileSync(
    join(cards, "triggers.json"),
    JSON.stringify({
      products: {
        ciyu: { include: ["词屿"], exclude: [] },
        cockpit: { include: ["驾驶舱"] },
      },
    }),
  );
  writeFileSync(
    join(cards, "sources.json"),
    JSON.stringify({ products: { ciyu: { name: "词屿", color: "#22aa66" } } }),
  );
  writeFileSync(
    join(cards, "ciyu.md"),
    "# 词屿\n\n## 最近在做\n- 发音（10-26）\n",
  );
  writeFileSync(join(cards, "CARD_SPEC.md"), "# 规范\n");
  writeFileSync(
    join(state, "s-1.json"),
    JSON.stringify({ session_product: "ciyu" }),
  );
  writeFileSync(join(state, "s-2.json"), JSON.stringify({ cards: ["ciyu"] }));
  writeFileSync(join(state, "s-3.json"), "{broken");
});

afterEach(() => rmSync(root, { recursive: true, force: true }));

describe("readProducts", () => {
  it("reads cards (not the spec), colors, triggers and the hook's session records", () => {
    const d = readProducts(cards, state);
    expect(d).not.toBeNull();
    expect(Object.keys(d!.products)).toEqual(["ciyu", "cockpit"]);
    expect(d!.products.ciyu.hasCard).toBe(true);
    expect(d!.products.ciyu.keywords).toEqual(["词屿"]);
    expect(d!.products.cockpit.hasCard).toBe(false);
    expect(d!.products.ciyu.color).toBe("#22aa66");
    expect(d!.products.ciyu.doing).toBe("发音（10-26）");
    expect(d!.triggers.map((t) => t.key).sort()).toEqual(["ciyu", "cockpit"]);
    expect(d!.triggers.find((t) => t.key === "cockpit")!.exclude).toEqual([]);
    expect(d!.bySession).toEqual({ "s-1": "ciyu", "s-2": "ciyu" });
  });

  it("is null when the cards dir does not exist, and tolerates a missing state dir", () => {
    expect(readProducts(join(root, "nope"), state)).toBeNull();
    expect(readProducts(cards, join(root, "nope"))?.bySession).toEqual({});
  });

  it("lets the durable records win over the state files, and reads task titles", () => {
    const data = join(root, "data");
    writeFileSync(
      join(data, "session-products.jsonl"),
      [
        { sid: "s-1", product: "cockpit", by: "manual" },
        { sid: "s-1", product: "ciyu", by: "scan" },
        { sid: "s-9", product: "ciyu", by: "scan" },
      ]
        .map((r) => JSON.stringify(r))
        .join("\n") + "\nnot json\n",
    );
    writeFileSync(
      join(data, "session-titles.jsonl"),
      JSON.stringify({ sid: "s-1", title: "旧" }) +
        "\n" +
        JSON.stringify({ sid: "s-1", title: "主题管理页" }) +
        "\n",
    );
    const d = readProducts(cards, state)!;
    expect(d.bySession["s-1"]).toBe("cockpit");
    expect(d.bySession["s-9"]).toBe("ciyu");
    expect(d.titles).toEqual({ "s-1": "主题管理页" });
  });
});

describe("topic edits", () => {
  it("saves a topic into both workbench files, keeping fields it does not own", () => {
    saveTopic(cards, {
      key: "seelen",
      name: "Seelen 借鉴",
      color: "#ff0000",
      keywords: [" seelen ", ""],
      repos: ["E:/x"],
    });
    saveTopic(cards, {
      key: "ciyu",
      name: "词屿",
      color: "#22aa66",
      keywords: ["词屿", "ciyu"],
      repos: [],
    });
    const d = readProducts(cards, state)!;
    expect(d.products.seelen).toMatchObject({
      name: "Seelen 借鉴",
      hasCard: false,
      keywords: ["seelen"],
      repos: ["E:/x"],
    });
    expect(d.products.ciyu.keywords).toEqual(["词屿", "ciyu"]);
    const src = JSON.parse(readFileSync(join(cards, "sources.json"), "utf8"));
    expect(src.products.seelen.memory).toEqual([]);
    expect(() =>
      saveTopic(cards, {
        key: "坏键",
        name: "x",
        color: "#000",
        keywords: [],
        repos: [],
      }),
    ).toThrow();
  });

  it("deletes a topic and moves its card to the trash", () => {
    deleteTopic(cards, "ciyu");
    expect(existsSync(join(cards, "ciyu.md"))).toBe(false);
    const d = readProducts(cards, state)!;
    expect(d.products.ciyu).toBeUndefined();
  });

  it("records a manual assignment that beats the hook", () => {
    assignSession(join(root, "data"), "s-1", "cockpit");
    expect(readProducts(cards, state)!.bySession["s-1"]).toBe("cockpit");
    assignSession(join(root, "data"), "s-1", "");
    expect(readProducts(cards, state)!.bySession["s-1"]).toBe("");
  });
});
