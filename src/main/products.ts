import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import {
  parseProductCard,
  type ProductTrigger,
  type ProductsData,
} from "@shared/products";

/**
 * Read the workbench's product cards for the sidebar's product tags (see `@shared/products`).
 *
 * Layout (owned by the workbench, read-only here):
 * - `<cardsDir>/triggers.json` — `{ products: { <key>: { include: [...], exclude: [...] } } }`
 * - `<cardsDir>/sources.json` — `{ products: { <key>: { name, color? } } }` (optional)
 * - `<cardsDir>/<key>.md` — one product card per product
 * - `<stateDir>/<sessionId>.json` — the hook's per-session state; `session_product` (or the first of
 *   `cards`) is the product that session is about
 *
 * Returns null when the cards dir is missing, so the sidebar simply renders untagged. Anything
 * unreadable degrades to "no tag" for that item rather than failing the whole read.
 */
export function readProducts(
  cardsDir: string,
  stateDir: string,
): ProductsData | null {
  if (!cardsDir || !existsSync(cardsDir)) return null;
  const triggers = readTriggers(join(cardsDir, "triggers.json"));
  const colors = readColors(join(cardsDir, "sources.json"));
  const products: ProductsData["products"] = {};
  for (const name of safeList(cardsDir)) {
    const m = /^([a-z0-9_-]+)\.md$/.exec(name);
    if (!m) continue; // CARD_SPEC.md and other uppercase docs are not cards
    try {
      const md = readFileSync(join(cardsDir, name), "utf8");
      products[m[1]] = parseProductCard(m[1], md, colors[m[1]]);
    } catch {
      continue;
    }
  }
  return { products, bySession: readSessionProducts(stateDir), triggers };
}

function safeList(dir: string): string[] {
  try {
    return readdirSync(dir);
  } catch {
    return [];
  }
}

function readJson(path: string): unknown {
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch {
    return null;
  }
}

function readTriggers(path: string): ProductTrigger[] {
  const raw = readJson(path) as {
    products?: Record<string, { include?: string[]; exclude?: string[] }>;
  } | null;
  return Object.entries(raw?.products ?? {}).map(([key, v]) => ({
    key,
    include: Array.isArray(v.include) ? v.include : [],
    exclude: Array.isArray(v.exclude) ? v.exclude : [],
  }));
}

function readColors(path: string): Record<string, string> {
  const raw = readJson(path) as {
    products?: Record<string, { color?: string }>;
  } | null;
  const out: Record<string, string> = {};
  for (const [key, v] of Object.entries(raw?.products ?? {}))
    if (typeof v.color === "string") out[key] = v.color;
  return out;
}

function readSessionProducts(stateDir: string): Record<string, string> {
  const out: Record<string, string> = {};
  if (!stateDir) return out;
  for (const name of safeList(stateDir)) {
    if (!name.endsWith(".json")) continue;
    const raw = readJson(join(stateDir, name)) as {
      session_product?: unknown;
      cards?: unknown;
    } | null;
    const key =
      typeof raw?.session_product === "string"
        ? raw.session_product
        : Array.isArray(raw?.cards) && typeof raw.cards[0] === "string"
          ? raw.cards[0]
          : null;
    if (key) out[name.slice(0, -".json".length)] = key;
  }
  return out;
}
