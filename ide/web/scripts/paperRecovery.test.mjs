// Whether an ended paper run can still resume and whether a running one survives an interruption
// (model/recovery.ts): a Resume shown for a run that can only be refused tells the operator the wrong thing.
import assert from "node:assert/strict";
import { test } from "node:test";
import { loader } from "./load.mjs";

const recovery = await loader().namespace("model/recovery.ts"), { unresumable, heldOnInterruption } = recovery;
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
  assert.equal(heldOnInterruption({ state: "running", recovery_declared: false }), true);
  assert.equal(heldOnInterruption({ state: "running", recovery_declared: true }), false);
  assert.equal(heldOnInterruption({ state: "running", recovery_declared: null }), false, "unknown is not said");
  assert.equal(heldOnInterruption({ state: "ended", recovery_declared: false }), false);
  const readings = { protection_gaps: 0, missing_bars: 0, late_bars: 0, exceptions: 0 };
  assert.deepEqual(paperIssues({ state: "running", recovery_declared: false, readings }), [{ text: "Held on restart", tone: "misses" }]);
});

test("a held run with a position no working stop protects is marked first in the fail tone (user 2026-11-17)", () => {
  const { unprotected, unprotectedText } = recovery;
  const readings = { protection_gaps: 1, missing_bars: 0, late_bars: 0, exceptions: 0 };
  const held = { state: "running", recovery_declared: false, readings, held_since: 1,
    unprotected: [{ position_id: "P-1", instrument_id: "BTCUSDT-PERP.BINANCE", since_ns: 1 }] };
  assert.deepEqual(unprotected(held), ["P-1"]);
  assert.match(unprotectedText(unprotected(held)), /no working stop protects P-1/);
  assert.deepEqual(paperIssues(held), [{ text: "Unprotected position", tone: "fail" }, { text: "1 protection gap", tone: "fail" },
    { text: "Held on restart", tone: "misses" }]);
  assert.deepEqual(unprotected({ state: "running", readings }), [], "a listing without the fact marks nothing");
});
