import {
  RESEARCH_SHADOW_RESOLVE_OPERATION,
} from "./operation-registry.ts";
import { ownerApiTargetForOperationV1 } from "./owner-api-target.ts";
import {
  resolveResearchShadowV1,
  type ResearchShadowResponse,
  type ResearchShadowUnavailableReason,
} from "./rd-shadow-client.ts";

const IDENTITY = /^[A-Za-z0-9._:/-]{1,192}$/u;
const REASON = new Set<ResearchShadowUnavailableReason>([
  "INVALID_REQUEST_IDENTITY",
  "OWNER_CONFIGURATION_UNAVAILABLE",
  "OWNER_TRANSPORT_UNAVAILABLE",
  "OWNER_RESPONSE_UNAVAILABLE",
]);

type Fetcher = typeof fetch;

export type ResearchReadbackOutcomeV1 = Readonly<{
  resolution: "accepted" | "rejected";
  intentIdentity: string | null;
  rejectionCode: string | null;
  committedAt: string;
}>;

export type ResearchReadbackViewV1 = Readonly<{
  availability: "available" | "stale";
  phase: "intent_frozen" | "artifact_available";
  observedAt: string;
  validThrough: string;
  nextStep: "wait_for_r_and_d_execution" | "review_artifact" | "refresh_same_request";
}>;

export type ResearchReadbackTechnicalV1 = Readonly<{
  ownerReceiptIdentity: string;
  projectionIdentity: string | null;
  sourceCut: string | null;
  trialFamilyIdentity: string | null;
}>;

export type ResearchReadbackProjectionV1 = Readonly<{
  availability: "available" | "unavailable";
  requestIdentity: string;
  observedAt: string | null;
  outcome: ResearchReadbackOutcomeV1 | null;
  view: ResearchReadbackViewV1 | null;
  technical: ResearchReadbackTechnicalV1 | null;
  reason: ResearchShadowUnavailableReason | null;
}>;

export type ResearchReadbackGatewayResultV1 = Readonly<{
  status: 200 | 400 | 502 | 503;
  projection: ResearchReadbackProjectionV1;
}>;

function object(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function exactKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  return Object.keys(value).sort().join("|") === [...keys].sort().join("|");
}

function identity(value: unknown): value is string {
  return typeof value === "string" && IDENTITY.test(value);
}

function canonicalTime(value: unknown): value is string {
  if (typeof value !== "string") return false;
  const date = new Date(value);
  return !Number.isNaN(date.getTime()) && date.toISOString() === value;
}

