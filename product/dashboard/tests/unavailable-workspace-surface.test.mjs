import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { bilingualDoc, expectBonded, source } from "./doc-contract.mjs";

test("navigation-only routes use the shared quiet unavailable state", async () => {
  const [component, css] = await Promise.all([
    readFile(new URL("../components/dashboard-route-content.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/globals.css", import.meta.url), "utf8"),
  ]);
  const start = component.indexOf("function UnavailableBlueprint");
  const end = component.indexOf("export function DashboardRouteContent", start);
  assert.ok(start >= 0 && end > start);
  const placeholder = component.slice(start, end);
  assert.match(placeholder, /<UnavailableState[\s\S]+reason=\{maturity\}[\s\S]+density="compact"[\s\S]+surface="card"/u);
  assert.match(placeholder, /No Dashboard data or actions are available here yet\./u);
  assert.match(placeholder, /isn't connected yet/u);
  for (const noise of [
    "Navigation placeholder only",
    "No summary, P/Q/T surface",
    "Foundation prototype",
    "No Dashboard consumer or action is connected",
  ]) assert.doesNotMatch(placeholder, new RegExp(noise, "u"));
  assert.doesNotMatch(css, /\.not-implementable|\.prototype-notice/u);
  assert.match(css, /\.unavailable-state-info\[open\] \{[^}]*grid-template-columns: minmax\(0, 1fr\) 28px;/u);
  assert.match(css, /\.unavailable-state-info\[open\] > code \{[^}]*position: static;/u);
});

test("the bilingual guide names the shared placeholder component the shell renders", async () => {
  const shell = await source("components/dashboard-route-content.tsx");
  expectBonded(await bilingualDoc(), shell, ["UnavailableState"], "navigation-only placeholder");
});
