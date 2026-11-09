import { describe, expect, it } from "vitest";
import {
  accountColor,
  windowPct,
  type AccountQuota,
  type AccountsOverview,
} from "../../src/shared/account-switch";
import { buildIslandSnapshot } from "../../src/shared/island-feed";
import { shortTopicName, type ProductsData } from "../../src/shared/products";
import type { Session } from "../../src/shared/types";

const NOW = 1_800_000_000_000;
const HOUR = 3_600_000;

const session = (id: string, extra: Partial<Session> = {}): Session =>
  ({
    id,
    title: id,
    project: "proj",
    agent: "claude",
    management: "managed",
    state: "working",
    lastActivityMs: NOW - 60_000,
    createdMs: NOW - HOUR,
    ...extra,
  }) as Session;

const input = (over: Partial<Parameters<typeof buildIslandSnapshot>[0]>) => ({
  sessions: [],
  accounts: null,
  account: null,
  products: null,
  remoteOnline: false,
  now: NOW,
  ...over,
});

const acct = (
  deviceId: string,
  n: number,
  extra: Partial<AccountQuota> = {},
): AccountQuota => ({
  deviceId,
  orgId: `o${deviceId}`,
  email: `${deviceId}@x`,
  n,
  current: false,
  ...extra,
});

const products = (over: Partial<ProductsData> = {}): ProductsData => ({
  products: {},
  bySession: {},
  triggers: [],
  titles: {},
  runs: {},
  ...over,
});

