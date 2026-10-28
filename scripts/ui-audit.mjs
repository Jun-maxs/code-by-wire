// Count the visual values the renderer's components use (fork tool, 2026-10-28): font sizes, text and
// surface colors, raw color literals, radii. Run before and after a design pass to show the spread
// shrinking. `node scripts/ui-audit.mjs [--files]` — --files adds the per-file offenders.
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

const ROOT = "src/renderer/src";
const SKIP = ["hud/vendor", "hud\\vendor"];

const files = [];
(function walk(d) {
  for (const e of readdirSync(d)) {
    const p = join(d, e);
    if (SKIP.some((s) => p.includes(s))) continue;
    if (statSync(p).isDirectory()) walk(p);
    else if (/\.tsx?$/.test(e)) files.push(p);
  }
})(ROOT);

const RULES = {
  "arbitrary font size": /\btext-\[\d[\d.]*(?:rem|px|em)\]/g,
  "raw color literal": /#[0-9a-fA-F]{6}(?:[0-9a-fA-F]{2})?|rgba?\([^)]*\)/g,
  "tailwind palette color":
    /\b(?:text|bg|border|ring|fill|stroke|from|to|via)-(?:red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose|slate|gray|zinc|neutral|stone)-\d{2,3}\b/g,
  "font size token":
    /\btext-(?:micro|label|meta|aux|body|subhead|title|heading|display|xs|sm|base|lg|xl|2xl|3xl)\b/g,
  "text color":
    /\btext-(?:fg(?:-muted|-faint)?|\(--ui-text-[a-z]+\)|ink-\d+|accent|danger|ok|working|idle|primary)\b/g,
  "surface color": /\bbg-(?:ink-\d+|well|sidebar|\(--ui-[a-z-]+\)|primary)\b/g,
  "border color":
    /\bborder-(?:ink-\d+|\(--ui-stroke-[a-z]+\)|sidebar-border)\b/g,
  radius:
    /\brounded(?:-(?:none|xs|sm|md|lg|xl|2xl|3xl|4xl|full|\[[^\]]+\]))?\b/g,
};

const total = {};
const perFile = {};
for (const f of files) {
  const src = readFileSync(f, "utf8");
  for (const [rule, re] of Object.entries(RULES)) {
    for (const m of src.matchAll(re)) {
      const v = m[0];
      (total[rule] ??= {})[v] ??= 0;
      total[rule][v]++;
      if (
        [
          "arbitrary font size",
          "raw color literal",
          "tailwind palette color",
        ].includes(rule)
      ) {
        const k = relative(".", f).replaceAll("\\", "/");
        (perFile[rule] ??= {})[k] ??= 0;
        perFile[rule][k]++;
      }
    }
  }
}

for (const [rule, values] of Object.entries(total)) {
  const entries = Object.entries(values).sort((a, b) => b[1] - a[1]);
  const uses = entries.reduce((n, [, c]) => n + c, 0);
  console.log(`\n## ${rule} — ${entries.length} distinct, ${uses} uses`);
  for (const [v, c] of entries.slice(0, 14))
    console.log(`  ${String(c).padStart(4)}  ${v}`);
  if (entries.length > 14) console.log(`  … ${entries.length - 14} more`);
}
if (process.argv.includes("--files"))
  for (const [rule, byFile] of Object.entries(perFile)) {
    console.log(`\n## files with ${rule}`);
    for (const [f, c] of Object.entries(byFile).sort((a, b) => b[1] - a[1]))
      console.log(`  ${String(c).padStart(4)}  ${f}`);
  }
