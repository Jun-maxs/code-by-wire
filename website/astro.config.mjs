// website/astro.config.mjs
import { defineConfig } from "astro/config";
import tailwindcss from "@tailwindcss/vite";
import sitemap from "@astrojs/sitemap";

export default defineConfig({
  site: "https://cbw.liyu.dev",
  base: "/",
  trailingSlash: "always",
  output: "static",
  build: {
    inlineStylesheets: "always",
  },
  integrations: [sitemap()],
  vite: {
    plugins: [tailwindcss()],
  },
});
