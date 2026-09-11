import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const [layout, loading, chrome, route, navigation, workers, runs, schedules, artifacts, dialog, filterToolbar, runDetail, css] = await Promise.all([
  readFile(new URL("../app/(dashboard)/layout.tsx", import.meta.url), "utf8"),
  readFile(new URL("../app/(dashboard)/loading.tsx", import.meta.url), "utf8"),
  readFile(new URL("../components/dashboard-chrome.tsx", import.meta.url), "utf8"),
  readFile(new URL("../components/dashboard-route-content.tsx", import.meta.url), "utf8"),
  readFile(new URL("../components/module-navigation.tsx", import.meta.url), "utf8"),
  readFile(new URL("../components/operations-workers-preview.tsx", import.meta.url), "utf8"),
  readFile(new URL("../components/operations-runstore-preview.tsx", import.meta.url), "utf8"),
  readFile(new URL("../components/operations-schedules-preview.tsx", import.meta.url), "utf8"),
  readFile(new URL("../components/artifact-directory.tsx", import.meta.url), "utf8"),
  readFile(new URL("../components/ui/schedule-calendar/dialogs/schedule-inspection-dialog.tsx", import.meta.url), "utf8"),
  readFile(new URL("../components/ui/filter-toolbar.tsx", import.meta.url), "utf8"),
  readFile(new URL("../components/operations-run-detail.tsx", import.meta.url), "utf8"),
  readFile(new URL("../app/globals.css", import.meta.url), "utf8"),
]);

test("Dashboard chrome persists while one route outlet owns loading and content", () => {
  assert.match(layout, /<DashboardChrome>\{children\}<\/DashboardChrome>/u);
  assert.match(chrome, /className="dashboard-shell"[\s\S]+className="page-viewport"/u);
  assert.match(loading, /data-dashboard-route-loading/);
  assert.match(loading, /aria-busy="true"/);
  assert.match(route, /data-dashboard-route=\{current\}/u);
  assert.doesNotMatch(route, /className="dashboard-shell"|className="page-viewport"/u);
  assert.match(css, /\.dashboard-route-content \{[^}]+animation: dashboard-route-enter 180ms/u);
  assert.match(css, /\.dashboard-route-loading \{[^}]+background: var\(--surface-page\);[^}]+animation: dashboard-route-enter 160ms/u);
  assert.match(css, /@media \(prefers-reduced-motion: reduce\)/u);
});

test("internal Dashboard navigation does not bypass the route loading boundary", () => {
  for (const source of [navigation, workers, schedules, artifacts, dialog]) {
    assert.match(source, /import Link from "next\/link"/u);
  }
  assert.doesNotMatch(navigation, /<a\b/u);
  assert.doesNotMatch(workers, /<a\b/u);
  assert.match(runs, /import \{ useRouter \} from "next\/navigation"/u);
  assert.match(runs, /onRowClicked=\{\(run\) => router\.push\(`/u);
  assert.doesNotMatch(runs, /window\.location/u);
  assert.doesNotMatch(schedules, /<a\b/u);
  assert.doesNotMatch(artifacts, /<a[^>]+href=\{`\/rd\/artifacts/u);
  assert.doesNotMatch(dialog, /<a[^>]+href=\{`\/operations\/runs/u);
  assert.match(filterToolbar, /import Link from "next\/link"/u);
  assert.match(filterToolbar, /const usesClientNavigation = typeof href === "string"[\s\S]+?<Link \{\.\.\.sharedProps\} href=\{href\}>/u);
  assert.match(filterToolbar, /!props\.download/u);
  assert.match(runDetail, /<FilterLink density="compact" variant="secondary" href=\{run\.owner_view\.href\}>/u);
});

test("worker reads distinguish pending from unavailable", () => {
  assert.match(workers, /pending \? \([\s\S]+?<LoadingState[\s\S]+?title="Reading worker store"/u);
  assert.doesNotMatch(workers, /reason=\{result\?\.unavailable_reason \?\? "READING_WORKERS"\}/u);
});
