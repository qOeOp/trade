import assert from "node:assert/strict";
import test from "node:test";

import { OWNER_READ_NONCE_HEADER } from "../lib/owner-read-nonce.ts";
import {
  parseRdIterationTimelineOwnerV1,
  resolveRdIterationTimelineShadowV1,
} from "../lib/rd-iteration-timeline-client.ts";

const digest = (digit) => `sha256:${digit.repeat(64)}`;

function decision(outcome, nextLegalAction) {
  return {
    decision_identity: "decision-1",
    decision_digest: digest("1"),
    round_ordinal: 1,
    trial_family_identity: "family-1",
    census_frontier_identity: "frontier-1",
    census_frontier_digest: digest("3"),
    request_identity: "replay-request-1",
    result_identity: "replay-result-1",
    attempt_identity: "attempt-1",
    outcome,
    next_legal_action: nextLegalAction,
    committed_at_epoch_ms: 95,
    receipt_identity: "decision-receipt-1",
  };
}

function timeline(state, decisions = []) {
  return {
    schema_version: 1,
    trial_family_identity: "family-1",
    census_frontier_identity: "frontier-1",
    census_frontier_digest: digest("3"),
    consumed_trial_budget: decisions.length,
    trial_budget: 2,
    state,
    decisions,
    observed_at_epoch_ms: 100,
  };
}

const transitions = [
  [{ outcome: "REPAIR_INPUTS", category: "MARKET_DATA", target: "MARKET_DATA" },
    "SUBMIT_REPAIR_REQUEST", "REPAIR_REQUIRED"],
  [{ outcome: "SUCCESSOR_EXPERIMENT", experiment_identity: "experiment-1", experiment_digest: digest("4") },
    "CREATE_SUCCESSOR_INTENT", "SUCCESSOR_REQUIRED"],
  [{ outcome: "TERMINAL_STOP", reason: "LOW_INFORMATION_VALUE" },
    "STOP_ON_COMMITTED_DECISION", "TERMINAL"],
  [{ outcome: "READY_FOR_SELECTION", candidate_identity: "candidate-1", candidate_digest: digest("5") },
    "SUBMIT_SELECTED_CANDIDATE_TO_QUALIFICATION", "READY_FOR_QUALIFICATION"],
];

test("empty timeline preserves the exact awaiting state", () => {
  const parsed = parseRdIterationTimelineOwnerV1(
    timeline("AWAITING_REPLAY_RESULT"), "family-1",
  );
  assert.equal(parsed?.state, "AWAITING_REPLAY_RESULT");
  assert.deepEqual(parsed?.decisions, []);
});

test("each canonical Owner outcome binds one exact action and state", () => {
  for (const [outcome, action, state] of transitions) {
    const parsed = parseRdIterationTimelineOwnerV1(
      timeline(state, [decision(outcome, action)]), "family-1",
    );
    assert.equal(parsed?.state, state);
    assert.equal(parsed?.decisions[0].outcome.outcome, outcome.outcome);
    assert.equal(parsed?.decisions[0].nextLegalAction, action);
  }
});

test("invented outcomes and cross-outcome actions fail closed", () => {
  const invalid = [
    timeline("RUNNING"),
    timeline("TERMINAL", [decision({ outcome: "EVIDENCE_UNRESOLVED" }, "STOP_ON_COMMITTED_DECISION")]),
    timeline("TERMINAL", [decision({ outcome: "TERMINAL_STOP", reason: "LOW_INFORMATION_VALUE" }, "RUN_AGAIN")]),
    timeline("TERMINAL", [decision(
      { outcome: "REPAIR_INPUTS", category: "MARKET_DATA", target: "MARKET_DATA" },
      "STOP_ON_COMMITTED_DECISION",
    )]),
  ];
  for (const value of invalid) {
    assert.equal(parseRdIterationTimelineOwnerV1(value, "family-1"), null);
  }
});

async function read(body, echo = (nonce) => nonce) {
  const nonces = [];
  const result = await resolveRdIterationTimelineShadowV1({
    trialFamilyIdentity: "family-1",
    baseUrl: "http://owner.test",
    token: "opaque-test-token",
    now: () => 50,
    fetcher: async (_url, init) => {
      const nonce = init.headers[OWNER_READ_NONCE_HEADER];
      nonces.push(nonce);
      const echoed = echo(nonce);
      return new Response(JSON.stringify(body), {
        headers: echoed === undefined ? {} : { [OWNER_READ_NONCE_HEADER]: echoed },
      });
    },
  });
  return { result, nonce: nonces[0] };
}

// The Owner stamps its observation from its own clock, which can run ahead of this process's: a
// Docker Desktop VM's does. The echoed nonce, not this process's clock, is what binds the answer.
test("an Owner observation on a clock ahead of this process's is this read's answer", async () => {
  const [transition] = transitions;
  const first = await read(timeline(transition[2], [decision(transition[0], transition[1])]));
  assert.equal(first.result.status, 200);
  assert.equal(first.result.envelope.projection.observedAtEpochMs, 100);
  const second = await read(timeline("AWAITING_REPLAY_RESULT"));
  assert.equal(second.result.status, 200);
  for (const nonce of [first.nonce, second.nonce]) assert.match(nonce, /^[0-9a-f]{32}$/u);
  assert.notEqual(first.nonce, second.nonce);
});

test("an answer that does not echo this read's nonce is not its answer", async () => {
  for (const echo of [
    () => undefined,
    () => "0".repeat(32),
    (nonce) => nonce.toUpperCase(),
    (nonce) => `${nonce}, ${nonce}`,
  ]) {
    const { result } = await read(timeline("AWAITING_REPLAY_RESULT"), echo);
    assert.deepEqual([result.status, result.envelope.unavailable_reason], [502, "OWNER_RESPONSE_UNAVAILABLE"]);
  }
});

test("a Decision committed after the Owner's own observation fails closed", () => {
  const [[outcome, action, state]] = transitions;
  const late = timeline(state, [{ ...decision(outcome, action), committed_at_epoch_ms: 101 }]);
  assert.equal(parseRdIterationTimelineOwnerV1(late, "family-1"), null);
});
