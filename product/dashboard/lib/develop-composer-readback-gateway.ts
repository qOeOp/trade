import {
  DEVELOP_COMPOSER_SHADOW_READ_OPERATION,
  operationByIdV1,
  ownerOperationUrlV1,
} from "./operation-registry.ts";
import { ownerApiTargetForOperationV1 } from "./owner-api-target.ts";

const MAX_OWNER_RESPONSE_BYTES = 1_048_576;
const IDENTITY = /^[A-Za-z0-9._:/-]{1,192}$/;
const COORDINATE = /^[A-Za-z0-9._:/-]{1,192}$/;
const HEX_DIGEST = /^[0-9a-f]{64}$/;
const REASON = /^[\p{L}\p{N}\p{P}\p{Zs}]{1,512}$/u;
const UNAVAILABLE_REASON = /^[A-Z0-9_]{1,128}$/;
const DISPOSITIONS = new Set([
  "SUCCESS",
  "CONFLICT",
  "UNSUPPORTED",
  "NEEDS_RESEARCH_REFINEMENT",
  "UNAVAILABLE",
  "SUBMITTED_OR_UNKNOWN",
]);

type Json = Record<string, unknown>;
type Fetcher = typeof fetch;

export type DevelopComposerArtifactProjectionV1 = Readonly<{
  locator: string;
  artifactDigest: string;
  canonicalPlanDigest: string;
  designDigest: string;
}>;

export type DevelopComposerReadbackV1 = Readonly<{
  disposition: string;
  receiptIdentity: string | null;
  artifact: DevelopComposerArtifactProjectionV1 | null;
  coordinate: string | null;
  reason: string | null;
}>;

export type DevelopComposerBrowserProjectionV1 = Readonly<{
  schemaVersion: 1;
  availability: "available" | "unavailable";
  requestIdentity: string;
  observedAt: string | null;
  state: "readback" | null;
  readback: DevelopComposerReadbackV1 | null;
  reason: string | null;
}>;

export type DevelopComposerGatewayResultV1 = Readonly<{
  status: number;
  projection: DevelopComposerBrowserProjectionV1;
}>;

