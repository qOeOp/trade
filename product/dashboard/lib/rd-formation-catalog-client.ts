import {
  operationByIdV1,
  ownerOperationUrlV1,
  RD_FORMATION_CATALOG_SHADOW_READ_OPERATION,
} from "./operation-registry.ts";
import { validOperationalRunReferenceV1 } from "./operational-run-reference.ts";

const MAX_OWNER_RESPONSE_BYTES = 1_048_576;
const IDENTITY = /^[A-Za-z0-9._:/-]{1,256}$/;

type Json = Record<string, unknown>;
type Fetcher = typeof fetch;
type ObservationWindowV1 = {
  requestStartedAtEpochMs: number;
  responseObservedAtEpochMs: number;
};

export type RdFormationCatalogAttemptV1 = {
  buildRequestIdentity: string;
  attemptIdentity: string;
  preparedAtEpochMs: number;
  resolution: string;
  receiptIdentity: string | null;
  disposition: string | null;
  artifactIdentity: string | null;
  reviewIdentity: string | null;
  familyBindingIdentity: string | null;
};

export type RdFormationCatalogFamilyV1 = {
  trialFamilyIdentity: string;
  research: {
    requestIdentity: string;
    receiptIdentity: string;
    intentIdentity: string;
    committedAtEpochMs: number;
    viewAvailability: "AVAILABLE" | "STALE" | "UNAVAILABLE";
    nextLegalAction: string;
    trialBudget: number;
    consumedTrialBudget: number;
  };
  attemptHistory: RdFormationCatalogAttemptV1[];
};

export type RdFormationCatalogProjectionV1 = {
  resolution: "RETRIEVED" | "SUBMITTED_OR_UNKNOWN";
  completeness: "COMPLETE" | "PARTIAL_UNAVAILABLE";
  observedAtEpochMs: number | null;
  families: RdFormationCatalogFamilyV1[];
};

export type RdFormationCatalogShadowResponseV1 = {
  status: number;
  envelope: {
    schema_version: 1;
    operation: "rd_formation_catalog.shadow_read.v1";
    channel: "DASHBOARD_SHADOW_READ";
    transport_observed_at: string;
    availability: "available" | "unavailable";
    unavailable_reason: "OWNER_CONFIGURATION_UNAVAILABLE" | "OWNER_TRANSPORT_UNAVAILABLE" | "OWNER_RESPONSE_UNAVAILABLE" | null;
    projection: RdFormationCatalogProjectionV1;
  };
};

function object(value: unknown): value is Json {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function exactKeys(value: Json, keys: string[]): boolean {
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  return actual.length === expected.length
    && actual.every((key, index) => key === expected[index]);
}

function identity(value: unknown): value is string {
  return typeof value === "string" && IDENTITY.test(value);
}

function epoch(value: unknown): value is number {
  return Number.isSafeInteger(value) && Number(value) >= 0;
}

function isoInstant(value: unknown): value is string {
  if (typeof value !== "string") return false;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) && new Date(parsed).toISOString() === value;
}

function optionalIdentity(value: unknown): value is string | null {
  return value === null || identity(value);
}

