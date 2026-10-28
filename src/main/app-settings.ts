import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { readTextOrNull } from "./claude-config";
import type { Locale } from "../shared/locale";
import type { HudSettings } from "../shared/ipc";
import type {
  CleanupRun,
  SessionCleanupSettings,
} from "../shared/session-cleanup";

/** code-by-wire's own settings, stored under Electron's userData — NOT ~/.claude (that's Claude's). */
export interface AppSettings {
  /** Whether to check for app updates on launch. Missing means on; the launch check reads
   *  `read().autoCheckUpdates ?? true`. */
  autoCheckUpdates?: boolean;
  /** Whether the statusLine capture wrapper is installed at launch and active. Missing means on;
   *  callers read `read().statuslineEnabled ?? true`. */
  statuslineEnabled?: boolean;
  /** The app chrome's theme (panels, sidebar, settings, markdown code blocks). Missing means dark;
   *  callers read `read().appTheme ?? "dark"`. */
  appTheme?: "dark" | "light";
  /** The terminal panels' theme (interactive shell rail + observed session terminal), independent
   *  of appTheme. Missing means dark; callers read `read().terminalTheme ?? "dark"`. */
  terminalTheme?: "dark" | "light";
  /** The app's display language ("en" | "zh"). Missing means English; the IPC read runs
   *  normalizeLocale over it, so a persisted alias ("zh-CN") or garbage still reads as a
   *  supported locale. */
  appLocale?: Locale;
  /** The HUD overlay. Missing means on, on the primary display; callers read `hudSettings(read())`. */
  hud?: Partial<HudSettings>;
  /** The HUD's own preferences, set in its Settings window (Agent HUD's General page). */
  hudPanel?: HudPanelSettings;
  /** Automatic session cleanup; read through cleanupSettings() (missing = off, 30 days). */
  sessionCleanup?: Partial<SessionCleanupSettings>;
  /** The last cleanup run, for the Settings card. */
  lastCleanup?: CleanupRun;
}

/** Agent HUD's General page: the HUD windows' appearance and language, and whether quota reads as
 *  used or remaining. Missing fields follow the app (its theme and language) and "consumed". */
export interface HudPanelSettings {
  appearance?: "system" | "light" | "dark";
  language?: "system" | "zh-CN" | "en";
  quotaDisplay?: "consumed" | "remaining";
  /** Agents turned off on the HUD's Agents page. */
  disabledAgents?: string[];
}

/** The HUD preferences with their defaults filled in. */
export function hudSettings(s: AppSettings): HudSettings {
  return {
    enabled: s.hud?.enabled ?? true,
    display: typeof s.hud?.display === "string" ? s.hud.display : null,
  };
}

export interface AppSettingsStore {
  read(): AppSettings;
  setAutoCheckUpdates(enabled: boolean): void;
  setStatuslineEnabled(enabled: boolean): void;
  setAppTheme(theme: "dark" | "light"): void;
  setTerminalTheme(theme: "dark" | "light"): void;
  setAppLocale(locale: Locale): void;
  setHud(hud: HudSettings): void;
  setHudPanel(patch: HudPanelSettings): void;
  setSessionCleanup(next: SessionCleanupSettings): void;
  setLastCleanup(run: CleanupRun): void;
}

export interface AppSettingsDeps {
  /** Directory to store settings.json in (the composition root passes app.getPath("userData")). */
  dir: string;
}

export function createAppSettingsStore(
  deps: AppSettingsDeps,
): AppSettingsStore {
  const file = join(deps.dir, "settings.json");

  function read(): AppSettings {
    const raw = readTextOrNull(file);
    if (raw === null) return {};
    try {
      const v: unknown = JSON.parse(raw);
      return v && typeof v === "object" && !Array.isArray(v) ? v : {};
    } catch {
      return {}; // a corrupt file reads as "no settings" rather than crashing the app
    }
  }

  function write(next: AppSettings): void {
    mkdirSync(deps.dir, { recursive: true });
    writeFileSync(file, JSON.stringify(next, null, 2) + "\n");
  }

  return {
    read,
    setAutoCheckUpdates(enabled) {
      write({ ...read(), autoCheckUpdates: enabled });
    },
    setStatuslineEnabled(enabled) {
      write({ ...read(), statuslineEnabled: enabled });
    },
    setAppTheme(theme) {
      write({ ...read(), appTheme: theme });
    },
    setTerminalTheme(theme) {
      write({ ...read(), terminalTheme: theme });
    },
    setAppLocale(locale) {
      write({ ...read(), appLocale: locale });
    },
    setHud(hud) {
      write({ ...read(), hud });
    },
    setHudPanel(patch) {
      const s = read();
      write({ ...s, hudPanel: { ...s.hudPanel, ...patch } });
    },
    setSessionCleanup(next) {
      write({ ...read(), sessionCleanup: next });
    },
    setLastCleanup(run) {
      write({ ...read(), lastCleanup: run });
    },
  };
}
