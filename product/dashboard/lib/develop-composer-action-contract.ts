import { createHash } from "node:crypto";

const MAX_IDENTITY_BYTES = 256;
const DIGEST_BYTES = 32;

type Json = Record<string, unknown>;

export type DevelopComposerRunRequestV2 = {
  action: "RUN";
  research_request_locator: string;
};

export type DevelopComposerRequestProjectionV2 = {
  schema_version: 2;
  research_request_locator: string;
  request_identity: string;
  request_digest: number[];
  research_custody_digest: number[];
  research_request_identity: number[];
  intent_identity: number[];
  intent_digest: number[];
  design_identity: number[];
  design_digest: number[];
  provider_identity: string;
};

export type DevelopComposerDispatchRequestV2 = DevelopComposerRunRequestV2 & {
  projection: DevelopComposerRequestProjectionV2;
};

export type DevelopComposerOperationResponseV2 = {
  schema_version: 2;
  request_identity: string;
  disposition: "SUCCESS" | "CONFLICT" | "UNSUPPORTED"
    | "NEEDS_RESEARCH_REFINEMENT" | "UNAVAILABLE" | "SUBMITTED_OR_UNKNOWN";
  receipt_identity: number[] | null;
  artifact: {
    artifact_locator: string;
    artifact_digest: number[];
    canonical_plan_digest: number[];
    design_digest: number[];
  } | null;
  coordinate: string | null;
  reason: string | null;
};

