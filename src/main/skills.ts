import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import {
  cpSync,
  existsSync,
  lstatSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  realpathSync,
  rmdirSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { homedir, tmpdir } from "node:os";
import { dirname, join, relative, sep } from "node:path";
import { app, net, shell } from "electron";
import {
  parseSkillFrontMatter,
  type PluginInfo,
  type SkillCheck,
  type SkillFileDiff,
  type SkillInfo,
  type SkillRemoveResult,
  type SkillSource,
  type SkillsData,
} from "@shared/skills";
import { createSkillUsageScanner, type SkillUsageScanner } from "./skill-usage";

/**
 * The right sidebar's Skills page (fork feature, 2026-10-28). Skills live in several folders here
 * (the reclaude account's config, ~/.claude, ~/.agents, ~/.codex, ~/.cc-switch), often as separate
 * copies of one skill; the list merges them by name. Update checks follow how each was installed —
 * see the memory note local-skills-layout for where these upstreams come from. Copied skills are
 * compared with their upstream folder file by file (git blob hashes from the trees API).
 */

/** Upstream folders for skills installed by copying (no git, no updater). */
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

/** Kept different from upstream on purpose: compared when an upstream is known, never updated. */
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

const mdHash = (text: string) =>
  createHash("sha1").update(text.replace(/\r\n/g, "\n")).digest("hex");

function birth(path: string): number | null {
  try {
    const st = statSync(path);
    return st.birthtimeMs || st.ctimeMs || null;
  } catch {
    return null;
  }
}

function collectSkills(): SkillInfo[] {
  const byName = new Map<string, SkillInfo>();
  const hashes = new Map<string, Set<string>>();
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
      const born = birth(real);
      const hs = hashes.get(name) ?? new Set<string>();
      hashes.set(name, hs);
      hs.add(mdHash(text));
      const known = byName.get(name);
      if (known) {
        if (!known.paths.includes(real)) known.paths.push(real);
        if (!known.locations.includes(dir)) known.locations.push(dir);
        known.updatedAt = Math.max(known.updatedAt ?? 0, mtime ?? 0);
        if (born !== null)
          known.installedAt = Math.min(known.installedAt ?? born, born);
        known.copiesDiffer = hs.size > 1;
        continue;
      }
      byName.set(name, {
        name,
        description: fm.description,
        version: fm.version,
        paths: [real],
        source: sourceOf(name, real),
        updatedAt: mtime,
        locations: [dir],
        installedAt: born,
        copiesDiffer: false,
        alsoInPlugin: null,
      });
    }
  }
  return [...byName.values()].sort((a, b) => a.name.localeCompare(b.name));
}

let usageScanner: SkillUsageScanner | null = null;
const usage = () =>
  (usageScanner ??= createSkillUsageScanner(
    join(app.getPath("userData"), "skill-usage.json"),
  ));

/** The last check per skill, kept across runs so the page opens with its dots already lit. */
const checksFile = () => join(app.getPath("userData"), "skill-checks.json");
let checkCache: Record<string, SkillCheck> | null = null;
function checks(): Record<string, SkillCheck> {
  if (checkCache) return checkCache;
  try {
    checkCache = JSON.parse(readFileSync(checksFile(), "utf8")) as Record<
      string,
      SkillCheck
    >;
  } catch {
    checkCache = {};
  }
  return checkCache;
}
function remember(c: SkillCheck): SkillCheck {
  const all = checks();
  all[c.name] = c;
  try {
    writeFileSync(checksFile(), JSON.stringify(all));
  } catch {
    // still served from memory this run
  }
  return c;
}

export function listSkills(): SkillsData {
  const u = usage().read();
  const plugins = listPlugins();
  const skills = collectSkills().map((s) => ({
    ...s,
    alsoInPlugin: plugins.find((p) => p.skills.includes(s.name))?.name ?? null,
  }));
  const names = new Set(skills.map((s) => s.name));
  return {
    skills,
    plugins,
    usage: u.usage,
    usageScannedAt: u.scannedAt,
    usageScanning: u.scanning,
    checks: Object.fromEntries(
      Object.entries(checks()).filter(([n]) => names.has(n)),
    ),
  };
}

/** Re-read the transcripts for usage (incremental); resolves with the fresh list. */
export async function scanSkillUsage(): Promise<SkillsData> {
  await usage().scan();
  return listSkills();
}

/** Skill folder names a plugin ships. Its recorded installPath may sit under another account's
 *  config (reclaude moves them); then the part after `plugins` is tried under this plugins dir. */
function pluginSkills(pluginsDir: string, installPath?: string): string[] {
  if (!installPath) return [];
  const parts = installPath.split(/[\\/]/);
  const at = parts.lastIndexOf("plugins");
  const candidates = [
    installPath,
    at >= 0 ? join(pluginsDir, ...parts.slice(at + 1)) : "",
  ];
  for (const c of candidates) {
    const dir = c && join(c, "skills");
    if (!dir || !existsSync(dir)) continue;
    try {
      return readdirSync(dir).filter((n) =>
        existsSync(join(dir, n, "SKILL.md")),
      );
    } catch {
      return [];
    }
  }
  return [];
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
        plugins?: Record<
          string,
          { version?: string; installedAt?: string; installPath?: string }[]
        >;
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
          skills: pluginSkills(d, first?.installPath),
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
  return collectSkills().find((s) => s.name === name);
}

