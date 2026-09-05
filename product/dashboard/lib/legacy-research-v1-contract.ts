export const LEGACY_RESEARCH_CONSUMER_PROJECTION_V1 = {
  schema_version: 1,
  operation: "research_goal.legacy_quarantine_projection.v1",
  owner_operation: "research_goal.submit_or_resolve.v1",
  owner_schema: "sourced-research-goal-v1",
} as const;

type LegacyReceiptV1 = {
  schema_version: 1;
  receipt_identity: string;
  request_identity: string;
  semantic_digest: string;
  disposition: "ACCEPTED" | "REJECTED_NO_WRITE";
  resulting_research_intent_identity: string | null;
  committed_at_epoch_ms: number;
  rejection_code: string | null;
};

export type LegacyResearchQuarantineProjectionV1 = {
  schema_version: 1;
  consumer_projection: typeof LEGACY_RESEARCH_CONSUMER_PROJECTION_V1;
  resolution: "LEGACY_TERMINAL_QUARANTINED" | "SUBMITTED_OR_UNKNOWN";
  request_identity: string;
  owner_receipt: LegacyReceiptV1 | null;
  research_view: null;
  next_legal_action: "RESOLVE_SAME_REQUEST_IDENTITY";
};

export type LegacyResearchQuarantineBrowserEnvelopeV1 = {
  schema_version: 1;
  operation: "research_goal.legacy_quarantine_read.v1";
  channel: "DASHBOARD_SHADOW_READ";
  request_identity: string;
  transport_observed_at: string;
  availability: "available" | "unavailable";
  unavailable_reason: string | null;
  projection: LegacyResearchQuarantineProjectionV1;
  operational_run: OperationalRunReferenceV1;
};

type Json = Record<string, unknown>;

const object = (value: unknown): value is Json => (
  Boolean(value) && typeof value === "object" && !Array.isArray(value)
);

function exactKeys(value: Json, expected: readonly string[]): boolean {
  const actual = Object.keys(value).sort();
  const wanted = [...expected].sort();
  return actual.length === wanted.length
    && actual.every((key, index) => key === wanted[index]);
}

function text(value: unknown): value is string {
  return typeof value === "string" && value.length > 0;
}

function epoch(value: unknown): value is number {
  return Number.isSafeInteger(value) && Number(value) >= 0;
}

