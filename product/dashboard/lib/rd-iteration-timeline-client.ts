import {
  announcedOwnerReadBudgetMsV1,
  operationByIdV1,
  ownerOperationUrlV1,
  RD_ITERATION_TIMELINE_SHADOW_READ_OPERATION,
} from "./operation-registry.ts";
import {
  newOwnerReadNonceV1,
  OWNER_READ_NONCE_HEADER,
  ownerReadNonceEchoedV1,
} from "./owner-read-nonce.ts";
import { validOperationalRunReferenceV1 } from "./operational-run-reference.ts";

const MAX_OWNER_RESPONSE_BYTES = 1_048_576;
const IDENTITY = /^[A-Za-z0-9._:/-]{1,256}$/;
const DIGEST = /^(?:sha256|blake3):[0-9a-f]{64}$/;
const REPAIR_CATEGORIES = [
  "MARKET_DATA", "ARTIFACT", "RUNTIME_KERNEL", "BACKTEST_OPERATIONAL", "SIMULATOR",
  "REPLAY_CONFIGURATION",
] as const;
const REPAIR_TARGETS = [
  "MARKET_DATA", "RESEARCH_DEVELOP", "RUNTIME", "BACKTEST_RUNNER_SERVICE", "SIM_EXCHANGE",
  "RESEARCH_REPLAY_CONFIGURATION",
] as const;
const TERMINAL_REASONS = [
  "FALSIFIER_SATISFIED", "FROZEN_STOP_RULE_SATISFIED", "TRIAL_BUDGET_EXHAUSTED",
  "ECONOMIC_IMPOSSIBILITY", "LOW_INFORMATION_VALUE", "INPUT_UNAVAILABLE",
] as const;
const ACTIONS = [
  "SUBMIT_REPAIR_REQUEST", "CREATE_SUCCESSOR_INTENT", "STOP_ON_COMMITTED_DECISION",
  "SUBMIT_SELECTED_CANDIDATE_TO_QUALIFICATION",
] as const;
const STATES = [
  "AWAITING_REPLAY_RESULT", "REPAIR_REQUIRED", "SUCCESSOR_REQUIRED", "TERMINAL",
  "READY_FOR_QUALIFICATION",
] as const;

type Json = Record<string, unknown>;
type Fetcher = typeof fetch;
type RepairCategory = typeof REPAIR_CATEGORIES[number];
type RepairTarget = typeof REPAIR_TARGETS[number];
type TerminalReason = typeof TERMINAL_REASONS[number];

export type RdIterationNextLegalActionV1 = typeof ACTIONS[number];
export type RdIterationTimelineStateV1 = typeof STATES[number];
export type RdIterationDecisionOutcomeV1 =
  | { outcome: "REPAIR_INPUTS"; category: RepairCategory; target: RepairTarget }
  | { outcome: "SUCCESSOR_EXPERIMENT"; experiment_identity: string; experiment_digest: string }
  | { outcome: "READY_FOR_SELECTION"; candidate_identity: string; candidate_digest: string }
  | { outcome: "TERMINAL_STOP"; reason: TerminalReason };

export type RdIterationDecisionV1 = {
  decisionIdentity: string;
  decisionDigest: string;
  roundOrdinal: number;
  trialFamilyIdentity: string;
  censusFrontierIdentity: string;
  censusFrontierDigest: string;
  requestIdentity: string;
  resultIdentity: string;
  attemptIdentity: string;
  outcome: RdIterationDecisionOutcomeV1;
  nextLegalAction: RdIterationNextLegalActionV1;
  committedAtEpochMs: number;
  receiptIdentity: string;
};

