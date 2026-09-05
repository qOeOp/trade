import {
  operationByIdV1,
  ownerOperationUrlV1,
  RD_HISTORICAL_CUSTODY_SHADOW_READ_OPERATION,
} from "./operation-registry.ts";
import { validOperationalRunReferenceV1 } from "./operational-run-reference.ts";

const MAX_OWNER_RESPONSE_BYTES = 1_048_576;
const IDENTITY = /^[A-Za-z0-9._:/-]{1,256}$/;
type Json = Record<string, unknown>;
type Fetcher = typeof fetch;

export type HistoricalResearchCandidateV1 = {
  requestIdentity: string;
  committedAtEpochMs: number;
  projectionState: "POINT_READ_REQUIRED";
};
export type HistoricalArtifactCandidateV1 = {
  buildRequestIdentity: string;
  attemptIdentity: string;
  preparedAtEpochMs: number;
  projectionState: "POINT_READ_REQUIRED";
};
export type HistoricalBindingCandidateV1 = {
  bindingIdentity: string;
  trialFamilyIdentity: string;
  committedAtEpochMs: number;
  projectionState: "POINT_READ_REQUIRED";
};
export type HistoricalCustodyProjectionV1 = {
  resolution: "RETRIEVED" | "SUBMITTED_OR_UNKNOWN";
  completeness: "COMPLETE" | "PARTIAL_TRUNCATED";
  observedAtEpochMs: number | null;
  researchTotal: number;
  artifactAttemptTotal: number;
  bindingTotal: number;
  research: HistoricalResearchCandidateV1[];
  artifactAttempts: HistoricalArtifactCandidateV1[];
  bindings: HistoricalBindingCandidateV1[];
};

