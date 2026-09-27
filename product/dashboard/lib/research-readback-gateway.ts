import {
  RESEARCH_SHADOW_RESOLVE_OPERATION,
} from "./operation-registry.ts";
import { validExploratoryReplayOpaqueIdentityV2 } from "./exploratory-replay-identity.ts";
import { ownerApiTargetForOperationV1 } from "./owner-api-target.ts";
import {
  validResearchInitialPitV1,
  type ResearchInitialPitV1,
} from "../../rd-owner-client/consumer_projection_v1.ts";
import {
  resolveResearchShadowV1,
  type ResearchShadowResponse,
  type ResearchShadowUnavailableReason,
} from "./rd-shadow-client.ts";

const IDENTITY = /^[A-Za-z0-9._:/-]{1,192}$/u;
const DIGEST = /^sha256:[0-9a-f]{64}$/u;
// A Replay request V2 meaning digest, which the request contract computes with BLAKE3; the Research
// View states it in that form, and the Owner's validator refuses any other.
const REPLAY_MEANING_DIGEST = /^blake3:[0-9a-f]{64}$/u;
const REASON = new Set<ResearchShadowUnavailableReason>([
  "INVALID_REQUEST_IDENTITY",
  "OWNER_CONFIGURATION_UNAVAILABLE",
  "OWNER_TRANSPORT_UNAVAILABLE",
  "OWNER_RESPONSE_UNAVAILABLE",
]);

type Fetcher = typeof fetch;

export type ResearchReadbackOutcomeV1 = Readonly<{
  resolution: "accepted" | "rejected" | "quarantined";
  historicalDisposition: "accepted" | "rejected" | null;
  intentIdentity: string | null;
  rejectionCode: string | null;
  committedAt: string;
  // The Owner's initial PIT request for an accepted Intent, as stated; `null` means none, which is
  // every rejected or historical record and implies no request version.
  initialPit: ResearchInitialPitV1 | null;
  // The request version the Owner states from the admission the request was made under; `null` for
  // a historical record, whose admission the Owner no longer holds current. Never inferred.
  requestVersion: 2 | 3 | null;
  // A V3 request's instruments, exactly as it was admitted, even where that is why it was
  // rejected; `null` for a V2 request and wherever the version is `null`.
  instrumentIdentities: readonly string[] | null;
}>;

// The Composer run and the Replay request an exploration ran, as the verified view names them.
export type ResearchReadbackExplorationV1 = Readonly<{
  composerRequestIdentity: string;
  replayRequestIdentity: string;
  replayMeaningDigest: string;
}>;

export type ResearchReadbackViewV1 = Readonly<{
  availability: "available" | "stale";
  phase: "intent_frozen" | "artifact_available" | "exploration_active";
  observedAt: string;
  validThrough: string;
  nextStep: "wait_for_r_and_d_execution" | "review_artifact" | "refresh_same_request" | "view_exploratory_run";
  // Present exactly for `exploration_active`.
  exploration: ResearchReadbackExplorationV1 | null;
}>;

