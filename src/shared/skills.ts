/**
 * Skills panel (fork feature, 2026-10-28): the agent skills installed on this machine, gathered from
 * every folder Claude Code / Codex / cc-switch read, with a per-skill update check. JSX-free shapes
 * shared by main (src/main/skills.ts) and the right sidebar's Skills page.
 */

/** How a skill can be checked for updates. */
export type SkillSource =
  /** The folder is a git checkout with an upstream. */
  | { kind: "git"; remote: string }
  /** The skill ships its own checker (scripts/check_update.py). */
  | { kind: "script" }
  /** Known upstream SKILL.md on GitHub; compared by content. */
  | { kind: "upstream"; repo: string; path: string }
  /** Deliberately customized here; upstream differences are expected. */
  | { kind: "custom"; note: string }
  | { kind: "local" };

export interface SkillInfo {
  name: string;
  description: string;
  version: string | null;
  /** Every folder holding a copy, first = the one Claude reads. */
  paths: string[];
  source: SkillSource;
  /** Newest SKILL.md mtime across copies, epoch ms. */
  updatedAt: number | null;
  /** Every entry pointing at it (folders and links), i.e. what removing it deletes. */
  locations: string[];
  /** When the oldest copy appeared on disk (folder birth time), epoch ms. */
  installedAt: number | null;
  /** The copies' SKILL.md files are not all the same. */
  copiesDiffer: boolean;
  /** An installed Claude Code plugin ships a skill of the same name (this copy duplicates it). */
  alsoInPlugin: string | null;
}

/** Uses found in the agents' transcripts. */
export interface SkillUsage {
  count: number;
  lastUsedAt: number | null;
}

/** Unused this long (and installed at least this long ago) reads as idle on the Skills page. */
export const SKILL_IDLE_DAYS = 30;

export function isIdleSkill(
  skill: Pick<SkillInfo, "installedAt">,
  usage: SkillUsage | undefined,
  now: number,
): boolean {
  const cutoff = now - SKILL_IDLE_DAYS * 86_400_000;
  if (skill.installedAt !== null && skill.installedAt > cutoff) return false;
  return !usage?.lastUsedAt || usage.lastUsedAt < cutoff;
}

export interface PluginInfo {
  name: string;
  marketplace: string;
  version: string | null;
  installedAt: number | null;
  /** Skill folder names the plugin ships. */
  skills: string[];
}

export interface SkillsData {
  skills: SkillInfo[];
  plugins: PluginInfo[];
  usage: Record<string, SkillUsage>;
  /** When the transcripts were last read for usage; null before the first scan. */
  usageScannedAt: number | null;
  usageScanning: boolean;
  /** The last check per skill, kept across app runs. */
  checks: Record<string, SkillCheck>;
}

/** How a copied skill's files compare with upstream (by git blob hash, every file). */
export interface SkillFileDiff {
  /** In both, content differs. */
  changed: string[];
  /** Upstream has it, the local copy doesn't. */
  added: string[];
  /** Only here (local additions, or files upstream removed). */
  localOnly: string[];
}

export type SkillCheckStatus =
  | "latest"
  | "behind"
  | "differs"
  | "custom"
  | "unknown"
  | "error";

export interface SkillCheck {
  name: string;
  status: SkillCheckStatus;
  /** One line for the row: "落后 3 个提交", the script's message, the error. */
  detail: string;
  /** Whether "Update" can run in place (git pull, or the skill's own updater). */
  canUpdate: boolean;
  /** Where to look upstream, when known. */
  url: string | null;
  /** File-level comparison for skills checked against an upstream folder. */
  diff?: SkillFileDiff;
  checkedAt: number;
}

/** `name` and `description` out of a SKILL.md's YAML front matter (single-line values only). */
export function parseSkillFrontMatter(md: string): {
  name: string | null;
  description: string;
  version: string | null;
} {
  const m = /^---\r?\n([\s\S]*?)\r?\n---/.exec(md);
  const field = (key: string): string | null => {
    if (!m) return null;
    const line = new RegExp(`^${key}:\\s*(.*)$`, "m").exec(m[1]);
    if (!line) return null;
    return line[1].trim().replace(/^["']|["']$/g, "") || null;
  };
  return {
    name: field("name"),
    description: field("description") ?? "",
    version: field("version"),
  };
}

export type SkillRemoveResult =
  | { ok: true; removed: string[] }
  | { ok: false; detail: string };
