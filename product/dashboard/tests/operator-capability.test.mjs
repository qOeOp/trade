import assert from "node:assert/strict";
import test from "node:test";

import { verifyOperatorCapabilityV1 } from "../lib/operator-capability.ts";

test("operator enqueue capability fails closed and compares one exact bearer", () => {
  const capability = "operator-capability-that-is-at-least-thirty-two-bytes";
  assert.equal(verifyOperatorCapabilityV1(null, undefined), "configuration_unavailable");
  assert.equal(verifyOperatorCapabilityV1(null, capability), "denied");
  assert.equal(verifyOperatorCapabilityV1("Basic opaque", capability), "denied");
  assert.equal(verifyOperatorCapabilityV1(`Bearer ${capability}x`, capability), "denied");
  assert.equal(verifyOperatorCapabilityV1(`Bearer ${capability}`, capability), "available");
});
