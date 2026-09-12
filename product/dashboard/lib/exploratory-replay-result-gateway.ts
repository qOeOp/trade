import { validExploratoryReplayOpaqueIdentityV2 } from "./exploratory-replay-identity.ts";
import {
  EXPLORATORY_REPLAY_RESULT_SHADOW_READ_OPERATION,
  operationByIdV1,
  ownerOperationUrlV1,
} from "./operation-registry.ts";
import { ownerApiTargetForOperationV1 } from "./owner-api-target.ts";

const MAX_OWNER_RESPONSE_BYTES = 1_048_576;
const DIGEST = /^(?:sha256|blake3):[0-9a-f]{64}$/;
const RESULT_DIGEST = /^blake3:[0-9a-f]{64}$/;
const REASON = /^[A-Z0-9_]{1,128}$/;

const COMPONENTS = [
  "FROZEN_RESEARCH_INTENT", "TRIAL_FAMILY", "TRIAL_FAMILY_CENSUS_FRONTIER",
  "REPLAY_AUTHORITY", "STRATEGY_DESIGN", "STRATEGY_PLAN", "ARTIFACT",
  "RESOLVED_OWNER_INPUTS", "PIT_SCOPE", "PIT_SNAPSHOT", "UNIVERSE_SELECTION",
  "CORRECTION_RULE", "MARKET_SEMANTICS", "REPLAY_CONFIGURATION", "RUNTIME_KERNEL",
  "SIMULATOR", "COST_MODEL", "SLIPPAGE_MODEL", "CAPACITY_MODEL",
  "RUNNER_OPERATIONAL_PROFILE", "DIAGNOSTIC_POLICY", "DETERMINISTIC_SEED",
  "REPLAY_WINDOW", "CALENDAR", "SESSION", "TIME_ZONE", "CORPORATE_ACTION_CUT",
  "HISTORICAL_MEMBERSHIP_CUT",
] as const;

const DIAGNOSTICS = [
  "NO_EXECUTION_DEFECT", "MARKET_DATA", "ARTIFACT", "RUNTIME_KERNEL",
  "BACKTEST_OPERATIONAL", "SIMULATOR", "REPLAY_CONFIGURATION",
  "VALID_ECONOMIC_FAILURE", "UNRESOLVED_FAILURE",
] as const;

const TERMINALS = [
  "RUN_REJECTED", "IN_PROGRESS_OR_UNKNOWN", "TERMINAL_RESULT", "INVALID_REPLAY_EVIDENCE",
] as const;

type Json = Record<string, unknown>;
type Fetcher = typeof fetch;
type ReplayTerminalV2 = typeof TERMINALS[number];
type DiagnosticCategoryV2 = typeof DIAGNOSTICS[number];

export type ExploratoryReplayResultBrowserProjectionV1 = Readonly<{
  schemaVersion: 1;
  availability: "available" | "unavailable";
  requestIdentity: string;
  meaningDigest: string;
  attemptIdentity: string;
  resultIdentity: string;
  observedAt: string | null;
  result: Readonly<{
    terminal: ReplayTerminalV2;
    exactComponents: number;
    totalComponents: 28;
    diagnostics: readonly DiagnosticCategoryV2[];
    semanticTraceAvailable: boolean;
  }> | null;
  reason: string | null;
}>;

export type ExploratoryReplayResultGatewayResultV1 = Readonly<{
  status: number;
  projection: ExploratoryReplayResultBrowserProjectionV1;
}>;

