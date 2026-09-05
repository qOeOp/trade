import {
  operationByIdV1,
  ownerOperationUrlV1,
  RD_ITERATION_TIMELINE_SHADOW_READ_OPERATION,
} from "./operation-registry.ts";
import { validOperationalRunReferenceV1 } from "./operational-run-reference.ts";

const MAX_OWNER_RESPONSE_BYTES = 1_048_576;
const IDENTITY = /^[A-Za-z0-9._:/-]{1,256}$/;
const DIGEST = /^(?:sha256|blake3):[0-9a-f]{64}$/;
const DIAGNOSTIC_CATEGORIES = new Set([
  "NO_EXECUTION_DEFECT", "MARKET_DATA", "ARTIFACT", "RUNTIME_KERNEL",
  "BACKTEST_OPERATIONAL", "SIMULATOR", "REPLAY_CONFIGURATION",
  "VALID_ECONOMIC_FAILURE", "UNRESOLVED_FAILURE",
]);
const DECISION_TRANSITIONS = {
  REPLAY_REPAIR_REQUIRED: ["RESOLVE_REPLAY_DEFECT", "REPLAY_REPAIR_REQUIRED"],
  SUCCESSOR_INPUT_REQUIRED: ["AUTHOR_SUCCESSOR_INTENT", "AWAITING_SUCCESSOR_INTENT"],
  TERMINAL_STOP: ["NONE_TERMINAL", "TERMINAL"],
  RESEARCH_REVIEW_REQUIRED: ["REVIEW_ECONOMIC_EVIDENCE", "RESEARCH_REVIEW_REQUIRED"],
  EVIDENCE_UNRESOLVED: ["RESOLVE_EVIDENCE", "EVIDENCE_UNRESOLVED"],
} as const;

type Json = Record<string, unknown>;
type Fetcher = typeof fetch;

export type RdIterationDecisionV1 = {
  decisionIdentity: string;
  decisionDigest: string;
  roundOrdinal: number;
  predecessorDecisionIdentity: string | null;
  trialFamilyIdentity: string;
  intentIdentity: string;
  intentDigest: string;
  artifactIdentity: string;
  censusFrontierIdentity: string;
  censusFrontierDigest: string;
  replayRequestIdentity: string;
  replayRequestMeaningDigest: string;
  replayResultIdentity: string;
  replayResultDigest: string;
  diagnosticCategories: string[];
  disposition: string;
  nextLegalAction: string;
  committedAtEpochMs: number;
  receiptIdentity: string;
  receiptDigest: string;
};

export type RdIterationTimelineProjectionV1 = {
  trialFamilyIdentity: string;
  censusFrontierIdentity: string;
  censusFrontierDigest: string;
  consumedTrialBudget: number;
  trialBudget: number;
  state: "AWAITING_REPLAY_RESULT" | "REPLAY_REPAIR_REQUIRED" | "AWAITING_SUCCESSOR_INTENT"
    | "TERMINAL" | "RESEARCH_REVIEW_REQUIRED" | "EVIDENCE_UNRESOLVED";
  decisions: RdIterationDecisionV1[];
  observedAtEpochMs: number;
};

