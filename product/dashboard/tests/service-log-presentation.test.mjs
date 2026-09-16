import assert from "node:assert/strict";
import test from "node:test";

import { serviceLogSourcesV1 } from "../lib/service-log-contract.ts";
import {
  serviceLogEventLabel,
  serviceLogRelatedLabel,
  serviceLogRunIdentity,
  serviceLogSourceLabel,
} from "../lib/service-log-presentation.ts";

test("every service-log source has one business-facing label", () => {
  const labels = serviceLogSourcesV1.map(serviceLogSourceLabel);
  assert.equal(labels.length, serviceLogSourcesV1.length);
  assert.equal(new Set(labels).size, labels.length);
  labels.forEach((label, index) => {
    assert.notEqual(label, serviceLogSourcesV1[index]);
    assert.doesNotMatch(label, /_/u);
  });
});

test("event and correlation presentation remains deterministic without widening the contract", () => {
  assert.equal(serviceLogEventLabel("RUN_STARTED"), "Run started");
  assert.equal(serviceLogEventLabel("MANUAL_RECONCILIATION_REQUIRED"), "Manual reconciliation required");
  const runIdentity = "dashboard-run-v1-963d7f74-5fc7-4d2a-8845-1eed910fb16d";
  assert.equal(serviceLogRunIdentity(runIdentity), runIdentity);
  assert.equal(serviceLogRelatedLabel(runIdentity), "View run");
  assert.equal(serviceLogRunIdentity("correlation-v1-example"), null);
  assert.equal(serviceLogRelatedLabel("correlation-v1-example"), "Related activity");
});
