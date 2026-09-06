import { ownerApiTargetForOperationV1 } from "./owner-api-target.ts";
import { EXPLORATORY_REPLAY_SHADOW_READ_OPERATION } from "./operation-registry.ts";
import {
  resolveExploratoryReplayShadowV2,
  type ExploratoryReplayReadbackProjectionV2,
} from "./exploratory-replay-readback-client.ts";

const IDENTITY = /^[A-Za-z0-9._:/-]{1,256}$/;
const DIGEST = /^(?:sha256|blake3):[0-9a-f]{64}$/;
const REASON = /^[A-Z0-9_]{1,128}$/;

type Fetcher = typeof fetch;
type Json = Record<string, unknown>;

export type ExploratoryReplayBrowserProjectionV1 = Readonly<{
  schemaVersion: 1;
  availability: "available" | "unavailable";
  requestIdentity: string;
  meaningDigest: string;
  observedAt: string | null;
  request: Readonly<{
    availability: "AVAILABLE";
    namespace: "EXPLORATORY";
    deterministicSeed: number;
  }> | null;
  custody: Readonly<{
    receiptIdentity: string;
    sealDigest: string;
    committedAt: string;
    ownerObservedAt: string;
  }> | null;
  replayBasis: Readonly<{
    startEventNs: number;
    endEventNsExclusive: number;
    trialFamilyIdentity: string;
    artifactIdentity: string;
    strategyDesignIdentity: string;
    pitSnapshotIdentity: string;
    runtimeKernelIdentity: string;
    simulatorIdentity: string;
  }> | null;
  reason: string | null;
}>;

