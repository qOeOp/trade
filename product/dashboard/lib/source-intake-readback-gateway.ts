import { ownerApiTargetForOperationV1 } from "./owner-api-target.ts";
import { SOURCE_INTAKE_SHADOW_READ_OPERATION } from "./operation-registry.ts";
import {
  resolveSourceIntakeShadowV1,
  type SourceIntakeShadowEnvelope,
} from "./rd-shadow-client.ts";

const IDENTITY = /^[A-Za-z0-9._:/-]{1,192}$/;
const DIGEST = /^sha256:[0-9a-f]{64}$/;
const REASON = /^[A-Z0-9_]{1,128}$/;
const TERMINALS = new Set([
  "RETRIEVED",
  "NOT_FOUND",
  "AUTH_REQUIRED",
  "ACCESS_DENIED",
  "RATE_LIMITED",
  "TERMS_OR_LICENSE_BLOCKED",
  "MALFORMED",
  "UNAVAILABLE",
]);

type Fetcher = typeof fetch;

export type SourceIntakeTerminalReadbackV1 = Readonly<{
  requestIdentity: string;
  resolution: string;
  bindingIdentity: string;
  receiptIdentity: string;
  committedAt: string;
  authorityClass: "LIVE_EXTERNAL" | "SEALED_ACCEPTANCE";
  content: Readonly<{ state: "retained"; digest: string }> | null;
}>;

export type SourceIntakeBrowserProjectionV1 = Readonly<{
  schemaVersion: 1;
  availability: "available" | "unavailable";
  requestIdentity: string;
  observedAt: string | null;
  state: "terminal" | "no_verified_terminal" | null;
  terminal: SourceIntakeTerminalReadbackV1 | null;
  reason: string | null;
}>;

export type SourceIntakeReadbackGatewayResultV1 = Readonly<{
  status: number;
  projection: SourceIntakeBrowserProjectionV1;
}>;

function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function exactKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  return actual.length === expected.length
    && actual.every((key, index) => key === expected[index]);
}

function validIdentity(value: unknown): value is string {
  return typeof value === "string" && IDENTITY.test(value);
}

function validDigest(value: unknown): value is string {
  return typeof value === "string" && DIGEST.test(value);
}

function validIsoTime(value: unknown): value is string {
  if (typeof value !== "string") return false;
  const epoch = Date.parse(value);
  return Number.isFinite(epoch) && new Date(epoch).toISOString() === value;
}

function unavailable(
  requestIdentity: string,
  reason: string,
): SourceIntakeBrowserProjectionV1 {
  return {
    schemaVersion: 1,
    availability: "unavailable",
    requestIdentity: validIdentity(requestIdentity) ? requestIdentity : "INVALID_REQUEST_IDENTITY",
    observedAt: null,
    state: null,
    terminal: null,
    reason,
  };
}

export function projectSourceIntakeShadowReadbackV1(
  envelope: SourceIntakeShadowEnvelope,
  requestIdentity: string,
): SourceIntakeBrowserProjectionV1 | null {
  if (!validIdentity(requestIdentity)
    || envelope.availability !== "available"
    || envelope.request_identity !== requestIdentity
    || envelope.unavailable_reason !== null
    || !validIsoTime(envelope.transport_observed_at)) return null;

  const projection = envelope.projection as unknown;
  if (!record(projection) || projection.request_identity !== requestIdentity) return null;
  if (projection.resolution === "SUBMITTED_OR_UNKNOWN") {
    return {
      schemaVersion: 1,
      availability: "available",
      requestIdentity,
      observedAt: envelope.transport_observed_at,
      state: "no_verified_terminal",
      terminal: null,
      reason: null,
    };
  }

  if (typeof projection.resolution !== "string" || !TERMINALS.has(projection.resolution)
    || !validIdentity(projection.binding_identity)
    || !validIdentity(projection.authority_class)
    || !record(projection.receipt)
    || !validIdentity(projection.receipt.receipt_identity)
    || !Number.isSafeInteger(projection.receipt.committed_at_epoch_ms)
    || Number(projection.receipt.committed_at_epoch_ms) < 0) return null;
  const authorityClass = projection.authority_class;
  if (authorityClass !== "LIVE_EXTERNAL" && authorityClass !== "SEALED_ACCEPTANCE") return null;
  const content = projection.resolution === "RETRIEVED"
    ? validDigest(projection.content_digest)
      ? { state: "retained" as const, digest: projection.content_digest }
      : null
    : null;
  if (projection.resolution === "RETRIEVED" && content === null) return null;
  if (projection.resolution !== "RETRIEVED" && "content_digest" in projection) return null;

  return {
    schemaVersion: 1,
    availability: "available",
    requestIdentity,
    observedAt: envelope.transport_observed_at,
    state: "terminal",
    terminal: {
      requestIdentity,
      resolution: projection.resolution,
      bindingIdentity: projection.binding_identity,
      receiptIdentity: projection.receipt.receipt_identity,
      committedAt: new Date(Number(projection.receipt.committed_at_epoch_ms)).toISOString(),
      authorityClass,
      content,
    },
    reason: null,
  };
}

