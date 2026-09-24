import {
  operationByIdV1,
  ownerOperationUrlV1,
  RD_HISTORICAL_CUSTODY_SHADOW_READ_OPERATION,
} from "./operation-registry.ts";
import { validOperationalRunReferenceV1 } from "./operational-run-reference.ts";
import {
  newOwnerReadNonceV1,
  OWNER_READ_NONCE_HEADER,
  ownerReadNonceEchoedV1,
} from "./owner-read-nonce.ts";

const MAX_OWNER_RESPONSE_BYTES = 1_048_576;
const IDENTITY = /^[A-Za-z0-9._:/-]{1,256}$/;
const COMPLETENESS = ["COMPLETE", "PARTIAL_TRUNCATED"] as const;
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
  resolution: "RETRIEVED" | "UNAVAILABLE";
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
  return typeof value === "string" && IDENTITY.test(value) && value !== "." && value !== "..";
}
function count(value: unknown): value is number {
  return Number.isSafeInteger(value) && Number(value) >= 0;
}

function completeness(value: unknown): value is HistoricalCustodyProjectionV1["completeness"] {
  return typeof value === "string" && (COMPLETENESS as readonly string[]).includes(value);
}

function parseRows<T>(values: unknown[], parse: (value: unknown) => T | null): T[] | null {
  const rows: T[] = [];
  for (const value of values) {
    const row = parse(value);
    if (row === null) return null;
    rows.push(row);
  }
  return rows;
}

function parseOwnerResearchCandidate(value: unknown): HistoricalResearchCandidateV1 | null {
  if (!object(value) || !exactKeys(value, [
    "request_identity", "committed_at_epoch_ms", "projection_state",
  ]) || !identity(value.request_identity) || !count(value.committed_at_epoch_ms)
    || value.projection_state !== "POINT_READ_REQUIRED") return null;
  return {
    requestIdentity: value.request_identity,
    committedAtEpochMs: value.committed_at_epoch_ms,
    projectionState: "POINT_READ_REQUIRED",
  };
}

function parseOwnerArtifactCandidate(value: unknown): HistoricalArtifactCandidateV1 | null {
  if (!object(value) || !exactKeys(value, [
    "build_request_identity", "attempt_identity", "prepared_at_epoch_ms", "projection_state",
  ]) || !identity(value.build_request_identity) || !identity(value.attempt_identity)
    || !count(value.prepared_at_epoch_ms)
    || value.projection_state !== "POINT_READ_REQUIRED") return null;
  return {
    buildRequestIdentity: value.build_request_identity,
    attemptIdentity: value.attempt_identity,
    preparedAtEpochMs: value.prepared_at_epoch_ms,
    projectionState: "POINT_READ_REQUIRED",
  };
}

function parseOwnerBindingCandidate(value: unknown): HistoricalBindingCandidateV1 | null {
  if (!object(value) || !exactKeys(value, [
    "binding_identity", "trial_family_identity", "committed_at_epoch_ms", "projection_state",
  ]) || !identity(value.binding_identity) || !identity(value.trial_family_identity)
    || !count(value.committed_at_epoch_ms)
    || value.projection_state !== "POINT_READ_REQUIRED") return null;
  return {
    bindingIdentity: value.binding_identity,
    trialFamilyIdentity: value.trial_family_identity,
    committedAtEpochMs: value.committed_at_epoch_ms,
    projectionState: "POINT_READ_REQUIRED",
  };
}

