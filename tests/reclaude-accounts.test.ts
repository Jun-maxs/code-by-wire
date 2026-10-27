import { describe, expect, it } from "vitest";
import { parseOrgList, reclaudeCli } from "../src/main/reclaude-accounts";

describe("parseOrgList", () => {
  it("reads each organization row, the default one starred", () => {
    const text = [
      "Available organizations:",
      "* 419344\ta15816011695@qq.com\tpersonal\tme@example.com\tbound",
      "  77\tTeam X\tteam\tme@example.com\tnot bound",
      "Switch organization: reclaude org use <org_id>",
    ].join("\r\n");
    expect(parseOrgList(text)).toEqual([
      {
        id: "419344",
        name: "a15816011695@qq.com",
        kind: "personal",
        email: "me@example.com",
        bound: true,
        current: true,
      },
      {
        id: "77",
        name: "Team X",
        kind: "team",
        email: "me@example.com",
        bound: false,
        current: false,
      },
    ]);
  });
});

describe("reclaudeCli", () => {
  it("is reclaude.exe beside rec.exe, and nothing without rec", () => {
    expect(reclaudeCli("C:/x/bin/rec.exe")).toBe("C:/x/bin/reclaude.exe");
    expect(reclaudeCli("claude")).toBeNull();
    expect(reclaudeCli(undefined)).toBeNull();
  });
});