describe("buildIslandSnapshot", () => {
  it("keeps live sessions and recent ended ones, at most 30", () => {
    const many = Array.from({ length: 35 }, (_, i) => session(`w${i}`));
    expect(
      buildIslandSnapshot(input({ sessions: many })).sessions,
    ).toHaveLength(30);

    const ended = [
      session("old", { state: "ended", lastActivityMs: NOW - 25 * HOUR }),
      session("recent", { state: "ended", lastActivityMs: NOW - 23 * HOUR }),
    ];
    const ids = buildIslandSnapshot(input({ sessions: ended })).sessions.map(
      (s) => s.id,
    );
    expect(ids).toEqual(["recent"]);
  });

  it("orders like the sidebar", () => {
    const shuffled = [
      session("i", { state: "idle" }),
      session("e", { state: "ended" }),
      session("w", { state: "working" }),
      session("q", { state: "waiting" }),
    ];
    const snap = buildIslandSnapshot(input({ sessions: shuffled }));
    expect(snap.sessions.map((s) => s.state)).toEqual([
      "waiting",
      "working",
      "idle",
      "ended",
    ]);
  });

  it("titles carry the short topic name", () => {
    const data = products({
      bySession: { a: "jun-code" },
      products: {
        "jun-code": {
          key: "jun-code",
          name: "Jun-Code（多账号）",
          color: "#5e8bff",
          domains: [],
          loose: [],
          decide: [],
          hasCard: true,
          keywords: [],
          repos: [],
          updatedAt: null,
        },
      },
    });
    const snap = buildIslandSnapshot(
      input({
        sessions: [
          session("a", { title: "修切号", repoLabel: "cbw-wt-jun" }),
          session("b", { title: "修切号" }),
        ],
        products: data,
      }),
    );
    const [a, b] = snap.sessions.sort((x, y) => x.id.localeCompare(y.id));
    expect(a.title).toBe(`${shortTopicName("Jun-Code（多账号）")} · 修切号`);
    expect(a.topicColor).toBe(data.products["jun-code"].color);
    expect(a.project).toBe("cbw-wt-jun");
    expect(b.title).toBe("修切号");
    expect(b.topicColor).toBeNull();
    expect(b.project).toBe("proj");
  });

  it("numbers accounts and maps windows", () => {
    const five = { usedPct: 42, resetsAt: NOW + HOUR };
    const seven = { usedPct: 18, resetsAt: NOW + 48 * HOUR };
    const accounts: AccountsOverview = {
      accounts: [
        acct("48389", 1, {
          current: true,
          fiveHour: five,
          sevenDay: seven,
          seenAt: NOW - 1000,
        }),
        acct("50000", 2, { fiveHour: five, sevenDay: seven }),
      ],
      smart: { enabled: true, threshold: 85, available: true, stuck: false },
    };
    const snap = buildIslandSnapshot(
      input({
        sessions: [session("s", { accountDevice: "50000" })],
        accounts,
      }),
    );
    const [one, two] = snap.accounts.items;
    expect(snap.accounts.smartSwitch).toBe(true);
    expect(one).toEqual({
      device: "48389",
      label: "#1",
      color: accountColor(1),
      email: "48389@x",
      current: true,
      fiveHour: { usedPct: windowPct(five, NOW), resetsAt: five.resetsAt },
      sevenDay: { usedPct: windowPct(seven, NOW), resetsAt: seven.resetsAt },
    });
    // Never seen: nothing known about its windows.
    expect(two.label).toBe("#2");
    expect(two.fiveHour).toBeNull();
    expect(two.sevenDay).toBeNull();
    expect(snap.sessions[0].account).toBe("#2");

    const noWeek = buildIslandSnapshot(
      input({
        accounts: {
          ...accounts,
          accounts: [acct("1", 1, { fiveHour: five, seenAt: NOW })],
        },
      }),
    );
    expect(noWeek.accounts.items[0].sevenDay).toBeNull();
    expect(noWeek.accounts.items[0].fiveHour?.usedPct).toBe(42);
  });

  it("falls back to the single account", () => {
    const resetsAt = NOW + HOUR;
    const snap = buildIslandSnapshot(
      input({
        sessions: [session("s")],
        accounts: null,
        account: {
          billingMode: "subscription",
          fiveHour: { usedPct: 40, resetsAt },
          email: "me@x",
        },
      }),
    );
    expect(snap.accounts.smartSwitch).toBe(false);
    expect(snap.accounts.items).toHaveLength(1);
    expect(snap.accounts.items[0]).toMatchObject({
      label: "#1",
      current: true,
      email: "me@x",
      fiveHour: { usedPct: 40, resetsAt },
      sevenDay: null,
    });
    expect(snap.sessions[0].account).toBeNull();
  });

  it("remote flag passes through", () => {
    const snap = buildIslandSnapshot(
      input({ remoteOnline: true, sessions: [session("r", { remote: true })] }),
    );
    expect(snap.remote.online).toBe(true);
    expect(snap.sessions[0].remote).toBe(true);
    expect(snap.version).toBe(1);
    expect(snap.now).toBe(NOW);
  });

  // The island (C#) reads these as integers; a Codex/Pi mtime carries a fraction on Windows.
  it("sends whole numbers", () => {
    const snap = buildIslandSnapshot(
      input({
        now: NOW + 0.25,
        sessions: [
          session("c", { agent: "codex", lastActivityMs: NOW - 1000.0405 }),
        ],
        account: {
          billingMode: "subscription",
          fiveHour: { usedPct: 41.6, resetsAt: NOW + HOUR + 0.7 },
        } as Parameters<typeof buildIslandSnapshot>[0]["account"],
      }),
    );
    expect(snap.now).toBe(NOW);
    expect(snap.sessions[0].lastActivity).toBe(NOW - 1000);
    expect(snap.accounts.items[0].fiveHour).toEqual({
      usedPct: 42,
      resetsAt: NOW + HOUR + 1,
    });
  });

  it("leaves agent threads out (they sit under their parent in the sidebar)", () => {
    const snap = buildIslandSnapshot(
      input({
        sessions: [
          session("parent", { agent: "codex" }),
          session("child", { agent: "codex", parentSessionId: "parent" }),
        ],
      }),
    );
    expect(snap.sessions.map((s) => s.id)).toEqual(["parent"]);
  });
});