// The observation time is the R&D Owner's clock, so it is compared only with the commit times that
// clock stamped, never with this process's; `resolveHistoricalCustodyShadowV1` binds the answer
// to its request by the echoed nonce instead.
export function parseHistoricalCustodyOwnerV1(value: unknown): HistoricalCustodyProjectionV1 | null {
  if (!object(value) || !exactKeys(value, [
    "schema_version", "operation", "completeness", "observed_at_epoch_ms",
    "research_total", "artifact_attempt_total", "binding_total", "research",
    "artifact_attempts", "bindings",
  ]) || value.schema_version !== 1
    || value.operation !== "rd.historical_custody_quarantine.read.v1"
    || !completeness(value.completeness)
    || !count(value.observed_at_epoch_ms)
    || !count(value.research_total) || !count(value.artifact_attempt_total) || !count(value.binding_total)
    || !Array.isArray(value.research) || !Array.isArray(value.artifact_attempts) || !Array.isArray(value.bindings)) return null;
  const research = parseRows(value.research, parseOwnerResearchCandidate);
  const artifactAttempts = parseRows(value.artifact_attempts, parseOwnerArtifactCandidate);
  const bindings = parseRows(value.bindings, parseOwnerBindingCandidate);
  if (research === null || artifactAttempts === null || bindings === null) return null;
  const observedAtEpochMs = Number(value.observed_at_epoch_ms);
  const researchTotal = Number(value.research_total);
  const artifactAttemptTotal = Number(value.artifact_attempt_total);
  const bindingTotal = Number(value.binding_total);
  if (research.length > 200 || artifactAttempts.length > 200 || bindings.length > 200) return null;
  const exactCounts = research.length === researchTotal
    && artifactAttempts.length === artifactAttemptTotal
    && bindings.length === bindingTotal;
  const truncatedCounts = research.length < researchTotal
    || artifactAttempts.length < artifactAttemptTotal
    || bindings.length < bindingTotal;
  if ((value.completeness === "COMPLETE" && !exactCounts)
    || (value.completeness === "PARTIAL_TRUNCATED" && !truncatedCounts)
    || research.some((row) => row.committedAtEpochMs > observedAtEpochMs)
    || artifactAttempts.some((row) => row.preparedAtEpochMs > observedAtEpochMs)
    || bindings.some((row) => row.committedAtEpochMs > observedAtEpochMs)
    || new Set(research.map((row) => row.requestIdentity)).size !== research.length
    || new Set(artifactAttempts.map((row) => (
      `${row.buildRequestIdentity}\u0000${row.attemptIdentity}`
    ))).size !== artifactAttempts.length
    || new Set(bindings.map((row) => row.bindingIdentity)).size !== bindings.length) return null;
  return {
    resolution: "RETRIEVED",
    completeness: value.completeness,
    observedAtEpochMs,
    researchTotal,
    artifactAttemptTotal,
    bindingTotal,
    research: research as HistoricalResearchCandidateV1[],
    artifactAttempts: artifactAttempts as HistoricalArtifactCandidateV1[],
    bindings: bindings as HistoricalBindingCandidateV1[],
  };
}

function parseBrowserResearchCandidate(value: unknown): HistoricalResearchCandidateV1 | null {
  if (!object(value) || !exactKeys(value, [
    "requestIdentity", "committedAtEpochMs", "projectionState",
  ]) || !identity(value.requestIdentity) || !count(value.committedAtEpochMs)
    || value.projectionState !== "POINT_READ_REQUIRED") return null;
  return {
    requestIdentity: value.requestIdentity,
    committedAtEpochMs: value.committedAtEpochMs,
    projectionState: "POINT_READ_REQUIRED",
  };
}

function parseBrowserArtifactCandidate(value: unknown): HistoricalArtifactCandidateV1 | null {
  if (!object(value) || !exactKeys(value, [
    "buildRequestIdentity", "attemptIdentity", "preparedAtEpochMs", "projectionState",
  ]) || !identity(value.buildRequestIdentity) || !identity(value.attemptIdentity)
    || !count(value.preparedAtEpochMs)
    || value.projectionState !== "POINT_READ_REQUIRED") return null;
  return {
    buildRequestIdentity: value.buildRequestIdentity,
    attemptIdentity: value.attemptIdentity,
    preparedAtEpochMs: value.preparedAtEpochMs,
    projectionState: "POINT_READ_REQUIRED",
  };
}

function parseBrowserBindingCandidate(value: unknown): HistoricalBindingCandidateV1 | null {
  if (!object(value) || !exactKeys(value, [
    "bindingIdentity", "trialFamilyIdentity", "committedAtEpochMs", "projectionState",
  ]) || !identity(value.bindingIdentity) || !identity(value.trialFamilyIdentity)
    || !count(value.committedAtEpochMs)
    || value.projectionState !== "POINT_READ_REQUIRED") return null;
  return {
    bindingIdentity: value.bindingIdentity,
    trialFamilyIdentity: value.trialFamilyIdentity,
    committedAtEpochMs: value.committedAtEpochMs,
    projectionState: "POINT_READ_REQUIRED",
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
    projection: { resolution: "UNAVAILABLE" as const, completeness: "PARTIAL_TRUNCATED" as const, observedAtEpochMs: null, researchTotal: 0, artifactAttemptTotal: 0, bindingTotal: 0, research: [], artifactAttempts: [], bindings: [] },
  } };
}