export type ResearchReadbackTechnicalV1 = Readonly<{
  ownerReceiptIdentity: string;
  semanticDigest: string;
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

// Each Owner phase and next legal action maps to exactly one page state. One outside these tables is
// not shown as a neighbour: an exploration read as `intent_frozen` would say the request is still
// waiting for its first run.
const PHASES: Readonly<Record<string, ResearchReadbackViewV1["phase"]>> = {
  INTENT_FROZEN: "intent_frozen",
  ARTIFACT_AVAILABLE: "artifact_available",
  EXPLORATION_ACTIVE: "exploration_active",
};
const NEXT_STEPS: Readonly<Record<string, ResearchReadbackViewV1["nextStep"]>> = {
  WAIT_FOR_R_AND_D_EXECUTION: "wait_for_r_and_d_execution",
  REVIEW_ARTIFACT: "review_artifact",
  RESOLVE_SAME_REQUEST_IDENTITY: "refresh_same_request",
  VIEW_EXPLORATORY_RUN: "view_exploratory_run",
};

function validExploration(value: unknown): value is ResearchReadbackExplorationV1 {
  return object(value) && exactKeys(value, ["composerRequestIdentity", "replayRequestIdentity", "replayMeaningDigest"])
    && identity(value.composerRequestIdentity)
    && validExploratoryReplayOpaqueIdentityV2(value.replayRequestIdentity)
    && typeof value.replayMeaningDigest === "string" && REPLAY_MEANING_DIGEST.test(value.replayMeaningDigest);
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
  const quarantined = projection.resolution === "LEGACY_TERMINAL_QUARANTINED";
  const researchView = accepted ? projection.research_view : null;
  const observedAt = researchView ? isoTime(researchView.observed_at_epoch_ms) : null;
  const validThrough = researchView ? isoTime(researchView.valid_through_epoch_ms) : null;
  const phase = researchView && Object.hasOwn(PHASES, researchView.phase) ? PHASES[researchView.phase] : null;
  const nextStep = researchView && Object.hasOwn(NEXT_STEPS, researchView.next_legal_action)
    ? NEXT_STEPS[researchView.next_legal_action]
    : null;
  const exploration = researchView && phase === "exploration_active" ? {
    composerRequestIdentity: researchView.composer_artifact?.composer_request_identity,
    replayRequestIdentity: researchView.exploration?.replay_request_identity,
    replayMeaningDigest: researchView.exploration?.replay_request_meaning_digest,
  } : null;
  const view = researchView && observedAt && validThrough && phase && nextStep
    && (exploration === null || validExploration(exploration)) ? {
    availability: researchView.availability === "STALE" ? "stale" as const : "available" as const,
    phase,
    observedAt,
    validThrough,
    nextStep,
    exploration,
  } : null;
  if (accepted && !view) return unavailable(requestIdentity, "OWNER_RESPONSE_UNAVAILABLE", 502);
  return {
    status: 200,
    projection: {
      availability: "available",
      requestIdentity,
      observedAt: response.envelope.transport_observed_at,
      outcome: {
        resolution: accepted ? "accepted" : quarantined ? "quarantined" : "rejected",
        historicalDisposition: quarantined
          ? receipt.disposition === "ACCEPTED" ? "accepted" : "rejected"
          : null,
        intentIdentity: accepted ? receipt.resulting_research_intent_identity : null,
        rejectionCode: accepted ? null : receipt.rejection_code,
        committedAt,
        initialPit: accepted ? projection.initial_pit : null,
        requestVersion: quarantined ? null : projection.request_schema_version,
        instrumentIdentities: quarantined ? null : projection.instrument_scope?.identities ?? null,
      },
      view,
      technical: {
        ownerReceiptIdentity: receipt.receipt_identity,
        semanticDigest: receipt.semantic_digest,
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
    "resolution", "historicalDisposition", "intentIdentity", "rejectionCode", "committedAt", "initialPit",
    "requestVersion", "instrumentIdentities",
  ]) || !["accepted", "rejected", "quarantined"].includes(String(value.outcome.resolution))
    || !validResearchInitialPitV1(value.outcome.initialPit)
    || (value.outcome.resolution !== "accepted" && value.outcome.initialPit !== null)
    || !(value.outcome.resolution === "quarantined"
      ? value.outcome.requestVersion === null
      : value.outcome.requestVersion === 2 || value.outcome.requestVersion === 3)
    || !(value.outcome.instrumentIdentities === null
      || (Array.isArray(value.outcome.instrumentIdentities)
        && value.outcome.instrumentIdentities.every((entry) => typeof entry === "string")))
    || (value.outcome.requestVersion === 3) !== (value.outcome.instrumentIdentities !== null)
    || (value.outcome.initialPit !== null && value.outcome.requestVersion !== 3)
    || !(value.outcome.historicalDisposition === null
      || ["accepted", "rejected"].includes(String(value.outcome.historicalDisposition)))
    || !(value.outcome.intentIdentity === null || identity(value.outcome.intentIdentity))
    || !(value.outcome.rejectionCode === null || identity(value.outcome.rejectionCode))
    || !canonicalTime(value.outcome.committedAt)
    || !object(value.technical) || !exactKeys(value.technical, [
      "ownerReceiptIdentity", "semanticDigest", "projectionIdentity", "sourceCut", "trialFamilyIdentity",
    ]) || !identity(value.technical.ownerReceiptIdentity)
    || typeof value.technical.semanticDigest !== "string"
    || !DIGEST.test(value.technical.semanticDigest)
    || ![value.technical.projectionIdentity, value.technical.sourceCut, value.technical.trialFamilyIdentity]
      .every((entry) => entry === null || identity(entry))) return null;
  if (value.outcome.resolution === "rejected") {
    return value.outcome.historicalDisposition === null
      && value.outcome.intentIdentity === null && identity(value.outcome.rejectionCode)
      && value.view === null && value.technical.projectionIdentity === null
      && value.technical.sourceCut === null && value.technical.trialFamilyIdentity === null
      ? value as ResearchReadbackProjectionV1
      : null;
  }
  if (value.outcome.resolution === "quarantined") {
    const historicalAccepted = value.outcome.historicalDisposition === "accepted"
      && value.outcome.rejectionCode === null;
    const historicalRejected = value.outcome.historicalDisposition === "rejected"
      && identity(value.outcome.rejectionCode);
    return value.outcome.intentIdentity === null && (historicalAccepted || historicalRejected)
      && value.view === null && value.technical.projectionIdentity === null
      && value.technical.sourceCut === null && value.technical.trialFamilyIdentity === null
      ? value as ResearchReadbackProjectionV1
      : null;
  }
  if (value.outcome.historicalDisposition !== null
    || !identity(value.outcome.intentIdentity) || value.outcome.rejectionCode !== null
    || !object(value.view) || !exactKeys(value.view, [
      "availability", "phase", "observedAt", "validThrough", "nextStep", "exploration",
    ]) || !["available", "stale"].includes(String(value.view.availability))
    || !Object.values(PHASES).includes(value.view.phase as ResearchReadbackViewV1["phase"])
    || !canonicalTime(value.view.observedAt) || !canonicalTime(value.view.validThrough)
    || !Object.values(NEXT_STEPS).includes(value.view.nextStep as ResearchReadbackViewV1["nextStep"])
    // An exploration is available or it is nothing, it always names what it ran, and only it leads
    // to its run.
    || (value.view.phase === "exploration_active") !== validExploration(value.view.exploration)
    || (value.view.phase !== "exploration_active" && value.view.exploration !== null)
    || (value.view.phase === "exploration_active") !== (value.view.nextStep === "view_exploratory_run")
    || (value.view.phase === "exploration_active" && value.view.availability !== "available")
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
