/** Fork (2026-11-03): when each managed terminal was last typed into, so smart account switching
 *  never restarts a session under the user's fingers (its unsent input would be lost). */
const lastInput = new Map<string, number>();

export function noteTerminalInput(id: string): void {
  lastInput.set(id, Date.now());
}

/** Milliseconds since `id` was last typed into (Infinity when never). */
export function sinceTerminalInput(id: string, now = Date.now()): number {
  const at = lastInput.get(id);
  return at === undefined ? Infinity : now - at;
}
