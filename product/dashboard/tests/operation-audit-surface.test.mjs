import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";

const audit = await readFile(new URL("../components/operations-audit.tsx", import.meta.url), "utf8");
const shell = await readFile(new URL("../components/dashboard-route-content.tsx", import.meta.url), "utf8");
const css = await readFile(new URL("../app/globals.css", import.meta.url), "utf8");
const listRoute = await readFile(new URL("../app/api/operations/audit/route.ts", import.meta.url), "utf8");
const detailRoute = await readFile(new URL("../app/api/operations/audit/[auditIdentity]/route.ts", import.meta.url), "utf8");
const gateway = await readFile(new URL("../lib/operation-audit-gateway.ts", import.meta.url), "utf8");

test("Operations Audit composes shared card, status, table and detail atoms", () => {
  for (const atom of [
    "PanelFrame", "PanelFrameHeader", "PanelFrameBody", "PanelFrameFooter",
    "CompactStatusBar", "CompactStatusGroup", "CompactStatusItem",
    "DataWorkspaceTable", "DataWorkspaceEmpty", "DetailInspector", "DetailCluster",
  ]) assert.match(audit, new RegExp(`<${atom}(?:<|[\\s>])`));
  assert.match(audit, /actions=\{<><PanelFrameInfo[\s\S]*<FilterButton density="compact" variant="secondary"/u);
  assert.match(audit, /label="activity"[\s\S]*label="execute"[\s\S]*label="create \/ update"[\s\S]*label="delete"/u);
  assert.match(audit, /label="outcome"[\s\S]*label="succeeded"[\s\S]*label="failed \/ denied"/u);
  assert.match(audit, /\(page\?\.operations \?\? \[\]\)\.map/u);
  assert.doesNotMatch(audit, />IMPLEMENTATION_ADMITTED|Owner state is never inferred|Operational clock/u);
  assert.doesNotMatch(audit, /Resolve same identity|Open Owner view|Download|Retry|Replay/u);
});

test("Operations Audit owns one transparent header and one responsive inset body", () => {
  assert.match(shell, /const operationsAudit = current === "\/operations\/audit"/u);
  assert.match(shell, /suppressShellPageHeader = [^;]*operationsAudit/u);
  assert.match(shell, /operationsAudit \? <OperationsAudit \/>/u);
  assert.match(css, /\.operation-audit-body \{[^}]*display: grid[^}]*background: transparent/u);
  assert.match(css, /\.operation-audit-layout \{[^}]*grid-template-columns: minmax\(660px, 1\.55fr\) minmax\(340px, \.75fr\)/u);
  assert.match(css, /@media \(max-width: 1279px\)[\s\S]*\.operation-audit-layout \{ grid-template-columns: 1fr; \}/u);
  assert.match(css, /@media \(max-width: 767px\)[\s\S]*\.operation-audit-filters \{ grid-template-columns: minmax\(112px, 1fr\)/u);
});

test("Operations Audit API remains GET-only and no-store", () => {
  for (const route of [listRoute, detailRoute]) {
    assert.match(route, /export async function GET/u);
    assert.match(route, /["']cache-control["']:\s*["']no-store["']/iu);
    assert.doesNotMatch(route, /export async function (?:POST|PUT|PATCH|DELETE)/u);
  }
});

test("Operations Audit uses the shared Dashboard cursor authority", () => {
  assert.match(gateway, /process\.env\.DASHBOARD_CURSOR_HMAC_KEY/u);
  assert.doesNotMatch(gateway, /DASHBOARD_RUN_CURSOR_HMAC_KEY/u);
});
