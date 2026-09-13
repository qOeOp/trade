import { dashboardReadApiTargetV1 } from "./owner-api-target.ts";

const IDENTITY = /^[A-Za-z0-9._:/-]{1,192}$/u;
const DIGEST = /^sha256:[0-9a-f]{64}$/u;
const MAX_RESPONSE_BYTES = 256 * 1024;
const OWNER_KEYS = [
  "artifact_review",
  "artifact_review_actions",
  "attempt_identity",
  "build_request_identity",
  "next_legal_action",
  "owner_receipt",
  "research_view",
  "resolution",
  "schema_version",
  "trial_family_resolution",
];
const RECEIPT_KEYS = [
  "artifact_identity",
  "attempt_identity",
  "build_receipt_identity",
  "build_request_identity",
  "committed_at_epoch_ms",
  "disposition",
  "failure_code",
  "intent_identity",
  "intent_semantic_digest",
  "receipt_identity",
  "request_semantic_digest",
  "schema_version",
];
const BROWSER_KEYS = [
  "attemptIdentity",
  "availability",
  "buildRequestIdentity",
  "observedAt",
  "outcome",
  "reason",
  "technical",
];
const OUTCOME_KEYS = ["committedAt", "failureCode", "historicalDisposition", "resolution"];
const TECHNICAL_KEYS = ["ownerReceiptIdentity"];

type Fetcher = typeof fetch;
type Environment = Record<string, string | undefined>;

export type ArtifactHistoricalReadbackProjectionV1 = Readonly<{
  availability: "available" | "unavailable";
  buildRequestIdentity: string;
  attemptIdentity: string;
  observedAt: string | null;
  outcome: Readonly<{
    resolution: "quarantined";
    historicalDisposition: "failed" | "rejected" | "unknown";
    failureCode: string;
    committedAt: string;
  }> | null;
  technical: Readonly<{ ownerReceiptIdentity: string }> | null;
  reason: string | null;
}>;

