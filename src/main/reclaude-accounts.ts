import { execFile, spawn } from "node:child_process";
import { readdirSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import type { ClaudeOrg } from "@shared/ipc";

/**
 * reclaude's organizations, for the account switcher (fork feature, 2026-10-27). reclaude binds one
 * Claude account per organization, each with its own config dir under `~/.rec/claude/accounts`;
 * their `projects` (the transcripts), plugins, agents and rules are links into `~/.claude-shared`, so
 * every binding sees the same sessions. `reclaude org use <id>` changes only the default binding,
 * offline; sessions started after it (through rec.exe) run on that account, running ones keep theirs.
 */

/** reclaude.exe beside rec.exe, or null when reclaude isn't installed. */
export function reclaudeCli(launcher: string | undefined): string | null {
  if (!launcher || !/rec\.exe$/i.test(launcher)) return null;
  return launcher.replace(/rec\.exe$/i, "reclaude.exe");
}

/** `reclaude org list`: `[*] <id>\t<name>\t<kind>\t<email>\t<bound|…>` per organization, `*` marking
 *  the default binding. Lines that aren't rows (the heading, the hint) are skipped. */
export function parseOrgList(text: string): ClaudeOrg[] {
  const orgs: ClaudeOrg[] = [];
  for (const raw of text.split(/\r?\n/)) {
    const m = /^\s*(\*)?\s*(\d+)\t(.*)$/.exec(raw);
    if (!m) continue;
    const [name = "", kind = "", email = "", binding = ""] = m[3].split("\t");
    orgs.push({
      id: m[2],
      name: name.trim(),
      kind: kind.trim(),
      email: email.trim(),
      bound: binding.trim().toLowerCase() === "bound",
      current: m[1] === "*",
    });
  }
  return orgs;
}

/** Every binding's Claude config dir (`~/.rec/claude/accounts/<id>/config`), so the statusLine
 *  captures of each account are read whichever is the default now. */
export function reclaudeConfigDirs(home: string = homedir()): string[] {
  const root = join(home, ".rec", "claude", "accounts");
  let names: string[];
  try {
    names = readdirSync(root);
  } catch {
    return [];
  }
  return names
    .map((name) => join(root, name, "config"))
    .filter((dir) => {
      try {
        return statSync(dir).isDirectory();
      } catch {
        return false;
      }
    });
}

const run = (cli: string, args: string[]): Promise<string> =>
  new Promise((resolve, reject) => {
    execFile(
      cli,
      args,
      { windowsHide: true, timeout: 30_000, encoding: "utf8" },
      (err, stdout, stderr) => {
        if (err) reject(new Error((stderr || stdout || err.message).trim()));
        else resolve(stdout);
      },
    );
  });

/** One local binding from `reclaude status --json`: a Claude account this machine is logged in to.
 *  Each can belong to a different reclaude user, so `org list` (the current user's organizations
 *  only) misses the others. */
export interface ReclaudeBinding {
  deviceId: string;
  orgId: string;
  orgName: string;
  email: string;
}

/** The `claude` section of `reclaude status --json`: every local binding and the default one. */
export function parseStatusBindings(text: string): {
  bindings: ReclaudeBinding[];
  currentOrg: string | null;
} {
  const j = JSON.parse(text) as {
    claude?: {
      bindings?: Record<string, unknown>[];
      current?: Record<string, unknown> | null;
    };
  };
  const str = (v: unknown) =>
    typeof v === "string" || typeof v === "number" ? String(v) : "";
  const bindings = (j.claude?.bindings ?? [])
    .map((b) => ({
      deviceId: str(b.device_id),
      orgId: str(b.org_id),
      orgName: str(b.org_name),
      email: str(b.email),
    }))
    .filter((b) => /^\d+$/.test(b.orgId) && /^\d+$/.test(b.deviceId));
  const current = str(j.claude?.current?.org_id);
  return { bindings, currentOrg: /^\d+$/.test(current) ? current : null };
}

/** The switcher's list: every local binding (whichever reclaude user it belongs to), then the
 *  current user's organizations that aren't bound yet. `claudeEmail` reads a binding's Claude login
 *  from its config dir; `org list` only knows it for the current user's organizations. */
export function mergeAccounts(
  status: ReturnType<typeof parseStatusBindings>,
  listed: ClaudeOrg[],
  claudeEmail: (deviceId: string) => string | null,
): ClaudeOrg[] {
  const byId = new Map(listed.map((o) => [o.id, o]));
  const bound: ClaudeOrg[] = status.bindings.map((b) => {
    const row = byId.get(b.orgId);
    return {
      id: b.orgId,
      name: row?.name || b.orgName,
      kind: row?.kind ?? "",
      email: claudeEmail(b.deviceId) || row?.email || b.email,
      bound: true,
      current: status.currentOrg
        ? b.orgId === status.currentOrg
        : row?.current === true,
    };
  });
  const seen = new Set(bound.map((o) => o.id));
  return [...bound, ...listed.filter((o) => !seen.has(o.id))];
}

/** A binding's Claude config dir, `~/.rec/claude/accounts/<device id>/config`. */
export const bindingConfigDir = (deviceId: string, home: string = homedir()) =>
  join(home, ".rec", "claude", "accounts", deviceId, "config");

export async function listAccounts(
  cli: string,
  claudeEmail: (deviceId: string) => string | null,
): Promise<ClaudeOrg[]> {
  const [status, listed] = await Promise.all([
    run(cli, ["status", "--json", "--check"]).then(parseStatusBindings),
    // The current user's organizations; a binding whose login lapsed can make this fail, and the
    // local bindings are still worth showing then.
    run(cli, ["org", "list"]).then(parseOrgList, () => [] as ClaudeOrg[]),
  ]);
  return mergeAccounts(status, listed, claudeEmail);
}

export const useOrg = (cli: string, id: string): Promise<string> =>
  run(cli, ["org", "use", id]);

/** `reclaude logout --org <id>`: drops that binding's login and key; its config and the shared
 *  sessions stay. reclaude has no other way to remove a single binding. */
export const logoutOrg = (cli: string, id: string): Promise<string> =>
  run(cli, ["logout", "--org", id]);

/**
 * Run a reclaude command that authorizes in the browser (`login` for another reclaude user's
 * account, `org bind <id>` for one of the current user's organizations). It prints the
 * authorization URL and waits for the browser; `openUrl` opens the first URL it prints, and the
 * promise settles when the command exits (or after 10 minutes, when it is stopped).
 */
export function authorize(
  cli: string,
  args: string[],
  openUrl: (url: string) => void,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(cli, args, {
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
    });
    let out = "";
    let opened = false;
    const read = (chunk: Buffer) => {
      out += chunk.toString("utf8");
      const url = /https?:\/\/\S+/.exec(out)?.[0];
      if (url && !opened) {
        opened = true;
        openUrl(url);
      }
    };
    child.stdout.on("data", read);
    child.stderr.on("data", read);
    const timer = setTimeout(() => child.kill(), 10 * 60_000);
    child.on("error", (err) => {
      clearTimeout(timer);
      reject(err);
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      if (code === 0) resolve();
      else reject(new Error(out.trim() || `exit ${code}`));
    });
  });
}