export type ExploratoryReplayReadbackGatewayResultV1 = Readonly<{
  status: number;
  projection: ExploratoryReplayBrowserProjectionV1;
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

function validIdentity(value: unknown): value is string {
  return typeof value === "string" && IDENTITY.test(value);
}

function validDigest(value: unknown): value is string {
  return typeof value === "string" && DIGEST.test(value);
}

function validUnsigned(value: unknown): value is number {
  return Number.isSafeInteger(value) && Number(value) >= 0;
}

function validIsoTime(value: unknown): value is string {
  if (typeof value !== "string") return false;
  const epoch = Date.parse(value);
  return Number.isFinite(epoch) && new Date(epoch).toISOString() === value;
}

function epochToIso(value: number): string | null {
  try {
    const result = new Date(value).toISOString();
    return validIsoTime(result) ? result : null;
  } catch {
    return null;
  }
}

function unavailable(
  requestIdentity: string,
  meaningDigest: string,
  reason: string,
): ExploratoryReplayBrowserProjectionV1 {
  return {
    schemaVersion: 1,
    availability: "unavailable",
    requestIdentity: validIdentity(requestIdentity) ? requestIdentity : "INVALID_REQUEST_IDENTITY",
    meaningDigest: validDigest(meaningDigest) ? meaningDigest : "INVALID_MEANING_DIGEST",
    observedAt: null,
    request: null,
    custody: null,
    replayBasis: null,
    reason,
  };
}

function projectAvailable(
  projection: ExploratoryReplayReadbackProjectionV2,
  observedAt: string,
): ExploratoryReplayBrowserProjectionV1 | null {
  const readback = projection.readback;
  if (projection.availability !== "AVAILABLE" || !readback || !validIsoTime(observedAt)) return null;
  const committedAt = epochToIso(readback.committedAtEpochMs);
  const ownerObservedAt = epochToIso(readback.ownerCutEpochMs);
  if (!committedAt || !ownerObservedAt) return null;
  return {
    schemaVersion: 1,
    availability: "available",
    requestIdentity: projection.requestIdentity,
    meaningDigest: readback.meaningDigest,
    observedAt,
    request: {
      availability: "AVAILABLE",
      namespace: readback.namespace,
      deterministicSeed: readback.deterministicSeed,
    },
    custody: {
      receiptIdentity: readback.receiptIdentity,
      sealDigest: readback.sealDigest,
      committedAt,
      ownerObservedAt,
    },
    replayBasis: {
      startEventNs: readback.startEventNs,
      endEventNsExclusive: readback.endEventNsExclusive,
      trialFamilyIdentity: readback.trialFamilyIdentity,
      artifactIdentity: readback.artifactIdentity,
      strategyDesignIdentity: readback.strategyDesignIdentity,
      pitSnapshotIdentity: readback.pitSnapshotIdentity,
      runtimeKernelIdentity: readback.runtimeKernelIdentity,
      simulatorIdentity: readback.simulatorIdentity,
    },
    reason: null,
  };
}

export async function readExploratoryReplayReadbackGatewayV1({
  requestIdentity,
  meaningDigest,
  environment = process.env,
  fetcher = fetch,
}: {
  requestIdentity: string;
  meaningDigest: string;
  environment?: Record<string, string | undefined>;
  fetcher?: Fetcher;
}): Promise<ExploratoryReplayReadbackGatewayResultV1> {
  if (!validIdentity(requestIdentity) || !validDigest(meaningDigest)) {
    return {
      status: 400,
      projection: unavailable(requestIdentity, meaningDigest, "INVALID_EXPLORATORY_REPLAY_SELECTOR"),
    };
  }
  const target = ownerApiTargetForOperationV1(EXPLORATORY_REPLAY_SHADOW_READ_OPERATION, environment);
  const resolved = await resolveExploratoryReplayShadowV2({
    requestIdentity,
    meaningDigest,
    baseUrl: target.baseUrl,
    token: target.token,
    fetcher,
  });
  if (resolved.envelope.availability !== "available" || !resolved.envelope.projection) {
    return {
      status: resolved.status,
      projection: unavailable(
        requestIdentity,
        meaningDigest,
        resolved.envelope.unavailable_reason ?? "EXPLORATORY_REPLAY_READBACK_UNAVAILABLE",
      ),
    };
  }
  if (resolved.envelope.projection.availability !== "AVAILABLE") {
    const stale = resolved.envelope.projection.availability === "STALE";
    return {
      status: stale ? 409 : 404,
      projection: unavailable(
        requestIdentity,
        meaningDigest,
        stale ? "OWNER_CUSTODY_STALE" : "OWNER_CUSTODY_UNAVAILABLE",
      ),
    };
  }
  const projected = projectAvailable(
    resolved.envelope.projection,
    resolved.envelope.transport_observed_at,
  );
  return projected
    ? { status: 200, projection: projected }
    : {
        status: 502,
        projection: unavailable(requestIdentity, meaningDigest, "OWNER_RESPONSE_UNAVAILABLE"),
      };
}

export function parseExploratoryReplayBrowserProjectionV1(
  value: unknown,
): ExploratoryReplayBrowserProjectionV1 | null {
  if (!record(value) || !exactKeys(value, [
    "schemaVersion", "availability", "requestIdentity", "meaningDigest", "observedAt",
    "request", "custody", "replayBasis", "reason",
  ]) || value.schemaVersion !== 1) return null;
  if (value.availability === "unavailable") {
    const validRequest = validIdentity(value.requestIdentity)
      || value.requestIdentity === "INVALID_REQUEST_IDENTITY";
    const validMeaning = validDigest(value.meaningDigest)
      || value.meaningDigest === "INVALID_MEANING_DIGEST";
    return validRequest && validMeaning && value.observedAt === null
      && value.request === null && value.custody === null && value.replayBasis === null
      && typeof value.reason === "string" && REASON.test(value.reason)
      ? value as ExploratoryReplayBrowserProjectionV1
      : null;
  }
  if (value.availability !== "available" || !validIdentity(value.requestIdentity)
    || !validDigest(value.meaningDigest) || !validIsoTime(value.observedAt)
    || value.reason !== null || !record(value.request) || !exactKeys(value.request, [
      "availability", "namespace", "deterministicSeed",
    ]) || value.request.availability !== "AVAILABLE" || value.request.namespace !== "EXPLORATORY"
    || !validUnsigned(value.request.deterministicSeed)
    || !record(value.custody) || !exactKeys(value.custody, [
      "receiptIdentity", "sealDigest", "committedAt", "ownerObservedAt",
    ]) || !validIdentity(value.custody.receiptIdentity) || !validDigest(value.custody.sealDigest)
    || !validIsoTime(value.custody.committedAt) || !validIsoTime(value.custody.ownerObservedAt)
    || Date.parse(value.custody.ownerObservedAt) < Date.parse(value.custody.committedAt)
    || !record(value.replayBasis) || !exactKeys(value.replayBasis, [
      "startEventNs", "endEventNsExclusive", "trialFamilyIdentity", "artifactIdentity",
      "strategyDesignIdentity", "pitSnapshotIdentity", "runtimeKernelIdentity", "simulatorIdentity",
    ]) || !validUnsigned(value.replayBasis.startEventNs)
    || !validUnsigned(value.replayBasis.endEventNsExclusive)
    || Number(value.replayBasis.startEventNs) >= Number(value.replayBasis.endEventNsExclusive)
    || !["trialFamilyIdentity", "artifactIdentity", "strategyDesignIdentity", "pitSnapshotIdentity",
      "runtimeKernelIdentity", "simulatorIdentity"].every(
      (field) => validIdentity((value.replayBasis as Json)[field]),
    )) return null;
  return value as ExploratoryReplayBrowserProjectionV1;
}