/** git's blob id for a file's bytes — what the trees API reports for each upstream file. */
const blobSha = (buf: Buffer) =>
  createHash("sha1").update(`blob ${buf.length}\0`).update(buf).digest("hex");

/** Repo housekeeping (.gitignore, .github/, an installer's .source-commit) isn't part of a skill. */
const dotted = (p: string) => p.split("/").some((seg) => seg.startsWith("."));

const SKIP = new Set([".git", "node_modules", "__pycache__", ".DS_Store"]);

function localFiles(dir: string): Map<string, Buffer> {
  const out = new Map<string, Buffer>();
  const walk = (d: string) => {
    let entries;
    try {
      entries = readdirSync(d, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      if (SKIP.has(e.name)) continue;
      const p = join(d, e.name);
      if (e.isDirectory()) walk(p);
      else if (e.isFile())
        out.set(relative(dir, p).split(sep).join("/"), readFileSync(p));
    }
  };
  walk(dir);
  return out;
}

/** Upstream trees, one fetch per repo every few minutes (superpowers' 14 skills share one). */
const trees = new Map<
  string,
  { at: number; files: Promise<Map<string, string>> }
>();
function upstreamTree(repo: string): Promise<Map<string, string>> {
  const hit = trees.get(repo);
  if (hit && Date.now() - hit.at < 5 * 60_000) return hit.files;
  const files = (async () => {
    const token = process.env.GITHUB_TOKEN ?? process.env.GH_TOKEN;
    const res = await net.fetch(
      `https://api.github.com/repos/${repo}/git/trees/HEAD?recursive=1`,
      {
        headers: {
          accept: "application/vnd.github+json",
          ...(token ? { authorization: `Bearer ${token}` } : {}),
        },
      },
    );
    if (!res.ok) throw new Error(`GitHub HTTP ${res.status}`);
    const body = (await res.json()) as {
      tree?: { path: string; type: string; sha: string }[];
    };
    return new Map(
      (body.tree ?? [])
        .filter((t) => t.type === "blob")
        .map((t) => [t.path, t.sha] as const),
    );
  })();
  files.catch(() => trees.delete(repo));
  trees.set(repo, { at: Date.now(), files });
  return files;
}

const sameBlob = (buf: Buffer, sha: string) =>
  blobSha(buf) === sha ||
  // a CRLF checkout of an LF file is the same file
  blobSha(
    Buffer.from(buf.toString("latin1").replace(/\r\n/g, "\n"), "latin1"),
  ) === sha;

async function diffUpstream(
  dir: string,
  repo: string,
  path: string,
): Promise<SkillFileDiff> {
  const tree = await upstreamTree(repo);
  const prefix = path ? `${path}/` : "";
  const remote = new Map<string, string>();
  for (const [p, sha] of tree)
    if (p.startsWith(prefix) && !dotted(p.slice(prefix.length)))
      remote.set(p.slice(prefix.length), sha);
  if (!remote.has("SKILL.md")) throw new Error("上游没找到 SKILL.md");
  const local = localFiles(dir);
  const diff: SkillFileDiff = { changed: [], added: [], localOnly: [] };
  for (const [p, sha] of remote) {
    const buf = local.get(p);
    if (!buf) diff.added.push(p);
    else if (!sameBlob(buf, sha)) diff.changed.push(p);
  }
  for (const p of local.keys())
    if (!remote.has(p) && !dotted(p)) diff.localOnly.push(p);
  return diff;
}

export async function checkSkill(name: string): Promise<SkillCheck> {
  return remember(await checkSkillNow(name));
}

async function checkSkillNow(name: string): Promise<SkillCheck> {
  const now = Date.now();
  const skill = find(name);
  const base = { name, checkedAt: now, canUpdate: false, url: null };
  if (!skill) return { ...base, status: "error", detail: "找不到这个 skill" };
  const dir = skill.paths[0];
  const src = skill.source;
  try {
    if (src.kind === "custom") {
      const up = UPSTREAMS[name];
      if (!up) return { ...base, status: "custom", detail: src.note };
      const diff = await diffUpstream(dir, up.repo, up.path);
      const n = diff.changed.length + diff.added.length;
      return {
        ...base,
        status: "custom",
        diff,
        url: `https://github.com/${up.repo}/tree/HEAD/${up.path}`,
        detail: n ? `${src.note} · 和上游差 ${n} 个文件` : src.note,
      };
    }
    if (src.kind === "git") {
      const f = await run("git", ["fetch", "--quiet"], dir);
      if (f.code !== 0)
        return { ...base, status: "error", detail: f.out.slice(-200) };
      const r = await run("git", ["rev-list", "--count", "HEAD..@{u}"], dir);
      const behind = Number(r.out) || 0;
      const st = await run("git", ["status", "--porcelain"], dir);
      const edits =
        st.code === 0 ? st.out.split(/\r?\n/).filter(Boolean).length : 0;
      return {
        ...base,
        status: behind > 0 ? "behind" : edits > 0 ? "differs" : "latest",
        detail: [
          behind > 0 ? `落后 ${behind} 个提交` : "已是最新",
          edits > 0 && `本地改了 ${edits} 个文件`,
        ]
          .filter(Boolean)
          .join(" · "),
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
      const url = `https://github.com/${src.repo}/tree/HEAD/${src.path}`;
      const diff = await diffUpstream(dir, src.repo, src.path);
      const behind = diff.changed.length + diff.added.length;
      if (!behind)
        return {
          ...base,
          url,
          diff,
          status: "latest",
          detail: diff.localOnly.length
            ? `和上游一致（本地多 ${diff.localOnly.length} 个文件）`
            : "和上游一致",
        };
      return {
        ...base,
        url,
        diff,
        status: "differs",
        detail: [
          diff.changed.length && `${diff.changed.length} 个文件和上游不同`,
          diff.added.length && `上游新增 ${diff.added.length} 个`,
        ]
          .filter(Boolean)
          .join(" · "),
        canUpdate: true,
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

/** Update in place where that's safe: git pull (fast-forward only), the skill's own updater, or
 *  for a copied skill, its upstream folder's files. Every copy is updated. */
export async function updateSkill(name: string): Promise<SkillCheck> {
  const skill = find(name);
  if (!skill) return checkSkill(name);
  try {
    for (const dir of skill.paths) {
      if (skill.source.kind === "upstream")
        await pullUpstream(name, dir, skill.source.repo, skill.source.path);
      else if (existsSync(join(dir, ".git")))
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
  } catch (e) {
    return remember({
      name,
      checkedAt: Date.now(),
      canUpdate: false,
      url: null,
      status: "error",
      detail: (e instanceof Error ? e.message : String(e)).slice(0, 200),
    });
  }
  return checkSkill(name);
}

/** Copy the folder to a temp dir and send that to the Recycle Bin: a restorable "before" copy. */
async function backupToTrash(name: string, dir: string): Promise<void> {
  const copy = join(
    tmpdir(),
    "cbw-skill-backup",
    `${name}-before-${Date.now()}`,
  );
  mkdirSync(dirname(copy), { recursive: true });
  cpSync(dir, copy, { recursive: true });
  await shell.trashItem(copy);
}

/** Bring a copied skill up to its upstream folder: write the changed and new files. Files only this
 *  copy has are left alone (they may be local additions). The old folder goes to the Recycle Bin. */
async function pullUpstream(
  name: string,
  dir: string,
  repo: string,
  path: string,
): Promise<void> {
  const diff = await diffUpstream(dir, repo, path);
  const files = [...diff.changed, ...diff.added];
  if (!files.length) return;
  const fetched: [string, Buffer][] = [];
  for (const f of files) {
    const sub = (path ? `${path}/${f}` : f)
      .split("/")
      .map(encodeURIComponent)
      .join("/");
    const res = await net.fetch(
      `https://raw.githubusercontent.com/${repo}/HEAD/${sub}`,
    );
    if (!res.ok) throw new Error(`下载 ${f} 失败：HTTP ${res.status}`);
    fetched.push([f, Buffer.from(await res.arrayBuffer())]);
  }
  await backupToTrash(name, dir);
  for (const [f, buf] of fetched) {
    const target = join(dir, ...f.split("/"));
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, buf);
  }
}

/** Remove a skill everywhere it's installed: links are removed, folders go to the Recycle Bin. */
export async function removeSkill(name: string): Promise<SkillRemoveResult> {
  const skill = find(name);
  if (!skill) return { ok: false, detail: "找不到这个 skill" };
  const removed: string[] = [];
  try {
    const reals = new Set(skill.paths);
    for (const loc of skill.locations) {
      if (reals.has(loc) || !lstatSync(loc).isSymbolicLink()) continue;
      // A directory link or junction on Windows goes with rmdir (the target stays); elsewhere unlink.
      try {
        unlinkSync(loc);
      } catch {
        rmdirSync(loc);
      }
      removed.push(loc);
    }
    for (const dir of reals) {
      if (!existsSync(dir)) continue;
      await shell.trashItem(dir);
      removed.push(dir);
    }
    if (checkCache) {
      delete checkCache[name];
      writeFileSync(checksFile(), JSON.stringify(checkCache));
    }
    return { ok: true, removed };
  } catch (e) {
    const why = (e instanceof Error ? e.message : String(e)).slice(0, 200);
    return {
      ok: false,
      detail: removed.length
        ? `已移走 ${removed.length} 处后出错：${why}`
        : why,
    };
  }
}