export async function resolveHistoricalCustodyShadowV1({ baseUrl, token, fetcher = fetch, now = Date.now }: {
  baseUrl: string | undefined; token: string | undefined; fetcher?: Fetcher; now?: () => number;
}) {
  const operation = operationByIdV1(RD_HISTORICAL_CUSTODY_SHADOW_READ_OPERATION);
  const endpoint = baseUrl ? ownerOperationUrlV1({ operationId: RD_HISTORICAL_CUSTODY_SHADOW_READ_OPERATION, baseUrl, identities: {} }) : null;
  if (!endpoint || !token) return unavailable("OWNER_CONFIGURATION_UNAVAILABLE", 503, now());
  const nonce = newOwnerReadNonceV1();
  try {
    const response = await fetcher(endpoint, { method: "GET", headers: { authorization: `Bearer ${token}`, [OWNER_READ_NONCE_HEADER]: nonce }, cache: "no-store", signal: AbortSignal.timeout(operation.timeout_class.milliseconds) });
    const body = await response.text();
    const observedAt = now();
    if (new TextEncoder().encode(body).byteLength > MAX_OWNER_RESPONSE_BYTES) return unavailable("OWNER_RESPONSE_UNAVAILABLE", 502, observedAt);
    if (response.status >= 500) return unavailable("OWNER_TRANSPORT_UNAVAILABLE", 503, observedAt);
    if (!response.ok || !ownerReadNonceEchoedV1(response, nonce)) return unavailable("OWNER_RESPONSE_UNAVAILABLE", 502, observedAt);
    let raw: unknown;
    try { raw = JSON.parse(body); } catch { return unavailable("OWNER_RESPONSE_UNAVAILABLE", 502, observedAt); }
    const projection = parseHistoricalCustodyOwnerV1(raw);
    if (!projection) return unavailable("OWNER_RESPONSE_UNAVAILABLE", 502, observedAt);
    return { status: 200, envelope: { schema_version: 1 as const, operation: RD_HISTORICAL_CUSTODY_SHADOW_READ_OPERATION, channel: "DASHBOARD_SHADOW_READ" as const, transport_observed_at: new Date(observedAt).toISOString(), availability: "available" as const, unavailable_reason: null, projection } };
  } catch { return unavailable("OWNER_TRANSPORT_UNAVAILABLE", 503, now()); }
}

export function parseHistoricalCustodyBrowserEnvelopeV1(value: unknown): HistoricalCustodyProjectionV1 | null {
  if (!object(value) || !exactKeys(value, [
    "schema_version", "operation", "channel", "transport_observed_at", "availability",
    "unavailable_reason", "projection", "operational_run",
  ]) || value.schema_version !== 1 || value.operation !== RD_HISTORICAL_CUSTODY_SHADOW_READ_OPERATION
    || value.channel !== "DASHBOARD_SHADOW_READ" || value.availability !== "available"
    || value.unavailable_reason !== null || !object(value.projection) || !object(value.operational_run)
    || !validOperationalRunReferenceV1(value.operational_run, "available")) return null;
  const projection = value.projection as Json;
  if (!exactKeys(projection, ["resolution", "completeness", "observedAtEpochMs", "researchTotal", "artifactAttemptTotal", "bindingTotal", "research", "artifactAttempts", "bindings"])
    || projection.resolution !== "RETRIEVED" || !Array.isArray(projection.research)
    || !Array.isArray(projection.artifactAttempts) || !Array.isArray(projection.bindings)) return null;
  const research = parseRows(projection.research, parseBrowserResearchCandidate);
  const artifactAttempts = parseRows(projection.artifactAttempts, parseBrowserArtifactCandidate);
  const bindings = parseRows(projection.bindings, parseBrowserBindingCandidate);
  if (research === null || artifactAttempts === null || bindings === null) return null;
  if (typeof value.transport_observed_at !== "string") return null;
  const transport = Date.parse(value.transport_observed_at);
  if (!count(transport)) return null;
  const ownerShape = {
    schema_version: 1, operation: "rd.historical_custody_quarantine.read.v1", completeness: projection.completeness,
    observed_at_epoch_ms: projection.observedAtEpochMs, research_total: projection.researchTotal,
    artifact_attempt_total: projection.artifactAttemptTotal, binding_total: projection.bindingTotal,
    research: research.map((row) => ({ request_identity: row.requestIdentity, committed_at_epoch_ms: row.committedAtEpochMs, projection_state: row.projectionState })),
    artifact_attempts: artifactAttempts.map((row) => ({ build_request_identity: row.buildRequestIdentity, attempt_identity: row.attemptIdentity, prepared_at_epoch_ms: row.preparedAtEpochMs, projection_state: row.projectionState })),
    bindings: bindings.map((row) => ({ binding_identity: row.bindingIdentity, trial_family_identity: row.trialFamilyIdentity, committed_at_epoch_ms: row.committedAtEpochMs, projection_state: row.projectionState })),
  };
  return parseHistoricalCustodyOwnerV1(ownerShape);
}
