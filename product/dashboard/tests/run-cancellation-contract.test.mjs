import assert from "node:assert/strict";
import test from "node:test";

import {
  EMPTY_DOMAIN_EFFECT_DIGEST_V1,
  operationalCancellationReceiptIdentityV1,
  parseOperationalActionEnvelopeV1,
  parseOperationalCancellationEnvelopeV1,
  parseOperationalCancellationReadbackV1,
} from "../lib/run-cancellation-contract.ts";

const runIdentity = "dashboard-run-v1-00000000-0000-4000-8000-000000000040";
const action = {
  schema_version: 1,
  operation: "dashboard.operational_action.v1",
  action_identity: `dashboard-operational-action-v1-${"a".repeat(64)}`,
  capability: "dependency.cancel.queued",
  run_identity: runIdentity,
  principal_ref: "local_operator",
  authorization_digest: `sha256:${"b".repeat(64)}`,
  transition_version: 2,
  kind: "dependency",
  state: "queued",
  domain_effect_digest: EMPTY_DOMAIN_EFFECT_DIGEST_V1,
  claim_absence_observed_at: "2026-09-06T00:00:00.000Z",
  expires_at: "2026-09-06T00:01:00.000Z",
};

test("operational action envelope is exact, short-lived and zero-effect", () => {
  assert.deepEqual(parseOperationalActionEnvelopeV1(action), action);
  assert.equal(parseOperationalActionEnvelopeV1({ ...action, kind: "owner_effect" }), null);
  assert.equal(parseOperationalActionEnvelopeV1({ ...action, domain_effect_digest: `sha256:${"c".repeat(64)}` }), null);
  assert.equal(parseOperationalActionEnvelopeV1({ ...action, expires_at: "2026-09-06T00:01:00.001Z" }), null);
  assert.equal(parseOperationalActionEnvelopeV1({ ...action, extra: true }), null);
});

test("cancellation receipt is immutable and exact-run-bound", () => {
  const unsigned = {
    schema_version: 1,
    operation: "dashboard.dependency.cancel.queued.v1",
    action_identity: action.action_identity,
    run_identity: runIdentity,
    prior_state: "queued",
    prior_transition_version: 2,
    state: "cancelled",
    transition_version: 3,
    principal_ref: "local_operator",
    authorization_digest: action.authorization_digest,
    cancelled_at: "2026-09-06T00:00:10.000Z",
  };
  const receipt = {
    ...unsigned,
    receipt_identity: operationalCancellationReceiptIdentityV1(unsigned),
  };
  assert.equal(parseOperationalCancellationEnvelopeV1({
    schema_version: 1,
    operation: "dashboard.dependency.cancel.queued.v1",
    availability: "available",
    unavailable_reason: null,
    observed_at: "2026-09-06T00:00:11.000Z",
    run_identity: runIdentity,
    receipt,
  })?.receipt?.receipt_identity, receipt.receipt_identity);
  assert.equal(parseOperationalCancellationEnvelopeV1({
    schema_version: 1,
    operation: "dashboard.dependency.cancel.queued.v1",
    availability: "available",
    unavailable_reason: null,
    observed_at: "2026-09-06T00:00:11.000Z",
    run_identity: "dashboard-run-v1-00000000-0000-4000-8000-000000000041",
    receipt,
  }), null);
});

test("Run Detail cancellation readback admits only current envelope or terminal receipt", () => {
  assert.equal(parseOperationalCancellationReadbackV1({
    state: "pending",
    unavailable_reason: null,
    action_envelope: action,
    receipt: null,
  }, runIdentity, "2026-09-06T00:00:30.000Z")?.state, "pending");
  assert.equal(parseOperationalCancellationReadbackV1({
    state: "pending",
    unavailable_reason: null,
    action_envelope: action,
    receipt: null,
  }, runIdentity, "2026-09-06T00:01:00.000Z"), null);
});
