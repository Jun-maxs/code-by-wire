import { describe, expect, it } from "vitest";
import type { Session } from "../../src/shared/types";
import type { ProductInfo } from "../../src/shared/products";
import { groupSessionsByProduct } from "../../src/renderer/src/shell/session-list-model";
import { loadSessionsListPreferences } from "../../src/renderer/src/shell/session-list-preferences";

let seq = 0;
function mk(over: Partial<Session>): Session {
  seq += 1;
  return {
    id: `s${seq}`,
    title: `session ${seq}`,
    project: "开发临时用",
    state: "idle",
    createdMs: 1000 + seq,
    lastActivityMs: 1000 + seq,
    ...over,
  } as Session;
}

function product(key: string, name: string): ProductInfo {
  return {
    key,
    name,
    color: "#123456",
    domains: [],
    loose: [],
    decide: [],
    hasCard: true,
    keywords: [],
    repos: [],
    updatedAt: null,
  };
}

const CIYU = product("ciyu", "词屿");
const SHIYU = product("shiyu", "时屿");

describe("groupSessionsByProduct", () => {
  it("groups by product, most recently active first, with the product color", () => {
    const a = mk({ title: "词屿 发音", lastActivityMs: 100 });
    const b = mk({ title: "时屿 更新页", lastActivityMs: 900 });
    const c = mk({ title: "词屿 例句", lastActivityMs: 500 });
    const of = (s: Session) =>
      s.title.startsWith("词屿")
        ? CIYU
        : s.title.startsWith("时屿")
          ? SHIYU
          : null;
    const groups = groupSessionsByProduct([a, b, c], of, "其他");
    expect(groups.map((g) => g.label)).toEqual(["时屿", "词屿"]);
    expect(groups[1].sessions).toHaveLength(2);
    expect(groups[1].color).toBe("#123456");
    expect(groups[1].key).toBe("product:ciyu");
    expect(groups[1].cwd).toBeUndefined();
  });

  it("puts untagged sessions in one 'other' group without a color", () => {
    const a = mk({ title: "写个正则" });
    const [g] = groupSessionsByProduct([a], () => null, "其他");
    expect(g.label).toBe("其他");
    expect(g.key).toBe("product:-");
    expect(g.color).toBeUndefined();
  });

  it("keeps a subagent with its root's product even when its own title says otherwise", () => {
    const root = mk({ id: "root", title: "词屿 发音" });
    const child = mk({
      id: "kid",
      title: "时屿 子任务",
      parentSessionId: "root",
    });
    const of = (s: Session) =>
      s.title.startsWith("词屿")
        ? CIYU
        : s.title.startsWith("时屿")
          ? SHIYU
          : null;
    const groups = groupSessionsByProduct([root, child], of, "其他");
    expect(groups).toHaveLength(1);
    expect(groups[0].sessions.map((s) => s.id).sort()).toEqual(["kid", "root"]);
  });
});

describe("sessions list grouping preference", () => {
  const storage = (value: unknown): Storage =>
    ({ getItem: () => JSON.stringify(value) }) as unknown as Storage;
  it("is absent (by topic) by default and only stores folder", () => {
    expect(loadSessionsListPreferences(storage({})).grouping).toBeUndefined();
    expect(
      loadSessionsListPreferences(storage({ grouping: "folder" })).grouping,
    ).toBe("folder");
    expect(
      loadSessionsListPreferences(storage({ grouping: "bogus" })).grouping,
    ).toBeUndefined();
  });
});
