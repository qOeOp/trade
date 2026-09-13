import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";

const componentUrl = new URL("../components/runtime-foundation-not-ready-card.tsx", import.meta.url);
const shellUrl = new URL("../components/dashboard-route-content.tsx", import.meta.url);

test("Runtime surface keeps fixed evidence but presents a compact business state", async () => {
  const source = await readFile(componentUrl, "utf8");
  assert.match(source, /Runtime is not ready yet/);
  for (const label of ["Permissions", "Instance storage", "Artifact checks", "Execution recovery"]) {
    assert.match(source, new RegExp(`label: "${label}"`));
  }
  for (const dependency of [
    "Authorized-generation decision read",
    "Canonical Runtime custody",
    "Compatibility recovery read",
    "Recovery frontier read",
  ]) {
    assert.match(source, new RegExp(dependency));
  }
  for (const evidenceLine of ["#L33-L35", "#L36-L37", "#L38-L39", "#L40-L41"]) {
    assert.match(source, new RegExp(evidenceLine));
  }
  assert.match(source, /73edb0e32f1745cc835951a1b9bd6cb38e456c35/);
  assert.match(source, /96296549794b5b66fb3d730a505cc0551fe80e16/);
  assert.match(source, /<PanelFrameInfo label="View Runtime technical details">/);
  assert.match(source, /Refresh foundation/);
  assert.match(source, /Copy foundation locator/);
  assert.match(source, /<FilterButton density="compact" type="button" variant="outline" onClick=\{\(\) => router\.refresh\(\)\}>/u);
  assert.match(source, /<FilterButton density="compact" type="button" variant="outline" onClick=\{\(\) => void copyLocator\(\)\}>/u);
  assert.match(source, /reason="RUNTIME_FOUNDATION_NOT_READY"/);
});

test("all Runtime routes render the admitted not-ready foundation card", async () => {
  const shell = await readFile(shellUrl, "utf8");
  assert.match(shell, /const runtimeFoundation = current === "\/runtime" \|\| current\.startsWith\("\/runtime\/"\)/);
  assert.match(shell, /runtimeFoundation \? <RuntimeFoundationNotReadyCard \/>/);
  assert.match(shell, /!marketDataFoundation[\s\S]*&& !runtimeFoundation && !portfolioUnavailable && !connected/);
});

test("Runtime composes shared unavailable and data-workspace table atoms", async () => {
  const source = await readFile(componentUrl, "utf8");
  assert.equal(source.match(/<PanelFrameBody/g)?.length, 1);
  assert.match(source, /<UnavailableState/);
  assert.match(source, /<DataWorkspaceTable<RuntimePrerequisite>/);
  assert.match(source, /ariaLabel="Required Runtime services"/);
  for (const column of ["Owner", "Requirement", "Canonical dependency", "State"]) {
    assert.match(source, new RegExp(`name: "${column}"`));
  }
  assert.doesNotMatch(source, /SummaryList|SummaryItem/);
  assert.doesNotMatch(source, /onRowClicked|pointerOnHover|pagination|sortable|filterable/);
  assert.doesNotMatch(source, /className=\{styles\.|\.module\.css/);
});

test("Runtime surface preserves read-only controls without effect actions or noisy primary evidence", async () => {
  const source = await readFile(componentUrl, "utf8");
  assert.doesNotMatch(source, />\s*(Apply|Resolve|Restore|Create instance|Trade|Copy locator|Open dependency)\s*</u);
  assert.doesNotMatch(source, /fetch\(|WebSocket|EventSource|\bcredential\b|\border\b/iu);
  assert.doesNotMatch(source, /PR #330|non-authoritative Runtime foundation|Ordered contract/);
});
