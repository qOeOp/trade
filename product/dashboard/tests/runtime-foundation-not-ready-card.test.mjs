import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";

const componentUrl = new URL("../components/runtime-foundation-not-ready-card.tsx", import.meta.url);
const shellUrl = new URL("../components/dashboard-shell.tsx", import.meta.url);
const cssUrl = new URL("../components/runtime-foundation-not-ready-card.module.css", import.meta.url);
const globalCssUrl = new URL("../app/globals.css", import.meta.url);

test("Runtime foundation card preserves the fixed source identity and dependency order", async () => {
  const source = await readFile(componentUrl, "utf8");
  const dependencies = [
    "Authorized-generation decision read",
    "Canonical Runtime custody",
    "Compatibility recovery read",
    "Recovery frontier read",
  ];
  let cursor = -1;
  for (const dependency of dependencies) {
    const next = source.indexOf(`\"${dependency}\"`, cursor + 1);
    assert.ok(next > cursor, `missing or reordered dependency: ${dependency}`);
    cursor = next;
  }
  assert.match(source, /73edb0e32f1745cc835951a1b9bd6cb38e456c35/);
  assert.match(source, /96296549794b5b66fb3d730a505cc0551fe80e16/);
  assert.equal(source.match(/Open dependency/g)?.length, 1);
  assert.match(source, /dependencies\.map/);
  assert.match(source, /<PanelFrame[\s\S]*<PanelFrameHeader[\s\S]*<PanelFrameBody[\s\S]*<PanelFrameFooter/);
});

test("all Runtime routes render the admitted fixed not-ready foundation card", async () => {
  const shell = await readFile(shellUrl, "utf8");
  assert.match(shell, /const runtimeFoundation = current === "\/runtime" \|\| current\.startsWith\("\/runtime\/"\)/);
  assert.match(shell, /runtimeFoundation \? <RuntimeFoundationNotReadyCard \/>/);
  assert.match(shell, /CURRENT\/PARTIAL - FOUNDATION_NOT_READY/);
});

test("Runtime card uses compact grouped theme surfaces without a literal palette", async () => {
  const css = await readFile(cssUrl, "utf8");
  const globalCss = await readFile(globalCssUrl, "utf8");
  const source = await readFile(componentUrl, "utf8");
  assert.match(source, /<CompactStatusBar aria-label="Runtime foundation status">/u);
  assert.match(source, /<CompactStatusGroup label="foundation">/u);
  assert.match(source, /<CompactStatusItem label="state" value="not ready" tone="warning" \/>/u);
  assert.match(source, /<CompactStatusItem label="dependencies" value="4 required" \/>/u);
  assert.match(source, /<CompactStatusItem label="source revision"/u);
  assert.match(globalCss, /\.compact-status-bar \{[^}]*display: grid;[^}]*gap: 12px;/u);
  assert.doesNotMatch(globalCss, /\.compact-status-bar \{[^}]*(?:border|border-radius|background):/u);
  assert.match(globalCss, /\.compact-status-item\[data-tone="warning"\] dd \{ color: var\(--status-warning\); \}/u);
  assert.doesNotMatch(css, /\.statusBar|\.statusIcon/u);
  assert.match(css, /\.sectionHeader \{[\s\S]*background: color-mix\(in oklch, var\(--status-warning\) 5%, var\(--panel-chrome-bg\)\)/);
  assert.match(css, /\.dependencies li \+ li \{[\s\S]*border-top:/);
  assert.doesNotMatch(css + globalCss, /#[\da-f]{3,8}\b|\brgb\(|\bhsl\(/iu);
});

test("Runtime card exposes no unadmitted readiness or effect surface", async () => {
  const source = await readFile(componentUrl, "utf8");
  assert.doesNotMatch(source, /RuntimeReadinessCard|RuntimeApplicationCard|Strategy Instance row|CheckpointTable|RuntimeIncidentTable/);
  assert.doesNotMatch(source, />\s*(Apply|Resolve|Restore|Create instance|Trade)\s*</u);
  assert.doesNotMatch(source, /fetch\(|WebSocket|EventSource|\bprovider\b|\bcredential\b|\border\b/iu);
  assert.match(source, /from "\.\/ui\/iconography"/);
  assert.doesNotMatch(source, /from "lucide-react"/);
});