function record(value: unknown): value is Json {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function exactKeys(value: Json, expected: readonly string[]): boolean {
  return Object.keys(value).sort().join("\u001f") === [...expected].sort().join("\u001f");
}

export function validDevelopComposerIdentityV2(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0
    && new TextEncoder().encode(value).byteLength <= MAX_IDENTITY_BYTES;
}

function digestBytes(value: unknown): value is number[] {
  return Array.isArray(value) && value.length === DIGEST_BYTES
    && value.every((byte) => Number.isInteger(byte) && byte >= 0 && byte <= 255);
}

export function canonicalDevelopComposerRunRequestV2(
  value: unknown,
): DevelopComposerRunRequestV2 | null {
  if (!record(value) || !exactKeys(value, ["action", "research_request_locator"])
    || value.action !== "RUN" || !validDevelopComposerIdentityV2(value.research_request_locator)) {
    return null;
  }
  return { action: "RUN", research_request_locator: value.research_request_locator };
}

export function canonicalDevelopComposerProjectionV2(
  value: unknown,
  expectedLocator?: string,
): DevelopComposerRequestProjectionV2 | null {
  if (!record(value) || !exactKeys(value, [
    "schema_version", "research_request_locator", "request_identity", "request_digest",
    "research_custody_digest", "research_request_identity", "intent_identity", "intent_digest",
    "design_identity", "design_digest", "provider_identity",
  ]) || value.schema_version !== 2
    || !validDevelopComposerIdentityV2(value.research_request_locator)
    || (expectedLocator !== undefined && value.research_request_locator !== expectedLocator)
    || !validDevelopComposerIdentityV2(value.request_identity)
    || !validDevelopComposerIdentityV2(value.provider_identity)
    || ![
    value.request_digest, value.research_custody_digest, value.research_request_identity,
      value.intent_identity, value.intent_digest, value.design_identity, value.design_digest,
    ].every(digestBytes)) return null;
  const requestDigest = value.request_digest as number[];
  const researchCustodyDigest = value.research_custody_digest as number[];
  const researchRequestIdentity = value.research_request_identity as number[];
  const intentIdentity = value.intent_identity as number[];
  const intentDigest = value.intent_digest as number[];
  const designIdentity = value.design_identity as number[];
  const designDigest = value.design_digest as number[];
  return {
    schema_version: 2,
    research_request_locator: value.research_request_locator,
    request_identity: value.request_identity,
    request_digest: [...requestDigest],
    research_custody_digest: [...researchCustodyDigest],
    research_request_identity: [...researchRequestIdentity],
    intent_identity: [...intentIdentity],
    intent_digest: [...intentDigest],
    design_identity: [...designIdentity],
    design_digest: [...designDigest],
    provider_identity: value.provider_identity,
  };
}

export function developComposerProjectionDigestV2(
  projection: DevelopComposerRequestProjectionV2,
): string {
  const canonical = canonicalDevelopComposerProjectionV2(
    projection,
    projection.research_request_locator,
  );
  if (!canonical) throw new Error("DEVELOP_COMPOSER_PROJECTION_INVALID");
  return `sha256:${createHash("sha256").update(JSON.stringify(canonical)).digest("hex")}`;
}

export function canonicalDevelopComposerDispatchRequestV2(
  value: unknown,
): DevelopComposerDispatchRequestV2 | null {
  if (!record(value) || !exactKeys(value, ["action", "projection", "research_request_locator"])) {
    return null;
  }
  const request = canonicalDevelopComposerRunRequestV2({
    action: value.action,
    research_request_locator: value.research_request_locator,
  });
  const projection = request
    ? canonicalDevelopComposerProjectionV2(value.projection, request.research_request_locator)
    : null;
  return request && projection ? { ...request, projection } : null;
}

function artifact(value: unknown): DevelopComposerOperationResponseV2["artifact"] {
  if (!record(value) || !exactKeys(value, [
    "artifact_locator", "artifact_digest", "canonical_plan_digest", "design_digest",
  ]) || !validDevelopComposerIdentityV2(value.artifact_locator)
    || !digestBytes(value.artifact_digest) || !digestBytes(value.canonical_plan_digest)
    || !digestBytes(value.design_digest)) return null;
  return {
    artifact_locator: value.artifact_locator,
    artifact_digest: [...value.artifact_digest],
    canonical_plan_digest: [...value.canonical_plan_digest],
    design_digest: [...value.design_digest],
  };
}

export function canonicalDevelopComposerOperationResponseV2(
  value: unknown,
  requestIdentity: string,
): DevelopComposerOperationResponseV2 | null {
  if (!record(value) || !exactKeys(value, [
    "schema_version", "request_identity", "disposition", "receipt_identity", "artifact",
    "coordinate", "reason",
  ]) || value.schema_version !== 2 || value.request_identity !== requestIdentity
    || !["SUCCESS", "CONFLICT", "UNSUPPORTED", "NEEDS_RESEARCH_REFINEMENT", "UNAVAILABLE",
      "SUBMITTED_OR_UNKNOWN"].includes(String(value.disposition))
    || !(value.receipt_identity === null || digestBytes(value.receipt_identity))
    || !(value.coordinate === null || typeof value.coordinate === "string")
    || !(value.reason === null || typeof value.reason === "string")) return null;
  const parsedArtifact = value.artifact === null ? null : artifact(value.artifact);
  if (value.artifact !== null && parsedArtifact === null) return null;
  const disposition = value.disposition as DevelopComposerOperationResponseV2["disposition"];
  if (disposition === "SUCCESS") {
    if (!digestBytes(value.receipt_identity) || !parsedArtifact
      || value.coordinate !== null || value.reason !== null) return null;
  } else if (value.receipt_identity !== null || parsedArtifact !== null) return null;
  return {
    schema_version: 2,
    request_identity: requestIdentity,
    disposition,
    receipt_identity: value.receipt_identity === null ? null : [...value.receipt_identity],
    artifact: parsedArtifact,
    coordinate: value.coordinate as string | null,
    reason: value.reason as string | null,
  };
}

export function parseDevelopComposerOperationResponseV2(
  status: number,
  value: unknown,
  requestIdentity: string,
): DevelopComposerOperationResponseV2 | null {
  const canonical = canonicalDevelopComposerOperationResponseV2(value, requestIdentity);
  if (!canonical) return null;
  const disposition = canonical.disposition;
  return (status === 200 && disposition === "SUCCESS")
    || (status === 202 && disposition === "SUBMITTED_OR_UNKNOWN")
    || (status === 409 && disposition === "CONFLICT")
    || (status === 422 && ["UNSUPPORTED", "NEEDS_RESEARCH_REFINEMENT"].includes(disposition))
    || (status === 503 && disposition === "UNAVAILABLE")
    ? canonical
    : null;
}

export function developComposerOwnerRunBodyV2(researchRequestLocator: string): string {
  const request = canonicalDevelopComposerRunRequestV2({
    action: "RUN",
    research_request_locator: researchRequestLocator,
  });
  if (!request) throw new Error("DEVELOP_COMPOSER_REQUEST_INVALID");
  return JSON.stringify({ research_request_locator: request.research_request_locator });
}
