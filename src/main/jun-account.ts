import { readFileSync, writeFileSync, renameSync, rmSync } from "node:fs";
import { hostname } from "node:os";
import { join } from "node:path";
import {
  JUN_ACCOUNT_URL,
  type JunAccountStatus,
  type JunLoginPoll,
  type JunLoginStart,
  type JunStoreEntry,
} from "@shared/jun-account";

/** Keeps the account token encrypted at rest when the OS offers it (Electron safeStorage). */
export interface TokenCipher {
  available(): boolean;
  encrypt(text: string): Buffer;
  decrypt(data: Buffer): string;
}

interface SavedAccount {
  /** base64 of the encrypted token, or the plain token when no cipher is available. */
  token: string;
  encrypted: boolean;
  user: string;
  space: string;
  device: string;
}

interface PendingLogin {
  id: string;
  secret: string;
  expiresAt: number;
}

/**
 * The hub account in main (fork feature, 2026-10-30). Request/response only, like the rest of
 * main: the renderer starts a login, then polls `poll()` every couple of seconds until the owner
 * approves the code on the hub page.
 */
export function createJunAccount(opts: {
  dir: string;
  cipher: TokenCipher;
  baseUrl?: string;
  fetchImpl?: typeof fetch;
}) {
  const file = join(opts.dir, "jun-account.json");
  const base = (opts.baseUrl ?? JUN_ACCOUNT_URL).replace(/\/$/, "");
  const doFetch = opts.fetchImpl ?? fetch;
  let pending: PendingLogin | null = null;

  const read = (): SavedAccount | null => {
    try {
      return JSON.parse(readFileSync(file, "utf8")) as SavedAccount;
    } catch {
      return null;
    }
  };

  const write = (account: SavedAccount | null) => {
    if (!account) {
      rmSync(file, { force: true });
      return;
    }
    const tmp = `${file}.tmp`;
    writeFileSync(tmp, JSON.stringify(account), { mode: 0o600 });
    renameSync(tmp, file);
  };

  const token = (): string | null => {
    const saved = read();
    if (!saved) return null;
    if (!saved.encrypted) return saved.token;
    try {
      return opts.cipher.decrypt(Buffer.from(saved.token, "base64"));
    } catch {
      return null;
    }
  };

  async function call<T>(path: string, init?: RequestInit): Promise<T> {
    const res = await doFetch(`${base}${path}`, {
      ...init,
      headers: {
        "content-type": "application/json",
        ...(init?.headers ?? {}),
      },
      signal: AbortSignal.timeout(15_000),
    });
    const text = await res.text();
    if (!res.ok || text.trimStart().startsWith("<")) {
      throw Object.assign(new Error(`HTTP ${res.status}`), {
        status: res.status,
      });
    }
    return JSON.parse(text) as T;
  }

  const authed = (): Record<string, string> => {
    const t = token();
    if (!t) throw Object.assign(new Error("signed out"), { status: 401 });
    return { authorization: `Bearer ${t}` };
  };

  return {
    status(): JunAccountStatus {
      const saved = read();
      return saved
        ? {
            signedIn: true,
            user: saved.user,
            space: saved.space,
            device: saved.device,
          }
        : { signedIn: false };
    },

    async startLogin(): Promise<JunLoginStart> {
      const started = await call<{
        id: string;
        code: string;
        secret: string;
        expiresAt: number;
      }>("/api/device/start", {
        method: "POST",
        body: JSON.stringify({ device: hostname(), client: "code" }),
      });
      pending = {
        id: started.id,
        secret: started.secret,
        expiresAt: started.expiresAt,
      };
      return { code: started.code, expiresAt: started.expiresAt };
    },

    async poll(): Promise<JunLoginPoll> {
      const p = pending;
      if (!p) return { status: "idle" };
      let result: {
        status: string;
        user?: string;
        space?: { label: string };
        accountToken?: string;
      };
      try {
        result = await call(
          `/api/device/poll?id=${encodeURIComponent(p.id)}&secret=${encodeURIComponent(p.secret)}`,
        );
      } catch {
        return { status: "offline" };
      }
      if (result.status === "pending")
        return { status: "pending", expiresAt: p.expiresAt };
      pending = null;
      if (result.status === "approved" && result.accountToken) {
        const encrypted = opts.cipher.available();
        write({
          token: encrypted
            ? opts.cipher.encrypt(result.accountToken).toString("base64")
            : result.accountToken,
          encrypted,
          user: result.user ?? "",
          space: result.space?.label ?? "",
          device: hostname(),
        });
        return { status: "approved", account: this.status() };
      }
      return { status: result.status === "denied" ? "denied" : "expired" };
    },

    cancelLogin(): void {
      pending = null;
    },

    signOut(): JunAccountStatus {
      pending = null;
      write(null);
      return { signedIn: false };
    },

    async storeGet<T>(key: string): Promise<JunStoreEntry<T>> {
      return call<JunStoreEntry<T>>(`/api/store/${encodeURIComponent(key)}`, {
        headers: authed(),
      });
    },

    async storePut(key: string, value: unknown): Promise<number> {
      const res = await call<{ updatedAt: number }>(
        `/api/store/${encodeURIComponent(key)}`,
        { method: "PUT", headers: authed(), body: JSON.stringify({ value }) },
      );
      return res.updatedAt;
    },
  };
}

export type JunAccount = ReturnType<typeof createJunAccount>;