async function sha256Text(value: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

export function unknownLegacyResearchProjectionV1(
  requestIdentity: string,
): LegacyResearchQuarantineProjectionV1 {
  return {
    schema_version: 1,
    consumer_projection: LEGACY_RESEARCH_CONSUMER_PROJECTION_V1,
    resolution: "SUBMITTED_OR_UNKNOWN",
    request_identity: requestIdentity,
    owner_receipt: null,
    research_view: null,
    next_legal_action: "RESOLVE_SAME_REQUEST_IDENTITY",
  };
}

async function verifiedReceiptV1(
  value: unknown,
  requestIdentity: string,
): Promise<LegacyReceiptV1 | null> {
  if (!object(value) || !exactKeys(value, [
    "schema_version",
    "receipt_identity",
    "request_identity",
    "semantic_digest",
    "disposition",
    "resulting_research_intent_identity",
    "committed_at_epoch_ms",
    "rejection_code",
  ]) || value.schema_version !== 1 || value.request_identity !== requestIdentity
    || !text(value.receipt_identity) || !text(value.semantic_digest)
    || !/^sha256:[0-9a-f]{64}$/.test(value.semantic_digest)
    || !epoch(value.committed_at_epoch_ms)
    || !["ACCEPTED", "REJECTED_NO_WRITE"].includes(String(value.disposition))) return null;

  const suffix = await sha256Text(`${requestIdentity}:${value.semantic_digest}`);
  if (value.receipt_identity !== `rd-research-request-receipt-v1-${suffix}`) return null;
  if (value.disposition === "ACCEPTED") {
    if (value.resulting_research_intent_identity !== `rd-research-intent-v1-${suffix}`
      || value.rejection_code !== null) return null;
  } else if (value.resulting_research_intent_identity !== null || !text(value.rejection_code)) {
    return null;
  }
  return value as LegacyReceiptV1;
}

export async function projectLegacyResearchQuarantineV1(
  value: unknown,
  requestIdentity: string,
): Promise<LegacyResearchQuarantineProjectionV1 | null> {
  if (!object(value) || !exactKeys(value, [
    "schema_version",
    "resolution",
    "request_identity",
    "owner_receipt",
    "research_view",
    "next_legal_action",
  ]) || value.schema_version !== 1
    || value.resolution !== "LEGACY_TERMINAL_QUARANTINED"
    || value.request_identity !== requestIdentity
    || value.research_view !== null
    || value.next_legal_action !== "RESOLVE_SAME_REQUEST_IDENTITY") return null;
  const receipt = await verifiedReceiptV1(value.owner_receipt, requestIdentity);
  if (!receipt) return null;
  return {
    schema_version: 1,
    consumer_projection: LEGACY_RESEARCH_CONSUMER_PROJECTION_V1,
    resolution: "LEGACY_TERMINAL_QUARANTINED",
    request_identity: requestIdentity,
    owner_receipt: receipt,
    research_view: null,
    next_legal_action: "RESOLVE_SAME_REQUEST_IDENTITY",
  };
}

async function verifiedProjectedQuarantineV1(
  value: unknown,
  requestIdentity: string,
): Promise<boolean> {
  if (!object(value) || !exactKeys(value, [
    "schema_version",
    "consumer_projection",
    "resolution",
    "request_identity",
    "owner_receipt",
    "research_view",
    "next_legal_action",
  ]) || value.schema_version !== 1 || value.request_identity !== requestIdentity
    || value.resolution !== "LEGACY_TERMINAL_QUARANTINED"
    || value.research_view !== null
    || value.next_legal_action !== "RESOLVE_SAME_REQUEST_IDENTITY"
    || !object(value.consumer_projection)
    || JSON.stringify(value.consumer_projection) !== JSON.stringify(LEGACY_RESEARCH_CONSUMER_PROJECTION_V1)) {
    return false;
  }
  return Boolean(await verifiedReceiptV1(value.owner_receipt, requestIdentity));
}

function exactUnknownProjectionV1(value: unknown, requestIdentity: string): boolean {
  return object(value) && exactKeys(value, [
    "schema_version",
    "consumer_projection",
    "resolution",
    "request_identity",
    "owner_receipt",
    "research_view",
    "next_legal_action",
  ]) && JSON.stringify(value) === JSON.stringify(unknownLegacyResearchProjectionV1(requestIdentity));
}

export async function parseLegacyResearchQuarantineBrowserEnvelopeV1(
  value: unknown,
): Promise<LegacyResearchQuarantineBrowserEnvelopeV1 | null> {
  if (!object(value) || !exactKeys(value, [
    "schema_version",
    "operation",
    "channel",
    "request_identity",
    "transport_observed_at",
    "availability",
    "unavailable_reason",
    "projection",
    "operational_run",
  ]) || value.schema_version !== 1
    || value.operation !== "research_goal.legacy_quarantine_read.v1"
    || value.channel !== "DASHBOARD_SHADOW_READ"
    || !text(value.request_identity)
    || typeof value.transport_observed_at !== "string"
    || !Number.isFinite(Date.parse(value.transport_observed_at))) return null;
  if (value.availability === "available") {
    return value.unavailable_reason === null
      && await verifiedProjectedQuarantineV1(value.projection, value.request_identity)
      && validOperationalRunReferenceV1(value.operational_run, "available")
      ? value as LegacyResearchQuarantineBrowserEnvelopeV1 : null;
  }
  return value.availability === "unavailable" && text(value.unavailable_reason)
    && exactUnknownProjectionV1(value.projection, value.request_identity)
    && validOperationalRunReferenceV1(value.operational_run, "unavailable")
    ? value as LegacyResearchQuarantineBrowserEnvelopeV1 : null;
}
import {
  validOperationalRunReferenceV1,
  type OperationalRunReferenceV1,
} from "./operational-run-reference.ts";
