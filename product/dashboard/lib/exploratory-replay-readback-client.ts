import {
  EXPLORATORY_REPLAY_SHADOW_READ_OPERATION,
  operationByIdV1,
  ownerOperationUrlV1,
} from "./operation-registry.ts";
import { validOperationalRunReferenceV1 } from "./operational-run-reference.ts";

const MAX_OWNER_RESPONSE_BYTES = 1_048_576;
const IDENTITY = /^[A-Za-z0-9._:/-]{1,256}$/;
const DIGEST = /^(?:sha256|blake3):[0-9a-f]{64}$/;

type Json = Record<string, unknown>;
type Fetcher = typeof fetch;

export type ExploratoryReplayReadbackProjectionV2 = {
  requestIdentity: string;
  availability: "AVAILABLE" | "STALE" | "UNAVAILABLE";
  nextLegalAction: "LOCK_BY_LOCATOR" | "CREATE_SUCCESSOR_REQUEST" | "RESOLVE_OWNER_CUSTODY";
  readback: null | {
    meaningDigest: string;
    receiptIdentity: string;
    sealDigest: string;
    committedAtEpochMs: number;
    ownerCutEpochMs: number;
    namespace: "EXPLORATORY";
    deterministicSeed: number;
    startEventNs: number;
    endEventNsExclusive: number;
    trialFamilyIdentity: string;
    artifactIdentity: string;
    strategyDesignIdentity: string;
    pitSnapshotIdentity: string;
    runtimeKernelIdentity: string;
    simulatorIdentity: string;
  };
};

export type ExploratoryReplayShadowResponseV2 = {
  status: number;
  envelope: {
    schema_version: 1;
    operation: typeof EXPLORATORY_REPLAY_SHADOW_READ_OPERATION;
    channel: "DASHBOARD_SHADOW_READ";
    request_identity: string;
    meaning_digest: string;
    transport_observed_at: string;
    availability: "available" | "unavailable";
    unavailable_reason: "INVALID_SELECTOR" | "OWNER_CONFIGURATION_UNAVAILABLE"
      | "OWNER_TRANSPORT_UNAVAILABLE" | "OWNER_RESPONSE_UNAVAILABLE" | null;
    projection: ExploratoryReplayReadbackProjectionV2 | null;
  };
};

