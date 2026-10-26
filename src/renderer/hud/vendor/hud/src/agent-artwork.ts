/** Components/AgentLogo.swift and Core/Models/Catalog/VendorMark.swift, shared by every UI surface. */
export const ORIGINAL_ARTWORK_FILES = {
  Claude: "claude",
  ChatGPT: "chatgpt",
  DeepSeek: "deepseek",
  Grok: "grok",
  Kimi: "kimi",
  GLM: "glm",
  Pi: "pi",
  Qwen: "qwen",
} as const;
type OriginalVendor = keyof typeof ORIGINAL_ARTWORK_FILES;
const vendors: Readonly<Record<string, OriginalVendor>> = {
  claude: "Claude",
  openai: "ChatGPT",
  deepseek: "DeepSeek",
  grok: "Grok",
  kimi: "Kimi",
  glm: "GLM",
  pi: "Pi",
  qwen: "Qwen",
};
const templates: ReadonlySet<OriginalVendor> = new Set(["Grok", "Kimi", "Pi"]);
const normalize = (source: string) =>
  source
    .trim()
    .toLowerCase()
    .replace(/[\s_]+/g, "-");
const aliases: Readonly<Record<string, string>> = {
  "claude-code": "claude",
  anthropic: "claude",
  chatgpt: "openai",
  codex: "openai",
  "codex-cli": "openai",
};
export function agentArtworkKey(source: string): string {
  const key = normalize(source);
  return aliases[key] ?? key;
}
export function agentVendorName(source: string): string {
  const key = agentArtworkKey(source);
  return key === "openai" ? "OpenAI" : (vendors[key] ?? source);
}
const asset = (file: string) =>
  new URL(`./assets/${file}.png`, import.meta.url).href;
export interface AgentArtwork {
  key: string;
  vendor: OriginalVendor;
  file: string;
  url: string;
  template: boolean;
  /** Template foreground or the source's fixed OpenAI brand tint; null preserves every source pixel. */
  tint: string | null;
}
export function agentArtwork(
  source: string,
  light = false,
): AgentArtwork | null {
  const key = agentArtworkKey(source);
  const vendor = vendors[key];
  if (!vendor) return null;
  const file = ORIGINAL_ARTWORK_FILES[vendor],
    template = templates.has(vendor);
  return {
    key,
    vendor,
    file,
    url: asset(file),
    template,
    tint:
      vendor === "ChatGPT"
        ? "#10a37f"
        : template
          ? light
            ? "#1d1d1f"
            : "#ffffff"
          : null,
  };
}
export const originalArtworkVendors = Object.keys(ORIGINAL_ARTWORK_FILES)
  .filter((vendor) => !vendor.endsWith("-dark"))
  .sort();
