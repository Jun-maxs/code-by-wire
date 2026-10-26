import { execFile } from "node:child_process";
import { windowsPowerShell } from "./terminal/windows-system";

const WIN_QUERY =
  'Get-CimInstance Win32_Process | ForEach-Object { "$($_.ProcessId) $($_.ParentProcessId)" }';

/**
 * Fork feature: a pid → parent-pid snapshot of every running process, for following a Managed pty to
 * the claude that runs under it (rotation.ts). A failed or timed-out read resolves to an empty map —
 * the pass then simply follows nothing — never a rejection. Async on purpose: it runs in the sync's
 * beforeSync slot, and the Windows query (CIM via PowerShell) takes the better part of a second.
 */
export function readParentMap(
  platform: NodeJS.Platform = process.platform,
): Promise<Map<number, number>> {
  const [file, args] =
    platform === "win32"
      ? [
          windowsPowerShell(),
          ["-NoProfile", "-NonInteractive", "-Command", WIN_QUERY],
        ]
      : ["ps", ["-A", "-o", "pid=,ppid="]];
  return new Promise((resolve) => {
    execFile(
      file,
      args,
      { windowsHide: true, timeout: 15_000, maxBuffer: 8 * 1024 * 1024 },
      (err, stdout) => resolve(err ? new Map() : parseParentMap(stdout)),
    );
  });
}

/** Parse `<pid> <ppid>` lines (both readers print that shape); anything else is skipped. */
export function parseParentMap(text: string): Map<number, number> {
  const out = new Map<number, number>();
  for (const line of text.split(/\r?\n/)) {
    const m = /^\s*(\d+)\s+(\d+)\s*$/.exec(line);
    if (m) out.set(Number(m[1]), Number(m[2]));
  }
  return out;
}