function object(value: unknown): value is Json {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
function exactKeys(value: Json, keys: string[]) {
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  return actual.length === expected.length && actual.every((key, index) => key === expected[index]);
}
function identity(value: unknown): value is string {
  return typeof value === "string" && IDENTITY.test(value);
}
function count(value: unknown): value is number {
  return Number.isSafeInteger(value) && Number(value) >= 0;
}

export function parseHistoricalCustodyOwnerV1(
  value: unknown,
  startedAt: number,
  observedAt: number,
): HistoricalCustodyProjectionV1 | null {
  if (!object(value) || !exactKeys(value, [
    "schema_version", "operation", "completeness", "observed_at_epoch_ms",
    "research_total", "artifact_attempt_total", "binding_total", "research",
    "artifact_attempts", "bindings",
  ]) || value.schema_version !== 1
    || value.operation !== "rd.historical_custody_quarantine.read.v1"
    || !["COMPLETE", "PARTIAL_TRUNCATED"].includes(String(value.completeness))
    || !count(value.observed_at_epoch_ms)
    || Number(value.observed_at_epoch_ms) < startedAt
    || Number(value.observed_at_epoch_ms) > observedAt
    || !count(value.research_total) || !count(value.artifact_attempt_total) || !count(value.binding_total)
    || !Array.isArray(value.research) || !Array.isArray(value.artifact_attempts) || !Array.isArray(value.bindings)) return null;
  const research = value.research.map((row) => {
    if (!object(row) || !exactKeys(row, ["request_identity", "committed_at_epoch_ms", "projection_state"])
      || !identity(row.request_identity) || !count(row.committed_at_epoch_ms)
      || row.projection_state !== "POINT_READ_REQUIRED") return null;
    return { requestIdentity: row.request_identity, committedAtEpochMs: row.committed_at_epoch_ms, projectionState: row.projection_state };
  });
  const artifactAttempts = value.artifact_attempts.map((row) => {
    if (!object(row) || !exactKeys(row, ["build_request_identity", "attempt_identity", "prepared_at_epoch_ms", "projection_state"])
      || !identity(row.build_request_identity) || !identity(row.attempt_identity)
      || !count(row.prepared_at_epoch_ms) || row.projection_state !== "POINT_READ_REQUIRED") return null;
    return { buildRequestIdentity: row.build_request_identity, attemptIdentity: row.attempt_identity, preparedAtEpochMs: row.prepared_at_epoch_ms, projectionState: row.projection_state };
  });
  const bindings = value.bindings.map((row) => {
    if (!object(row) || !exactKeys(row, ["binding_identity", "trial_family_identity", "committed_at_epoch_ms", "projection_state"])
      || !identity(row.binding_identity) || !identity(row.trial_family_identity)
      || !count(row.committed_at_epoch_ms) || row.projection_state !== "POINT_READ_REQUIRED") return null;
    return { bindingIdentity: row.binding_identity, trialFamilyIdentity: row.trial_family_identity, committedAtEpochMs: row.committed_at_epoch_ms, projectionState: row.projection_state };
  });
  if ([...research, ...artifactAttempts, ...bindings].some((row) => row === null)
    || research.length > Number(value.research_total)
    || artifactAttempts.length > Number(value.artifact_attempt_total)
    || bindings.length > Number(value.binding_total)) return null;
  return {
    resolution: "RETRIEVED",
    completeness: value.completeness as "COMPLETE" | "PARTIAL_TRUNCATED",
    observedAtEpochMs: value.observed_at_epoch_ms,
    researchTotal: value.research_total,
    artifactAttemptTotal: value.artifact_attempt_total,
    bindingTotal: value.binding_total,
    research: research as HistoricalResearchCandidateV1[],
    artifactAttempts: artifactAttempts as HistoricalArtifactCandidateV1[],
    bindings: bindings as HistoricalBindingCandidateV1[],
  };
}

function unavailable(reason: string, status: number, now: number) {
  return { status, envelope: {
    schema_version: 1 as const,
    operation: RD_HISTORICAL_CUSTODY_SHADOW_READ_OPERATION,
    channel: "DASHBOARD_SHADOW_READ" as const,
    transport_observed_at: new Date(now).toISOString(),
    availability: "unavailable" as const,
    unavailable_reason: reason,
    projection: { resolution: "SUBMITTED_OR_UNKNOWN" as const, completeness: "PARTIAL_TRUNCATED" as const, observedAtEpochMs: null, researchTotal: 0, artifactAttemptTotal: 0, bindingTotal: 0, research: [], artifactAttempts: [], bindings: [] },
  } };
}

export async function resolveHistoricalCustodyShadowV1({ baseUrl, token, fetcher = fetch, now = Date.now }: {
  baseUrl: string | undefined; token: string | undefined; fetcher?: Fetcher; now?: () => number;
}) {
  const endpoint = baseUrl ? ownerOperationUrlV1({ operationId: RD_HISTORICAL_CUSTODY_SHADOW_READ_OPERATION, baseUrl, identities: {} }) : null;
  if (!endpoint || !token) return unavailable("OWNER_CONFIGURATION_UNAVAILABLE", 503, now());
  const startedAt = now();
  try {
    const response = await fetcher(endpoint, { method: "GET", headers: { authorization: `Bearer ${token}` }, cache: "no-store", signal: AbortSignal.timeout(operationByIdV1(RD_HISTORICAL_CUSTODY_SHADOW_READ_OPERATION).timeout_class.milliseconds) });
    const body = await response.text();
    const observedAt = now();
    if (new TextEncoder().encode(body).byteLength > MAX_OWNER_RESPONSE_BYTES) return unavailable("OWNER_RESPONSE_UNAVAILABLE", 502, observedAt);
    if (response.status >= 500) return unavailable("OWNER_TRANSPORT_UNAVAILABLE", 503, observedAt);
    if (!response.ok) return unavailable("OWNER_RESPONSE_UNAVAILABLE", 502, observedAt);
    let raw: unknown;
    try { raw = JSON.parse(body); } catch { return unavailable("OWNER_RESPONSE_UNAVAILABLE", 502, observedAt); }
    const projection = parseHistoricalCustodyOwnerV1(raw, startedAt, observedAt);
    if (!projection) return unavailable("OWNER_RESPONSE_UNAVAILABLE", 502, observedAt);
    return { status: 200, envelope: { schema_version: 1 as const, operation: RD_HISTORICAL_CUSTODY_SHADOW_READ_OPERATION, channel: "DASHBOARD_SHADOW_READ" as const, transport_observed_at: new Date(observedAt).toISOString(), availability: "available" as const, unavailable_reason: null, projection } };
  } catch { return unavailable("OWNER_TRANSPORT_UNAVAILABLE", 503, now()); }
}

export function parseHistoricalCustodyBrowserEnvelopeV1(value: unknown): HistoricalCustodyProjectionV1 | null {
  if (!object(value) || value.schema_version !== 1 || value.operation !== RD_HISTORICAL_CUSTODY_SHADOW_READ_OPERATION
    || value.channel !== "DASHBOARD_SHADOW_READ" || value.availability !== "available"
    || value.unavailable_reason !== null || !object(value.projection) || !object(value.operational_run)
    || !validOperationalRunReferenceV1(value.operational_run, "available")) return null;
  const projection = value.projection as Json;
  if (!exactKeys(projection, ["resolution", "completeness", "observedAtEpochMs", "researchTotal", "artifactAttemptTotal", "bindingTotal", "research", "artifactAttempts", "bindings"])
    || projection.resolution !== "RETRIEVED" || !Array.isArray(projection.research)
    || !Array.isArray(projection.artifactAttempts) || !Array.isArray(projection.bindings)) return null;
  const transport = Date.parse(String(value.transport_observed_at));
  const operation = operationByIdV1(RD_HISTORICAL_CUSTODY_SHADOW_READ_OPERATION);
  const ownerShape = {
    schema_version: 1, operation: "rd.historical_custody_quarantine.read.v1", completeness: projection.completeness,
    observed_at_epoch_ms: projection.observedAtEpochMs, research_total: projection.researchTotal,
    artifact_attempt_total: projection.artifactAttemptTotal, binding_total: projection.bindingTotal,
    research: (projection.research as HistoricalResearchCandidateV1[]).map((row) => ({ request_identity: row.requestIdentity, committed_at_epoch_ms: row.committedAtEpochMs, projection_state: row.projectionState })),
    artifact_attempts: (projection.artifactAttempts as HistoricalArtifactCandidateV1[]).map((row) => ({ build_request_identity: row.buildRequestIdentity, attempt_identity: row.attemptIdentity, prepared_at_epoch_ms: row.preparedAtEpochMs, projection_state: row.projectionState })),
    bindings: (projection.bindings as HistoricalBindingCandidateV1[]).map((row) => ({ binding_identity: row.bindingIdentity, trial_family_identity: row.trialFamilyIdentity, committed_at_epoch_ms: row.committedAtEpochMs, projection_state: row.projectionState })),
  };
  return parseHistoricalCustodyOwnerV1(ownerShape, transport - operation.timeout_class.milliseconds, transport);
}