export type RdIterationTimelineProjectionV1 = {
  trialFamilyIdentity: string;
  censusFrontierIdentity: string;
  censusFrontierDigest: string;
  consumedTrialBudget: number;
  trialBudget: number;
  state: RdIterationTimelineStateV1;
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

function exactKeys(value: Json, keys: readonly string[]): boolean {
  return Object.keys(value).sort().join("|") === [...keys].sort().join("|");
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

function memberOf<const T extends readonly string[]>(values: T, value: unknown): value is T[number] {
  return typeof value === "string" && (values as readonly string[]).includes(value);
}

function parseOutcome(value: unknown): RdIterationDecisionOutcomeV1 | null {
  if (!object(value) || typeof value.outcome !== "string") return null;
  switch (value.outcome) {
    case "REPAIR_INPUTS":
      return exactKeys(value, ["outcome", "category", "target"])
        && memberOf(REPAIR_CATEGORIES, value.category) && memberOf(REPAIR_TARGETS, value.target)
        ? value as RdIterationDecisionOutcomeV1 : null;
    case "SUCCESSOR_EXPERIMENT":
      return exactKeys(value, ["outcome", "experiment_identity", "experiment_digest"])
        && identity(value.experiment_identity) && digest(value.experiment_digest)
        ? value as RdIterationDecisionOutcomeV1 : null;
    case "READY_FOR_SELECTION":
      return exactKeys(value, ["outcome", "candidate_identity", "candidate_digest"])
        && identity(value.candidate_identity) && digest(value.candidate_digest)
        ? value as RdIterationDecisionOutcomeV1 : null;
    case "TERMINAL_STOP":
      return exactKeys(value, ["outcome", "reason"]) && memberOf(TERMINAL_REASONS, value.reason)
        ? value as RdIterationDecisionOutcomeV1 : null;
    default:
      return null;
  }
}

function expectedAction(outcome: RdIterationDecisionOutcomeV1): RdIterationNextLegalActionV1 {
  if (outcome.outcome === "REPAIR_INPUTS") return "SUBMIT_REPAIR_REQUEST";
  if (outcome.outcome === "SUCCESSOR_EXPERIMENT") return "CREATE_SUCCESSOR_INTENT";
  if (outcome.outcome === "READY_FOR_SELECTION") return "SUBMIT_SELECTED_CANDIDATE_TO_QUALIFICATION";
  return "STOP_ON_COMMITTED_DECISION";
}

function expectedState(decisions: readonly RdIterationDecisionV1[]): RdIterationTimelineStateV1 {
  const action = decisions.at(-1)?.nextLegalAction;
  if (!action) return "AWAITING_REPLAY_RESULT";
  if (action === "SUBMIT_REPAIR_REQUEST") return "REPAIR_REQUIRED";
  if (action === "CREATE_SUCCESSOR_INTENT") return "SUCCESSOR_REQUIRED";
  if (action === "SUBMIT_SELECTED_CANDIDATE_TO_QUALIFICATION") return "READY_FOR_QUALIFICATION";
  return "TERMINAL";
}

function parseDecision(value: unknown): RdIterationDecisionV1 | null {
  if (!object(value) || !exactKeys(value, [
    "decision_identity", "decision_digest", "round_ordinal", "trial_family_identity",
    "census_frontier_identity", "census_frontier_digest", "request_identity", "result_identity",
    "attempt_identity", "outcome", "next_legal_action", "committed_at_epoch_ms", "receipt_identity",
  ]) || !identity(value.decision_identity) || !digest(value.decision_digest)
    || !Number.isSafeInteger(value.round_ordinal) || Number(value.round_ordinal) <= 0
    || !identity(value.trial_family_identity) || !identity(value.census_frontier_identity)
    || !digest(value.census_frontier_digest) || !identity(value.request_identity)
    || !identity(value.result_identity) || !identity(value.attempt_identity)
    || !memberOf(ACTIONS, value.next_legal_action) || !epoch(value.committed_at_epoch_ms)
    || !identity(value.receipt_identity)) return null;
  const outcome = parseOutcome(value.outcome);
  if (!outcome || expectedAction(outcome) !== value.next_legal_action) return null;
  return {
    decisionIdentity: value.decision_identity,
    decisionDigest: value.decision_digest,
    roundOrdinal: Number(value.round_ordinal),
    trialFamilyIdentity: value.trial_family_identity,
    censusFrontierIdentity: value.census_frontier_identity,
    censusFrontierDigest: value.census_frontier_digest,
    requestIdentity: value.request_identity,
    resultIdentity: value.result_identity,
    attemptIdentity: value.attempt_identity,
    outcome,
    nextLegalAction: value.next_legal_action,
    committedAtEpochMs: Number(value.committed_at_epoch_ms),
    receiptIdentity: value.receipt_identity,
  };
}

// The observation time is the R&D Owner's clock, so it is compared only with the commit times that
// clock stamped, never with this process's; `resolveRdIterationTimelineShadowV1` binds the answer
// to its request by the echoed nonce instead.
export function parseRdIterationTimelineOwnerV1(
  value: unknown,
  expectedTrialFamilyIdentity: string,
): RdIterationTimelineProjectionV1 | null {
  if (!object(value) || !exactKeys(value, [
    "schema_version", "trial_family_identity", "census_frontier_identity",
    "census_frontier_digest", "consumed_trial_budget", "trial_budget", "state", "decisions",
    "observed_at_epoch_ms",
  ]) || value.schema_version !== 1 || value.trial_family_identity !== expectedTrialFamilyIdentity
    || !identity(value.trial_family_identity) || !identity(value.census_frontier_identity)
    || !digest(value.census_frontier_digest) || !epoch(value.consumed_trial_budget)
    || !epoch(value.trial_budget) || Number(value.consumed_trial_budget) > Number(value.trial_budget)
    || !memberOf(STATES, value.state) || !Array.isArray(value.decisions)
    || value.decisions.length > 128 || !epoch(value.observed_at_epoch_ms)) return null;
  const decisions = value.decisions.map(parseDecision);
  if (decisions.some((decision) => decision === null)) return null;
  const parsed = decisions as RdIterationDecisionV1[];
  const identities = new Set<string>();
  let priorCommit = 0;
  for (const [index, decision] of parsed.entries()) {
    const unique = [decision.decisionIdentity, decision.decisionDigest, decision.resultIdentity,
      decision.attemptIdentity, decision.receiptIdentity];
    if (unique.some((entry) => identities.has(entry)) || decision.roundOrdinal !== index + 1
      || decision.trialFamilyIdentity !== value.trial_family_identity
      || decision.committedAtEpochMs < priorCommit
      || decision.committedAtEpochMs > Number(value.observed_at_epoch_ms)) return null;
    unique.forEach((entry) => identities.add(entry));
    priorCommit = decision.committedAtEpochMs;
  }
  if (value.state !== expectedState(parsed)) return null;
  return {
    trialFamilyIdentity: value.trial_family_identity,
    censusFrontierIdentity: value.census_frontier_identity,
    censusFrontierDigest: value.census_frontier_digest,
    consumedTrialBudget: Number(value.consumed_trial_budget),
    trialBudget: Number(value.trial_budget),
    state: value.state,
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
  return { status, envelope: {
    schema_version: 1,
    operation: RD_ITERATION_TIMELINE_SHADOW_READ_OPERATION,
    channel: "DASHBOARD_SHADOW_READ",
    trial_family_identity: trialFamilyIdentity,
    transport_observed_at: new Date(nowEpochMs).toISOString(),
    availability: "unavailable",
    unavailable_reason: reason,
    projection: null,
  } };
}

export async function resolveRdIterationTimelineShadowV1({
  trialFamilyIdentity, baseUrl, token, fetcher = fetch, now = Date.now,
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
  const nonce = newOwnerReadNonceV1();
  try {
    const response = await fetcher(endpoint, {
      method: "GET",
      headers: { authorization: `Bearer ${token}`, [OWNER_READ_NONCE_HEADER]: nonce },
      cache: "no-store",
      signal: AbortSignal.timeout(
        announcedOwnerReadBudgetMsV1("rd iteration timeline", operation.timeout_class.milliseconds),
      ),
    });
    const body = await response.text();
    const observedAt = now();
    if (new TextEncoder().encode(body).byteLength > MAX_OWNER_RESPONSE_BYTES) {
      return unavailable(trialFamilyIdentity, "OWNER_RESPONSE_UNAVAILABLE", 502, observedAt);
    }
    if (response.status >= 500) {
      return unavailable(trialFamilyIdentity, "OWNER_TRANSPORT_UNAVAILABLE", 503, observedAt);
    }
    if (!response.ok || !ownerReadNonceEchoedV1(response, nonce)) {
      return unavailable(trialFamilyIdentity, "OWNER_RESPONSE_UNAVAILABLE", 502, observedAt);
    }
    let raw: unknown;
    try { raw = JSON.parse(body); } catch {
      return unavailable(trialFamilyIdentity, "OWNER_RESPONSE_UNAVAILABLE", 502, observedAt);
    }
    const projection = parseRdIterationTimelineOwnerV1(raw, trialFamilyIdentity);
    if (!projection) {
      return unavailable(trialFamilyIdentity, "OWNER_RESPONSE_UNAVAILABLE", 502, observedAt);
    }
    return { status: 200, envelope: {
      schema_version: 1,
      operation: RD_ITERATION_TIMELINE_SHADOW_READ_OPERATION,
      channel: "DASHBOARD_SHADOW_READ",
      trial_family_identity: trialFamilyIdentity,
      transport_observed_at: new Date(observedAt).toISOString(),
      availability: "available",
      unavailable_reason: null,
      projection,
    } };
  } catch {
    return unavailable(trialFamilyIdentity, "OWNER_TRANSPORT_UNAVAILABLE", 503, now());
  }
}

export function parseRdIterationTimelineDirectEnvelopeV1(
  value: unknown,
  expectedTrialFamilyIdentity: string,
): RdIterationTimelineProjectionV1 | null {
  if (!object(value) || !exactKeys(value, [
    "schema_version", "operation", "channel", "trial_family_identity", "transport_observed_at",
    "availability", "unavailable_reason", "projection",
  ]) || value.schema_version !== 1 || value.operation !== RD_ITERATION_TIMELINE_SHADOW_READ_OPERATION
    || value.channel !== "DASHBOARD_SHADOW_READ"
    || value.trial_family_identity !== expectedTrialFamilyIdentity
    || typeof value.transport_observed_at !== "string"
    || !Number.isFinite(Date.parse(value.transport_observed_at))
    || value.availability !== "available" || value.unavailable_reason !== null
    || !object(value.projection)) return null;
  return parseBrowserProjection(value.projection, expectedTrialFamilyIdentity);
}

export function parseRdIterationTimelineShadowEnvelopeV1(
  value: unknown,
): RdIterationTimelineProjectionV1 | null {
  if (!object(value) || !exactKeys(value, [
    "schema_version", "operation", "channel", "trial_family_identity", "transport_observed_at",
    "availability", "unavailable_reason", "projection", "operational_run",
  ]) || value.schema_version !== 1 || value.operation !== RD_ITERATION_TIMELINE_SHADOW_READ_OPERATION
    || value.channel !== "DASHBOARD_SHADOW_READ" || !identity(value.trial_family_identity)
    || typeof value.transport_observed_at !== "string"
    || !Number.isFinite(Date.parse(value.transport_observed_at))
    || !validOperationalRunReferenceV1(value.operational_run,
      value.availability === "available" ? "available" : "unavailable")) return null;
  if (value.availability !== "available" || value.unavailable_reason !== null
    || !object(value.projection)) return null;
  return parseBrowserProjection(value.projection, value.trial_family_identity);
}

function parseBrowserProjection(
  projection: Json,
  trialFamilyIdentity: string,
): RdIterationTimelineProjectionV1 | null {
  const ownerShape = {
    schema_version: 1,
    trial_family_identity: projection.trialFamilyIdentity,
    census_frontier_identity: projection.censusFrontierIdentity,
    census_frontier_digest: projection.censusFrontierDigest,
    consumed_trial_budget: projection.consumedTrialBudget,
    trial_budget: projection.trialBudget,
    state: projection.state,
    decisions: Array.isArray(projection.decisions) ? projection.decisions.map((decision) => object(decision) ? ({
      decision_identity: decision.decisionIdentity,
      decision_digest: decision.decisionDigest,
      round_ordinal: decision.roundOrdinal,
      trial_family_identity: decision.trialFamilyIdentity,
      census_frontier_identity: decision.censusFrontierIdentity,
      census_frontier_digest: decision.censusFrontierDigest,
      request_identity: decision.requestIdentity,
      result_identity: decision.resultIdentity,
      attempt_identity: decision.attemptIdentity,
      outcome: decision.outcome,
      next_legal_action: decision.nextLegalAction,
      committed_at_epoch_ms: decision.committedAtEpochMs,
      receipt_identity: decision.receiptIdentity,
    }) : null) : null,
    observed_at_epoch_ms: projection.observedAtEpochMs,
  };
  return parseRdIterationTimelineOwnerV1(ownerShape, trialFamilyIdentity);
}