function record(value: unknown): value is Json {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function exactKeys(value: Json, keys: readonly string[]): boolean {
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  return actual.length === expected.length
    && actual.every((key, index) => key === expected[index]);
}

function validIdentity(value: unknown): value is string {
  return typeof value === "string" && IDENTITY.test(value);
}

function validIsoTime(value: unknown): value is string {
  if (typeof value !== "string") return false;
  const epoch = Date.parse(value);
  return Number.isFinite(epoch) && new Date(epoch).toISOString() === value;
}

function byteDigest(value: unknown): string | null {
  if (!Array.isArray(value) || value.length !== 32
    || !value.every((byte) => Number.isInteger(byte) && byte >= 0 && byte <= 255)) return null;
  return value.map((byte) => Number(byte).toString(16).padStart(2, "0")).join("");
}

function unavailable(requestIdentity: string, reason: string): DevelopComposerBrowserProjectionV1 {
  return {
    schemaVersion: 1,
    availability: "unavailable",
    requestIdentity: validIdentity(requestIdentity) ? requestIdentity : "INVALID_REQUEST_IDENTITY",
    observedAt: null,
    state: null,
    readback: null,
    reason,
  };
}

export function projectDevelopComposerOwnerReadbackV1(
  value: unknown,
  requestIdentity: string,
  observedAt: string,
): DevelopComposerBrowserProjectionV1 | null {
  if (!record(value) || !exactKeys(value, [
    "schema_version", "request_identity", "disposition", "receipt_identity", "artifact",
    "coordinate", "reason",
  ]) || value.schema_version !== 2 || value.request_identity !== requestIdentity
    || !validIdentity(value.request_identity) || !validIsoTime(observedAt)
    || typeof value.disposition !== "string" || !DISPOSITIONS.has(value.disposition)) return null;

  if (value.disposition === "SUCCESS") {
    const receiptIdentity = byteDigest(value.receipt_identity);
    const artifact = value.artifact;
    if (!receiptIdentity || !record(artifact) || !exactKeys(artifact, [
      "artifact_locator", "artifact_digest", "canonical_plan_digest", "design_digest",
    ]) || !validIdentity(artifact.artifact_locator)
      || value.coordinate !== null || value.reason !== null) return null;
    const artifactDigest = byteDigest(artifact.artifact_digest);
    const canonicalPlanDigest = byteDigest(artifact.canonical_plan_digest);
    const designDigest = byteDigest(artifact.design_digest);
    if (!artifactDigest || !canonicalPlanDigest || !designDigest) return null;
    return {
      schemaVersion: 1,
      availability: "available",
      requestIdentity,
      observedAt,
      state: "readback",
      readback: {
        disposition: value.disposition,
        receiptIdentity,
        artifact: {
          locator: artifact.artifact_locator,
          artifactDigest,
          canonicalPlanDigest,
          designDigest,
        },
        coordinate: null,
        reason: null,
      },
      reason: null,
    };
  }

  if (value.receipt_identity !== null || value.artifact !== null
    || typeof value.coordinate !== "string" || !COORDINATE.test(value.coordinate)
    || typeof value.reason !== "string" || !REASON.test(value.reason)) return null;
  return {
    schemaVersion: 1,
    availability: "available",
    requestIdentity,
    observedAt,
    state: "readback",
    readback: {
      disposition: value.disposition,
      receiptIdentity: null,
      artifact: null,
      coordinate: value.coordinate,
      reason: value.reason,
    },
    reason: null,
  };
}

export function parseDevelopComposerBrowserProjectionV1(
  value: unknown,
): DevelopComposerBrowserProjectionV1 | null {
  if (!record(value) || !exactKeys(value, [
    "schemaVersion", "availability", "requestIdentity", "observedAt", "state", "readback", "reason",
  ]) || value.schemaVersion !== 1 || !validIdentity(value.requestIdentity)) return null;
  if (value.availability === "unavailable") {
    return value.observedAt === null && value.state === null && value.readback === null
      && typeof value.reason === "string" && UNAVAILABLE_REASON.test(value.reason)
      ? value as DevelopComposerBrowserProjectionV1
      : null;
  }
  if (value.availability !== "available" || !validIsoTime(value.observedAt)
    || value.state !== "readback" || value.reason !== null || !record(value.readback)
    || !exactKeys(value.readback, ["disposition", "receiptIdentity", "artifact", "coordinate", "reason"])
    || typeof value.readback.disposition !== "string"
    || !DISPOSITIONS.has(value.readback.disposition)) return null;
  if (value.readback.disposition === "SUCCESS") {
    if (typeof value.readback.receiptIdentity !== "string"
      || !HEX_DIGEST.test(value.readback.receiptIdentity) || !record(value.readback.artifact)
      || !exactKeys(value.readback.artifact, [
        "locator", "artifactDigest", "canonicalPlanDigest", "designDigest",
      ]) || !validIdentity(value.readback.artifact.locator)
      || ![value.readback.artifact.artifactDigest, value.readback.artifact.canonicalPlanDigest,
        value.readback.artifact.designDigest].every((digest) => typeof digest === "string" && HEX_DIGEST.test(digest))
      || value.readback.coordinate !== null || value.readback.reason !== null) return null;
  } else if (value.readback.receiptIdentity !== null || value.readback.artifact !== null
    || typeof value.readback.coordinate !== "string" || !COORDINATE.test(value.readback.coordinate)
    || typeof value.readback.reason !== "string" || !REASON.test(value.readback.reason)) return null;
  return value as DevelopComposerBrowserProjectionV1;
}

export async function readDevelopComposerGatewayV1({
  requestIdentity,
  environment = process.env,
  fetcher = fetch,
  clock = Date.now,
}: {
  requestIdentity: string;
  environment?: Record<string, string | undefined>;
  fetcher?: Fetcher;
  clock?: () => number;
}): Promise<DevelopComposerGatewayResultV1> {
  if (!validIdentity(requestIdentity)) {
    return { status: 400, projection: unavailable(requestIdentity, "INVALID_REQUEST_IDENTITY") };
  }
  const target = ownerApiTargetForOperationV1(DEVELOP_COMPOSER_SHADOW_READ_OPERATION, environment);
  const operation = operationByIdV1(DEVELOP_COMPOSER_SHADOW_READ_OPERATION);
  const endpoint = target.baseUrl ? ownerOperationUrlV1({
    operationId: DEVELOP_COMPOSER_SHADOW_READ_OPERATION,
    baseUrl: target.baseUrl,
    identities: { request_identity: requestIdentity },
  }) : null;
  if (!endpoint || !target.token) {
    return { status: 503, projection: unavailable(requestIdentity, "OWNER_CONFIGURATION_UNAVAILABLE") };
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
      return { status: 502, projection: unavailable(requestIdentity, "OWNER_RESPONSE_UNAVAILABLE") };
    }
    if (response.status === 401 || response.status === 403) {
      return { status: 403, projection: unavailable(requestIdentity, "OWNER_PERMISSION_DENIED") };
    }
    let raw: unknown;
    try { raw = JSON.parse(body); } catch {
      return { status: response.status >= 500 ? 503 : 502,
        projection: unavailable(requestIdentity, response.status >= 500
          ? "OWNER_TRANSPORT_UNAVAILABLE" : "OWNER_RESPONSE_UNAVAILABLE") };
    }
    const observedAt = new Date(clock()).toISOString();
    const projection = projectDevelopComposerOwnerReadbackV1(raw, requestIdentity, observedAt);
    if (!projection) {
      return { status: 502, projection: unavailable(requestIdentity, "OWNER_RESPONSE_UNAVAILABLE") };
    }
    return { status: 200, projection };
  } catch {
    return { status: 503, projection: unavailable(requestIdentity, "OWNER_TRANSPORT_UNAVAILABLE") };
  }
}
