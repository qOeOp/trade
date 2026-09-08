import assert from "node:assert/strict";
import test from "node:test";

import {
  canonicalizeServiceLogFilterCutV1,
  parseServiceLogBrowserEnvelopeV1,
  serviceLogFilterCutDigestV1,
  serviceLogFilterCutMatchesV1,
  serviceLogInstanceSourceCutDigestV1,
} from "../lib/service-log-contract.ts";

const observedAt = "2026-09-08T04:00:00.000Z";

async function availableEnvelope() {
  const { filterCut } = canonicalizeServiceLogFilterCutV1({
    observedAt,
    range: "1h",
    search: "run_store",
    pageSize: 20,
  }, observedAt);
  const digest = await serviceLogFilterCutDigestV1(filterCut);
  const instanceFields = {
    schema_version: 1,
    instance_identity: "dashboard-server-1",
    instance_kind: "server",
    readiness: "observed",
    host_ref: null,
    services: ["run_store"],
    last_observed_at: "2026-09-08T03:59:00.000Z",
  };
  return {
    schema_version: 1,
    projection_version: 1,
    operation: "dashboard.service_log_gateway.read.v1",
    availability: "available",
    unavailable_reason: null,
    completeness: "complete",
    observed_at: observedAt,
    retention_limit: 512,
    filter_cut: filterCut,
    filter_cut_digest: digest,
    summary: { error: 0, warning: 0, info: 1, worker: 0, server: 1 },
    instances: [{ ...instanceFields, source_cut: await serviceLogInstanceSourceCutDigestV1(instanceFields) }],
    selected_instance_identity: "dashboard-server-1",
    entries: [{
      schema_version: 1,
      correlation_identity: "dashboard-run-v1-12345678-1234-4123-8123-123456789abc",
      sequence: 2,
      observed_at: "2026-09-08T03:59:00.000Z",
      severity: "info",
      service: "run_store",
      instance_identity: "dashboard-server-1",
      event_code: "OWNER_AVAILABLE",
    }],
    page_size: 20,
    next_cursor: null,
  };
}

test("canonical service-log cuts trim search and have a stable Web Crypto digest", async () => {
  const first = canonicalizeServiceLogFilterCutV1({
    observedAt, range: "6h", kind: "worker", service: "shadow_worker",
    instanceIdentity: "worker-a", severity: "warning", search: "  RUN_Store  ", pageSize: 100,
  }, observedAt);
  const second = canonicalizeServiceLogFilterCutV1({
    observedAt, range: "6h", kind: "worker", service: "shadow_worker",
    instanceIdentity: "worker-a", severity: "warning", search: "run_store", pageSize: 100,
  }, observedAt);
  assert.equal(first.filterCut.search, "run_store");
  assert.equal(await serviceLogFilterCutDigestV1(first.filterCut), "sha256:edb9f613520c483de2c580b4b1673373eb4798933f87ff44b360c36ba5d260ce");
  assert.equal(await serviceLogFilterCutDigestV1(first.filterCut), await serviceLogFilterCutDigestV1(second.filterCut));
  assert.equal(serviceLogFilterCutMatchesV1(first.filterCut, second.filterCut), true);
  assert.equal(serviceLogFilterCutMatchesV1(first.filterCut, { ...second.filterCut, severity: "error" }), false);
  assert.throws(() => canonicalizeServiceLogFilterCutV1({ observedAt: "2026-09-08T04:00:00Z" }, observedAt), {
    message: "SERVICE_LOG_QUERY_INVALID",
  });
  assert.throws(() => canonicalizeServiceLogFilterCutV1({ search: "x".repeat(129) }, observedAt), {
    message: "SERVICE_LOG_QUERY_INVALID",
  });
  assert.throws(() => canonicalizeServiceLogFilterCutV1({ pageSize: 10 }, observedAt), {
    message: "SERVICE_LOG_QUERY_INVALID",
  });
});

test("browser projection accepts one exact cut and fails closed on digest, binding, ordering and unknown keys", async () => {
  const envelope = await availableEnvelope();
  assert.deepEqual(await parseServiceLogBrowserEnvelopeV1(envelope), envelope);

  assert.equal(await parseServiceLogBrowserEnvelopeV1({ ...envelope, surprise: true }), null);
  assert.equal(await parseServiceLogBrowserEnvelopeV1({ ...envelope, filter_cut_digest: `sha256:${"0".repeat(64)}` }), null);
  assert.equal(await parseServiceLogBrowserEnvelopeV1({
    ...envelope,
    entries: [{ ...envelope.entries[0], instance_identity: "other-server" }],
  }), null);
  assert.equal(await parseServiceLogBrowserEnvelopeV1({
    ...envelope,
    entries: [
      envelope.entries[0],
      { ...envelope.entries[0], correlation_identity: "dashboard-run-v1-12345678-1234-4123-8123-123456789abd", sequence: 1,
        observed_at: "2026-09-08T03:59:30.000Z" },
    ],
  }), null);
  assert.equal(await parseServiceLogBrowserEnvelopeV1({
    ...envelope,
    entries: [{ ...envelope.entries[0], event_code: "invented prose" }],
  }), null);
  assert.equal(await parseServiceLogBrowserEnvelopeV1({
    ...envelope,
    instances: [{ ...envelope.instances[0], services: ["dashboard_bff"] }],
  }), null);
  assert.equal(await parseServiceLogBrowserEnvelopeV1({
    ...envelope,
    instances: [{ ...envelope.instances[0], source_cut: `sha256:${"0".repeat(64)}` }],
  }), null);
  assert.equal(await parseServiceLogBrowserEnvelopeV1({
    ...envelope,
    summary: { ...envelope.summary, info: 0 },
  }), null);
  const futureCut = { ...envelope.filter_cut, observed_at: "2099-01-01T00:00:00.000Z" };
  assert.equal(await parseServiceLogBrowserEnvelopeV1({
    ...envelope,
    observed_at: futureCut.observed_at,
    filter_cut: futureCut,
    filter_cut_digest: await serviceLogFilterCutDigestV1(futureCut),
  }, observedAt), null);
});

test("unavailable projection exposes no stale positive state", async () => {
  const unavailable = {
    schema_version: 1,
    projection_version: 1,
    operation: "dashboard.service_log_gateway.read.v1",
    availability: "unavailable",
    unavailable_reason: "SERVICE_LOG_STORE_UNAVAILABLE",
    completeness: "partial_unavailable",
    observed_at: observedAt,
    retention_limit: 512,
    filter_cut: null,
    filter_cut_digest: null,
    summary: null,
    instances: [],
    selected_instance_identity: null,
    entries: [],
    page_size: 50,
    next_cursor: null,
  };
  assert.deepEqual(await parseServiceLogBrowserEnvelopeV1(unavailable), unavailable);
  assert.equal(await parseServiceLogBrowserEnvelopeV1({ ...unavailable, summary: { error: 0, warning: 0, info: 0, worker: 0, server: 0 } }), null);
});
