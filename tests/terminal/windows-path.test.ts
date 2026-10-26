import { describe, expect, it } from "vitest";
import {
  mergeWindowsPath,
  parseRegPath,
  restoreWindowsPath,
} from "../../src/main/terminal/windows-path";
import {
  windowsPowerShell,
  windowsSystemTool,
} from "../../src/main/terminal/windows-system";

const REG_OUT = `
HKEY_CURRENT_USER\\Environment
    Path    REG_EXPAND_SZ    %USERPROFILE%\\bin;C:\\Users\\me\\AppData\\Roaming\\npm
`;

describe("windowsSystemTool", () => {
  it("names System32 under SystemRoot, then windir, then C:\\Windows", () => {
    expect(windowsSystemTool("cmd.exe", { SystemRoot: "D:\\Win\\" })).toBe(
      "D:\\Win\\System32\\cmd.exe",
    );
    expect(windowsSystemTool("cmd.exe", { windir: "E:\\W" })).toBe(
      "E:\\W\\System32\\cmd.exe",
    );
    expect(windowsSystemTool("cmd.exe", {})).toBe(
      "C:\\Windows\\System32\\cmd.exe",
    );
    expect(windowsPowerShell({})).toBe(
      "C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe",
    );
  });
});

describe("parseRegPath", () => {
  it("reads the Path value of reg query output", () => {
    expect(parseRegPath(REG_OUT)).toBe(
      "%USERPROFILE%\\bin;C:\\Users\\me\\AppData\\Roaming\\npm",
    );
    expect(parseRegPath("ERROR: The system was unable to find")).toBeNull();
  });
});

describe("mergeWindowsPath", () => {
  it("appends only the missing dirs, expanding %VAR% and ignoring case", () => {
    const merged = mergeWindowsPath(
      "C:\\Windows\\System32;c:\\users\\me\\bin",
      ["C:\\WINDOWS\\system32;%USERPROFILE%\\bin;%NOPE%\\x;C:\\tools"],
      { USERPROFILE: "C:\\Users\\me" },
    );
    expect(merged).toBe(
      "C:\\Windows\\System32;c:\\users\\me\\bin;%NOPE%\\x;C:\\tools",
    );
  });

  it("skips entries decoded with a replacement character", () => {
    expect(mergeWindowsPath("", ["C:\\\uFFFD\\bin;C:\\ok"], {})).toBe("C:\\ok");
  });
});

describe("restoreWindowsPath", () => {
  it("merges the machine and user values into env.PATH", () => {
    const env: NodeJS.ProcessEnv = {
      PATH: "C:\\a",
      USERPROFILE: "C:\\Users\\me",
    };
    restoreWindowsPath(env, (key) =>
      key.startsWith("HKLM")
        ? "    Path    REG_SZ    C:\\Windows\\System32;C:\\a"
        : REG_OUT,
    );
    expect(env.PATH).toBe(
      "C:\\a;C:\\Windows\\System32;C:\\Users\\me\\bin;C:\\Users\\me\\AppData\\Roaming\\npm",
    );
  });

  it("leaves PATH alone when the registry can't be read", () => {
    const env: NodeJS.ProcessEnv = { PATH: "C:\\a" };
    restoreWindowsPath(env, () => {
      throw new Error("reg failed");
    });
    expect(env.PATH).toBe("C:\\a");
  });
});
