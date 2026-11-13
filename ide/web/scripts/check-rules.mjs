// Structural rules for src/ that tsc cannot express; `npm run check` runs this after tsc and the build
// refuses to start when any fails. Spacing, control heights and sizes follow the design language in
// docs/plans/ide-design-language.zh.md; each rule says why beside it.
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative, dirname, resolve } from "node:path";

const SRC = resolve(dirname(new URL(import.meta.url).pathname), "../src");
// recommended, meets, misses, fail, per theme (a single hex in tokens.css is both themes)
const VALIDATED = { light: ["#3871E1", "#36956D", "#B87701", "#A63D47"], dark: ["#3871E1", "#4AA87F", "#BE880A", "#BE5354"] };
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
// Spacing takes the eight steps of the design language (1, 2, 4, 6, 8, 12, 16 and 24px), so every island,
// card and row lines up on one 4px grid; a token (`p-(--gap)`), a safe-area inset (`pb-[env(…)]`, alone or
// plus a step) or an `em` that scales with its text is the only other spacing.
const SPACE = /(?<![\w-])((?:[\w@/&[\]_*:-]+:)*)-?(p|px|py|pt|pb|pl|pr|ps|pe|m|mx|my|mt|mb|ml|mr|ms|me|gap|gap-x|gap-y|space-x|space-y)-(\[[^\]\s]*\]|\([^)\s]*\)|[\d.]+|px|auto)(?![\w.\[(-])/g;
const STEPS = new Set(["0", "px", "0.5", "1", "1.5", "2", "3", "4", "6", "auto"]);
const PX_STEPS = ["0", "1", "2", "4", "6", "8", "12", "16", "24"];
const pxOf = (n, unit) => String(unit === "rem" ? +n * 16 : +n);
const TOKENS = readFileSync(join(SRC, "theme/tokens.css"), "utf8");
const freeSpace = (v) => (v.startsWith("(--") && TOKENS.includes(`${v.slice(1, -1)}:`)) || /^\[-?[\d.]+em\]$/.test(v)
  || (/^\[.*env\(safe-area-inset-\w+\).*\]$/.test(v) && [...v.matchAll(/([\d.]+)(px|rem)/g)].every(([, n, u]) => PX_STEPS.includes(pxOf(n, u))));
// Comments say what classes do; only code is checked. Blanked in place, so line numbers hold.
const uncommented = (t) => t.replace(/\/\*[\s\S]*?\*\/|(?<![:"'`\w])\/\/[^\n]*/g, (c) => c.replace(/[^\n]/g, " "));
// Breakpoints switch layout only: sizes for a thumb come from :root[data-phone], never the viewport width.
const SIZED_BY_VIEWPORT = /(?<![\w-])(?:[\w-]+:)*(?:max-)?(?:sm|md|lg|xl|2xl|min-\[[^\]]+\]|max-\[[^\]]+\]):(?:[\w-]+:)*-?(?:(?:h|min-h|size)-(?:[\d.]+|\(|\[)|(?:p|px|py|pt|pb|pl|pr|m|mx|my|mt|mb|ml|mr|gap|gap-x|gap-y|space-x|space-y)-|text-(?:value|h1|h2|ui|dense|small|badge)\b)/;
// A control's height is the control's own (20, 24, 28 or 32px): a caller never stretches it. Every string in
// the opening tag is read, so a class built in a ternary or a helper call counts too.
const CONTROL = /<(FormButton|IconButton|TextButton)\b((?:=>|[^>])*?)\/?>/g;
const STRETCHED = /(?<![\w-])(?:[\w-]+:)*(min-h|h|size)-/;
const lineOf = (text, at) => text.slice(0, at).split("\n").length;
for (const f of code) {
  const text = uncommented(f.text);
  for (const m of text.matchAll(SPACE)) if (!STEPS.has(m[3]) && !freeSpace(m[3])) fail(f, `spacing ${m[0].trim()} off the design steps`, lineOf(text, m.index));
  text.split("\n").forEach((l, i) => {
    if (SIZED_BY_VIEWPORT.test(l)) fail(f, "a viewport breakpoint sizing a control, text or spacing (use :root[data-phone] tokens)", i + 1);
    if (/\[&_(button|input|select)\]:(min-h|h|size)-/.test(l)) fail(f, "a descendant selector stretching controls", i + 1);
  });
  for (const m of text.matchAll(CONTROL))
    if ([...m[2].matchAll(/"([^"]*)"|`([^`]*)`/g)].some((q) => STRETCHED.test(q[1] ?? q[2]))) fail(f, `<${m[1]}> given a height by its caller`, lineOf(text, m.index));
  // Inline styles keep to the same steps: a literal padding, margin or gap (a number, or a string in px) is one of them.
  for (const style of text.matchAll(/style=\{\{([\s\S]*?)\}\}/g)) for (const m of style[1].matchAll(/\b(padding\w*|margin\w*|gap|rowGap|columnGap)\s*:\s*([^,\n]*)/g))
    for (const n of m[2].matchAll(/(?<![\w.$-])(\d+(?:\.\d+)?)(px|rem)?(?![\w.])/g)) if (!PX_STEPS.includes(pxOf(n[1], n[2]))) fail(f, `inline ${m[1]} ${n[0]} off the design steps`, lineOf(text, style.index));
}
// Stylesheets other than the tokens take type sizes from the tokens and spacing from the same steps; a
// custom property (--vl-gap) is a value, not spacing, and comments are skipped.
for (const f of all.filter((x) => x.rel.endsWith(".css") && x.rel !== "theme/tokens.css")) {
  uncommented(f.text).split("\n").forEach((l, i) => {
    for (const m of l.matchAll(/(?<![\w-])font(-size)?:\s*([^;}]*)/g))
      if (m[1] ? !/^(var\(--size-|[\d.]+em\b|inherit|100%)/.test(m[2]) : /\d(px|rem)\b/.test(m[2])) fail(f, "font size not from a --size-* token", i + 1);
    for (const m of l.matchAll(/(?<![\w-])(padding|margin|gap)[\w-]*:\s*([^;}]*)/g))
      for (const n of m[2].matchAll(/-?(\d+(?:\.\d+)?)(px|rem)/g)) if (!PX_STEPS.includes(pxOf(n[1], n[2]))) fail(f, `${m[1]} ${n[0]} off the design steps`, i + 1);
  });
}
const tokens = TOKENS;
const HEX = "(#[0-9A-Fa-f]{6})";
const data = ["recommended", "meets", "misses", "fail"].map((r) => {
  const m = tokens.match(new RegExp(`--${r}:\\s*(?:${HEX}|light-dark\\(${HEX},\\s*${HEX}\\))\\s*;`));
  return m ? [m[1] ?? m[2], m[1] ?? m[3]].map((h) => h.toUpperCase()) : [undefined, undefined];
});
for (const [i, theme] of ["light", "dark"].entries()) {
  const got = data.map((d) => d[i]);
  if (got.join() !== VALIDATED[theme].join()) failures.push(`theme/tokens.css  ${theme} data roles ${got.join(",")} differ from the validated ${VALIDATED[theme].join(",")}: revalidate and update both`);
}

if (failures.length) { console.error(`check-rules: ${failures.length} failure(s)\n  ${failures.join("\n  ")}`); process.exit(1); }
console.log(`check-rules: ${code.length} source files pass`);
