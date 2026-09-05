import { operationRegistryV1, type RegisteredOperationId } from "./operation-registry.ts";
import { isRunIdentityV1 } from "./run-contract.ts";

const IDENTITY = /^[A-Za-z0-9._:/-]{1,192}$/;
const DIGEST = /^sha256:[0-9a-f]{64}$/;
const operationIds = new Set(operationRegistryV1.map(({ operation_id }) => operation_id));
const operationOrder = new Map(operationRegistryV1.map(({ operation_id }, index) => [operation_id, index]));
const runStates = new Set(["queued", "running", "succeeded", "failed", "cancelled", "unknown"]);

export type WorkerBrowserProjectionV1 = {
  schema_version: 1;
  worker_identity: string;
  operation_ids: RegisteredOperationId[];
  worker_artifact_digest: string;
  lease_state: "available" | "expired";
  registered_at: string;
  last_heartbeat_at: string;
  lease_expires_at: string;
  job_count: number;
  active_job_count: number;
  last_run_identity: string | null;
  last_run_state: "queued" | "running" | "succeeded" | "failed" | "cancelled" | "unknown" | null;
  last_run_at: string | null;
};

export type WorkerBrowserEnvelopeV1 = {
  schema_version: 1;
  operation: "dashboard.shadow_workers.list.v1";
  availability: "available" | "unavailable";
  unavailable_reason: string | null;
  observed_at: string;
  workers: WorkerBrowserProjectionV1[];
};

export type WorkerDetailBrowserEnvelopeV1 = {
  schema_version: 1;
  operation: "dashboard.shadow_workers.detail.v1";
  availability: "available" | "unavailable";
  unavailable_reason: string | null;
  observed_at: string;
  requested_worker_identity: string;
  worker: WorkerBrowserProjectionV1 | null;
};

export function isWorkerIdentityV1(value: unknown): value is string {
  return typeof value === "string" && IDENTITY.test(value);
}

// "~" is outside the Owner identity alphabet, so these transport markers cannot collide.
export function encodeWorkerIdentitySegmentV1(identity: string): string {
  if (!isWorkerIdentityV1(identity)) throw new Error("WORKER_IDENTITY_INVALID");
  return encodeURIComponent(identity === "." ? "~dot" : identity === ".." ? "~dotdot" : identity);
}

// Next supplies an already percent-decoded segment; never decode a second time.
export function decodeWorkerIdentitySegmentV1(segment: string): string | null {
  if (segment === "~dot") return ".";
  if (segment === "~dotdot") return "..";
  if (segment === "." || segment === "..") return null;
  return isWorkerIdentityV1(segment) ? segment : null;
}

