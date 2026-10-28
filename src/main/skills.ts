import { execFile } from "node:child_process";
import {
  existsSync,
  readdirSync,
  readFileSync,
  realpathSync,
  statSync,
} from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { net } from "electron";
import {
  parseSkillFrontMatter,
  type PluginInfo,
  type SkillCheck,
  type SkillInfo,
  type SkillSource,
  type SkillsData,
} from "@shared/skills";

/**
 * The right sidebar's Skills page (fork feature, 2026-10-28). Skills live in several folders here
 * (the reclaude account's config, ~/.claude, ~/.agents, ~/.codex, ~/.cc-switch), often as separate
 * copies of one skill; the list merges them by name. Update checks follow how each was installed —
 * see the memory note local-skills-layout for where these upstreams come from.
 */

/** Upstream SKILL.md locations for skills installed by copying (no git, no updater). */
const UPSTREAMS: Record<string, { repo: string; path: string }> = {
  "web-artifacts-builder": {
    repo: "anthropics/skills",
    path: "skills/web-artifacts-builder",
  },
  "fixing-accessibility": {
    repo: "ibelick/ui-skills",
    path: "skills/fixing-accessibility",
  },
  "fixing-motion-performance": {
    repo: "ibelick/ui-skills",
    path: "skills/fixing-motion-performance",
  },
  officecli: { repo: "iOfficeAI/OfficeCLI", path: "skills/officecli" },
  "oil-visual": { repo: "oil-oil/oil-visual", path: "" },
  "oil-skill-creator": { repo: "oil-oil/oil-skill-creator", path: "" },
  "pdf-to-interactive-web": {
    repo: "ai-azhou/pdf-to-interactive-web",
    path: "skills/pdf-to-interactive-web",
  },
};
for (const n of [
  "expo-animation",
  "expo-data-fetching",
  "expo-design-system",
  "expo-native-ui",
  "expo-project-structure",
  "expo-router",
  "expo-ui",
])
  UPSTREAMS[n] = { repo: "expo/skills", path: `plugins/expo/skills/${n}` };
for (const n of [
  "brainstorming",
  "dispatching-parallel-agents",
  "executing-plans",
  "finishing-a-development-branch",
  "receiving-code-review",
  "requesting-code-review",
  "subagent-driven-development",
  "systematic-debugging",
  "test-driven-development",
  "using-git-worktrees",
  "using-superpowers",
  "verification-before-completion",
  "writing-plans",
  "writing-skills",
])
  UPSTREAMS[n] = { repo: "obra/superpowers", path: `skills/${n}` };

/** Kept different from upstream on purpose. */
const CUSTOM: Record<string, string> = {
  "gpt-image-2-style-library": "本地补过提示词模板",
  "oil-icon": "定制版：接 ai-ui-craft、默认 shyfai 4K",
  "ai-ui-craft": "自建（菜心 AI+UI 课提炼）",
  "webhub-ui-taste": "自建",
};

function skillRoots(): string[] {
  const home = homedir();
  const roots = [
    process.env.CLAUDE_CONFIG_DIR &&
      join(process.env.CLAUDE_CONFIG_DIR, "skills"),
    join(home, ".claude", "skills"),
    join(home, ".agents", "skills"),
    join(home, ".codex", "skills"),
    join(home, ".cc-switch", "skills"),
  ].filter((x): x is string => !!x);
  return [...new Set(roots)].filter((r) => existsSync(r));
}

function sourceOf(name: string, dir: string): SkillSource {
  if (CUSTOM[name]) return { kind: "custom", note: CUSTOM[name] };
  if (existsSync(join(dir, ".git"))) return { kind: "git", remote: "" };
  if (existsSync(join(dir, "scripts", "check_update.py")))
    return { kind: "script" };
  const up = UPSTREAMS[name];
  if (up) return { kind: "upstream", ...up };
  return { kind: "local" };
}

export function listSkills(): SkillsData {
  const byName = new Map<string, SkillInfo>();
  for (const root of skillRoots()) {
    let entries: string[];
    try {
      entries = readdirSync(root);
    } catch {
      continue;
    }
    for (const entry of entries) {
      const dir = join(root, entry);
      const md = join(dir, "SKILL.md");
      if (!existsSync(md)) continue;
      let text: string;
      let mtime: number;
      try {
        text = readFileSync(md, "utf8");
        mtime = statSync(md).mtimeMs;
      } catch {
        continue;
      }
      const fm = parseSkillFrontMatter(text);
      const name = fm.name ?? entry;
      let real = dir;
      try {
        real = realpathSync(dir);
      } catch {
        // keep the link path
      }
      const known = byName.get(name);
      if (known) {
        if (!known.paths.includes(real)) known.paths.push(real);
        known.updatedAt = Math.max(known.updatedAt ?? 0, mtime ?? 0);
        continue;
      }
      byName.set(name, {
        name,
        description: fm.description,
        version: fm.version,
        paths: [real],
        source: sourceOf(name, real),
        updatedAt: mtime,
      });
    }
  }
  return {
    skills: [...byName.values()].sort((a, b) => a.name.localeCompare(b.name)),
    plugins: listPlugins(),
  };
}

