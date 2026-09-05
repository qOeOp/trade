import assert from "node:assert/strict";
import test from "node:test";

import {
  parseWorkerBrowserEnvelopeV1,
  parseWorkerDetailBrowserEnvelopeV1,
  readWorkerBrowserResponsesV1,
  encodeWorkerIdentitySegmentV1,
  decodeWorkerIdentitySegmentV1,
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

test("worker transport survives URL dot normalization and preserves exact response binding", async () => {
  for (const identity of [".", "..", "a-worker", ".worker", "..worker", "group:worker/a"]) {
    const segment = encodeWorkerIdentitySegmentV1(identity);
    const page = new URL(`/operations/workers/${segment}/`, "http://dashboard.test");
    assert.equal(page.pathname, `/operations/workers/${segment}/`);
    const pageIdentity = decodeWorkerIdentitySegmentV1(decodeURIComponent(page.pathname.split("/")[3]));
    assert.equal(pageIdentity, identity);
    const result = await readWorkerBrowserResponsesV1(async (url) => {
      if (url === "/api/operations/workers/") return Response.json(envelope({ workers: [] }));
      const request = new URL(url, "http://dashboard.test");
      assert.equal(request.pathname, `/api/operations/workers/${segment}/`);
      const decoded = decodeWorkerIdentitySegmentV1(decodeURIComponent(request.pathname.split("/")[4]));
      assert.equal(decoded, identity);
      return Response.json(detailEnvelope({
        requested_worker_identity: decoded, worker: { ...worker, worker_identity: decoded },
      }));
    }, pageIdentity);
    assert.equal(result.detail.availability, "available");
    assert.equal(result.detail.worker.worker_identity, identity);
    const mismatch = detailEnvelope({
      requested_worker_identity: "other-worker", worker: { ...worker, worker_identity: "other-worker" },
    });
    assert.equal(parseWorkerDetailBrowserEnvelopeV1(mismatch, identity), null);
  }
  for (const alias of [".", "..", "~", "~dot.other", "~dotdotdot", "%2E", "%2E%2E", "%7Edot"]) {
    assert.equal(decodeWorkerIdentitySegmentV1(alias), null);
  }
  for (const invalidIdentity of ["~dot", "~dotdot", "%2E", "%7Edot"]) {
    assert.throws(() => encodeWorkerIdentitySegmentV1(invalidIdentity), /WORKER_IDENTITY_INVALID/);
  }
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
        if (endpoint === failedEndpoint && failure === "json-reject") return new Response("invalid json", { status: 200 });
        const body = endpoint !== failedEndpoint
          ? endpoint === "list" ? envelope() : detailEnvelope()
          : failure === "invalid" ? { extra: true }
          : endpoint === "list"
            ? envelope({ availability: "unavailable", unavailable_reason: "WORKER_STORE_UNAVAILABLE", workers: [] })
            : detailEnvelope({ availability: "unavailable", unavailable_reason: "WORKER_NOT_FOUND", worker: null });
        return new Response(JSON.stringify(body), { status: 200 });
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

test("worker reader requires independent successful HTTP responses before admitting positive envelopes", async () => {
  for (const listStatus of [200, 403, 503]) {
    for (const detailStatus of [200, 403, 503]) {
      const calls = [];
      const result = await readWorkerBrowserResponsesV1(async (url, init) => {
        calls.push(url);
        assert.deepEqual(init, { method: "GET", cache: "no-store" });
        const list = url === "/api/operations/workers/";
        return new Response(JSON.stringify(list ? envelope() : detailEnvelope()), {
          status: list ? listStatus : detailStatus,
        });
      }, worker.worker_identity);
      assert.deepEqual(calls, ["/api/operations/workers/", `/api/operations/workers/${worker.worker_identity}/`]);
      assert.equal(result.list.availability, listStatus === 200 ? "available" : "unavailable");
      assert.deepEqual(result.list.workers, listStatus === 200 ? [worker] : []);
      assert.equal(result.detail.availability, detailStatus === 200 ? "available" : "unavailable");
      assert.deepEqual(result.detail.worker, detailStatus === 200 ? worker : null);
      assert.equal(result.detail.requested_worker_identity, worker.worker_identity);
    }
  }
});
