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

export const listOrgs = async (cli: string): Promise<ClaudeOrg[]> =>
  parseOrgList(await run(cli, ["org", "list"]));

export const useOrg = (cli: string, id: string): Promise<string> =>
  run(cli, ["org", "use", id]);

/** `reclaude org bind <id>` authorizes in the browser and waits for it, so it runs detached. */
export function bindOrg(cli: string, id: string): void {
  spawn(cli, ["org", "bind", id], {
    detached: true,
    stdio: "ignore",
    windowsHide: true,
  }).unref();
}
