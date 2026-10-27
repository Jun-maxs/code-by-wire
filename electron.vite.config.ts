import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { defineConfig } from "electron-vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

// The renderer can't read package.json at runtime, and an IPC round-trip just to
// print the version would flash empty on launch. Bake it in at build time. CI
// gates the release tag against package.json, so this string is the real version.
const { version } = JSON.parse(
  readFileSync(resolve("package.json"), "utf8"),
) as { version: string };

// The HUD overlay page (src/renderer/hud) imports Agent HUD's packages by name; they are vendored
// under it, and Tauri's API is served by shims over the HUD bridge. Most specific prefix first.
const HUD = "src/renderer/hud";
const dir = (p: string) => resolve(p).split("\\").join("/");
const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\/]/g, "\\$&");
/** Map `prefix/<rest>` onto `<target dir>/<rest>`. */
const under = (prefix: string, target: string) => ({
  find: new RegExp(`^${escape(prefix)}/(.*)$`),
  replacement: `${dir(target)}/$1`,
});
/** Map exactly `id` onto one file. */
const exactly = (id: string, file: string) => ({
  find: new RegExp(`^${escape(id)}$`),
  replacement: dir(file),
});
const hudAliases = [
  under("@agent-hud/hud", `${HUD}/vendor/hud/src`),
  under("@agent-hud/ui/components", `${HUD}/vendor/ui/src/ui`),
  under("@agent-hud/ui", `${HUD}/vendor/ui/src`),
  exactly(
    "@agent-hud/protocol/capabilities",
    "src/shared/hud-protocol/capabilities.json",
  ),
  under("@agent-hud/protocol", "src/shared/hud-protocol"),
  exactly("@agent-hud/protocol", "src/shared/hud-protocol/index.ts"),
  exactly("@tauri-apps/api/core", `${HUD}/shim/tauri-core.ts`),
  exactly("@tauri-apps/api/event", `${HUD}/shim/tauri-event.ts`),
  exactly(
    "@tauri-apps/api/webviewWindow",
    `${HUD}/shim/tauri-webview-window.ts`,
  ),
  exactly("@tauri-apps/api/app", `${HUD}/shim/tauri-app.ts`),
  exactly("@tauri-apps/api/window", `${HUD}/shim/tauri-window.ts`),
  exactly("sonner", `${HUD}/shim/sonner.ts`),
];

export default defineConfig({
  main: {
    build: {
      rollupOptions: {
        external: ["better-sqlite3", "node-pty"],
        // Second entry: the transcript parse-worker utilityProcess (src/main/parse-worker/),
        // forked by client.ts as out/main/parse-worker.js.
        input: {
          index: resolve("src/main/index.ts"),
          "parse-worker": resolve("src/main/parse-worker/worker.ts"),
        },
      },
    },
    resolve: {
      alias: { "@shared": resolve("src/shared") },
    },
  },
  preload: {
    resolve: {
      alias: { "@shared": resolve("src/shared") },
    },
  },
  renderer: {
    root: "src/renderer",
    define: { __APP_VERSION__: JSON.stringify(version) },
    plugins: [react(), tailwindcss()],
    resolve: {
      alias: [
        { find: "@shared", replacement: resolve("src/shared") },
        { find: "@renderer", replacement: resolve("src/renderer/src") },
        // The HUD overlay page (src/renderer/hud): Agent HUD's packages, vendored, resolved by the
        // package names their code imports, and Tauri's API served by shims over the HUD bridge.
        ...hudAliases,
      ],
    },
    build: {
      rollupOptions: {
        input: {
          index: resolve("src/renderer/index.html"),
          hud: resolve("src/renderer/hud.html"),
        },
      },
    },
  },
});
