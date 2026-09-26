import assert from "node:assert/strict";
import test from "node:test";

import { parseSourceResearchActionEnvelopeV1 } from "../lib/source-research-action-contract.ts";

const envelope = {
  schema_version: 1,
  operation: "source_intake.research.submit_or_resolve.v1",
  channel: "DASHBOARD_DISPOSABLE_EXECUTION",
  availability: "available",
  unavailable_reason: null,
  source: {
    schema_version: 1,
    request_identity: "source-request-1",
    resolution: "RETRIEVED",
    binding_identity: "source-binding-1",
    receipt_identity: "source-receipt-1",
    content_digest: `sha256:${"a".repeat(64)}`,
  },
  research: {
    schema_version: 1,
    request_identity: "request-1",
    resolution: "ACCEPTED",
    intent_identity: "intent-1",
    trial_family_identity: "family-1",
    rejection_code: null,
    next_legal_action: "WAIT_FOR_R_AND_D_EXECUTION",
  },
  operational_run: {
    schema_version: 1,
    availability: "available",
    unavailable_reason: null,
    run_identity: "dashboard-run-v1-00000000-0000-4000-8000-000000000061",
    state: "succeeded",
    owner_outcome_state: "available",
    transition_version: 4,
  },
};

test("browser action contract binds both identities and matching operational outcome", () => {
  assert.deepEqual(
    parseSourceResearchActionEnvelopeV1(envelope, "source-request-1", "request-1"),
    envelope,
  );
  assert.equal(parseSourceResearchActionEnvelopeV1(
    { ...envelope, operational_run: { ...envelope.operational_run, state: "failed" } },
    "source-request-1",
    "request-1",
  ), null);
  assert.equal(parseSourceResearchActionEnvelopeV1(
    { ...envelope, smuggled: true },
    "source-request-1",
    "request-1",
  ), null);
});

test("a rejected Research carries the Owner's code, and an accepted one carries none", () => {
  const rejected = {
    ...envelope,
    research: {
      ...envelope.research,
      resolution: "REJECTED_NO_WRITE",
      intent_identity: null,
      trial_family_identity: null,
      rejection_code: "INSTRUMENT_SCOPE_NOT_RESOLVABLE",
      next_legal_action: "CORRECT_INPUT_AND_CREATE_SUCCESSOR_REQUEST",
    },
    operational_run: { ...envelope.operational_run, state: "failed", owner_outcome_state: "rejected" },
  };
  assert.deepEqual(parseSourceResearchActionEnvelopeV1(rejected, "source-request-1", "request-1"), rejected);
  for (const code of [null, "", "instrument_scope_not_resolvable", "INSTRUMENT SCOPE"]) {
    assert.equal(parseSourceResearchActionEnvelopeV1(
      { ...rejected, research: { ...rejected.research, rejection_code: code } },
      "source-request-1",
      "request-1",
    ), null, String(code));
  }
  assert.equal(parseSourceResearchActionEnvelopeV1(
    { ...envelope, research: { ...envelope.research, rejection_code: "GOAL_INVALID" } },
    "source-request-1",
    "request-1",
  ), null);
  const { rejection_code: _code, ...withoutCode } = envelope.research;
  assert.equal(parseSourceResearchActionEnvelopeV1(
    { ...envelope, research: withoutCode },
    "source-request-1",
    "request-1",
  ), null);
});
