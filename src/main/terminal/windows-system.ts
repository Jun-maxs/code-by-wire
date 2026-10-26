/** Absolute path of a program in Windows' System32. node-pty (and CreateProcess) resolve a bare
 *  `cmd.exe` against the main process's PATH, which is missing System32 when the app is launched
 *  from a stripped environment — the session then fails with "File not found: cmd.exe". The Windows
 *  folder comes from `SystemRoot` (`windir` as a fallback), so a non-C: install still resolves. */
export function windowsSystemTool(
  name: string,
  env: NodeJS.ProcessEnv = process.env,
): string {
  const root = env.SystemRoot || env.windir || "C:\\Windows";
  return `${root.replace(/[\\/]+$/, "")}\\System32\\${name}`;
}

/** The Windows PowerShell 5.1 host, which ships in every supported Windows. */
export function windowsPowerShell(
  env: NodeJS.ProcessEnv = process.env,
): string {
  return windowsSystemTool("WindowsPowerShell\\v1.0\\powershell.exe", env);
}
