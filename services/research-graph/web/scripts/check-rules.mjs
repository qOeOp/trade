// Structural rules for src/ that tsc cannot express; `npm run check` runs this after tsc and the build
// refuses to start when any fails. Each rule names its reason in the design (README, "Code rules").
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative, dirname, resolve } from "node:path";

const SRC = resolve(dirname(new URL(import.meta.url).pathname), "../src");
const VALIDATED = ["#3871E1", "#4E9D6C", "#C28013", "#B0464F"];  // recommended, meets, misses, fail
const MAX_LINES = 200;
// Which top-level folders a folder may import from (App and main may import anything).
const MAY = {
  theme: [], lib: [], model: ["lib"], icons: ["theme", "model"], state: ["lib", "model"],
  components: ["theme", "icons", "lib", "model", "state"],
  widgets: ["theme", "icons", "lib", "model", "state", "components"],
  shell: ["theme", "icons", "lib", "model", "state", "components", "widgets"],
};
const CHART = /^widgets\/(lineage\/|Progress|Scatter)/;

const files = (dir) => readdirSync(dir).flatMap((n) => {
  const p = join(dir, n);
  return statSync(p).isDirectory() ? files(p) : [p];
});
const all = files(SRC).map((p) => ({ path: p, rel: relative(SRC, p), text: readFileSync(p, "utf8") }));
const code = all.filter((f) => /\.(ts|tsx)$/.test(f.rel));
const failures = [];
const fail = (f, rule, line) => failures.push(`${f.rel}${line ? `:${line}` : ""}  ${rule}`);
const lines = (f, re, rule) => f.text.split("\n").forEach((l, i) => { if (re.test(l)) fail(f, rule, i + 1); });
// className values may use Tailwind arbitrary values with var(--…); strip them before scanning styles.
const withoutClasses = (t) => t.replace(/className=(\{`[^`]*`\}|"[^"]*")/g, "className=\"\"");

for (const f of all) {
  if (f.rel !== "theme/tokens.css" && /\.(ts|tsx|css)$/.test(f.rel))
    lines(f, /#[0-9a-fA-F]{6}\b|#[0-9a-fA-F]{3}\b(?![\w-])|\brgba?\(|\bhsla?\(/, "colour literal outside theme/tokens.css");
}
for (const f of code) {
  const top = f.rel.split("/")[0];
  if (f.rel !== "theme/roles.ts") withoutClasses(f.text).split("\n").forEach((l, i) => { if (/var\(--/.test(l)) fail(f, "var(--…) outside theme/roles.ts (use v() or a role class)", i + 1); });
  if (!f.rel.startsWith("icons/") && !CHART.test(f.rel)) lines(f, /<svg\b/, "<svg> outside icons/ and the chart widgets");
  if (f.rel !== "icons/Icon.tsx") lines(f, /dangerouslySetInnerHTML/, "dangerouslySetInnerHTML outside icons/Icon.tsx");
  if (top !== "components") lines(f, /<button\b|\.Trigger\b/, "<button> or a Radix trigger outside components/");
  if (top !== "components") lines(f, /style=\{\{[^}]*\b(color|background|fill|stroke|border\w*)\s*:/, "colour in an inline style outside components/");
  lines(f, /\b(text|rounded)-\[/, "arbitrary text-[…] or rounded-[…] class (use a token)");
  if (f.rel !== "lib/storage.ts") lines(f, /\blocalStorage\b/, "localStorage outside lib/storage.ts");
  const n = f.text.split("\n").length;
  if (n > MAX_LINES) fail(f, `${n} lines (at most ${MAX_LINES})`);
  for (const m of f.text.matchAll(/from "(\.{1,2}\/[^"]+)"/g)) {
    const target = relative(SRC, resolve(dirname(f.path), m[1])).split("/")[0];
    if (target === top || !(top in MAY)) continue;
    if (!MAY[top].includes(target)) fail(f, `${top}/ may not import ${target}/`);
  }
}
const tokens = readFileSync(join(SRC, "theme/tokens.css"), "utf8");
const data = ["recommended", "meets", "misses", "fail"].map((r) => tokens.match(new RegExp(`--${r}:\\s*(#[0-9A-Fa-f]{6})`))?.[1]?.toUpperCase());
if (data.join() !== VALIDATED.join()) failures.push(`theme/tokens.css  data roles ${data.join(",")} differ from the validated ${VALIDATED.join(",")}: revalidate and update both`);

if (failures.length) { console.error(`check-rules: ${failures.length} failure(s)\n  ${failures.join("\n  ")}`); process.exit(1); }
console.log(`check-rules: ${code.length} source files pass`);
