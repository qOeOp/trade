import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";

const componentUrl = new URL("../components/runtime-foundation-not-ready-card.tsx", import.meta.url);
const shellUrl = new URL("../components/dashboard-shell.tsx", import.meta.url);

test("Runtime surface keeps fixed evidence but presents a compact business state", async () => {
  const source = await readFile(componentUrl, "utf8");
  assert.match(source, /Runtime is not ready yet/);
  for (const label of ["Permissions", "Instance storage", "Artifact checks", "Execution recovery"]) {
    assert.match(source, new RegExp(`label: "${label}"`));
  }
  assert.match(source, /73edb0e32f1745cc835951a1b9bd6cb38e456c35/);
  assert.match(source, /96296549794b5b66fb3d730a505cc0551fe80e16/);
  assert.match(source, /<PanelFrameInfo label="View Runtime technical details">/);
  assert.match(source, /reason="RUNTIME_FOUNDATION_NOT_READY"/);
});

test("all Runtime routes render the admitted not-ready foundation card", async () => {
  const shell = await readFile(shellUrl, "utf8");
  assert.match(shell, /const runtimeFoundation = current === "\/runtime" \|\| current\.startsWith\("\/runtime\/"\)/);
  assert.match(shell, /runtimeFoundation \? <RuntimeFoundationNotReadyCard \/>/);
  assert.match(shell, /!marketDataFoundation[\s\S]*&& !runtimeFoundation && !portfolioUnavailable \? <footer/);
});

test("Runtime composes shared unavailable and summary-list atoms", async () => {
  const source = await readFile(componentUrl, "utf8");
  assert.equal(source.match(/<PanelFrameBody/g)?.length, 1);
  assert.match(source, /<UnavailableState/);
  assert.match(source, /<SummaryList aria-label="Required Runtime services">/);
  assert.match(source, /<SummaryItem/);
  assert.doesNotMatch(source, /className=\{styles\.|\.module\.css/);
});

test("Runtime surface exposes no effect or noisy primary evidence controls", async () => {
  const source = await readFile(componentUrl, "utf8");
  assert.doesNotMatch(source, />\s*(Apply|Resolve|Restore|Create instance|Trade|Copy locator|Open dependency)\s*</u);
  assert.doesNotMatch(source, /fetch\(|WebSocket|EventSource|\bcredential\b|\border\b/iu);
  assert.doesNotMatch(source, /PR #330|non-authoritative Runtime foundation|Ordered contract/);
});
