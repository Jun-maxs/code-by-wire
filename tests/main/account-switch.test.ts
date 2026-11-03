import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { createAccountSwitcher } from "../../src/main/account-switch";
import type { StatusLineSample } from "../../src/shared/statusline";
import type { Session } from "../../src/shared/types";

const NOW = 1_800_000_000_000;
const HOUR = 3_600_000;

const sample = (
  device: string,
  five: number,
  mtime: number,
): StatusLineSample =>
  ({
    sessionId: `s${device}-${mtime}`,
    capturedMtimeMs: mtime,
    configDir: `C:\\Users\\x\\.rec\\claude\\accounts\\${device}\\config`,
    rateLimits: { fiveHour: { usedPct: five, resetsAt: NOW + HOUR } },
  }) as StatusLineSample;

function setup(current = { id: "10" }) {
  const dir = mkdtempSync(join(tmpdir(), "acct-switch-"));
  const switchTo = vi.fn((orgId: string) => {
    current.id = orgId === "o20" ? "20" : "10";
    return Promise.resolve();
  });
  const sw = createAccountSwitcher({
    readBindings: () =>
      Promise.resolve([
        { deviceId: "20", orgId: "o20", orgName: "", email: "b@x" },
        { deviceId: "10", orgId: "o10", orgName: "", email: "a@x" },
      ]),
    currentDevice: () => current.id,
    claudeEmail: () => null,
    switchTo,
    prefs: () => ({ enabled: true, threshold: 85 }),
    savePrefs: () => {},
    statePath: join(dir, "state.json"),
    now: () => NOW,
  });
  return { sw, switchTo, dir, current };
}

describe("account switcher", () => {
  it("keeps each account's freshest windows and numbers accounts by device id", async () => {
    const { sw } = setup();
    await sw.refresh();
    sw.observe([sample("10", 40, NOW - 5000), sample("10", 50, NOW - 1000)]);
    sw.observe([sample("10", 45, NOW - 3000), sample("20", 7, NOW - 2000)]);
    const v = sw.view()!;
    expect(v.accounts.map((a) => [a.deviceId, a.n, a.current])).toEqual([
      ["10", 1, true],
      ["20", 2, false],
    ]);
    expect(v.accounts[0].fiveHour?.usedPct).toBe(50);
    expect(v.accounts[1].fiveHour?.usedPct).toBe(7);
    expect(v.smart.available).toBe(true);
  });

  it("switches a hot default once, records it, and then offers the idle sessions left behind", async () => {
    const { sw, switchTo, dir } = setup();
    await sw.refresh();
    sw.observe([sample("10", 90, NOW - 1000), sample("20", 10, NOW - 2000)]);
    const idle = {
      id: "a",
      agent: "claude",
      management: "managed",
      state: "idle",
      lastActivityMs: NOW - 20_000,
      accountDevice: "10",
    } as Session;
    sw.tick([idle]);
    sw.tick([idle]); // in flight: no second switch
    await vi.waitFor(() => expect(sw.view()!.smart.last).toBeDefined());
    expect(switchTo).toHaveBeenCalledTimes(1);
    expect(switchTo).toHaveBeenCalledWith("o20");
    const after = sw.tick([idle]);
    expect(after.candidates.map((c) => c.id)).toEqual(["a"]);
    sw.noteMoved();
    const saved = JSON.parse(readFileSync(join(dir, "state.json"), "utf8"));
    expect(saved.last).toMatchObject({
      from: "10",
      to: "20",
      fromPct: 90,
      moved: 1,
    });
  });

  it("holds off after a manual pick", async () => {
    const { sw, switchTo } = setup();
    await sw.refresh();
    sw.observe([sample("10", 95, NOW - 1000)]);
    sw.noteManualSwitch();
    sw.tick([]);
    await Promise.resolve();
    expect(switchTo).not.toHaveBeenCalled();
  });
});
