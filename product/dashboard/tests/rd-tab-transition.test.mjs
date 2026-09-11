import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("module tabs use client navigation and settle their active position before paint", async () => {
  const source = await readFile(new URL("../components/module-tab-links.tsx", import.meta.url), "utf8");

  assert.match(source, /import Link from "next\/link";/u);
  assert.match(source, /useLayoutEffect\(\(\) =>/u);
  assert.match(source, /nav\.scrollLeft = Math\.max\(0, active\.offsetLeft/u);
  assert.match(source, /return <Link[\s\S]*href=\{tab\.href\}/u);
  assert.doesNotMatch(source, /return <a|scrollIntoView|useEffect/u);
});

test("every R&D top tab owns one stable card-level route header", async () => {
  const shell = await readFile(new URL("../components/dashboard-route-content.tsx", import.meta.url), "utf8");

  assert.match(shell, /const rdPlaceholderRoute = current === "\/rd\/hypotheses" \|\| current === "\/rd\/decisions";/u);
  assert.match(shell, /const ownsRouteChrome = embedsRouteChrome \|\| rdPlaceholderRoute;/u);
  assert.match(shell, /<PanelFrame className="rd-placeholder-panel">[\s\S]*<PanelFrameHeader eyebrow="R&D" title=\{routeLabel\}/u);
  assert.match(shell, /<PanelFrameBody density="compact">\{unavailable\}<\/PanelFrameBody>/u);
  assert.match(shell, /routeLabel=\{rdPlaceholderRoute \? page\.label : undefined\}/u);
  assert.match(shell, /\{suppressShellPageHeader \? <h1 className="sr-only">/u);
});