function parseAttempt(value: unknown): RdFormationCatalogAttemptV1 | null {
  if (!object(value) || !exactKeys(value, [
    "build_request_identity", "attempt_identity", "prepared_at_epoch_ms", "resolution",
    "receipt_identity", "disposition", "artifact_identity", "review_identity",
    "family_binding_identity",
  ])) return null;
  if (!identity(value.build_request_identity) || !identity(value.attempt_identity)
    || !epoch(value.prepared_at_epoch_ms)
    || typeof value.resolution !== "string"
    || !["SUCCESS", "FAILED_NO_ARTIFACT", "REJECTED_NO_WRITE", "OUTCOME_UNKNOWN", "SUBMITTED_OR_UNKNOWN"].includes(value.resolution)
    || !optionalIdentity(value.receipt_identity)
    || !(value.disposition === null || (typeof value.disposition === "string"
      && ["SUCCESS", "FAILED_NO_ARTIFACT", "REJECTED_NO_WRITE", "OUTCOME_UNKNOWN"].includes(value.disposition)))
    || !optionalIdentity(value.artifact_identity)
    || !optionalIdentity(value.review_identity)
    || !optionalIdentity(value.family_binding_identity)) return null;
  const resolution = value.resolution;
  const disposition = value.disposition;
  const hasReceipt = value.receipt_identity !== null;
  const hasArtifact = value.artifact_identity !== null;
  const hasReview = value.review_identity !== null;
  const hasFamilyBinding = value.family_binding_identity !== null;
  if (resolution === "SUBMITTED_OR_UNKNOWN") {
    if (hasReceipt || disposition !== null || hasArtifact || hasReview || hasFamilyBinding) return null;
  } else if (!hasReceipt || disposition !== resolution) {
    return null;
  } else if (resolution === "SUCCESS") {
    if (!hasArtifact || !hasReview || !hasFamilyBinding) return null;
  } else if (hasArtifact || hasReview || hasFamilyBinding) {
    return null;
  }
  return {
    buildRequestIdentity: value.build_request_identity,
    attemptIdentity: value.attempt_identity,
    preparedAtEpochMs: value.prepared_at_epoch_ms,
    resolution,
    receiptIdentity: value.receipt_identity,
    disposition,
    artifactIdentity: value.artifact_identity,
    reviewIdentity: value.review_identity,
    familyBindingIdentity: value.family_binding_identity,
  };
}

function parseFamily(value: unknown): RdFormationCatalogFamilyV1 | null {
  if (!object(value) || !exactKeys(value, ["trial_family_identity", "research", "attempt_history"])
    || !identity(value.trial_family_identity) || !object(value.research)
    || !exactKeys(value.research, [
      "request_identity", "receipt_identity", "intent_identity", "committed_at_epoch_ms",
      "view_availability", "next_legal_action", "trial_budget", "consumed_trial_budget",
    ]) || !Array.isArray(value.attempt_history)) return null;
  const research = value.research;
  if (!identity(research.request_identity) || !identity(research.receipt_identity)
    || !identity(research.intent_identity) || !epoch(research.committed_at_epoch_ms)
    || typeof research.view_availability !== "string"
    || !["AVAILABLE", "STALE", "UNAVAILABLE"].includes(research.view_availability)
    || typeof research.next_legal_action !== "string"
    || ![
      "RESOLVE_SAME_REQUEST_IDENTITY",
      "WAIT_FOR_R_AND_D_EXECUTION",
      "CORRECT_INPUT_AND_CREATE_SUCCESSOR_REQUEST",
      "REVIEW_ARTIFACT",
    ].includes(research.next_legal_action)
    || !epoch(research.trial_budget) || !epoch(research.consumed_trial_budget)
    || Number(research.consumed_trial_budget) > Number(research.trial_budget)) return null;
  const attemptHistory = value.attempt_history.map(parseAttempt);
  if (attemptHistory.some((entry) => entry === null)) return null;
  const availableAction = research.view_availability === "AVAILABLE"
    && ["WAIT_FOR_R_AND_D_EXECUTION", "REVIEW_ARTIFACT"].includes(research.next_legal_action);
  const staleAction = research.view_availability === "STALE"
    && research.next_legal_action === "RESOLVE_SAME_REQUEST_IDENTITY";
  if (!availableAction && !staleAction) return null;
  if (research.view_availability === "AVAILABLE"
    && research.next_legal_action === "WAIT_FOR_R_AND_D_EXECUTION"
    && attemptHistory.some((attempt) => attempt?.resolution === "SUCCESS")) return null;
  return {
    trialFamilyIdentity: value.trial_family_identity,
    research: {
      requestIdentity: research.request_identity,
      receiptIdentity: research.receipt_identity,
      intentIdentity: research.intent_identity,
      committedAtEpochMs: research.committed_at_epoch_ms,
      viewAvailability: research.view_availability as "AVAILABLE" | "STALE" | "UNAVAILABLE",
      nextLegalAction: research.next_legal_action,
      trialBudget: research.trial_budget,
      consumedTrialBudget: research.consumed_trial_budget,
    },
    attemptHistory: attemptHistory as RdFormationCatalogAttemptV1[],
  };
}

