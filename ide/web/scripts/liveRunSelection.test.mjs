import assert from "node:assert/strict";
import { test } from "node:test";
import { namespace } from "./load.mjs";

const { shownLiveRun } = await namespace("model/liveRunSelection.ts", { sources: [], packages: [] });
const run = (id, candidate, observedNs) => ({ id, candidate, evidence: [{ source: "lifecycle", observedNs }] });
const runs = [run("7", "a@1", "1000"), run("web-later", "a@1", "3000"), run("web-other", "b@1", "9000")];

test("Live uses its own string identity and keeps the exact user choice within a version", () => {
  assert.equal(shownLiveRun(runs, "a@1", "7"), runs[0]);
  assert.equal(shownLiveRun(runs, "a@1", 7), runs[1], "a numeric Paper ID cannot select a string Live ID");
  assert.equal(shownLiveRun(runs, "a@1", "web-other"), runs[1], "another version is not silently substituted");
  assert.equal(shownLiveRun(runs, "missing@1", "web-other"), null);
});

test("an explicitly selected retained Live run works without research, with no unchosen global fallback", () => {
  assert.equal(shownLiveRun(runs, null, "web-other"), runs[2]);
  assert.equal(shownLiveRun(runs, null), null);
  assert.equal(shownLiveRun(runs, null, "not-read"), null);
  assert.equal(shownLiveRun([], null, "web-other"), null);
});
