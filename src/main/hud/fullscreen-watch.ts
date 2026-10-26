import { spawn, type ChildProcess } from "node:child_process";
import { windowsPowerShell } from "../terminal/windows-system";
import { logWarn } from "../log-buffer";

/**
 * Whether a full-screen app (a game, a video, a slideshow) is in front, so the HUD can step aside.
 * Windows only: one hidden PowerShell polls the foreground window once a second and prints `1` or
 * `0` whenever the answer changes. Full screen is either Windows' own notification state
 * (exclusive Direct3D, presentation mode) or a foreground window that covers its whole monitor —
 * which is how borderless-windowed games look. The desktop and taskbar cover their monitor too and
 * never count.
 */

const POLL_MS = 1000;
const RESTART_MS = 5000;

const SCRIPT = `
$ErrorActionPreference = 'Stop'
Add-Type @'
using System;
using System.Runtime.InteropServices;
using System.Text;
public static class CbwFullscreen {
  [StructLayout(LayoutKind.Sequential)] public struct RECT { public int L, T, R, B; }
  [StructLayout(LayoutKind.Sequential)] public struct MONITORINFO { public int cbSize; public RECT rcMonitor; public RECT rcWork; public int dwFlags; }
  [DllImport("user32.dll")] static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll")] static extern bool GetWindowRect(IntPtr h, out RECT r);
  [DllImport("user32.dll")] static extern IntPtr MonitorFromWindow(IntPtr h, int flags);
  [DllImport("user32.dll")] static extern bool GetMonitorInfo(IntPtr m, ref MONITORINFO i);
  [DllImport("user32.dll", CharSet = CharSet.Unicode)] static extern int GetClassName(IntPtr h, StringBuilder s, int n);
  [DllImport("user32.dll")] static extern bool SetProcessDPIAware();
  [DllImport("shell32.dll")] static extern int SHQueryUserNotificationState(out int state);
  public static void Init() { SetProcessDPIAware(); }
  public static bool Now() {
    int quns;
    // 3 = exclusive Direct3D full screen, 4 = presentation mode.
    if (SHQueryUserNotificationState(out quns) == 0 && (quns == 3 || quns == 4)) return true;
    IntPtr h = GetForegroundWindow();
    if (h == IntPtr.Zero) return false;
    StringBuilder cls = new StringBuilder(64);
    GetClassName(h, cls, 64);
    string c = cls.ToString();
    if (c == "Progman" || c == "WorkerW" || c == "Shell_TrayWnd" || c == "Shell_SecondaryTrayWnd") return false;
    RECT w;
    if (!GetWindowRect(h, out w)) return false;
    MONITORINFO mi = new MONITORINFO();
    mi.cbSize = Marshal.SizeOf(typeof(MONITORINFO));
    if (!GetMonitorInfo(MonitorFromWindow(h, 2), ref mi)) return false;
    RECT m = mi.rcMonitor;
    return w.L <= m.L && w.T <= m.T && w.R >= m.R && w.B >= m.B;
  }
}
'@
[CbwFullscreen]::Init()
$last = ''
while ($true) {
  $now = if ([CbwFullscreen]::Now()) { '1' } else { '0' }
  if ($now -ne $last) { [Console]::Out.WriteLine($now); [Console]::Out.Flush(); $last = $now }
  Start-Sleep -Milliseconds ${POLL_MS}
}
`;

/** The state lines in a chunk of the watcher's output; anything else is ignored. */
export function parseFullscreenLines(chunk: string): boolean[] {
  return chunk
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l === "0" || l === "1")
    .map((l) => l === "1");
}

/** Start watching; `onChange` hears every change, starting from the first reading. Returns stop. */
export function watchFullscreen(
  onChange: (fullscreen: boolean) => void,
): () => void {
  if (process.platform !== "win32") return () => {};
  let child: ChildProcess | null = null;
  let stopped = false;
  let restart: NodeJS.Timeout | null = null;

  const run = () => {
    const encoded = Buffer.from(SCRIPT, "utf16le").toString("base64");
    const proc = spawn(
      windowsPowerShell(),
      [
        "-NoProfile",
        "-NonInteractive",
        "-ExecutionPolicy",
        "Bypass",
        "-EncodedCommand",
        encoded,
      ],
      { windowsHide: true, stdio: ["ignore", "pipe", "pipe"] },
    );
    child = proc;
    proc.stdout?.setEncoding("utf8");
    proc.stdout?.on("data", (chunk: string) => {
      for (const state of parseFullscreenLines(chunk)) onChange(state);
    });
    proc.stderr?.setEncoding("utf8");
    proc.stderr?.on("data", (chunk: string) =>
      logWarn("hud-fullscreen", chunk.trim().slice(0, 500)),
    );
    proc.on("error", (e) => logWarn("hud-fullscreen", String(e)));
    proc.on("exit", (code) => {
      if (child === proc) child = null;
      if (stopped) return;
      // The watcher died: show the HUD rather than leave it hidden, and try again shortly.
      logWarn("hud-fullscreen", `watcher exited (${code}); restarting`);
      onChange(false);
      restart = setTimeout(run, RESTART_MS);
    });
  };
  run();

  return () => {
    stopped = true;
    if (restart) clearTimeout(restart);
    child?.kill();
    child = null;
  };
}