export type RdIterationTimelineShadowResponseV1 = {
  status: number;
  envelope: {
    schema_version: 1;
    operation: typeof RD_ITERATION_TIMELINE_SHADOW_READ_OPERATION;
    channel: "DASHBOARD_SHADOW_READ";
    trial_family_identity: string;
    transport_observed_at: string;
    availability: "available" | "unavailable";
    unavailable_reason: "INVALID_TRIAL_FAMILY_IDENTITY" | "OWNER_CONFIGURATION_UNAVAILABLE"
      | "OWNER_TRANSPORT_UNAVAILABLE" | "OWNER_RESPONSE_UNAVAILABLE" | null;
    projection: RdIterationTimelineProjectionV1 | null;
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

function digest(value: unknown): value is string {
  return typeof value === "string" && DIGEST.test(value);
}

function epoch(value: unknown): value is number {
  return Number.isSafeInteger(value) && Number(value) >= 0;
}

function parseDecision(value: unknown): RdIterationDecisionV1 | null {
  if (!object(value) || !exactKeys(value, [
    "schema_version", "decision_identity", "decision_digest", "trial_family_identity",
    "round_ordinal", "predecessor_decision_identity", "intent_identity", "intent_digest",
    "artifact_identity", "census_frontier_identity", "census_frontier_digest",
    "replay_request_identity", "replay_request_meaning_digest", "replay_result_identity",
    "replay_result_digest", "diagnostic_categories", "disposition", "next_legal_action",
    "committed_at_epoch_ms", "receipt_identity", "receipt_digest",
  ]) || value.schema_version !== 1 || !identity(value.decision_identity)
    || !digest(value.decision_digest) || !identity(value.trial_family_identity)
    || !Number.isSafeInteger(value.round_ordinal) || Number(value.round_ordinal) <= 0
    || !(value.predecessor_decision_identity === null || identity(value.predecessor_decision_identity))
    || !identity(value.intent_identity) || !digest(value.intent_digest)
    || !identity(value.artifact_identity) || !identity(value.census_frontier_identity)
    || !digest(value.census_frontier_digest) || !identity(value.replay_request_identity)
    || !digest(value.replay_request_meaning_digest) || !identity(value.replay_result_identity)
    || !digest(value.replay_result_digest) || !Array.isArray(value.diagnostic_categories)
    || !value.diagnostic_categories.every((category) => (
      typeof category === "string" && DIAGNOSTIC_CATEGORIES.has(category)
    ))
    || new Set(value.diagnostic_categories).size !== value.diagnostic_categories.length
    || !["REPLAY_REPAIR_REQUIRED", "SUCCESSOR_INPUT_REQUIRED", "TERMINAL_STOP",
      "RESEARCH_REVIEW_REQUIRED", "EVIDENCE_UNRESOLVED"].includes(String(value.disposition))
    || !["RESOLVE_REPLAY_DEFECT", "AUTHOR_SUCCESSOR_INTENT", "NONE_TERMINAL",
      "REVIEW_ECONOMIC_EVIDENCE", "RESOLVE_EVIDENCE"].includes(String(value.next_legal_action))
    || !epoch(value.committed_at_epoch_ms) || !identity(value.receipt_identity)
    || !digest(value.receipt_digest)) return null;
  return {
    decisionIdentity: value.decision_identity,
    decisionDigest: value.decision_digest,
    roundOrdinal: Number(value.round_ordinal),
    predecessorDecisionIdentity: value.predecessor_decision_identity as string | null,
    trialFamilyIdentity: value.trial_family_identity,
    intentIdentity: value.intent_identity,
    intentDigest: value.intent_digest,
    artifactIdentity: value.artifact_identity,
    censusFrontierIdentity: value.census_frontier_identity,
    censusFrontierDigest: value.census_frontier_digest,
    replayRequestIdentity: value.replay_request_identity,
    replayRequestMeaningDigest: value.replay_request_meaning_digest,
    replayResultIdentity: value.replay_result_identity,
    replayResultDigest: value.replay_result_digest,
    diagnosticCategories: value.diagnostic_categories as string[],
    disposition: String(value.disposition),
    nextLegalAction: String(value.next_legal_action),
    committedAtEpochMs: Number(value.committed_at_epoch_ms),
    receiptIdentity: value.receipt_identity,
    receiptDigest: value.receipt_digest,
  };
}

export function parseRdIterationTimelineOwnerV1(
  value: unknown,
  expectedTrialFamilyIdentity: string,
  requestStartedAtEpochMs: number,
  responseObservedAtEpochMs: number,
): RdIterationTimelineProjectionV1 | null {
  if (!object(value) || !exactKeys(value, [
    "schema_version", "trial_family_identity", "census_frontier_identity",
    "census_frontier_digest", "consumed_trial_budget", "trial_budget", "state",
    "decisions", "observed_at_epoch_ms",
  ]) || value.schema_version !== 1 || value.trial_family_identity !== expectedTrialFamilyIdentity
    || !identity(value.trial_family_identity) || !identity(value.census_frontier_identity)
    || !digest(value.census_frontier_digest) || !Number.isSafeInteger(value.consumed_trial_budget)
    || Number(value.consumed_trial_budget) <= 0 || !Number.isSafeInteger(value.trial_budget)
    || Number(value.trial_budget) < Number(value.consumed_trial_budget)
    || !["AWAITING_REPLAY_RESULT", "REPLAY_REPAIR_REQUIRED", "AWAITING_SUCCESSOR_INTENT",
      "TERMINAL", "RESEARCH_REVIEW_REQUIRED", "EVIDENCE_UNRESOLVED"].includes(String(value.state))
    || !Array.isArray(value.decisions) || !epoch(value.observed_at_epoch_ms)
    || value.observed_at_epoch_ms < requestStartedAtEpochMs
    || value.observed_at_epoch_ms > responseObservedAtEpochMs) return null;
  const decisions = value.decisions.map(parseDecision);
  if (decisions.some((decision) => decision === null)) return null;
  const parsed = decisions as RdIterationDecisionV1[];
  const decisionIdentities = new Set<string>();
  const decisionDigests = new Set<string>();
  const replayRequestIdentities = new Set<string>();
  const replayResultIdentities = new Set<string>();
  const receiptIdentities = new Set<string>();
  const receiptDigests = new Set<string>();
  let predecessor: string | null = null;
  let priorRound = 0;
  let priorCommittedAt = 0;
  for (const decision of parsed) {
    if (decisionIdentities.has(decision.decisionIdentity)
      || decisionDigests.has(decision.decisionDigest)
      || replayRequestIdentities.has(decision.replayRequestIdentity)
      || replayResultIdentities.has(decision.replayResultIdentity)
      || receiptIdentities.has(decision.receiptIdentity)
      || receiptDigests.has(decision.receiptDigest)
      || decision.predecessorDecisionIdentity !== predecessor
      || decision.trialFamilyIdentity !== value.trial_family_identity
      || decision.roundOrdinal !== priorRound + 1
      || decision.roundOrdinal > Number(value.consumed_trial_budget)
      || decision.committedAtEpochMs < priorCommittedAt
      || decision.committedAtEpochMs > Number(value.observed_at_epoch_ms)) return null;
    const transition = DECISION_TRANSITIONS[
      decision.disposition as keyof typeof DECISION_TRANSITIONS
    ];
    if (!transition || decision.nextLegalAction !== transition[0]) return null;
    decisionIdentities.add(decision.decisionIdentity);
    decisionDigests.add(decision.decisionDigest);
    replayRequestIdentities.add(decision.replayRequestIdentity);
    replayResultIdentities.add(decision.replayResultIdentity);
    receiptIdentities.add(decision.receiptIdentity);
    receiptDigests.add(decision.receiptDigest);
    predecessor = decision.decisionIdentity;
    priorRound = decision.roundOrdinal;
    priorCommittedAt = decision.committedAtEpochMs;
  }
  const expectedState = parsed.length === 0
    ? "AWAITING_REPLAY_RESULT"
    : DECISION_TRANSITIONS[parsed.at(-1)!.disposition as keyof typeof DECISION_TRANSITIONS]?.[1];
  if (value.state !== expectedState) return null;
  return {
    trialFamilyIdentity: value.trial_family_identity,
    censusFrontierIdentity: value.census_frontier_identity,
    censusFrontierDigest: value.census_frontier_digest,
    consumedTrialBudget: Number(value.consumed_trial_budget),
    trialBudget: Number(value.trial_budget),
    state: value.state as RdIterationTimelineProjectionV1["state"],
    decisions: parsed,
    observedAtEpochMs: Number(value.observed_at_epoch_ms),
  };
}

function unavailable(
  trialFamilyIdentity: string,
  reason: Exclude<RdIterationTimelineShadowResponseV1["envelope"]["unavailable_reason"], null>,
  status: number,
  nowEpochMs: number,
): RdIterationTimelineShadowResponseV1 {
  return {
    status,
    envelope: {
      schema_version: 1,
      operation: RD_ITERATION_TIMELINE_SHADOW_READ_OPERATION,
      channel: "DASHBOARD_SHADOW_READ",
      trial_family_identity: trialFamilyIdentity,
      transport_observed_at: new Date(nowEpochMs).toISOString(),
      availability: "unavailable",
      unavailable_reason: reason,
      projection: null,
    },
  };
}

export async function resolveRdIterationTimelineShadowV1({
  trialFamilyIdentity,
  baseUrl,
  token,
  fetcher = fetch,
  now = Date.now,
}: {
  trialFamilyIdentity: string;
  baseUrl: string | undefined;
  token: string | undefined;
  fetcher?: Fetcher;
  now?: () => number;
}): Promise<RdIterationTimelineShadowResponseV1> {
  if (!identity(trialFamilyIdentity)) {
    return unavailable(trialFamilyIdentity, "INVALID_TRIAL_FAMILY_IDENTITY", 400, now());
  }
  const operation = operationByIdV1(RD_ITERATION_TIMELINE_SHADOW_READ_OPERATION);
  const endpoint = baseUrl ? ownerOperationUrlV1({
    operationId: RD_ITERATION_TIMELINE_SHADOW_READ_OPERATION,
    baseUrl,
    identities: { trial_family_identity: trialFamilyIdentity },
  }) : null;
  if (!endpoint || !token) {
    return unavailable(trialFamilyIdentity, "OWNER_CONFIGURATION_UNAVAILABLE", 503, now());
  }
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
      return unavailable(trialFamilyIdentity, "OWNER_RESPONSE_UNAVAILABLE", 502, responseObservedAtEpochMs);
    }
    if (response.status >= 500) {
      return unavailable(trialFamilyIdentity, "OWNER_TRANSPORT_UNAVAILABLE", 503, responseObservedAtEpochMs);
    }
    if (!response.ok) {
      return unavailable(trialFamilyIdentity, "OWNER_RESPONSE_UNAVAILABLE", 502, responseObservedAtEpochMs);
    }
    let raw: unknown;
    try { raw = JSON.parse(body); } catch {
      return unavailable(trialFamilyIdentity, "OWNER_RESPONSE_UNAVAILABLE", 502, responseObservedAtEpochMs);
    }
    const projection = parseRdIterationTimelineOwnerV1(
      raw,
      trialFamilyIdentity,
      Math.max(0, requestStartedAtEpochMs - operation.timeout_class.milliseconds),
      responseObservedAtEpochMs,
    );
    if (!projection) {
      return unavailable(trialFamilyIdentity, "OWNER_RESPONSE_UNAVAILABLE", 502, responseObservedAtEpochMs);
    }
    return {
      status: 200,
      envelope: {
        schema_version: 1,
        operation: RD_ITERATION_TIMELINE_SHADOW_READ_OPERATION,
        channel: "DASHBOARD_SHADOW_READ",
        trial_family_identity: trialFamilyIdentity,
        transport_observed_at: new Date(responseObservedAtEpochMs).toISOString(),
        availability: "available",
        unavailable_reason: null,
        projection,
      },
    };
  } catch {
    return unavailable(trialFamilyIdentity, "OWNER_TRANSPORT_UNAVAILABLE", 503, now());
  }
}

