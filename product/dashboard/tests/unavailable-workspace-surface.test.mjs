import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

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

test("bilingual architecture keeps placeholder maturity technical and primary copy quiet", async () => {
  for (const suffix of ["", ".zh"]) {
    const doc = await readFile(new URL(`../../../docs/guide/dashboard${suffix}.md`, import.meta.url), "utf8");
    const sentence = suffix
      ? "navigation-only route 只使用共享 `UnavailableState`"
      : "navigation-only route uses only the shared `UnavailableState`";
    assert.ok(doc.includes(sentence), `${suffix || "en"} missing quiet placeholder contract`);
  }
});
