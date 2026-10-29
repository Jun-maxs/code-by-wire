import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createJunAccount, type TokenCipher } from "../../src/main/jun-account";

const cipher: TokenCipher = {
  available: () => true,
  encrypt: (t) => Buffer.from(`enc:${t}`),
  decrypt: (d) => d.toString().replace(/^enc:/, ""),
};

function fakeBroker() {
  const calls: Array<{ url: string; init?: RequestInit }> = [];
  let pollStatus = "pending";
  const fetchImpl = ((url: string, init?: RequestInit) =>
    Promise.resolve(route(url, init))) as typeof fetch;
  function route(url: string, init?: RequestInit): Response {
    calls.push({ url, init });
    const json = (body: unknown) =>
      new Response(JSON.stringify(body), { status: 200 });
    if (url.endsWith("/api/device/start"))
      return json({ id: "r1", code: "123456", secret: "s1", expiresAt: 999 });
    if (url.includes("/api/device/poll"))
      return pollStatus === "approved"
        ? json({
            status: "approved",
            user: "Jun",
            space: { id: "owner", label: "我的空间" },
            accountToken: "ja_secret",
            hubs: [],
          })
        : json({ status: pollStatus });
    if (url.endsWith("/api/store/prompts")) {
      const auth = new Headers(init?.headers).get("authorization");
      if (auth !== "Bearer ja_secret")
        return new Response("{}", { status: 401 });
      return init?.method === "PUT"
        ? json({ updatedAt: 42 })
        : json({ value: [], updatedAt: 41 });
    }
    return new Response("<html>", { status: 200 });
  }
  return {
    calls,
    fetchImpl,
    approve: () => {
      pollStatus = "approved";
    },
    deny: () => {
      pollStatus = "denied";
    },
  };
}

describe("jun-account", () => {
  const dirs: string[] = [];
  afterEach(() =>
    dirs.splice(0).forEach((d) => rmSync(d, { recursive: true, force: true })),
  );
  const setup = () => {
    const dir = mkdtempSync(join(tmpdir(), "jun-account-"));
    dirs.push(dir);
    const broker = fakeBroker();
    const account = createJunAccount({
      dir,
      cipher,
      baseUrl: "https://hub.test/account",
      fetchImpl: broker.fetchImpl,
    });
    return { dir, broker, account };
  };

  it("keeps polling until approved, then stores the token encrypted", async () => {
    const { dir, broker, account } = setup();
    expect(await account.poll()).toEqual({ status: "idle" });
    expect(await account.startLogin()).toEqual({
      code: "123456",
      expiresAt: 999,
    });
    expect((await account.poll()).status).toBe("pending");
    broker.approve();
    const done = await account.poll();
    expect(done).toMatchObject({
      status: "approved",
      account: { signedIn: true, user: "Jun", space: "我的空间" },
    });
    const saved = readFileSync(join(dir, "jun-account.json"), "utf8");
    expect(saved).not.toContain("ja_secret");
    expect(account.status().signedIn).toBe(true);
    expect(await account.poll()).toEqual({ status: "idle" });
  });

  it("reports a denied code and stays signed out", async () => {
    const { broker, account } = setup();
    await account.startLogin();
    broker.deny();
    expect(await account.poll()).toEqual({ status: "denied" });
    expect(account.status()).toEqual({ signedIn: false });
  });

  it("reads and writes the store with the account token, and refuses when signed out", async () => {
    const { broker, account } = setup();
    await expect(account.storeGet("prompts")).rejects.toThrow();
    await account.startLogin();
    broker.approve();
    await account.poll();
    expect(await account.storeGet("prompts")).toEqual({
      value: [],
      updatedAt: 41,
    });
    expect(await account.storePut("prompts", [{ id: "a" }])).toBe(42);
    account.signOut();
    expect(account.status()).toEqual({ signedIn: false });
    await expect(account.storePut("prompts", [])).rejects.toThrow();
  });
});