export function parseRdFormationCatalogOwnerV1(
  value: unknown,
  observationWindow: ObservationWindowV1,
): RdFormationCatalogProjectionV1 | null {
  if (!object(value) || !exactKeys(value, [
    "schema_version", "operation", "completeness", "observed_at_epoch_ms", "families",
  ]) || value.schema_version !== 1 || value.operation !== "rd.formation_catalog.read.v1"
    || typeof value.completeness !== "string"
    || !["COMPLETE", "PARTIAL_UNAVAILABLE"].includes(value.completeness)
    || !epoch(value.observed_at_epoch_ms) || !Array.isArray(value.families)) return null;
  const observedAtEpochMs = value.observed_at_epoch_ms;
  if (!epoch(observationWindow.requestStartedAtEpochMs)
    || !epoch(observationWindow.responseObservedAtEpochMs)
    || observationWindow.requestStartedAtEpochMs > observationWindow.responseObservedAtEpochMs
    || observedAtEpochMs < observationWindow.requestStartedAtEpochMs
    || observedAtEpochMs > observationWindow.responseObservedAtEpochMs) return null;
  const families = value.families.map(parseFamily);
  if (families.some((entry) => entry === null)) return null;
  const parsed = families as RdFormationCatalogFamilyV1[];
  const familyIdentities = new Set(parsed.map((family) => family.trialFamilyIdentity));
  const researchIdentities = new Set(parsed.map((family) => family.research.requestIdentity));
  const attempts = parsed.flatMap((family) => family.attemptHistory);
  const uniqueNonNull = (values: Array<string | null>) => {
    const present = values.filter((value): value is string => value !== null);
    return new Set(present).size === present.length;
  };
  if (familyIdentities.size !== parsed.length || researchIdentities.size !== parsed.length
    || new Set(attempts.map((attempt) => attempt.attemptIdentity)).size !== attempts.length
    || new Set(attempts.map((attempt) => attempt.buildRequestIdentity)).size !== attempts.length
    || !uniqueNonNull(attempts.map((attempt) => attempt.receiptIdentity))
    || !uniqueNonNull(attempts.map((attempt) => attempt.artifactIdentity))
    || !uniqueNonNull(attempts.map((attempt) => attempt.reviewIdentity))
    || !uniqueNonNull(attempts.map((attempt) => attempt.familyBindingIdentity))) return null;
  if (parsed.some((family) => family.research.committedAtEpochMs > observedAtEpochMs
    || family.attemptHistory.some((attempt) => attempt.preparedAtEpochMs > observedAtEpochMs))) return null;
  for (let index = 1; index < parsed.length; index += 1) {
    const previous = parsed[index - 1];
    const current = parsed[index];
    if (previous.research.committedAtEpochMs < current.research.committedAtEpochMs
      || (previous.research.committedAtEpochMs === current.research.committedAtEpochMs
        && previous.trialFamilyIdentity > current.trialFamilyIdentity)) return null;
  }
  for (const family of parsed) {
    for (let index = 1; index < family.attemptHistory.length; index += 1) {
      const previous = family.attemptHistory[index - 1];
      const current = family.attemptHistory[index];
      if (previous.preparedAtEpochMs < current.preparedAtEpochMs
        || (previous.preparedAtEpochMs === current.preparedAtEpochMs
          && previous.attemptIdentity > current.attemptIdentity)) return null;
    }
  }
  return {
    resolution: "RETRIEVED",
    completeness: value.completeness as "COMPLETE" | "PARTIAL_UNAVAILABLE",
    observedAtEpochMs,
    families: parsed,
  };
}

