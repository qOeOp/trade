import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";

const componentUrl = new URL("../components/operations-service-logs.tsx", import.meta.url);
const viewportUrl = new URL("../components/ui/bounded-log-viewport.tsx", import.meta.url);
const shellUrl = new URL("../components/dashboard-shell.tsx", import.meta.url);
const cssUrl = new URL("../app/globals.css", import.meta.url);

test("Service Logs composes the fixed frame, status, filters, split, detail, and bounded table", async () => {
  const source = await readFile(componentUrl, "utf8");
  assert.match(source, /<PanelFrame[\s\S]*<PanelFrameHeader[\s\S]*<PanelFrameBody/u);
  assert.match(source, /<CompactStatusBar/u);
  assert.match(source, /className="service-log-filters"/u);
  assert.match(source, /<SplitBento[^>]*columns="minmax\(248px, \.55fr\) minmax\(620px, 1\.45fr\)"/u);
  assert.match(source, /<ServiceInstanceList/u);
  assert.match(source, /<ServiceInstanceCard/u);
  assert.match(source, /<BoundedLogViewport/u);
  assert.match(source, /<DataWorkspaceTable<ServiceLogRow>/u);
  assert.doesNotMatch(source, /heightMode="(?:viewport|equal)"|LogExplorer/u);
});

test("Service Logs uses exact GET/no-store filters, cursor paging, and bounded download", async () => {
  const source = await readFile(componentUrl, "utf8");
  for (const key of ["observedAt", "range", "kind", "service", "instance", "severity", "search", "pageSize", "cursor"]) {
    assert.ok(source.includes(key), `missing ${key}`);
  }
  assert.match(source, /fetch\(`\/api\/operations\/service-logs\/\?\$\{queryFor/u);
  assert.match(source, /fetch\(`\/api\/operations\/service-logs\/download\/\?\$\{downloadQueryFor/u);
  assert.match(source, /query\.delete\("pageSize"\)/u);
  assert.match(source, /x-service-log-cut-digest/u);
  assert.match(source, /blob\.size > 256 \* 1_024/u);
  assert.match(source, /method: "GET",\s*cache: "no-store"/u);
  assert.doesNotMatch(source, /method: "(?:POST|PUT|PATCH|DELETE)"|LogExplorer|OperationalActionEnvelope/iu);
  assert.match(source, /pageSizes = \[20, 50, 100, 200\]/u);
  assert.match(source, /next_cursor/u);
  assert.match(source, /pages\.slice\(0, pageIndex \+ 1\)/u);
  assert.match(source, /if \(pages\[pageIndex \+ 1\]\) setPageIndex/u);
  assert.match(source, /onSelect=\{\(identity\) => replaceFilter\("instance_identity", identity\)\}/u);
  assert.match(source, /const entries: ServiceLogRow\[\] = \(page\?\.entries \?\? \[\]\)/u);
  assert.doesNotMatch(source, /page\?\.entries\.filter\(\(\{ instance_identity \}\)/u);
  assert.match(source, /!serviceLogFilterCutMatchesV1\(parsed\.filter_cut, requestedCut\)/u);
  assert.match(source, /parsed\.page_size !== requestedPageSize/u);
  assert.match(source, /if \(!autoRefresh \|\| pageIndex !== 0\) return undefined/u);
});

test("Service Logs table preserves exact field order, dimensions, and identity-bound row keys", async () => {
  const source = await readFile(componentUrl, "utf8");
  const columns = source.slice(source.indexOf("const columns"), source.indexOf("const viewportState"));
  const expected = [
    ["Timestamp", "190px"], ["Severity", "108px"], ["Service", "190px"],
    ["Instance", "220px"], ["Correlation", "260px"], ["Event", "220px"],
  ];
  let offset = 0;
  for (const [label, width] of expected) {
    const next = columns.indexOf(`>${label}</DataTableHeaderLabel>`, offset);
    assert.ok(next > offset, `${label} must retain its exact position`);
    assert.ok(columns.slice(next, next + 260).includes(width), `${label} must retain ${width}`);
    offset = next;
  }
  assert.match(source, /return `\$\{entry\.correlation_identity\}:\$\{entry\.sequence\}`/u);
  assert.match(source, /keyField="row_identity"/u);
  assert.match(source, /entry\.event_code/u);
  assert.doesNotMatch(source, /entry\.message|instance\.host_ref/u);
});

test("Service Logs keeps unavailable, permission, empty, filtered-empty, partial, and previous-cut states explicit", async () => {
  const source = await readFile(componentUrl, "utf8");
  for (const state of [
    "READING_SERVICE_LOGS", "SERVICE_LOG_RESPONSE_UNAVAILABLE", "SERVICE_LOG_TRANSPORT_UNAVAILABLE",
    "permission denied", "filtered-empty", "Partial evidence", "Previous observation",
  ]) assert.ok(source.includes(state), `missing ${state}`);
  assert.match(source, /setPages\(\[\]\);[\s\S]*setSelectedIdentity\(null\);[\s\S]*setUnavailableReason/u);
});

test("Service Logs suppresses duplicate shell chrome and BoundedLogViewport owns one stable body/footer", async () => {
  const [shell, viewport, css] = await Promise.all([
    readFile(shellUrl, "utf8"), readFile(viewportUrl, "utf8"), readFile(cssUrl, "utf8"),
  ]);
  assert.match(shell, /operationsServiceLogs = current === "\/operations\/service-logs"/u);
  assert.match(shell, /suppressShellPageHeader = operationsSchedules \|\| operationsServiceLogs \|\| embedsRouteChrome/u);
  assert.match(viewport, /data-state=\{state\}/u);
  assert.match(viewport, /bounded-log-viewport-body/u);
  assert.match(viewport, /bounded-log-viewport-footer/u);
  assert.match(css, /\.bounded-log-viewport-body[^}]*min-height: 220px/u);
  assert.match(css, /\.service-logs-body[^}]*display: grid/u);
  assert.doesNotMatch(css, /\.service-logs-layout[^}]*min-height:[^;}]*vh/u);
});
