import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { readProducts } from "../../src/main/products";

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
    expect(Object.keys(d!.products)).toEqual(["ciyu"]);
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
});
