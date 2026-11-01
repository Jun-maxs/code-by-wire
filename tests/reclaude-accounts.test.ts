import { describe, expect, it } from "vitest";
import {
  mergeAccounts,
  parseOrgList,
  parseStatusBindings,
  reclaudeCli,
} from "../src/main/reclaude-accounts";

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

describe("mergeAccounts", () => {
  it("lists every local binding, even another reclaude user's, then unbound orgs", () => {
    const status = parseStatusBindings(
      JSON.stringify({
        claude: {
          bindings: [
            {
              device_id: 45797,
              org_id: 189481,
              org_name: "a@qq.com",
              email: "a@qq.com",
            },
            {
              device_id: 48389,
              org_id: 419344,
              org_name: "b@qq.com",
              email: "b@qq.com",
            },
          ],
          current: { device_id: 48389, org_id: 419344 },
        },
      }),
    );
    const listed = parseOrgList(
      "* 419344\tb@qq.com\tpersonal\tme@example.com\tbound\n  77\tTeam X\tteam\tme@example.com\tnot bound",
    );
    const merged = mergeAccounts(status, listed, (device) =>
      device === "45797" ? "other@example.com" : null,
    );
    expect(merged.map((o) => [o.id, o.email, o.bound, o.current])).toEqual([
      ["189481", "other@example.com", true, false],
      ["419344", "me@example.com", true, true],
      ["77", "me@example.com", false, false],
    ]);
  });
});