export function parseSourceIntakeBrowserProjectionV1(
  value: unknown,
): SourceIntakeBrowserProjectionV1 | null {
  if (!record(value) || !exactKeys(value, [
    "schemaVersion", "availability", "requestIdentity", "observedAt", "state", "terminal", "reason",
  ]) || value.schemaVersion !== 1 || !validIdentity(value.requestIdentity)) return null;
  if (value.availability === "unavailable") {
    return value.observedAt === null && value.state === null && value.terminal === null
      && typeof value.reason === "string" && REASON.test(value.reason)
      ? value as SourceIntakeBrowserProjectionV1
      : null;
  }
  if (value.availability !== "available" || !validIsoTime(value.observedAt) || value.reason !== null) return null;
  if (value.state === "no_verified_terminal") {
    return value.terminal === null ? value as SourceIntakeBrowserProjectionV1 : null;
  }
  if (value.state !== "terminal" || !record(value.terminal) || !exactKeys(value.terminal, [
    "requestIdentity", "resolution", "bindingIdentity", "receiptIdentity", "committedAt", "authorityClass",
    "content",
  ]) || value.terminal.requestIdentity !== value.requestIdentity
    || typeof value.terminal.resolution !== "string" || !TERMINALS.has(value.terminal.resolution)
    || !validIdentity(value.terminal.bindingIdentity)
    || !validIdentity(value.terminal.receiptIdentity)
    || !validIsoTime(value.terminal.committedAt)
    || !["LIVE_EXTERNAL", "SEALED_ACCEPTANCE"].includes(String(value.terminal.authorityClass))) return null;
  if (value.terminal.resolution === "RETRIEVED") {
    if (!record(value.terminal.content) || !exactKeys(value.terminal.content, ["state", "digest"])
      || value.terminal.content.state !== "retained" || !validDigest(value.terminal.content.digest)) return null;
  } else if (value.terminal.content !== null) return null;
  return value as SourceIntakeBrowserProjectionV1;
}

export async function readSourceIntakeReadbackGatewayV1({
  requestIdentity,
  environment = process.env,
  fetcher = fetch,
}: {
  requestIdentity: string;
  environment?: Record<string, string | undefined>;
  fetcher?: Fetcher;
}): Promise<SourceIntakeReadbackGatewayResultV1> {
  if (!validIdentity(requestIdentity)) {
    return { status: 400, projection: unavailable(requestIdentity, "INVALID_REQUEST_IDENTITY") };
  }
  const target = ownerApiTargetForOperationV1(SOURCE_INTAKE_SHADOW_READ_OPERATION, environment);
  const resolved = await resolveSourceIntakeShadowV1({
    requestIdentity,
    baseUrl: target.baseUrl,
    token: target.token,
    fetcher,
  });
  if (resolved.envelope.availability !== "available") {
    return {
      status: resolved.status,
      projection: unavailable(
        requestIdentity,
        resolved.envelope.unavailable_reason ?? "SOURCE_INTAKE_READBACK_UNAVAILABLE",
      ),
    };
  }
  const projection = projectSourceIntakeShadowReadbackV1(resolved.envelope, requestIdentity);
  return projection
    ? { status: 200, projection }
    : { status: 502, projection: unavailable(requestIdentity, "SOURCE_INTAKE_RESPONSE_UNAVAILABLE") };
}
