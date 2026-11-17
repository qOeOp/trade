// Whether an ended paper run can still resume and whether a running one survives an interruption
// (model/recovery.ts): a Resume shown for a run that can only be refused tells the operator the wrong thing.
import assert from "node:assert/strict";
import { test } from "node:test";
import { loader } from "./load.mjs";

const { unresumable, endsOnInterruption } = await loader().namespace("model/recovery.ts");
const { paperIssues } = await loader().namespace("model/phoneRuns.ts");
const refused = (message, code = "PAPER_RECOVERY_UNAVAILABLE") => ({ state: "ended", recovery: { code, message } });

test("a resume refused for what stays (no checkpoint, a changed input) cannot pass; one refused for what passes can", () => {
  assert.equal(unresumable(refused("no complete native checkpoint; the existing run is retained")), true);
  assert.equal(unresumable(refused("the run's original strategy input has changed")), true);
  assert.equal(unresumable(refused("another run of this source is running")), false);
  assert.equal(unresumable(refused("this source reached 3 recovery attempts per hour")), false);
  assert.equal(unresumable(refused("another Paper lifecycle operation is still in progress")), false);
  assert.equal(unresumable(refused("docker-api unavailable", "PAPER_FAILED")), false, "another failure may pass on a retry");
  assert.equal(unresumable({ state: "ended" }), false, "no refusal yet");
});

test("only a running run whose source is read as not declaring recovery is marked", () => {
  assert.equal(endsOnInterruption({ state: "running", recovery_declared: false }), true);
  assert.equal(endsOnInterruption({ state: "running", recovery_declared: true }), false);
  assert.equal(endsOnInterruption({ state: "running", recovery_declared: null }), false, "unknown is not said");
  assert.equal(endsOnInterruption({ state: "ended", recovery_declared: false }), false);
  const readings = { protection_gaps: 0, missing_bars: 0, late_bars: 0, exceptions: 0 };
  assert.deepEqual(paperIssues({ state: "running", recovery_declared: false, readings }), [{ text: "no recovery", tone: "misses" }]);
});