function object(value: unknown): value is Json {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function exactKeys(value: Json, expected: string[]): boolean {
  const actual = Object.keys(value).sort();
  const wanted = [...expected].sort();
  return actual.length === wanted.length
    && actual.every((key, index) => key === wanted[index]);
}

function identity(value: unknown): value is string {
  return typeof value === "string" && IDENTITY.test(value);
}

function digest(value: unknown): value is string {
  return typeof value === "string" && DIGEST.test(value);
}

function safeUnsigned(value: unknown): value is number {
  return Number.isSafeInteger(value) && Number(value) >= 0;
}

function contentIdentity(value: unknown): value is { identity: string; digest: string } {
  return object(value) && exactKeys(value, ["identity", "digest"])
    && identity(value.identity) && digest(value.digest);
}

function versionedIdentity(value: unknown): value is { identity: string; version: string } {
  return object(value) && exactKeys(value, ["identity", "version"])
    && identity(value.identity) && identity(value.version);
}

const CONTENT_FIELDS = [
  "frozen_research_intent", "trial_family", "trial_family_census_frontier",
  "strategy_design", "strategy_plan", "artifact", "resolved_owner_inputs", "pit_scope",
  "pit_snapshot", "universe_selection", "replay_configuration", "corporate_action_cut",
  "historical_membership_cut",
] as const;
const VERSION_FIELDS = [
  "correction_rule", "market_semantics", "runner_operational_profile", "diagnostic_policy",
  "calendar", "session", "time_zone",
] as const;
const MODEL_FIELDS = ["runtime_kernel", "simulator", "cost", "slippage", "capacity"] as const;

function replayRequest(value: unknown, requestIdentity: string): value is Json {
  const keys = [
    "schema_version", "request_identity", ...CONTENT_FIELDS, "replay_authority",
    ...VERSION_FIELDS.slice(0, 2), "models", ...VERSION_FIELDS.slice(2, 4),
    "deterministic_seed", "window", ...VERSION_FIELDS.slice(4),
  ];
  if (!object(value) || !exactKeys(value, keys)
    || value.schema_version !== 2 || value.request_identity !== requestIdentity
    || !identity(value.request_identity)
    || !CONTENT_FIELDS.every((field) => contentIdentity(value[field]))
    || !VERSION_FIELDS.every((field) => versionedIdentity(value[field]))
    || !object(value.replay_authority)
    || !exactKeys(value.replay_authority, ["namespace"])
    || value.replay_authority.namespace !== "EXPLORATORY"
    || !object(value.models) || !exactKeys(value.models, [...MODEL_FIELDS])
    || !MODEL_FIELDS.every((field) => versionedIdentity((value.models as Json)[field]))
    || !safeUnsigned(value.deterministic_seed)
    || !object(value.window) || !exactKeys(value.window, ["start_event_ns", "end_event_ns_exclusive"])
    || !safeUnsigned(value.window.start_event_ns) || !safeUnsigned(value.window.end_event_ns_exclusive)
    || Number(value.window.start_event_ns) >= Number(value.window.end_event_ns_exclusive)) return false;
  return true;
}

function canonicalRequestMatches(bytes: unknown, request: Json): boolean {
  if (!Array.isArray(bytes) || bytes.length === 0
    || !bytes.every((entry) => Number.isInteger(entry) && entry >= 0 && entry <= 255)) return false;
  try {
    const text = new TextDecoder("utf-8", { fatal: true }).decode(Uint8Array.from(bytes));
    const decoded: unknown = JSON.parse(text);
    return replayRequest(decoded, String(request.request_identity))
      && text === JSON.stringify(decoded)
      && JSON.stringify(decoded) === JSON.stringify(request);
  } catch {
    return false;
  }
}

export function parseExploratoryReplayOwnerV2(
  value: unknown,
  expectedRequestIdentity: string,
  expectedMeaningDigest: string,
): ExploratoryReplayReadbackProjectionV2 | null {
  if (!object(value) || !exactKeys(value, ["projection", "readback"])
    || !object(value.projection)
    || !exactKeys(value.projection, ["schema_version", "request_identity", "availability", "next_legal_action"])
    || value.projection.schema_version !== 1
    || value.projection.request_identity !== expectedRequestIdentity
    || !identity(value.projection.request_identity)
    || !["AVAILABLE", "STALE", "UNAVAILABLE"].includes(String(value.projection.availability))) return null;

  const availability = value.projection.availability as ExploratoryReplayReadbackProjectionV2["availability"];
  const nextLegalAction = value.projection.next_legal_action;
  const expectedAction = availability === "AVAILABLE" ? "LOCK_BY_LOCATOR"
    : availability === "STALE" ? "CREATE_SUCCESSOR_REQUEST" : "RESOLVE_OWNER_CUSTODY";
  if (nextLegalAction !== expectedAction) return null;
  if (availability !== "AVAILABLE") {
    return value.readback === null ? {
      requestIdentity: expectedRequestIdentity,
      availability,
      nextLegalAction: expectedAction,
      readback: null,
    } : null;
  }

  const readback = value.readback;
  if (!object(readback) || !exactKeys(readback, [
    "request", "canonical_request_bytes", "meaning_digest", "receipt", "owner_cut_epoch_ms",
  ]) || !replayRequest(readback.request, expectedRequestIdentity)
    || !canonicalRequestMatches(readback.canonical_request_bytes, readback.request)
    || readback.meaning_digest !== expectedMeaningDigest || !digest(readback.meaning_digest)
    || !object(readback.receipt) || !exactKeys(readback.receipt, [
      "schema_version", "receipt_identity", "request_identity", "meaning_digest", "seal_digest",
      "committed_at_epoch_ms",
    ]) || readback.receipt.schema_version !== 2 || !identity(readback.receipt.receipt_identity)
    || readback.receipt.request_identity !== expectedRequestIdentity
    || readback.receipt.meaning_digest !== expectedMeaningDigest
    || !digest(readback.receipt.seal_digest) || !safeUnsigned(readback.receipt.committed_at_epoch_ms)
    || !safeUnsigned(readback.owner_cut_epoch_ms)
    || Number(readback.owner_cut_epoch_ms) < Number(readback.receipt.committed_at_epoch_ms)) return null;

  const request = readback.request;
  const models = request.models as Json;
  const window = request.window as Json;
  return {
    requestIdentity: expectedRequestIdentity,
    availability,
    nextLegalAction: expectedAction,
    readback: {
      meaningDigest: expectedMeaningDigest,
      receiptIdentity: String(readback.receipt.receipt_identity),
      sealDigest: String(readback.receipt.seal_digest),
      committedAtEpochMs: Number(readback.receipt.committed_at_epoch_ms),
      ownerCutEpochMs: Number(readback.owner_cut_epoch_ms),
      namespace: "EXPLORATORY",
      deterministicSeed: Number(request.deterministic_seed),
      startEventNs: Number(window.start_event_ns),
      endEventNsExclusive: Number(window.end_event_ns_exclusive),
      trialFamilyIdentity: String((request.trial_family as Json).identity),
      artifactIdentity: String((request.artifact as Json).identity),
      strategyDesignIdentity: String((request.strategy_design as Json).identity),
      pitSnapshotIdentity: String((request.pit_snapshot as Json).identity),
      runtimeKernelIdentity: String((models.runtime_kernel as Json).identity),
      simulatorIdentity: String((models.simulator as Json).identity),
    },
  };
}

function unavailable(
  requestIdentity: string,
  meaningDigest: string,
  reason: Exclude<ExploratoryReplayShadowResponseV2["envelope"]["unavailable_reason"], null>,
  status: number,
): ExploratoryReplayShadowResponseV2 {
  return { status, envelope: {
    schema_version: 1,
    operation: EXPLORATORY_REPLAY_SHADOW_READ_OPERATION,
    channel: "DASHBOARD_SHADOW_READ",
    request_identity: requestIdentity,
    meaning_digest: meaningDigest,
    transport_observed_at: new Date().toISOString(),
    availability: "unavailable",
    unavailable_reason: reason,
    projection: null,
  } };
}

export async function resolveExploratoryReplayShadowV2({
  requestIdentity,
  meaningDigest,
  baseUrl,
  token,
  fetcher = fetch,
}: {
  requestIdentity: string;
  meaningDigest: string;
  baseUrl: string | undefined;
  token: string | undefined;
  fetcher?: Fetcher;
}): Promise<ExploratoryReplayShadowResponseV2> {
  if (!identity(requestIdentity) || !digest(meaningDigest)) {
    return unavailable(requestIdentity, meaningDigest, "INVALID_SELECTOR", 400);
  }
  const operation = operationByIdV1(EXPLORATORY_REPLAY_SHADOW_READ_OPERATION);
  const endpoint = baseUrl ? ownerOperationUrlV1({
    operationId: EXPLORATORY_REPLAY_SHADOW_READ_OPERATION,
    baseUrl,
    identities: { request_identity: requestIdentity, meaning_digest: meaningDigest },
  }) : null;
  if (!endpoint || !token) {
    return unavailable(requestIdentity, meaningDigest, "OWNER_CONFIGURATION_UNAVAILABLE", 503);
  }
  try {
    const response = await fetcher(endpoint, {
      method: "GET",
      headers: { authorization: `Bearer ${token}` },
      cache: "no-store",
      signal: AbortSignal.timeout(operation.timeout_class.milliseconds),
    });
    const body = await response.text();
    if (new TextEncoder().encode(body).byteLength > MAX_OWNER_RESPONSE_BYTES) {
      return unavailable(requestIdentity, meaningDigest, "OWNER_RESPONSE_UNAVAILABLE", 502);
    }
    if (response.status >= 500) {
      return unavailable(requestIdentity, meaningDigest, "OWNER_TRANSPORT_UNAVAILABLE", 503);
    }
    if (!response.ok) {
      return unavailable(requestIdentity, meaningDigest, "OWNER_RESPONSE_UNAVAILABLE", 502);
    }
    let raw: unknown;
    try { raw = JSON.parse(body); } catch {
      return unavailable(requestIdentity, meaningDigest, "OWNER_RESPONSE_UNAVAILABLE", 502);
    }
    const projection = parseExploratoryReplayOwnerV2(raw, requestIdentity, meaningDigest);
    if (!projection) {
      return unavailable(requestIdentity, meaningDigest, "OWNER_RESPONSE_UNAVAILABLE", 502);
    }
    return { status: 200, envelope: {
      schema_version: 1,
      operation: EXPLORATORY_REPLAY_SHADOW_READ_OPERATION,
      channel: "DASHBOARD_SHADOW_READ",
      request_identity: requestIdentity,
      meaning_digest: meaningDigest,
      transport_observed_at: new Date().toISOString(),
      availability: "available",
      unavailable_reason: null,
      projection,
    } };
  } catch {
    return unavailable(requestIdentity, meaningDigest, "OWNER_TRANSPORT_UNAVAILABLE", 503);
  }
}

export function parseExploratoryReplayShadowEnvelopeV2(
  value: unknown,
): ExploratoryReplayReadbackProjectionV2 | null {
  if (!object(value) || !exactKeys(value, [
    "schema_version", "operation", "channel", "request_identity", "meaning_digest",
    "transport_observed_at", "availability", "unavailable_reason", "projection", "operational_run",
  ]) || value.schema_version !== 1 || value.operation !== EXPLORATORY_REPLAY_SHADOW_READ_OPERATION
    || value.channel !== "DASHBOARD_SHADOW_READ" || !identity(value.request_identity)
    || !digest(value.meaning_digest) || typeof value.transport_observed_at !== "string"
    || !Number.isFinite(Date.parse(value.transport_observed_at))
    || value.availability !== "available" || value.unavailable_reason !== null
    || !object(value.projection)) return null;
  const projection = value.projection;
  if (!exactKeys(projection, ["requestIdentity", "availability", "nextLegalAction", "readback"])
    || projection.requestIdentity !== value.request_identity
    || !["AVAILABLE", "STALE", "UNAVAILABLE"].includes(String(projection.availability))) return null;
  const expectedAction = projection.availability === "AVAILABLE" ? "LOCK_BY_LOCATOR"
    : projection.availability === "STALE" ? "CREATE_SUCCESSOR_REQUEST" : "RESOLVE_OWNER_CUSTODY";
  if (projection.nextLegalAction !== expectedAction) return null;
  const expectedOutcome = projection.availability === "AVAILABLE" ? "available"
    : projection.availability === "STALE" ? "unknown" : "unavailable";
  if (!validOperationalRunReferenceV1(value.operational_run, expectedOutcome)) return null;
  if (projection.availability !== "AVAILABLE") {
    return projection.readback === null
      ? projection as unknown as ExploratoryReplayReadbackProjectionV2 : null;
  }
  const readback = projection.readback;
  if (!object(readback) || !exactKeys(readback, [
    "meaningDigest", "receiptIdentity", "sealDigest", "committedAtEpochMs", "ownerCutEpochMs",
    "namespace", "deterministicSeed", "startEventNs", "endEventNsExclusive", "trialFamilyIdentity",
    "artifactIdentity", "strategyDesignIdentity", "pitSnapshotIdentity", "runtimeKernelIdentity",
    "simulatorIdentity",
  ]) || readback.meaningDigest !== value.meaning_digest || !digest(readback.meaningDigest)
    || !identity(readback.receiptIdentity) || !digest(readback.sealDigest)
    || readback.namespace !== "EXPLORATORY" || !safeUnsigned(readback.deterministicSeed)
    || !safeUnsigned(readback.startEventNs) || !safeUnsigned(readback.endEventNsExclusive)
    || Number(readback.startEventNs) >= Number(readback.endEventNsExclusive)
    || !safeUnsigned(readback.committedAtEpochMs) || !safeUnsigned(readback.ownerCutEpochMs)
    || Number(readback.ownerCutEpochMs) < Number(readback.committedAtEpochMs)
    || !identity(readback.trialFamilyIdentity) || !identity(readback.artifactIdentity)
    || !identity(readback.strategyDesignIdentity) || !identity(readback.pitSnapshotIdentity)
    || !identity(readback.runtimeKernelIdentity) || !identity(readback.simulatorIdentity)) return null;
  return projection as unknown as ExploratoryReplayReadbackProjectionV2;
}