function parseDashboardProjection(
  value: unknown,
  transportObservedAtEpochMs: number,
): RdFormationCatalogProjectionV1 | null {
  if (!object(value) || !exactKeys(value, [
    "resolution", "completeness", "observedAtEpochMs", "families",
  ]) || typeof value.resolution !== "string"
    || !["RETRIEVED", "SUBMITTED_OR_UNKNOWN"].includes(value.resolution)
    || typeof value.completeness !== "string"
    || !["COMPLETE", "PARTIAL_UNAVAILABLE"].includes(value.completeness)
    || !(value.observedAtEpochMs === null || epoch(value.observedAtEpochMs))
    || !Array.isArray(value.families)) return null;
  if (value.resolution === "SUBMITTED_OR_UNKNOWN") {
    return value.completeness === "PARTIAL_UNAVAILABLE"
      && value.observedAtEpochMs === null && value.families.length === 0
      ? value as RdFormationCatalogProjectionV1 : null;
  }
  const ownerFamilies = value.families.map((family) => {
    if (!object(family) || !exactKeys(family, [
      "trialFamilyIdentity", "research", "attemptHistory",
    ]) || !object(family.research) || !exactKeys(family.research, [
      "requestIdentity", "receiptIdentity", "intentIdentity", "committedAtEpochMs",
      "viewAvailability", "nextLegalAction", "trialBudget", "consumedTrialBudget",
    ]) || !Array.isArray(family.attemptHistory)) return null;
    const attempts = family.attemptHistory.map((attempt) => {
      if (!object(attempt) || !exactKeys(attempt, [
        "buildRequestIdentity", "attemptIdentity", "preparedAtEpochMs", "resolution",
        "receiptIdentity", "disposition", "artifactIdentity", "reviewIdentity",
        "familyBindingIdentity",
      ])) return null;
      return {
        build_request_identity: attempt.buildRequestIdentity,
        attempt_identity: attempt.attemptIdentity,
        prepared_at_epoch_ms: attempt.preparedAtEpochMs,
        resolution: attempt.resolution,
        receipt_identity: attempt.receiptIdentity,
        disposition: attempt.disposition,
        artifact_identity: attempt.artifactIdentity,
        review_identity: attempt.reviewIdentity,
        family_binding_identity: attempt.familyBindingIdentity,
      };
    });
    if (attempts.some((attempt) => attempt === null)) return null;
    return {
      trial_family_identity: family.trialFamilyIdentity,
      research: {
        request_identity: family.research.requestIdentity,
        receipt_identity: family.research.receiptIdentity,
        intent_identity: family.research.intentIdentity,
        committed_at_epoch_ms: family.research.committedAtEpochMs,
        view_availability: family.research.viewAvailability,
        next_legal_action: family.research.nextLegalAction,
        trial_budget: family.research.trialBudget,
        consumed_trial_budget: family.research.consumedTrialBudget,
      },
      attempt_history: attempts,
    };
  });
  if (ownerFamilies.some((family) => family === null)) return null;
  const ownerShape = {
    schema_version: 1,
    operation: "rd.formation_catalog.read.v1",
    completeness: value.completeness,
    observed_at_epoch_ms: value.observedAtEpochMs,
    families: ownerFamilies,
  };
  const operation = operationByIdV1(RD_FORMATION_CATALOG_SHADOW_READ_OPERATION);
  return parseRdFormationCatalogOwnerV1(ownerShape, {
    requestStartedAtEpochMs: transportObservedAtEpochMs - operation.timeout_class.milliseconds,
    responseObservedAtEpochMs: transportObservedAtEpochMs,
  });
}

export function parseRdFormationCatalogShadowEnvelopeV1(
  value: unknown,
): RdFormationCatalogProjectionV1 | null {
  if (!object(value) || !exactKeys(value, [
    "schema_version", "operation", "channel", "transport_observed_at", "availability",
    "unavailable_reason", "projection", "operational_run",
  ]) || value.schema_version !== 1
    || value.operation !== RD_FORMATION_CATALOG_SHADOW_READ_OPERATION
    || value.channel !== "DASHBOARD_SHADOW_READ"
    || !isoInstant(value.transport_observed_at)
    || typeof value.availability !== "string"
    || !["available", "unavailable"].includes(value.availability)
    || !object(value.operational_run)
    || !exactKeys(value.operational_run, [
      "schema_version", "availability", "unavailable_reason", "run_identity", "state",
      "owner_outcome_state", "transition_version",
    ])) return null;
  const transportObservedAtEpochMs = Date.parse(value.transport_observed_at);
  const projection = parseDashboardProjection(value.projection, transportObservedAtEpochMs);
  if (!projection || !validOperationalRunReferenceV1(
    value.operational_run,
    value.availability === "available" ? "available" : "unavailable",
  )) return null;
  if (value.availability === "available") {
    return value.unavailable_reason === null && projection.resolution === "RETRIEVED"
      ? projection : null;
  }
  return typeof value.unavailable_reason === "string"
    && [
      "OWNER_CONFIGURATION_UNAVAILABLE",
      "OWNER_TRANSPORT_UNAVAILABLE",
      "OWNER_RESPONSE_UNAVAILABLE",
    ].includes(value.unavailable_reason)
    && projection.resolution === "SUBMITTED_OR_UNKNOWN" ? projection : null;
}