function object(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function exactKeys(value: Record<string, unknown>, expected: readonly string[]) {
  const actual = Object.keys(value).sort();
  const wanted = [...expected].sort();
  return actual.length === wanted.length && actual.every((key, index) => key === wanted[index]);
}

function timestamp(value: unknown): value is string {
  return typeof value === "string" && Number.isFinite(Date.parse(value))
    && new Date(value).toISOString() === value;
}

// RunStore projects both counts through PostgreSQL COUNT(...)::int.
function workerCount(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= 0 && value <= 2147483647;
}

function parseWorker(value: unknown, observedAt: string): WorkerBrowserProjectionV1 | null {
  if (!object(value) || !exactKeys(value, [
    "schema_version", "worker_identity", "operation_ids", "worker_artifact_digest", "lease_state",
    "registered_at", "last_heartbeat_at", "lease_expires_at", "job_count", "active_job_count",
    "last_run_identity", "last_run_state", "last_run_at",
  ])) return null;
  const receivedOperations = Array.isArray(value.operation_ids) ? value.operation_ids : [];
  if (value.schema_version !== 1 || typeof value.worker_identity !== "string"
    || !IDENTITY.test(value.worker_identity) || receivedOperations.length < 1
    || receivedOperations.some((id) => typeof id !== "string" || !operationIds.has(id as RegisteredOperationId))
    || new Set(receivedOperations).size !== receivedOperations.length
    || receivedOperations.some((id, index) => index > 0
      && Number(operationOrder.get(receivedOperations[index - 1] as RegisteredOperationId))
        >= Number(operationOrder.get(id as RegisteredOperationId)))
    || typeof value.worker_artifact_digest !== "string" || !DIGEST.test(value.worker_artifact_digest)
    || (value.lease_state !== "available" && value.lease_state !== "expired")
    || !timestamp(value.registered_at) || !timestamp(value.last_heartbeat_at)
    || !timestamp(value.lease_expires_at) || Date.parse(value.registered_at) > Date.parse(value.last_heartbeat_at)
    || Date.parse(value.last_heartbeat_at) >= Date.parse(value.lease_expires_at)
    || Date.parse(value.last_heartbeat_at) > Date.parse(observedAt)
    || (value.lease_state === "available") !== (Date.parse(value.lease_expires_at) > Date.parse(observedAt))
    || !workerCount(value.job_count) || !workerCount(value.active_job_count)
    || Number(value.active_job_count) > Number(value.job_count)) return null;
  const noLastRun = value.last_run_identity === null && value.last_run_state === null && value.last_run_at === null;
  const hasLastRun = isRunIdentityV1(value.last_run_identity)
    && typeof value.last_run_state === "string" && runStates.has(value.last_run_state)
    && timestamp(value.last_run_at) && Date.parse(value.last_run_at) <= Date.parse(observedAt);
  if ((!noLastRun && !hasLastRun) || (Number(value.job_count) === 0) !== noLastRun) return null;
  return value as WorkerBrowserProjectionV1;
}

export function parseWorkerBrowserEnvelopeV1(value: unknown): WorkerBrowserEnvelopeV1 | null {
  if (!object(value) || !exactKeys(value, [
    "schema_version", "operation", "availability", "unavailable_reason", "observed_at", "workers",
  ]) || value.schema_version !== 1 || value.operation !== "dashboard.shadow_workers.list.v1"
    || !timestamp(value.observed_at) || !Array.isArray(value.workers) || value.workers.length > 100) return null;
  if (value.availability === "unavailable") {
    return typeof value.unavailable_reason === "string" && IDENTITY.test(value.unavailable_reason)
      && value.workers.length === 0 ? value as WorkerBrowserEnvelopeV1 : null;
  }
  if (value.availability !== "available" || value.unavailable_reason !== null) return null;
  const workers = value.workers.map((worker) => parseWorker(worker, value.observed_at as string));
  if (workers.some((worker) => worker === null)) return null;
  const parsed = workers as WorkerBrowserProjectionV1[];
  if (new Set(parsed.map(({ worker_identity }) => worker_identity)).size !== parsed.length) return null;
  return { ...(value as WorkerBrowserEnvelopeV1), workers: parsed };
}

export function parseWorkerDetailBrowserEnvelopeV1(
  value: unknown,
  expectedWorkerIdentity: string,
): WorkerDetailBrowserEnvelopeV1 | null {
  if (!isWorkerIdentityV1(expectedWorkerIdentity) || !object(value) || !exactKeys(value, [
    "schema_version", "operation", "availability", "unavailable_reason", "observed_at",
    "requested_worker_identity", "worker",
  ]) || value.schema_version !== 1 || value.operation !== "dashboard.shadow_workers.detail.v1"
    || !timestamp(value.observed_at) || value.requested_worker_identity !== expectedWorkerIdentity) return null;
  if (value.availability === "unavailable") {
    return typeof value.unavailable_reason === "string" && IDENTITY.test(value.unavailable_reason)
      && value.worker === null ? value as WorkerDetailBrowserEnvelopeV1 : null;
  }
  if (value.availability !== "available" || value.unavailable_reason !== null) return null;
  const worker = parseWorker(value.worker, value.observed_at as string);
  return worker?.worker_identity === expectedWorkerIdentity
    ? { ...(value as WorkerDetailBrowserEnvelopeV1), worker }
    : null;
}

// Each endpoint owns its own availability, including transport and JSON failures.
export async function readWorkerBrowserResponsesV1(
  fetcher: (url: string, init: RequestInit) => Promise<Response>,
  workerIdentity: string | null,
) {
  const readList = async () => {
    const response = await fetcher("/api/operations/workers/", { method: "GET", cache: "no-store" });
    return response.ok === true ? parseWorkerBrowserEnvelopeV1(await response.json()) : null;
  };
  const readDetail = async () => {
    if (!workerIdentity) return null;
    const response = await fetcher(`/api/operations/workers/${encodeWorkerIdentitySegmentV1(workerIdentity)}/`, {
      method: "GET", cache: "no-store",
    });
    if (response.ok !== true && response.status !== 404) return null;
    const detail = parseWorkerDetailBrowserEnvelopeV1(await response.json(), workerIdentity);
    if (response.ok === true) return detail;
    return detail?.availability === "unavailable" && detail.unavailable_reason === "WORKER_NOT_FOUND"
      && detail.worker === null ? detail : null;
  };
  const [listResponse, detailResponse] = await Promise.allSettled([
    readList(),
    readDetail(),
  ]);
  const observed_at = new Date().toISOString();
  const list: WorkerBrowserEnvelopeV1 = (listResponse.status === "fulfilled"
    ? listResponse.value : null) ?? {
    schema_version: 1, operation: "dashboard.shadow_workers.list.v1", availability: "unavailable",
    unavailable_reason: listResponse.status === "rejected" ? "WORKER_TRANSPORT_UNAVAILABLE" : "WORKER_RESPONSE_UNAVAILABLE",
    observed_at, workers: [],
  };
  const detail: WorkerDetailBrowserEnvelopeV1 | null = workerIdentity ? (
    (detailResponse.status === "fulfilled" ? detailResponse.value : null) ?? {
      schema_version: 1, operation: "dashboard.shadow_workers.detail.v1", availability: "unavailable",
      unavailable_reason: detailResponse.status === "rejected" ? "WORKER_DETAIL_TRANSPORT_UNAVAILABLE" : "WORKER_DETAIL_RESPONSE_UNAVAILABLE",
      observed_at, requested_worker_identity: workerIdentity, worker: null,
    }
  ) : null;
  return { list, detail };
}
