import assert from "node:assert/strict";
import test from "node:test";

import {
  parseWorkerBrowserEnvelopeV1,
  parseWorkerDetailBrowserEnvelopeV1,
  readWorkerBrowserResponsesV1,
} from "../lib/worker-browser-contract.ts";

const observedAt = "2026-09-01T10:00:00.000Z";
const runIdentity = "dashboard-run-v1-12345678-1234-4123-8123-123456789abc";
const worker = {
  schema_version: 1,
  worker_identity: "dashboard-shadow-worker-1",
  operation_ids: ["research_goal.shadow_resolve.v1", "source_intake.shadow_read.v1"],
  worker_artifact_digest: `sha256:${"a".repeat(64)}`,
  lease_state: "available",
  registered_at: "2026-09-01T09:00:00.000Z",
  last_heartbeat_at: "2026-09-01T09:59:50.000Z",
  lease_expires_at: "2026-09-01T10:00:20.000Z",
  job_count: 2,
  active_job_count: 1,
  last_run_identity: runIdentity,
  last_run_state: "running",
  last_run_at: "2026-09-01T09:59:45.000Z",
};

function envelope(overrides = {}) {
  return {
    schema_version: 1,
    operation: "dashboard.shadow_workers.list.v1",
    availability: "available",
    unavailable_reason: null,
    observed_at: observedAt,
    workers: [worker],
    ...overrides,
  };
}

test("worker envelope accepts exact lease, job and capability readback", () => {
  const parsed = parseWorkerBrowserEnvelopeV1(envelope());
  assert.equal(parsed?.workers[0].last_run_identity, runIdentity);
  assert.equal(parsed?.workers[0].active_job_count, 1);
});

test("worker identity uniqueness does not impose JavaScript ordering on database collation", () => {
  const a = { ...worker, worker_identity: "a-worker" };
  const z = { ...worker, worker_identity: "Z-worker" };
  for (const workers of [[a, z], [z, a]]) {
    assert.deepEqual(parseWorkerBrowserEnvelopeV1(envelope({ workers }))?.workers, workers);
  }
  for (const workers of [[a, a], [a, z, a]]) {
    assert.equal(parseWorkerBrowserEnvelopeV1(envelope({ workers })), null);
  }
});

test("worker envelope rejects inferred, contradictory and loose fields", () => {
  for (const candidate of [
    envelope({ workers: [{ ...worker, memory_bytes: 42 }] }),
    envelope({ workers: [{ ...worker, active_job_count: 3 }] }),
    envelope({ workers: [{ ...worker, lease_state: "expired" }] }),
    envelope({ workers: [{ ...worker, operation_ids: [...worker.operation_ids].reverse() }] }),
    envelope({ workers: [{ ...worker, last_run_identity: null, last_run_state: null, last_run_at: null }] }),
  ]) assert.equal(parseWorkerBrowserEnvelopeV1(candidate), null);
});

test("worker envelope admits only an empty explicit unavailable projection", () => {
  assert.ok(parseWorkerBrowserEnvelopeV1(envelope({
    availability: "unavailable",
    unavailable_reason: "WORKER_STORE_UNAVAILABLE",
    workers: [],
  })));
  assert.equal(parseWorkerBrowserEnvelopeV1(envelope({
    availability: "unavailable",
    unavailable_reason: "WORKER_STORE_UNAVAILABLE",
  })), null);
});

function detailEnvelope(overrides = {}) {
  return {
    schema_version: 1,
    operation: "dashboard.shadow_workers.detail.v1",
    availability: "available",
    unavailable_reason: null,
    observed_at: observedAt,
    requested_worker_identity: worker.worker_identity,
    worker,
    ...overrides,
  };
}

test("worker detail binds one exact path identity and the same strict worker projection", () => {
  assert.equal(
    parseWorkerDetailBrowserEnvelopeV1(detailEnvelope(), worker.worker_identity)?.worker?.last_run_identity,
    runIdentity,
  );
  assert.equal(parseWorkerDetailBrowserEnvelopeV1(detailEnvelope({
    requested_worker_identity: "different-worker",
  }), worker.worker_identity), null);
  assert.equal(parseWorkerDetailBrowserEnvelopeV1(detailEnvelope({
    worker: { ...worker, worker_identity: "different-worker" },
  }), worker.worker_identity), null);
  assert.equal(parseWorkerDetailBrowserEnvelopeV1(detailEnvelope({ extra: true }), worker.worker_identity), null);
});

test("worker detail keeps missing and unavailable workers explicit", () => {
  const unavailable = detailEnvelope({
    availability: "unavailable",
    unavailable_reason: "WORKER_NOT_FOUND",
    worker: null,
  });
  assert.equal(
    parseWorkerDetailBrowserEnvelopeV1(unavailable, worker.worker_identity)?.unavailable_reason,
    "WORKER_NOT_FOUND",
  );
  assert.equal(parseWorkerDetailBrowserEnvelopeV1({ ...unavailable, worker }, worker.worker_identity), null);
});

test("worker reads isolate unavailable, invalid, transport and JSON failures in both directions", async () => {
  for (const failedEndpoint of ["list", "detail"]) {
    for (const failure of ["unavailable", "invalid", "reject", "json-reject"]) {
      const calls = [];
      const result = await readWorkerBrowserResponsesV1(async (url, init) => {
        calls.push(url);
        assert.deepEqual(init, { method: "GET", cache: "no-store" });
        const endpoint = url === "/api/operations/workers/" ? "list" : "detail";
        if (endpoint === failedEndpoint && failure === "reject") throw new Error("offline");
        return { json: async () => {
          if (endpoint !== failedEndpoint) return endpoint === "list" ? envelope() : detailEnvelope();
          if (failure === "json-reject") throw new Error("invalid json");
          if (failure === "invalid") return { extra: true };
          return endpoint === "list"
            ? envelope({ availability: "unavailable", unavailable_reason: "WORKER_STORE_UNAVAILABLE", workers: [] })
            : detailEnvelope({ availability: "unavailable", unavailable_reason: "WORKER_NOT_FOUND", worker: null });
        } };
      }, worker.worker_identity);
      assert.equal(calls.length, 2);
      assert.equal(result[failedEndpoint].availability, "unavailable");
      if (failedEndpoint === "list") {
        assert.equal(result.list.workers.length, 0);
        assert.deepEqual(result.detail.worker, worker);
        assert.equal(result.detail.availability, "available");
      } else {
        assert.equal(result.detail.worker, null);
        assert.deepEqual(result.list.workers, [worker]);
        assert.equal(result.list.availability, "available");
      }
    }
  }
});
