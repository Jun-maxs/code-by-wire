import { describe, expect, it, vi } from "vitest";
import {
  codexRelay,
  fetchRelayUsage,
  piRelay,
  relayMoney,
  relayUsage,
} from "../../src/main/usage/relay";

const CODEX_CONFIG = `model_provider = "custom"
model = "deepseek-v4.1-flash"

[model_providers.custom]
name = "My Codex"
base_url = "https://relay.example.com/v1"
wire_api = "responses"
experimental_bearer_token = "sk-1"

[projects.'c:\\users\\me']
trust_level = "trusted"
`;

const CNY = {
  data: {
    quota_per_unit: 500000,
    quota_display_type: "CNY",
    usd_exchange_rate: 7.12,
  },
};

describe("codexRelay", () => {
  it("reads the selected provider's base_url and bearer token", () => {
    expect(codexRelay(CODEX_CONFIG, {})).toEqual({
      origin: "https://relay.example.com",
      host: "relay.example.com",
      key: "sk-1",
    });
  });

  it("takes the key from env_key", () => {
    const config = `model_provider = "r"\n[model_providers.r]\nbase_url = "https://r.io/v1"\nenv_key = "RELAY_KEY"\n`;
    expect(codexRelay(config, { RELAY_KEY: "sk-env" })?.key).toBe("sk-env");
    expect(codexRelay(config, {})).toBeNull();
  });

  it("is null for OpenAI itself and for unreadable config", () => {
    expect(codexRelay(`model_provider = "openai"\n`, {})).toBeNull();
    expect(codexRelay(`model = "gpt-5"\n`, {})).toBeNull();
    expect(codexRelay(`not [valid`, {})).toBeNull();
  });
});

describe("piRelay", () => {
  it("reads the first provider with a base URL and key", () => {
    const models = JSON.stringify({
      providers: {
        local: { baseUrl: "not a url", apiKey: "x" },
        relay: { baseUrl: "https://r.io/v1", apiKey: "RELAY_KEY" },
      },
    });
    expect(piRelay(models, { RELAY_KEY: "sk-env" })).toEqual({
      origin: "https://r.io",
      host: "r.io",
      key: "sk-env",
    });
    expect(piRelay(models, {})?.key).toBe("RELAY_KEY");
  });

  it("never treats a !command key as a key", () => {
    const models = JSON.stringify({
      providers: { r: { baseUrl: "https://r.io", apiKey: "!pass show key" } },
    });
    expect(piRelay(models, {})).toBeNull();
  });
});

describe("relayMoney and relayUsage", () => {
  it("shows a CNY relay in yuan at its own exchange rate", () => {
    const usage = relayUsage(
      { data: { total_used: 8465, total_granted: 0, unlimited_quota: true } },
      "relay.example.com",
      relayMoney(CNY),
    );
    expect(usage?.currency).toBe("CNY");
    expect(usage?.spent).toBeCloseTo(0.1205416, 6);
    expect(usage?.remaining).toBeUndefined();
    expect(usage?.usedPct).toBeUndefined();
  });

  it("gives a limited key its remaining money and used share", () => {
    const usage = relayUsage(
      {
        data: {
          total_used: 250000,
          total_granted: 1000000,
          unlimited_quota: false,
        },
      },
      "r.io",
      relayMoney(null),
    );
    expect(usage).toEqual({
      host: "r.io",
      spent: 0.5,
      remaining: 1.5,
      usedPct: 25,
      currency: "USD",
    });
  });

  it("is null for a body that isn't new-api's token usage", () => {
    expect(relayUsage({ error: "nope" }, "r.io", relayMoney(null))).toBeNull();
  });
});

describe("fetchRelayUsage", () => {
  const relay = { origin: "https://r.io", host: "r.io", key: "sk-1" };
  const json = (body: unknown, ok = true) =>
    ({ ok, json: () => Promise.resolve(body) }) as Response;

  it("sends the key only with the usage request", async () => {
    const fetchFn = vi.fn((url: string) =>
      Promise.resolve(
        url.endsWith("/api/status")
          ? json(CNY)
          : json({
              data: {
                total_used: 500000,
                total_granted: 0,
                unlimited_quota: true,
              },
            }),
      ),
    );
    const usage = await fetchRelayUsage(relay, fetchFn);
    expect(usage?.spent).toBeCloseTo(7.12, 6);
    expect(fetchFn.mock.calls[0]).toEqual(["https://r.io/api/status"]);
    expect(fetchFn.mock.calls[1]).toEqual([
      "https://r.io/api/usage/token/",
      { headers: { Authorization: "Bearer sk-1" } },
    ]);
  });

  it("still reads usage in dollars when the status fails", async () => {
    const fetchFn = vi.fn((url: string) =>
      url.endsWith("/api/status")
        ? Promise.reject(new Error("down"))
        : Promise.resolve(
            json({
              data: {
                total_used: 500000,
                total_granted: 0,
                unlimited_quota: true,
              },
            }),
          ),
    );
    expect((await fetchRelayUsage(relay, fetchFn))?.currency).toBe("USD");
  });

  it("is null when the usage request is refused", async () => {
    const fetchFn = vi.fn(() => Promise.resolve(json({}, false)));
    expect(await fetchRelayUsage(relay, fetchFn)).toBeNull();
  });
});
