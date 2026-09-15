import assert from "node:assert/strict";
import test from "node:test";

import {
  emptyServiceLogPresentation,
  runDurationPresentation,
  runKindLabel,
  runStateLabel,
  runTriggerLabel,
  sourceResultLabel,
  summarizeRunsForPresentation,
  workerAssignmentPresentation,
} from "../lib/operations-presentation.ts";

const run = (overrides = {}) => ({
  state: "succeeded",
  started_at: "2026-09-09T10:00:00.000Z",
  duration_ms: 1200,
  terminal_code: "SUCCEEDED",
  owner_outcome_state: "available",
  ...overrides,
});

test("run summary keeps pending and unavailable Owner outcomes distinct", () => {
  assert.deepEqual(summarizeRunsForPresentation([
    run({ state: "running", owner_outcome_state: "unknown" }),
    run({ state: "failed", owner_outcome_state: "unavailable" }),
    run({ owner_outcome_state: "available" }),
  ]), { active: 1, failed: 1, ownerAvailable: 1, ownerPending: 1 });
});

test("a cancelled-before-start run never presents as in progress", () => {
  assert.deepEqual(runDurationPresentation(run({
    state: "cancelled",
    started_at: null,
    duration_ms: null,
    terminal_code: null,
    owner_outcome_state: "unknown",
  })), {
    duration: "Not started",
    durationTone: "neutral",
  });
});

test("run detail presentation translates implementation state without changing its distinctions", () => {
  assert.equal(runStateLabel("succeeded"), "Completed");
  assert.equal(runStateLabel("running"), "Running");
  assert.equal(sourceResultLabel("available"), "Available");
  assert.equal(sourceResultLabel("rejected"), "Not accepted");
  assert.equal(sourceResultLabel("unknown"), "Pending");
  assert.equal(runTriggerLabel("dashboard_bff"), "Dashboard");
  assert.equal(runKindLabel("owner_read"), "Data read");
  assert.deepEqual(workerAssignmentPresentation("unavailable", "RUN_DISPATCH_BINDING_UNAVAILABLE"), {
    title: "Assignment not recorded",
    detail: "This historical run has no matching current worker assignment record.",
  });
});

test("duration presentation is independent from the technical terminal code", () => {
  assert.deepEqual(runDurationPresentation(run({ terminal_code: "OWNER_AVAILABLE" })), {
    duration: "1.20 s",
    durationTone: "neutral",
  });
});

test("partial empty service logs remain explicitly incomplete", () => {
  assert.deepEqual(emptyServiceLogPresentation({ completeness: "partial_unavailable", filtered: false }), {
    title: "Some activity unavailable",
    detail: "No verified service events are available for this view. Some sources could not be read.",
  });
  assert.deepEqual(emptyServiceLogPresentation({ completeness: "complete", filtered: false }), {
    title: "No recent activity",
    detail: "No services reported events in the selected time range.",
  });
});
