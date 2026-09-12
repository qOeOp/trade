import assert from "node:assert/strict";
import test from "node:test";

import {
  controlPlaneAdmissionReceiptIdentityV1,
  parseControlPlaneAdmissionReceiptV1,
  validControlPlaneAdmissionContextV1,
} from "../lib/control-plane-admission-contract.ts";

const fields = {
  principalRef: "local_operator",
  operation: "source_intake.research.submit_or_resolve.v1",
  requestedAction: "RUN",
  executionMode: "FRESH_RUN",
  runIdentity: "dashboard-run-v1-00000000-0000-4000-8000-000000000081",
  authorizationDigest: `sha256:${"e".repeat(64)}`,
};

test("control-plane admission identity binds the exact principal, action, mode and run", () => {
  const identity = controlPlaneAdmissionReceiptIdentityV1(fields);
  assert.equal(identity, controlPlaneAdmissionReceiptIdentityV1(fields));
  assert.notEqual(identity, controlPlaneAdmissionReceiptIdentityV1({
    ...fields,
    requestedAction: "RESOLVE",
  }));
  assert.equal(identity, "dashboard-control-plane-admission-v1-cd512ef1bfcecf15acaacb8bd02b6cd2a255809f9dd30ac50e374f861d263515");
});

test("control-plane admission receipt is exact and rejects incompatible modes", () => {
  const receipt = {
    schema_version: 1,
    receipt_identity: controlPlaneAdmissionReceiptIdentityV1(fields),
    admitted_at: "2026-09-12T04:00:00.000Z",
    principal_ref: fields.principalRef,
    operation: fields.operation,
    requested_action: fields.requestedAction,
    execution_mode: fields.executionMode,
    run_identity: fields.runIdentity,
    authorization_digest: fields.authorizationDigest,
  };
  assert.deepEqual(parseControlPlaneAdmissionReceiptV1(receipt), receipt);
  assert.equal(parseControlPlaneAdmissionReceiptV1({ ...receipt, unexpected: true }), null);
  assert.throws(() => controlPlaneAdmissionReceiptIdentityV1({
    ...fields,
    executionMode: "CONTINUE_CLAIMED_ONCE",
  }), /CONTROL_PLANE_ADMISSION_INVALID/);
  assert.equal(validControlPlaneAdmissionContextV1({
    authorizationDigest: fields.authorizationDigest,
    principalRef: fields.principalRef,
    requestedAction: "RUN",
  }), true);
  assert.equal(validControlPlaneAdmissionContextV1(undefined), false);
  assert.equal(validControlPlaneAdmissionContextV1({
    authorizationDigest: fields.authorizationDigest,
    principalRef: fields.principalRef,
    requestedAction: "RUN",
    unexpected: true,
  }), false);
});
