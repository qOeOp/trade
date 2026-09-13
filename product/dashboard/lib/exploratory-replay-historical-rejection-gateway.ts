import { validExploratoryReplayOpaqueIdentityV2 } from "./exploratory-replay-identity.ts";
import {
  dashboardReadApiTargetV1,
  ownerApiTargetAvailableV1,
} from "./owner-api-target.ts";

const LEGACY_IDENTITY = /^[A-Za-z0-9._:-]{16,200}$/u;
const SHA256 = /^sha256:[0-9a-f]{64}$/u;
const BLAKE3 = /^blake3:[0-9a-f]{64}$/u;
const MAX_OWNER_RESPONSE_BYTES = 256 * 1024;
const OWNER_KEYS = [
  "artifact_identity", "attempt_identity", "build_receipt_identity", "channel",
  "committed_at_epoch_ms", "disposition", "receipt_identity", "rejection_code",
  "request_identity", "resolution", "schema_version", "semantic_digest",
] as const;
const BROWSER_KEYS = [
  "attemptIdentity", "availability", "observedAt", "outcome", "reason",
  "requestIdentity", "technical",
] as const;
const OUTCOME_KEYS = ["committedAt", "record", "result", "verification"] as const;
const TECHNICAL_KEYS = [
  "artifactIdentity", "buildReceiptIdentity", "channel", "receiptIdentity",
  "rejectionCode", "semanticDigest",
] as const;

type Fetcher = typeof fetch;
type Json = Record<string, unknown>;

export type ExploratoryReplayHistoricalRejectionBrowserProjectionV1 = Readonly<{
  availability: "available" | "unavailable";
  requestIdentity: string;
  attemptIdentity: string;
  observedAt: string | null;
  outcome: Readonly<{
    record: "historical";
    result: "rejected";
    verification: "quarantined";
    committedAt: string;
  }> | null;
  technical: Readonly<{
    semanticDigest: string;
    receiptIdentity: string;
    artifactIdentity: string;
    buildReceiptIdentity: string;
    rejectionCode: "INVALID_REPLAY_EVIDENCE";
    channel: "APP" | "MCP";
  }> | null;
  reason: string | null;
}>;

export type ExploratoryReplayHistoricalRejectionGatewayResultV1 = Readonly<{
  status: 200 | 400 | 404 | 502 | 503;
  projection: ExploratoryReplayHistoricalRejectionBrowserProjectionV1;
}>;