export function parseRdIterationTimelineShadowEnvelopeV1(
  value: unknown,
): RdIterationTimelineProjectionV1 | null {
  if (!object(value) || !exactKeys(value, [
    "schema_version", "operation", "channel", "trial_family_identity",
    "transport_observed_at", "availability", "unavailable_reason", "projection",
    "operational_run",
  ]) || value.schema_version !== 1
    || value.operation !== RD_ITERATION_TIMELINE_SHADOW_READ_OPERATION
    || value.channel !== "DASHBOARD_SHADOW_READ" || !identity(value.trial_family_identity)
    || typeof value.transport_observed_at !== "string"
    || !Number.isFinite(Date.parse(value.transport_observed_at))
    || !validOperationalRunReferenceV1(
      value.operational_run,
      value.availability === "available" ? "available" : "unavailable",
    )) return null;
  if (value.availability === "unavailable") return null;
  if (value.availability !== "available" || value.unavailable_reason !== null
    || !object(value.projection) || !exactKeys(value.projection, [
      "trialFamilyIdentity", "censusFrontierIdentity", "censusFrontierDigest",
      "consumedTrialBudget", "trialBudget", "state", "decisions", "observedAtEpochMs",
    ]) || !Array.isArray(value.projection.decisions)
    || !value.projection.decisions.every((decision) => object(decision) && exactKeys(decision, [
      "decisionIdentity", "decisionDigest", "roundOrdinal", "predecessorDecisionIdentity",
      "trialFamilyIdentity", "intentIdentity", "intentDigest", "artifactIdentity",
      "censusFrontierIdentity", "censusFrontierDigest", "replayRequestIdentity",
      "replayRequestMeaningDigest", "replayResultIdentity", "replayResultDigest",
      "diagnosticCategories", "disposition", "nextLegalAction", "committedAtEpochMs",
      "receiptIdentity", "receiptDigest",
    ]))) return null;
  const observed = Date.parse(value.transport_observed_at);
  const operation = operationByIdV1(RD_ITERATION_TIMELINE_SHADOW_READ_OPERATION);
  const ownerShape = {
      schema_version: 1,
      trial_family_identity: value.projection.trialFamilyIdentity,
      census_frontier_identity: value.projection.censusFrontierIdentity,
      census_frontier_digest: value.projection.censusFrontierDigest,
      consumed_trial_budget: value.projection.consumedTrialBudget,
      trial_budget: value.projection.trialBudget,
      state: value.projection.state,
      decisions: value.projection.decisions
        .map((decision) => object(decision) ? {
          schema_version: 1,
          decision_identity: decision.decisionIdentity,
          decision_digest: decision.decisionDigest,
          trial_family_identity: decision.trialFamilyIdentity,
          round_ordinal: decision.roundOrdinal,
          predecessor_decision_identity: decision.predecessorDecisionIdentity,
          intent_identity: decision.intentIdentity,
          intent_digest: decision.intentDigest,
          artifact_identity: decision.artifactIdentity,
          census_frontier_identity: decision.censusFrontierIdentity,
          census_frontier_digest: decision.censusFrontierDigest,
          replay_request_identity: decision.replayRequestIdentity,
          replay_request_meaning_digest: decision.replayRequestMeaningDigest,
          replay_result_identity: decision.replayResultIdentity,
          replay_result_digest: decision.replayResultDigest,
          diagnostic_categories: decision.diagnosticCategories,
          disposition: decision.disposition,
          next_legal_action: decision.nextLegalAction,
          committed_at_epoch_ms: decision.committedAtEpochMs,
          receipt_identity: decision.receiptIdentity,
          receipt_digest: decision.receiptDigest,
        } : null),
      observed_at_epoch_ms: value.projection.observedAtEpochMs,
    };
  return parseRdIterationTimelineOwnerV1(
    ownerShape,
    value.trial_family_identity,
    observed - operation.timeout_class.milliseconds,
    observed,
  );
}