function record(value: unknown): value is Json {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function exactKeys(value: Json, expected: readonly string[]): boolean {
  const actual = Object.keys(value).sort();
  const wanted = [...expected].sort();
  return actual.length === wanted.length
    && actual.every((key, index) => key === wanted[index]);
}

function validDigest(value: unknown): value is string {
  return typeof value === "string" && DIGEST.test(value);
}

function validResultDigest(value: unknown): value is string {
  return typeof value === "string" && RESULT_DIGEST.test(value);
}

function validIdentity(value: unknown): value is string {
  return typeof value === "string" && validExploratoryReplayOpaqueIdentityV2(value);
}

function validLocator(value: unknown, component: string): boolean {
  return record(value) && exactKeys(value, ["component", "reference", "digest"])
    && value.component === component && validIdentity(value.reference) && validDigest(value.digest);
}

function validReconciliation(value: unknown, component: string): value is Json {
  if (!record(value) || !exactKeys(value, [
    "component", "requested_meaning_identity", "requested_meaning_digest",
    "observed_meaning_identity", "observed_meaning_digest", "observation_locator", "status",
  ]) || value.component !== component || !validIdentity(value.requested_meaning_identity)
    || !validDigest(value.requested_meaning_digest)
    || !["EXACT", "MISSING", "MISMATCHED"].includes(String(value.status))) return false;
  if (value.status === "MISSING") {
    return value.observed_meaning_identity === null && value.observed_meaning_digest === null
      && value.observation_locator === null;
  }
  if (!validIdentity(value.observed_meaning_identity) || !validDigest(value.observed_meaning_digest)
    || !validLocator(value.observation_locator, component)) return false;
  const matches = value.observed_meaning_identity === value.requested_meaning_identity
    && value.observed_meaning_digest === value.requested_meaning_digest;
  return value.status === "EXACT" ? matches : !matches;
}

function validSemanticTrace(
  value: unknown,
  requestIdentity: string,
  meaningDigest: string,
  attemptIdentity: string,
): boolean {
  return record(value) && exactKeys(value, [
    "request_identity", "request_meaning_digest", "attempt_identity", "component", "locator",
    "observed_meaning_identity", "observed_meaning_digest",
  ]) && value.request_identity === requestIdentity && value.request_meaning_digest === meaningDigest
    && value.attempt_identity === attemptIdentity && value.component === "SEMANTIC_TRACE"
    && validLocator(value.locator, "SEMANTIC_TRACE")
    && validIdentity(value.observed_meaning_identity) && validDigest(value.observed_meaning_digest);
}

function validDiagnostic(
  value: unknown,
  requestIdentity: string,
  meaningDigest: string,
  attemptIdentity: string,
): value is Json {
  if (!record(value) || !exactKeys(value, [
    "request_identity", "request_meaning_digest", "attempt_identity", "category", "decisive_evidence",
  ]) || value.request_identity !== requestIdentity || value.request_meaning_digest !== meaningDigest
    || value.attempt_identity !== attemptIdentity
    || !DIAGNOSTICS.includes(value.category as DiagnosticCategoryV2)
    || !record(value.decisive_evidence)
    || !exactKeys(value.decisive_evidence, ["component", "reference", "digest"])) return false;
  const component = value.decisive_evidence.component;
  return (component === "SEMANTIC_TRACE"
      || COMPONENTS.includes(component as typeof COMPONENTS[number]))
    && validIdentity(value.decisive_evidence.reference)
    && validDigest(value.decisive_evidence.digest);
}

function projectOwnerResult(
  value: unknown,
  selector: {
    requestIdentity: string;
    meaningDigest: string;
    attemptIdentity: string;
    resultIdentity: string;
  },
  observedAt: string,
): ExploratoryReplayResultBrowserProjectionV1 | null {
  if (!record(value) || !exactKeys(value, [
    "schema_version", "result_identity", "result_digest", "request_identity",
    "request_meaning_digest", "namespace", "replay_authority", "attempt_identity", "terminal",
    "reconciliation", "semantic_trace", "diagnostic_census",
  ]) || value.schema_version !== 2 || value.result_identity !== selector.resultIdentity
    || value.request_identity !== selector.requestIdentity
    || value.request_meaning_digest !== selector.meaningDigest
    || value.attempt_identity !== selector.attemptIdentity || value.namespace !== "EXPLORATORY"
    || !record(value.replay_authority) || !exactKeys(value.replay_authority, ["namespace"])
    || value.replay_authority.namespace !== "EXPLORATORY" || !validResultDigest(value.result_digest)
    || value.result_identity !== `backtest-replay-result-v2-${value.result_digest.slice("blake3:".length)}`
    || !TERMINALS.includes(value.terminal as ReplayTerminalV2)) {
    return null;
  }
  const rawReconciliation = value.reconciliation;
  if (!Array.isArray(rawReconciliation) || rawReconciliation.length !== COMPONENTS.length
    || !COMPONENTS.every((component, index) => validReconciliation(rawReconciliation[index], component))) {
    return null;
  }
  const terminal = value.terminal as ReplayTerminalV2;
  const reconciliation = rawReconciliation as Json[];
  if (COMPONENTS.slice(0, 4).some((_component, index) => reconciliation[index].status !== "EXACT")
    || (terminal === "TERMINAL_RESULT" && reconciliation.some((atom) => atom.status !== "EXACT"))) return null;
  if (value.semantic_trace !== null
    && !validSemanticTrace(value.semantic_trace, selector.requestIdentity, selector.meaningDigest,
      selector.attemptIdentity)) return null;
  if (terminal === "TERMINAL_RESULT" && value.semantic_trace === null) return null;
  if (!Array.isArray(value.diagnostic_census)
    || !value.diagnostic_census.every((diagnostic) => validDiagnostic(
      diagnostic, selector.requestIdentity, selector.meaningDigest, selector.attemptIdentity,
    ))) return null;
  const diagnostics = value.diagnostic_census.map((diagnostic) => diagnostic.category as DiagnosticCategoryV2);
  const diagnosticOrder = diagnostics.map((category) => DIAGNOSTICS.indexOf(category));
  if ((terminal === "IN_PROGRESS_OR_UNKNOWN" && diagnostics.length !== 0)
    || (terminal !== "IN_PROGRESS_OR_UNKNOWN" && diagnostics.length === 0)
    || diagnosticOrder.some((entry, index) => index > 0 && entry <= diagnosticOrder[index - 1])
    || (diagnostics.some((category) => category === "NO_EXECUTION_DEFECT"
      || category === "UNRESOLVED_FAILURE") && diagnostics.length !== 1)) return null;
  return {
    schemaVersion: 1,
    availability: "available",
    requestIdentity: selector.requestIdentity,
    meaningDigest: selector.meaningDigest,
    attemptIdentity: selector.attemptIdentity,
    resultIdentity: selector.resultIdentity,
    observedAt,
    result: {
      terminal,
      exactComponents: reconciliation.filter((atom) => atom.status === "EXACT").length,
      totalComponents: 28,
      diagnostics,
      semanticTraceAvailable: value.semantic_trace !== null,
    },
    reason: null,
  };
}

function unavailable(
  selector: { requestIdentity: string; meaningDigest: string; attemptIdentity: string; resultIdentity: string },
  reason: string,
): ExploratoryReplayResultBrowserProjectionV1 {
  return {
    schemaVersion: 1,
    availability: "unavailable",
    requestIdentity: validIdentity(selector.requestIdentity) ? selector.requestIdentity : "INVALID_REQUEST_IDENTITY",
    meaningDigest: validDigest(selector.meaningDigest) ? selector.meaningDigest : "INVALID_MEANING_DIGEST",
    attemptIdentity: validIdentity(selector.attemptIdentity) ? selector.attemptIdentity : "INVALID_ATTEMPT_IDENTITY",
    resultIdentity: validIdentity(selector.resultIdentity) ? selector.resultIdentity : "INVALID_RESULT_IDENTITY",
    observedAt: null,
    result: null,
    reason,
  };
}

export async function readExploratoryReplayResultGatewayV1({
  requestIdentity,
  meaningDigest,
  attemptIdentity,
  resultIdentity,
  environment = process.env,
  fetcher = fetch,
  clock = Date.now,
}: {
  requestIdentity: string;
  meaningDigest: string;
  attemptIdentity: string;
  resultIdentity: string;
  environment?: Record<string, string | undefined>;
  fetcher?: Fetcher;
  clock?: () => number;
}): Promise<ExploratoryReplayResultGatewayResultV1> {
  const selector = { requestIdentity, meaningDigest, attemptIdentity, resultIdentity };
  if (!validIdentity(requestIdentity) || !validDigest(meaningDigest)
    || !validIdentity(attemptIdentity) || !validIdentity(resultIdentity)) {
    return { status: 400, projection: unavailable(selector, "INVALID_EXPLORATORY_REPLAY_RESULT_SELECTOR") };
  }
  const target = ownerApiTargetForOperationV1(EXPLORATORY_REPLAY_RESULT_SHADOW_READ_OPERATION, environment);
  const operation = operationByIdV1(EXPLORATORY_REPLAY_RESULT_SHADOW_READ_OPERATION);
  const endpoint = target.baseUrl ? ownerOperationUrlV1({
    operationId: EXPLORATORY_REPLAY_RESULT_SHADOW_READ_OPERATION,
    baseUrl: target.baseUrl,
    identities: {
      result_identity: resultIdentity,
      request_identity: requestIdentity,
      attempt_identity: attemptIdentity,
    },
  }) : null;
  if (!endpoint || !target.token) {
    return { status: 503, projection: unavailable(selector, "OWNER_CONFIGURATION_UNAVAILABLE") };
  }
  try {
    const response = await fetcher(endpoint, {
      method: "GET",
      headers: { authorization: `Bearer ${target.token}` },
      cache: "no-store",
      signal: AbortSignal.timeout(operation.timeout_class.milliseconds),
    });
    const body = await response.text();
    if (new TextEncoder().encode(body).byteLength > MAX_OWNER_RESPONSE_BYTES) {
      return { status: 502, projection: unavailable(selector, "OWNER_RESPONSE_UNAVAILABLE") };
    }
    if (response.status === 401 || response.status === 403) {
      return { status: 403, projection: unavailable(selector, "OWNER_PERMISSION_DENIED") };
    }
    if (response.status === 404) {
      return { status: 404, projection: unavailable(selector, "EXPLORATORY_REPLAY_RESULT_UNAVAILABLE") };
    }
    if (!response.ok) {
      return { status: response.status >= 500 ? 503 : 502,
        projection: unavailable(selector, response.status >= 500
          ? "OWNER_TRANSPORT_UNAVAILABLE" : "OWNER_RESPONSE_UNAVAILABLE") };
    }
    let raw: unknown;
    try { raw = JSON.parse(body); } catch {
      return { status: 502, projection: unavailable(selector, "OWNER_RESPONSE_UNAVAILABLE") };
    }
    const observedAt = new Date(clock()).toISOString();
    const projection = projectOwnerResult(raw, selector, observedAt);
    return projection
      ? { status: 200, projection }
      : { status: 502, projection: unavailable(selector, "OWNER_RESPONSE_UNAVAILABLE") };
  } catch {
    return { status: 503, projection: unavailable(selector, "OWNER_TRANSPORT_UNAVAILABLE") };
  }
}

export function parseExploratoryReplayResultBrowserProjectionV1(
  value: unknown,
): ExploratoryReplayResultBrowserProjectionV1 | null {
  if (!record(value) || !exactKeys(value, [
    "schemaVersion", "availability", "requestIdentity", "meaningDigest", "attemptIdentity",
    "resultIdentity", "observedAt", "result", "reason",
  ]) || value.schemaVersion !== 1) return null;
  if (value.availability === "unavailable") {
    const validUnavailableIdentity = (candidate: unknown, placeholder: string) =>
      candidate === placeholder
        || (validIdentity(candidate) && !candidate.startsWith("INVALID_"));
    return validUnavailableIdentity(value.requestIdentity, "INVALID_REQUEST_IDENTITY")
      && (value.meaningDigest === "INVALID_MEANING_DIGEST" || validDigest(value.meaningDigest))
      && validUnavailableIdentity(value.attemptIdentity, "INVALID_ATTEMPT_IDENTITY")
      && validUnavailableIdentity(value.resultIdentity, "INVALID_RESULT_IDENTITY")
      && typeof value.reason === "string" && REASON.test(value.reason)
      && value.observedAt === null && value.result === null
      ? value as ExploratoryReplayResultBrowserProjectionV1 : null;
  }
  if (value.availability !== "available" || !validIdentity(value.requestIdentity)
    || !validDigest(value.meaningDigest) || !validIdentity(value.attemptIdentity)
    || !validIdentity(value.resultIdentity) || typeof value.observedAt !== "string"
    || new Date(value.observedAt).toISOString() !== value.observedAt || value.reason !== null
    || !record(value.result) || !exactKeys(value.result, [
      "terminal", "exactComponents", "totalComponents", "diagnostics", "semanticTraceAvailable",
    ]) || !TERMINALS.includes(value.result.terminal as ReplayTerminalV2)
    || !Number.isSafeInteger(value.result.exactComponents) || Number(value.result.exactComponents) < 0
    || Number(value.result.exactComponents) > 28 || value.result.totalComponents !== 28
    || !Array.isArray(value.result.diagnostics)
    || !value.result.diagnostics.every((item) => DIAGNOSTICS.includes(item as DiagnosticCategoryV2))
    || typeof value.result.semanticTraceAvailable !== "boolean") return null;
  return value as ExploratoryReplayResultBrowserProjectionV1;
}