function object(value: unknown): value is Json {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function exactKeys(value: Json, keys: readonly string[]): boolean {
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  return actual.length === expected.length
    && actual.every((key, index) => key === expected[index]);
}

function validLegacyIdentity(value: unknown): value is string {
  return typeof value === "string" && LEGACY_IDENTITY.test(value);
}

function validCanonicalTime(value: unknown): value is string {
  if (typeof value !== "string") return false;
  const epoch = Date.parse(value);
  return Number.isFinite(epoch) && new Date(epoch).toISOString() === value;
}

function validEpoch(value: unknown): value is number {
  return Number.isSafeInteger(value) && Number(value) >= 0
    && !Number.isNaN(new Date(Number(value)).getTime());
}

function validChannel(value: unknown): value is "APP" | "MCP" {
  return value === "APP" || value === "MCP";
}

function validAvailability(value: unknown): value is "available" | "unavailable" {
  return value === "available" || value === "unavailable";
}

function ownerEndpoint(
  baseUrl: string,
  requestIdentity: string,
  attemptIdentity: string,
  semanticDigest: string,
): URL | null {
  try {
    const base = new URL(baseUrl);
    if (!["http:", "https:"].includes(base.protocol) || base.username || base.password
      || base.pathname !== "/" || base.search || base.hash) return null;
    const endpoint = new URL("/v1/exploratory-replay-rejections/readback", base);
    endpoint.searchParams.set("request_identity", requestIdentity);
    endpoint.searchParams.set("attempt_identity", attemptIdentity);
    endpoint.searchParams.set("semantic_digest", semanticDigest);
    return endpoint;
  } catch {
    return null;
  }
}

function unavailable(
  requestIdentity: string,
  attemptIdentity: string,
  reason: string,
  status: ExploratoryReplayHistoricalRejectionGatewayResultV1["status"],
): ExploratoryReplayHistoricalRejectionGatewayResultV1 {
  return {
    status,
    projection: {
      availability: "unavailable",
      requestIdentity,
      attemptIdentity,
      observedAt: null,
      outcome: null,
      technical: null,
      reason,
    },
  };
}

function projectOwnerReadback(
  value: unknown,
  requestIdentity: string,
  attemptIdentity: string,
  semanticDigest: string,
  observedAtEpochMs: number,
): ExploratoryReplayHistoricalRejectionBrowserProjectionV1 | null {
  if (!object(value) || !exactKeys(value, OWNER_KEYS)
    || value.schema_version !== 1
    || value.resolution !== "LEGACY_REJECTION_QUARANTINED"
    || value.disposition !== "REJECTED_NO_WRITE"
    || value.rejection_code !== "INVALID_REPLAY_EVIDENCE"
    || value.request_identity !== requestIdentity
    || value.attempt_identity !== attemptIdentity
    || value.semantic_digest !== semanticDigest
    || !SHA256.test(semanticDigest)
    || !validLegacyIdentity(value.receipt_identity)
    || value.receipt_identity !== `rd-exploratory-request-rejection-v1-${semanticDigest.slice(7)}`
    || typeof value.artifact_identity !== "string" || !BLAKE3.test(value.artifact_identity)
    || !validLegacyIdentity(value.build_receipt_identity)
    || !validChannel(value.channel)
    || !validEpoch(value.committed_at_epoch_ms)
    || !validEpoch(observedAtEpochMs)) return null;

  return {
    availability: "available",
    requestIdentity,
    attemptIdentity,
    observedAt: new Date(observedAtEpochMs).toISOString(),
    outcome: {
      record: "historical",
      result: "rejected",
      verification: "quarantined",
      committedAt: new Date(Number(value.committed_at_epoch_ms)).toISOString(),
    },
    technical: {
      semanticDigest,
      receiptIdentity: String(value.receipt_identity),
      artifactIdentity: String(value.artifact_identity),
      buildReceiptIdentity: String(value.build_receipt_identity),
      rejectionCode: "INVALID_REPLAY_EVIDENCE",
      channel: value.channel,
    },
    reason: null,
  };
}

export function parseExploratoryReplayHistoricalRejectionBrowserProjectionV1(
  value: unknown,
  requestIdentity: string,
  attemptIdentity: string,
  semanticDigest: string,
): ExploratoryReplayHistoricalRejectionBrowserProjectionV1 | null {
  if (!object(value) || !exactKeys(value, BROWSER_KEYS)
    || value.requestIdentity !== requestIdentity || value.attemptIdentity !== attemptIdentity
    || !validAvailability(value.availability)) return null;
  if (value.availability === "unavailable") {
    return value.observedAt === null && value.outcome === null && value.technical === null
      && typeof value.reason === "string"
      ? value as ExploratoryReplayHistoricalRejectionBrowserProjectionV1
      : null;
  }
  if (!validCanonicalTime(value.observedAt) || value.reason !== null
    || !object(value.outcome) || !exactKeys(value.outcome, OUTCOME_KEYS)
    || value.outcome.record !== "historical" || value.outcome.result !== "rejected"
    || value.outcome.verification !== "quarantined"
    || !validCanonicalTime(value.outcome.committedAt)
    || !object(value.technical) || !exactKeys(value.technical, TECHNICAL_KEYS)
    || typeof value.technical.semanticDigest !== "string"
    || !SHA256.test(value.technical.semanticDigest)
    || value.technical.semanticDigest !== semanticDigest
    || !validLegacyIdentity(value.technical.receiptIdentity)
    || typeof value.technical.artifactIdentity !== "string"
    || !BLAKE3.test(value.technical.artifactIdentity)
    || !validLegacyIdentity(value.technical.buildReceiptIdentity)
    || value.technical.rejectionCode !== "INVALID_REPLAY_EVIDENCE"
    || !validChannel(value.technical.channel)) return null;
  return value as ExploratoryReplayHistoricalRejectionBrowserProjectionV1;
}

export async function readExploratoryReplayHistoricalRejectionGatewayV1({
  requestIdentity,
  attemptIdentity,
  semanticDigest,
  environment = process.env,
  fetcher = fetch,
  now = Date.now,
}: {
  requestIdentity: string;
  attemptIdentity: string;
  semanticDigest: string;
  environment?: Record<string, string | undefined>;
  fetcher?: Fetcher;
  now?: () => number;
}): Promise<ExploratoryReplayHistoricalRejectionGatewayResultV1> {
  if (!validLegacyIdentity(requestIdentity) || !validLegacyIdentity(attemptIdentity)
    || !SHA256.test(semanticDigest)
    || !validExploratoryReplayOpaqueIdentityV2(requestIdentity)
    || !validExploratoryReplayOpaqueIdentityV2(attemptIdentity)) {
    return unavailable(requestIdentity, attemptIdentity, "INVALID_HISTORICAL_REPLAY_SELECTOR", 400);
  }
  const target = dashboardReadApiTargetV1(environment);
  const endpoint = target.baseUrl
    ? ownerEndpoint(target.baseUrl, requestIdentity, attemptIdentity, semanticDigest)
    : null;
  if (!ownerApiTargetAvailableV1(target) || !endpoint || !target.token) {
    return unavailable(requestIdentity, attemptIdentity, "OWNER_CONFIGURATION_UNAVAILABLE", 503);
  }
  try {
    const response = await fetcher(endpoint, {
      method: "GET",
      headers: { authorization: `Bearer ${target.token}` },
      cache: "no-store",
      signal: AbortSignal.timeout(8_000),
    });
    if (!response.ok) {
      const status = response.status === 404 ? 404 : response.status >= 500 ? 503 : 502;
      return unavailable(requestIdentity, attemptIdentity, "HISTORICAL_REPLAY_REJECTION_UNAVAILABLE", status);
    }
    const contentLength = response.headers.get("content-length");
    if (contentLength !== null && (!/^\d+$/u.test(contentLength)
      || Number(contentLength) > MAX_OWNER_RESPONSE_BYTES)) {
      return unavailable(requestIdentity, attemptIdentity, "OWNER_RESPONSE_UNAVAILABLE", 502);
    }
    const text = await response.text();
    if (new TextEncoder().encode(text).byteLength > MAX_OWNER_RESPONSE_BYTES) {
      return unavailable(requestIdentity, attemptIdentity, "OWNER_RESPONSE_UNAVAILABLE", 502);
    }
    let raw: unknown;
    try { raw = JSON.parse(text); } catch {
      return unavailable(requestIdentity, attemptIdentity, "OWNER_RESPONSE_UNAVAILABLE", 502);
    }
    const projection = projectOwnerReadback(
      raw, requestIdentity, attemptIdentity, semanticDigest, now(),
    );
    return projection
      ? { status: 200, projection }
      : unavailable(requestIdentity, attemptIdentity, "OWNER_RESPONSE_UNAVAILABLE", 502);
  } catch {
    return unavailable(requestIdentity, attemptIdentity, "OWNER_TRANSPORT_UNAVAILABLE", 503);
  }
}