function listPlugins(): PluginInfo[] {
  const dirs = [
    process.env.CLAUDE_CONFIG_DIR &&
      join(process.env.CLAUDE_CONFIG_DIR, "plugins"),
    join(homedir(), ".claude-shared", "plugins"),
    join(homedir(), ".claude", "plugins"),
  ].filter((x): x is string => !!x);
  for (const d of dirs) {
    const file = join(d, "installed_plugins.json");
    if (!existsSync(file)) continue;
    try {
      const raw = JSON.parse(readFileSync(file, "utf8")) as {
        plugins?: Record<string, { version?: string; installedAt?: string }[]>;
      };
      return Object.entries(raw.plugins ?? {}).map(([id, v]) => {
        const first = Array.isArray(v) ? v[0] : undefined;
        const [name, marketplace = ""] = id.split("@");
        const at = first?.installedAt ? Date.parse(first.installedAt) : NaN;
        return {
          name,
          marketplace,
          version: first?.version ?? null,
          installedAt: Number.isFinite(at) ? at : null,
        };
      });
    } catch {
      return [];
    }
  }
  return [];
}

function run(
  file: string,
  args: string[],
  cwd: string,
  timeout = 60_000,
): Promise<{ code: number; out: string }> {
  return new Promise((resolve) => {
    execFile(
      file,
      args,
      {
        cwd,
        timeout,
        windowsHide: true,
        env: { ...process.env, PYTHONIOENCODING: "utf-8" },
      },
      (err, stdout, stderr) =>
        resolve({
          code: err ? (typeof err.code === "number" ? err.code : 1) : 0,
          out: `${stdout}${stderr}`.trim(),
        }),
    );
  });
}

const PYTHON = () => process.env.CBW_PYTHON ?? "python";

function find(name: string): SkillInfo | undefined {
  return listSkills().skills.find((s) => s.name === name);
}

export async function checkSkill(name: string): Promise<SkillCheck> {
  const now = Date.now();
  const skill = find(name);
  const base = { name, checkedAt: now, canUpdate: false, url: null };
  if (!skill) return { ...base, status: "error", detail: "找不到这个 skill" };
  const dir = skill.paths[0];
  const src = skill.source;
  try {
    if (src.kind === "custom")
      return { ...base, status: "custom", detail: src.note };
    if (src.kind === "git") {
      const f = await run("git", ["fetch", "--quiet"], dir);
      if (f.code !== 0)
        return { ...base, status: "error", detail: f.out.slice(-200) };
      const r = await run("git", ["rev-list", "--count", "HEAD..@{u}"], dir);
      const behind = Number(r.out) || 0;
      return {
        ...base,
        status: behind > 0 ? "behind" : "latest",
        detail: behind > 0 ? `落后 ${behind} 个提交` : "已是最新",
        canUpdate: behind > 0,
      };
    }
    if (src.kind === "script") {
      const r = await run(
        PYTHON(),
        ["-X", "utf8", join("scripts", "check_update.py")],
        dir,
      );
      const line = r.out.split(/\r?\n/).filter(Boolean).pop() ?? "";
      const behind =
        /new version|可更新|有新版本|update available|available/i.test(r.out);
      return {
        ...base,
        status:
          r.code !== 0 && !behind ? "error" : behind ? "behind" : "latest",
        detail: line.slice(0, 200) || (behind ? "有新版本" : "已是最新"),
        canUpdate: behind,
      };
    }
    if (src.kind === "upstream") {
      const sub = src.path ? `${src.path}/` : "";
      const url = `https://github.com/${src.repo}/tree/HEAD/${src.path}`;
      const res = await net.fetch(
        `https://raw.githubusercontent.com/${src.repo}/HEAD/${sub}SKILL.md`,
      );
      if (!res.ok)
        return {
          ...base,
          url,
          status: "error",
          detail: `上游 HTTP ${res.status}`,
        };
      const remote = (await res.text()).replace(/\r\n/g, "\n").trim();
      const local = readFileSync(join(dir, "SKILL.md"), "utf8")
        .replace(/\r\n/g, "\n")
        .trim();
      return remote === local
        ? { ...base, url, status: "latest", detail: "和上游一致" }
        : {
            ...base,
            url,
            status: "differs",
            detail: "和上游不同",
          };
    }
    return { ...base, status: "unknown", detail: "本地安装，没有上游可比" };
  } catch (e) {
    return {
      ...base,
      status: "error",
      detail: (e instanceof Error ? e.message : String(e)).slice(0, 200),
    };
  }
}

/** Update in place where that's safe: git pull (fast-forward only) or the skill's own updater.
 *  Every copy that is a git checkout or carries the updater is updated. */
export async function updateSkill(name: string): Promise<SkillCheck> {
  const skill = find(name);
  if (!skill) return checkSkill(name);
  for (const dir of skill.paths) {
    if (existsSync(join(dir, ".git")))
      await run("git", ["pull", "--ff-only", "--quiet"], dir, 120_000);
    else if (existsSync(join(dir, "scripts", "check_update.py")))
      // The checker installs a newer version itself when one is out (oil-ui-pro's does).
      await run(
        PYTHON(),
        ["-X", "utf8", join("scripts", "check_update.py")],
        dir,
        180_000,
      );
  }
  return checkSkill(name);
}
