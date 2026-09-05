import assert from "node:assert/strict";
import test from "node:test";

import {
  operationalCacheDeletionReceiptIdentityV1,
  parseOperationalCacheDeletionEnvelopeV1,
  parseOperationalCacheDeletionReceiptV1,
} from "../lib/run-cache-deletion-contract.ts";

const unsigned = {
  schema_version: 1,
  operation: "dashboard.operational_cache.delete.v1",
  run_identity: "dashboard-run-v1-00000000-0000-4000-8000-000000000020",
  prior_state: "succeeded",
  prior_transition_version: 3,
  principal_ref: "local_operator",
  authorization_digest: `sha256:${"a".repeat(64)}`,
  deleted_at: "2026-09-02T04:00:00.000Z",
};
const receipt = { ...unsigned, receipt_identity: operationalCacheDeletionReceiptIdentityV1(unsigned) };

test("operational cache deletion receipt is exact, content-addressed and run-bound", () => {
  assert.deepEqual(parseOperationalCacheDeletionReceiptV1(receipt), receipt);
  assert.equal(parseOperationalCacheDeletionReceiptV1({ ...receipt, prior_transition_version: 4 }), null);
  assert.equal(parseOperationalCacheDeletionReceiptV1({ ...receipt, token: "forbidden" }), null);
  assert.equal(parseOperationalCacheDeletionEnvelopeV1({
    schema_version: 1,
    operation: "dashboard.operational_cache.delete.v1",
    availability: "available",
    unavailable_reason: null,
    observed_at: "2026-09-02T04:00:01.000Z",
    run_identity: unsigned.run_identity,
    receipt,
  })?.receipt?.receipt_identity, receipt.receipt_identity);
});

test("unavailable cache deletion cannot carry a receipt", () => {
  const unavailable = {
    schema_version: 1,
    operation: "dashboard.operational_cache.delete.v1",
    availability: "unavailable",
    unavailable_reason: "OPERATOR_CAPABILITY_DENIED",
    observed_at: "2026-09-02T04:00:01.000Z",
    run_identity: unsigned.run_identity,
    receipt: null,
  };
  assert.ok(parseOperationalCacheDeletionEnvelopeV1(unavailable));
  assert.equal(parseOperationalCacheDeletionEnvelopeV1({ ...unavailable, receipt }), null);
});