export type ArtifactHistoricalReadbackGatewayResultV1 = Readonly<{
  status: 200 | 400 | 502 | 503;
  projection: ArtifactHistoricalReadbackProjectionV1;
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

function safeEpoch(value: unknown): value is number {
  return Number.isSafeInteger(value) && Number(value) >= 0
    && !Number.isNaN(new Date(Number(value)).getTime());
}

function canonicalTime(value: unknown): value is string {
  if (typeof value !== "string") return false;
  const date = new Date(value);
  return !Number.isNaN(date.getTime()) && date.toISOString() === value;
}

function unavailable(
  buildRequestIdentity: string,
  attemptIdentity: string,
  reason: string,
  status: ArtifactHistoricalReadbackGatewayResultV1["status"],
): ArtifactHistoricalReadbackGatewayResultV1 {
  return {
    status,
    projection: {
      availability: "unavailable",
      buildRequestIdentity,
      attemptIdentity,
      observedAt: null,
      outcome: null,
      technical: null,
      reason,
    },
  };
}

function endpoint(baseUrl: string, buildRequestIdentity: string, attemptIdentity: string): URL | null {
  try {
    const base = new URL(baseUrl);
    if (!["http:", "https:"].includes(base.protocol) || base.username || base.password
      || base.pathname !== "/" || base.search || base.hash) return null;
    return new URL(
      `/v1/artifact-builds/${encodeURIComponent(buildRequestIdentity)}/attempts/${encodeURIComponent(attemptIdentity)}/readback`,
      base,
    );
  } catch {
    return null;
  }
}

export function projectArtifactHistoricalOwnerReadbackV1(
  value: unknown,
  buildRequestIdentity: string,
  attemptIdentity: string,
  observedAtEpochMs: number,
): ArtifactHistoricalReadbackProjectionV1 | null {
  if (!object(value) || !exactKeys(value, OWNER_KEYS)
    || value.schema_version !== 1
    || value.resolution !== "LEGACY_TERMINAL_QUARANTINED"
    || value.build_request_identity !== buildRequestIdentity
    || value.attempt_identity !== attemptIdentity
    || value.research_view !== null
    || value.artifact_review !== null
    || value.artifact_review_actions !== null
    || value.trial_family_resolution !== "TRIAL_FAMILY_UNAVAILABLE_LEGACY"
    || value.next_legal_action !== "RESOLVE_SAME_ATTEMPT_IDENTITY"
    || !object(value.owner_receipt)
    || !exactKeys(value.owner_receipt, RECEIPT_KEYS)
    || value.owner_receipt.schema_version !== 1
    || value.owner_receipt.build_request_identity !== buildRequestIdentity
    || value.owner_receipt.attempt_identity !== attemptIdentity
    || !identity(value.owner_receipt.receipt_identity)
    || typeof value.owner_receipt.request_semantic_digest !== "string"
    || !DIGEST.test(value.owner_receipt.request_semantic_digest)
    || value.owner_receipt.artifact_identity !== null
    || value.owner_receipt.build_receipt_identity !== null
    || !identity(value.owner_receipt.failure_code)
    || !safeEpoch(value.owner_receipt.committed_at_epoch_ms)
    || !safeEpoch(observedAtEpochMs)) return null;

  const disposition = value.owner_receipt.disposition === "FAILED_NO_ARTIFACT"
    ? "failed" as const
    : value.owner_receipt.disposition === "REJECTED_NO_WRITE"
      ? "rejected" as const
      : value.owner_receipt.disposition === "OUTCOME_UNKNOWN"
        ? "unknown" as const
        : null;
  if (!disposition) return null;
  if ((value.owner_receipt.intent_identity === null) !== (value.owner_receipt.intent_semantic_digest === null)
    || (value.owner_receipt.intent_identity !== null && !identity(value.owner_receipt.intent_identity))
    || (value.owner_receipt.intent_semantic_digest !== null
      && (typeof value.owner_receipt.intent_semantic_digest !== "string"
        || !DIGEST.test(value.owner_receipt.intent_semantic_digest)))) return null;

  return {
    availability: "available",
    buildRequestIdentity,
    attemptIdentity,
    observedAt: new Date(observedAtEpochMs).toISOString(),
    outcome: {
      resolution: "quarantined",
      historicalDisposition: disposition,
      failureCode: value.owner_receipt.failure_code,
      committedAt: new Date(Number(value.owner_receipt.committed_at_epoch_ms)).toISOString(),
    },
    technical: { ownerReceiptIdentity: value.owner_receipt.receipt_identity },
    reason: null,
  };
}

export function parseArtifactHistoricalBrowserProjectionV1(
  value: unknown,
  buildRequestIdentity: string,
  attemptIdentity: string,
): ArtifactHistoricalReadbackProjectionV1 | null {
  if (!object(value) || !exactKeys(value, BROWSER_KEYS)
    || value.buildRequestIdentity !== buildRequestIdentity
    || value.attemptIdentity !== attemptIdentity
    || !["available", "unavailable"].includes(String(value.availability))) return null;
  if (value.availability === "unavailable") {
    return value.observedAt === null && value.outcome === null && value.technical === null
      && typeof value.reason === "string"
      ? value as ArtifactHistoricalReadbackProjectionV1
      : null;
  }
  if (!canonicalTime(value.observedAt) || value.reason !== null
    || !object(value.outcome) || !exactKeys(value.outcome, OUTCOME_KEYS)
    || value.outcome.resolution !== "quarantined"
    || !["failed", "rejected", "unknown"].includes(String(value.outcome.historicalDisposition))
    || !identity(value.outcome.failureCode)
    || !canonicalTime(value.outcome.committedAt)
    || !object(value.technical) || !exactKeys(value.technical, TECHNICAL_KEYS)
    || !identity(value.technical.ownerReceiptIdentity)) return null;
  return value as ArtifactHistoricalReadbackProjectionV1;
}

export async function readArtifactHistoricalGatewayV1({
  buildRequestIdentity,
  attemptIdentity,
  baseUrl,
  token,
  environment = process.env,
  fetcher = fetch,
  now = Date.now,
}: {
  buildRequestIdentity: string;
  attemptIdentity: string;
  baseUrl?: string;
  token?: string;
  environment?: Environment;
  fetcher?: Fetcher;
  now?: () => number;
}): Promise<ArtifactHistoricalReadbackGatewayResultV1> {
  if (!identity(buildRequestIdentity) || !identity(attemptIdentity)) {
    return unavailable(buildRequestIdentity, attemptIdentity, "ARTIFACT_READBACK_IDENTITY_INVALID", 400);
  }
  const target = baseUrl !== undefined || token !== undefined
    ? { baseUrl, token }
    : dashboardReadApiTargetV1(environment);
  const url = target.baseUrl ? endpoint(target.baseUrl, buildRequestIdentity, attemptIdentity) : null;
  if (!url || !target.token) {
    return unavailable(buildRequestIdentity, attemptIdentity, "OWNER_CONFIGURATION_UNAVAILABLE", 503);
  }
  try {
    const response = await fetcher(url, {
      method: "GET",
      headers: { authorization: `Bearer ${target.token}` },
      cache: "no-store",
      signal: AbortSignal.timeout(8_000),
    });
    if (!response.ok) {
      return unavailable(buildRequestIdentity, attemptIdentity, "OWNER_RESPONSE_UNAVAILABLE", response.status >= 500 ? 503 : 502);
    }
    const contentLength = response.headers.get("content-length");
    if (contentLength !== null && (!/^\d+$/u.test(contentLength)
      || Number(contentLength) > MAX_RESPONSE_BYTES)) {
      return unavailable(buildRequestIdentity, attemptIdentity, "OWNER_RESPONSE_UNAVAILABLE", 502);
    }
    const text = await response.text();
    if (new TextEncoder().encode(text).byteLength > MAX_RESPONSE_BYTES) {
      return unavailable(buildRequestIdentity, attemptIdentity, "OWNER_RESPONSE_UNAVAILABLE", 502);
    }
    let raw: unknown;
    try { raw = JSON.parse(text); } catch {
      return unavailable(buildRequestIdentity, attemptIdentity, "OWNER_RESPONSE_UNAVAILABLE", 502);
    }
    const projection = projectArtifactHistoricalOwnerReadbackV1(
      raw,
      buildRequestIdentity,
      attemptIdentity,
      now(),
    );
    return projection
      ? { status: 200, projection }
      : unavailable(buildRequestIdentity, attemptIdentity, "OWNER_RESPONSE_UNAVAILABLE", 502);
  } catch {
    return unavailable(buildRequestIdentity, attemptIdentity, "OWNER_TRANSPORT_UNAVAILABLE", 503);
  }
}
