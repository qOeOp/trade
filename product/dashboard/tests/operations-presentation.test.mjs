import assert from "node:assert/strict";
import test from "node:test";

import {
  emptyServiceLogPresentation,
  runTerminalPresentation,
  summarizeRunsForPresentation,
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
  assert.deepEqual(runTerminalPresentation(run({
    state: "cancelled",
    started_at: null,
    duration_ms: null,
    terminal_code: null,
    owner_outcome_state: "unknown",
  })), {
    duration: "Not started",
    durationTone: "neutral",
    terminalState: "Cancelled",
    terminalTone: "neutral",
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