function unavailable(
  reason: Exclude<RdFormationCatalogShadowResponseV1["envelope"]["unavailable_reason"], null>,
  status: number,
  observedAtEpochMs = Date.now(),
): RdFormationCatalogShadowResponseV1 {
  return {
    status,
    envelope: {
      schema_version: 1,
      operation: RD_FORMATION_CATALOG_SHADOW_READ_OPERATION,
      channel: "DASHBOARD_SHADOW_READ",
      transport_observed_at: new Date(observedAtEpochMs).toISOString(),
      availability: "unavailable",
      unavailable_reason: reason,
      projection: {
        resolution: "SUBMITTED_OR_UNKNOWN",
        completeness: "PARTIAL_UNAVAILABLE",
        observedAtEpochMs: null,
        families: [],
      },
    },
  };
}

export async function resolveRdFormationCatalogShadowV1({
  baseUrl,
  token,
  fetcher = fetch,
  now = Date.now,
}: {
  baseUrl: string | undefined;
  token: string | undefined;
  fetcher?: Fetcher;
  now?: () => number;
}): Promise<RdFormationCatalogShadowResponseV1> {
  const operation = operationByIdV1(RD_FORMATION_CATALOG_SHADOW_READ_OPERATION);
  const endpoint = baseUrl ? ownerOperationUrlV1({
    operationId: RD_FORMATION_CATALOG_SHADOW_READ_OPERATION,
    baseUrl,
    identities: {},
  }) : null;
  if (!endpoint || !token) return unavailable("OWNER_CONFIGURATION_UNAVAILABLE", 503, now());
  const requestStartedAtEpochMs = now();
  try {
    const response = await fetcher(endpoint, {
      method: "GET",
      headers: { authorization: `Bearer ${token}` },
      cache: "no-store",
      signal: AbortSignal.timeout(operation.timeout_class.milliseconds),
    });
    const body = await response.text();
    const responseObservedAtEpochMs = now();
    if (new TextEncoder().encode(body).byteLength > MAX_OWNER_RESPONSE_BYTES) {
      return unavailable("OWNER_RESPONSE_UNAVAILABLE", 502, responseObservedAtEpochMs);
    }
    if (response.status >= 500) {
      return unavailable("OWNER_TRANSPORT_UNAVAILABLE", 503, responseObservedAtEpochMs);
    }
    if (!response.ok) return unavailable("OWNER_RESPONSE_UNAVAILABLE", 502, responseObservedAtEpochMs);
    let raw: unknown;
    try { raw = JSON.parse(body); } catch {
      return unavailable("OWNER_RESPONSE_UNAVAILABLE", 502, responseObservedAtEpochMs);
    }
    const projection = parseRdFormationCatalogOwnerV1(raw, {
      requestStartedAtEpochMs,
      responseObservedAtEpochMs,
    });
    if (!projection) return unavailable("OWNER_RESPONSE_UNAVAILABLE", 502, responseObservedAtEpochMs);
    return {
      status: 200,
      envelope: {
        schema_version: 1,
        operation: RD_FORMATION_CATALOG_SHADOW_READ_OPERATION,
        channel: "DASHBOARD_SHADOW_READ",
        transport_observed_at: new Date(responseObservedAtEpochMs).toISOString(),
        availability: "available",
        unavailable_reason: null,
        projection,
      },
    };
  } catch {
    return unavailable("OWNER_TRANSPORT_UNAVAILABLE", 503, now());
  }
}
