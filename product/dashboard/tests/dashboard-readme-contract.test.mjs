import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const readme = await readFile(new URL("../README.md", import.meta.url), "utf8");

test("Dashboard README names the shipped first-party surfaces without promoting placeholders", () => {
  for (const surface of [
    "Runs", "Run Detail", "Workers", "Schedules", "Service Logs", "Audit",
    "Source Intake", "Research", "Artifact", "Develop Composer", "Backtest",
    "Market Data", "Runtime", "Portfolio",
  ]) assert.match(readme, new RegExp(`\\b${surface}\\b`, "u"));

  assert.match(readme, /Settings Access ships only the local browser-session read\/re-authentication shell/u);
  assert.match(readme, /Event Rail,[\s\S]{1,80}?Telemetry, Alerts,[\s\S]{1,160}?remain navigation-only placeholders/u);
  assert.doesNotMatch(readme, /does not ship the local R&D/u);
});

test("Dashboard README keeps image, Compose, and effect custody explicit", () => {
  for (const boundary of [
    "standalone `trade-dashboard` image",
    "`dashboard-preview` profile",
    "does not stop, replace, or add a",
    "Windmill remains",
    "current executor for every effect",
    "fails closed as an unavailable projection",
  ]) assert.ok(readme.includes(boundary), `missing README boundary: ${boundary}`);

  assert.match(readme, /127\.0\.0\.1:3100/u);
  assert.doesNotMatch(readme, /Windmill cutover[^.]*complete/iu);
});
