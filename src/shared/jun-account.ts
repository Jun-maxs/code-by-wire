/**
 * Hub account (fork feature, 2026-10-30): Jun-Code signs in to the same account as the Jun-App
 * phone app through the jun-account broker beside the Nido hub. The desktop shows a 6-digit code,
 * the owner approves it in a popup on hub.yuanhk.top, and the app gets an account token that reads
 * and writes the account's small store (prompts, …) shared with the phone.
 */
export const JUN_ACCOUNT_URL = "https://hub.yuanhk.top/account";

export interface JunAccountStatus {
  signedIn: boolean;
  /** Approver's display name (Nido name or email). */
  user?: string;
  /** The space the account belongs to, e.g. "我的空间". */
  space?: string;
  /** This machine's name as the hub lists it. */
  device?: string;
}

export interface JunLoginStart {
  code: string;
  /** Epoch ms. */
  expiresAt: number;
}

export type JunLoginPoll =
  | { status: "pending"; expiresAt: number }
  | { status: "approved"; account: JunAccountStatus }
  | { status: "denied" | "expired" | "offline" | "idle" };

export interface JunStoreEntry<T = unknown> {
  value: T | null;
  /** Server write time (epoch ms); 0 when the key was never written. */
  updatedAt: number;
}

/** One saved prompt — the shape shared by Jun-Code's prompt page and Jun-App. */
export interface SavedPrompt {
  id: string;
  title: string;
  body: string;
  /** Last insert/copy, for "recently used first". */
  usedAt: number;
}
