/** One pty this app run spawned and controls, paired with the OS pid of its `claude` process. */
export interface ManagedPty {
  id: string;
  pid: number;
}

/** A `<pid>.json` registry file's identity: the live `claude` process and the session id it is
 *  currently writing. `/clear` repoints `sessionId` under the same `pid`. */
export interface RegistryEntry {
  pid: number;
  sessionId: string;
  /** The registry's `startedAt` (ms); picks the newest when several sessions run under one pty. */
  startedAt?: number;
}

/** pid → parent pid for every live process: a point-in-time snapshot (process-tree.ts). */
export type ParentMap = ReadonlyMap<number, number>;

/** A managed pty whose Claude session id moved out from under it: same process, new transcript. */
export interface Rotation {
  from: string;
  to: string;
  pid: number;
}

/**
 * Detect the `/clear` rotations among our Managed ptys. A Managed session is anchored to its pty's
 * pid, not to the session id it happened to start with: `/clear` tears down the conversation and
 * starts a fresh Claude session under the SAME process, so `<pid>.json` repoints its `sessionId`
 * while the pid (and our pty) live on. We follow the process to the new id so the live session stays
 * Managed instead of being misread as a brand-new Observed one.
 *
 * A pid with no current registry entry yields NO rotation: absence is a (possibly transient) dead
 * process, which the alive→Ended path already handles. Only a present-but-different sessionId is a
 * rotation.
 *
 * Fork feature: given a process snapshot (`parents`), a pty with no registry entry of its own is also
 * followed to the claude running BELOW it. On Windows the pty process is cmd.exe / rec.exe, never claude
 * itself, so `/clear` only shows up there; and a "with remote" session runs under HAPI, whose phone
 * takeover kills the local claude and starts a new one — on a fresh id when nothing was sent locally
 * yet. A live entry belongs to the pty when its parent chain reaches the pty before any other
 * registered claude (a `claude -p` run from inside a session is that session's child, not a takeover),
 * and it counts only while no process under the pty still runs the managed id itself.
 */
export function detectRotations(
  managed: ManagedPty[],
  registry: RegistryEntry[],
  parents?: ParentMap,
): Rotation[] {
  const sessionByPid = new Map<number, string>();
  for (const r of registry) sessionByPid.set(r.pid, r.sessionId);
  const taken = new Set(managed.map((m) => m.id));

  const rotations: Rotation[] = [];
  for (const { id, pid } of managed) {
    const current = sessionByPid.get(pid);
    if (current !== undefined) {
      if (current !== id) rotations.push({ from: id, to: current, pid });
      continue;
    }
    if (!parents) continue;
    const below = registry.filter(
      (r) => parents.has(r.pid) && runsUnder(r.pid, pid, parents, sessionByPid),
    );
    if (below.some((r) => r.sessionId === id)) continue;
    const next = below
      .filter((r) => !taken.has(r.sessionId))
      .sort((a, b) => (b.startedAt ?? 0) - (a.startedAt ?? 0))[0];
    if (next) {
      rotations.push({ from: id, to: next.sessionId, pid });
      taken.add(next.sessionId);
    }
  }
  return rotations;
}

/** Whether `pid`'s parent chain reaches `root` before passing through another live registered claude. */
function runsUnder(
  pid: number,
  root: number,
  parents: ParentMap,
  registered: ReadonlyMap<number, string>,
): boolean {
  let p = parents.get(pid);
  for (let hops = 0; p !== undefined && hops < 32; hops++) {
    if (p === root) return true;
    if (registered.has(p) && parents.has(p)) return false;
    p = parents.get(p);
  }
  return false;
}

/** Reads the process snapshot for `detectRotations`, at most once per newly seen registry entry. */
export interface ProcessTreeRead {
  read: () => Promise<ParentMap>;
  /** `pid:sessionId` of entries already checked against a snapshot; owned by the caller across passes. */
  seen: Set<string>;
}

/** The minimum a registry must expose for rotation reconciliation: its managed ptys and a way to re-key one. */
export interface RenamableRegistry {
  entries(): ManagedPty[];
  rename(from: string, to: string): void;
}

/**
 * Reconcile this run's Managed ptys against the on-disk session registry and follow every `/clear`
 * rotation: relabel the registry (so the provider's next sync calls the pty Managed under its new id and
 * leaves the abandoned id to derive as an Ended, resumable ghost), then fire `rename` to re-key the live
 * pty and hand the rotation to the renderer. Runs before each sync, so the relabel lands the same tick.
 *
 * `readRegistry` is lazy: with no Managed pty this run, nothing can have rotated, so we skip the on-disk
 * read entirely — the common case (browsing Observed sessions, no terminal open) costs nothing. It may
 * be async so the composition root can route the sweep through the parse worker.
 *
 * `tree` (fork feature) is lazier still: the process snapshot is read only when the registry holds an
 * unmanaged session not yet checked, so a steady state costs no extra process spawn.
 */
export async function applyRotations(
  managed: RenamableRegistry,
  readRegistry: () => Promise<RegistryEntry[]> | RegistryEntry[],
  rename: (from: string, to: string) => void,
  tree?: ProcessTreeRead,
): Promise<Rotation[]> {
  const managedPtys = managed.entries();
  if (managedPtys.length === 0) return [];
  const registry = await readRegistry();
  let parents: ParentMap | undefined;
  if (tree) {
    const ids = new Set(managedPtys.map((m) => m.id));
    const unseen = registry
      .filter((r) => !ids.has(r.sessionId))
      .map((r) => `${r.pid}:${r.sessionId}`)
      .filter((key) => !tree.seen.has(key));
    if (unseen.length > 0) {
      parents = await tree.read();
      // An empty snapshot is a failed read: leave the entries unseen so the next pass retries.
      if (parents.size > 0) for (const key of unseen) tree.seen.add(key);
    }
  }
  const rotations = detectRotations(managedPtys, registry, parents);
  for (const { from, to } of rotations) {
    managed.rename(from, to);
    rename(from, to);
  }
  return rotations;
}