function isoTime(value: unknown): string | null {
  if (!Number.isSafeInteger(value) || Number(value) < 0) return null;
  const date = new Date(Number(value));
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function unavailable(
  requestIdentity: string,
  reason: ResearchShadowUnavailableReason,
  status: ResearchReadbackGatewayResultV1["status"],
): ResearchReadbackGatewayResultV1 {
  return {
    status,
    projection: {
      availability: "unavailable",
      requestIdentity,
      observedAt: null,
      outcome: null,
      view: null,
      technical: null,
      reason,
    },
  };
}

function projectResponse(
  response: ResearchShadowResponse,
  requestIdentity: string,
): ResearchReadbackGatewayResultV1 {
  if (response.envelope.availability !== "available") {
    return unavailable(
      requestIdentity,
      response.envelope.unavailable_reason ?? "OWNER_RESPONSE_UNAVAILABLE",
      response.status === 400 ? 400 : response.status === 503 ? 503 : 502,
    );
  }
  const projection = response.envelope.projection;
  if (projection.request_identity !== requestIdentity) {
    return unavailable(requestIdentity, "OWNER_RESPONSE_UNAVAILABLE", 502);
  }
  if (projection.resolution === "SUBMITTED_OR_UNKNOWN") {
    return {
      status: 200,
      projection: {
        availability: "available",
        requestIdentity,
        observedAt: response.envelope.transport_observed_at,
        outcome: null,
        view: null,
        technical: null,
        reason: null,
      },
    };
  }
  const receipt = projection.owner_receipt;
  const committedAt = isoTime(receipt?.committed_at_epoch_ms);
  if (!receipt || !committedAt) {
    return unavailable(requestIdentity, "OWNER_RESPONSE_UNAVAILABLE", 502);
  }
  const accepted = projection.resolution === "ACCEPTED";
  const researchView = accepted ? projection.research_view : null;
  const observedAt = researchView ? isoTime(researchView.observed_at_epoch_ms) : null;
  const validThrough = researchView ? isoTime(researchView.valid_through_epoch_ms) : null;
  const view = researchView && observedAt && validThrough ? {
    availability: researchView.availability === "STALE" ? "stale" as const : "available" as const,
    phase: researchView.phase === "ARTIFACT_AVAILABLE" ? "artifact_available" as const : "intent_frozen" as const,
    observedAt,
    validThrough,
    nextStep: researchView.next_legal_action === "REVIEW_ARTIFACT"
      ? "review_artifact" as const
      : researchView.next_legal_action === "RESOLVE_SAME_REQUEST_IDENTITY"
        ? "refresh_same_request" as const
        : "wait_for_r_and_d_execution" as const,
  } : null;
  if (accepted && !view) return unavailable(requestIdentity, "OWNER_RESPONSE_UNAVAILABLE", 502);
  return {
    status: 200,
    projection: {
      availability: "available",
      requestIdentity,
      observedAt: response.envelope.transport_observed_at,
      outcome: {
        resolution: accepted ? "accepted" : "rejected",
        intentIdentity: accepted ? receipt.resulting_research_intent_identity : null,
        rejectionCode: accepted ? null : receipt.rejection_code,
        committedAt,
      },
      view,
      technical: {
        ownerReceiptIdentity: receipt.receipt_identity,
        projectionIdentity: researchView?.projection_identity ?? null,
        sourceCut: researchView?.source_cut ?? null,
        trialFamilyIdentity: accepted
          ? projection.trial_family?.root.trial_family_identity ?? null
          : null,
      },
      reason: null,
    },
  };
}

export function parseResearchReadbackBrowserProjectionV1(
  value: unknown,
  expectedRequestIdentity?: string,
): ResearchReadbackProjectionV1 | null {
  if (!object(value) || !exactKeys(value, [
    "availability", "requestIdentity", "observedAt", "outcome", "view", "technical", "reason",
  ]) || !["available", "unavailable"].includes(String(value.availability))
    || !identity(value.requestIdentity)
    || (expectedRequestIdentity !== undefined && value.requestIdentity !== expectedRequestIdentity)
    || !(value.observedAt === null || canonicalTime(value.observedAt))
    || !(value.reason === null || REASON.has(value.reason as ResearchShadowUnavailableReason))) return null;
  if (value.availability === "unavailable") {
    return value.observedAt === null && value.outcome === null && value.view === null
      && value.technical === null && value.reason !== null
      ? value as ResearchReadbackProjectionV1
      : null;
  }
  if (!canonicalTime(value.observedAt) || value.reason !== null) return null;
  if (value.outcome === null) {
    return value.view === null && value.technical === null
      ? value as ResearchReadbackProjectionV1
      : null;
  }
  if (!object(value.outcome) || !exactKeys(value.outcome, [
    "resolution", "intentIdentity", "rejectionCode", "committedAt",
  ]) || !["accepted", "rejected"].includes(String(value.outcome.resolution))
    || !(value.outcome.intentIdentity === null || identity(value.outcome.intentIdentity))
    || !(value.outcome.rejectionCode === null || identity(value.outcome.rejectionCode))
    || !canonicalTime(value.outcome.committedAt)
    || !object(value.technical) || !exactKeys(value.technical, [
      "ownerReceiptIdentity", "projectionIdentity", "sourceCut", "trialFamilyIdentity",
    ]) || !identity(value.technical.ownerReceiptIdentity)
    || ![value.technical.projectionIdentity, value.technical.sourceCut, value.technical.trialFamilyIdentity]
      .every((entry) => entry === null || identity(entry))) return null;
  if (value.outcome.resolution === "rejected") {
    return value.outcome.intentIdentity === null && identity(value.outcome.rejectionCode)
      && value.view === null && value.technical.projectionIdentity === null
      && value.technical.sourceCut === null && value.technical.trialFamilyIdentity === null
      ? value as ResearchReadbackProjectionV1
      : null;
  }
  if (!identity(value.outcome.intentIdentity) || value.outcome.rejectionCode !== null
    || !object(value.view) || !exactKeys(value.view, [
      "availability", "phase", "observedAt", "validThrough", "nextStep",
    ]) || !["available", "stale"].includes(String(value.view.availability))
    || !["intent_frozen", "artifact_available"].includes(String(value.view.phase))
    || !canonicalTime(value.view.observedAt) || !canonicalTime(value.view.validThrough)
    || !["wait_for_r_and_d_execution", "review_artifact", "refresh_same_request"]
      .includes(String(value.view.nextStep))
    || !identity(value.technical.projectionIdentity)
    || !identity(value.technical.sourceCut)
    || !identity(value.technical.trialFamilyIdentity)) return null;
  return value as ResearchReadbackProjectionV1;
}

export async function readResearchReadbackGatewayV1({
  requestIdentity,
  environment = process.env,
  fetcher = fetch,
}: {
  requestIdentity: string;
  environment?: Record<string, string | undefined>;
  fetcher?: Fetcher;
}): Promise<ResearchReadbackGatewayResultV1> {
  const target = ownerApiTargetForOperationV1(RESEARCH_SHADOW_RESOLVE_OPERATION, environment);
  const response = await resolveResearchShadowV1({
    requestIdentity,
    baseUrl: target.baseUrl,
    token: target.token,
    fetcher,
  });
  return projectResponse(response, requestIdentity);
}
