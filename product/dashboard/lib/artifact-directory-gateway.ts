const IDENTITY = /^[A-Za-z0-9._:/-]{1,192}$/u;
const MAX_RESPONSE_BYTES = 512 * 1024;
const OWNER_KEYS = [
  "completeness",
  "items",
  "next_cursor",
  "observed_at_epoch_ms",
  "omitted_count",
  "schema_version",
];
const ITEM_KEYS = [
  "artifact_identity",
  "attempt_identity",
  "build_request_identity",
  "build_security_state",
  "build_target",
  "committed_at_epoch_ms",
  "intent_identity",
];
const CURSOR_KEYS = ["build_request_identity", "prepared_at_epoch_ms"];
const BROWSER_KEYS = [
  "availability",
  "completeness",
  "items",
  "nextCursor",
  "observedAt",
  "omittedCount",
  "reason",
];
const BROWSER_ITEM_KEYS = [
  "artifactIdentity",
  "attemptIdentity",
  "buildRequestIdentity",
  "buildSecurityState",
  "buildTarget",
  "committedAt",
  "intentIdentity",
];
const BROWSER_CURSOR_KEYS = ["buildRequestIdentity", "preparedAtEpochMs"];

type Fetcher = typeof fetch;

export type ArtifactDirectoryCursorV1 = Readonly<{
  preparedAtEpochMs: number;
  buildRequestIdentity: string;
}>;

export type ArtifactDirectoryItemV1 = Readonly<{
  buildRequestIdentity: string;
  attemptIdentity: string;
  artifactIdentity: string;
  intentIdentity: string;
  committedAt: string;
  buildTarget: string;
  buildSecurityState: "ADMITTED";
}>;

export type ArtifactDirectoryProjectionV1 = Readonly<{
  availability: "available" | "unavailable";
  observedAt: string | null;
  completeness: "complete" | "partial" | null;
  omittedCount: number;
  nextCursor: ArtifactDirectoryCursorV1 | null;
  items: readonly ArtifactDirectoryItemV1[];
  reason: string | null;
}>;

export type ArtifactDirectoryGatewayResultV1 = Readonly<{
  status: 200 | 400 | 502 | 503;
  projection: ArtifactDirectoryProjectionV1;
}>;

export function createArtifactDirectoryRequestGuardV1() {
  let current = 0;
  return {
    begin: () => { current += 1; return current; },
    isCurrent: (requestIdentity: number) => requestIdentity === current,
  };
}

export function mergeArtifactDirectoryItemsV1(
  current: readonly ArtifactDirectoryItemV1[],
  incoming: readonly ArtifactDirectoryItemV1[],
): readonly ArtifactDirectoryItemV1[] | null {
  const buildRequests = new Set(current.map((item) => item.buildRequestIdentity));
  const attempts = new Set(current.map((item) => item.attemptIdentity));
  const artifacts = new Set(current.map((item) => item.artifactIdentity));
  for (const item of incoming) {
    if (buildRequests.has(item.buildRequestIdentity)
      || attempts.has(item.attemptIdentity)
      || artifacts.has(item.artifactIdentity)) return null;
    buildRequests.add(item.buildRequestIdentity);
    attempts.add(item.attemptIdentity);
    artifacts.add(item.artifactIdentity);
  }
  return [...current, ...incoming];
}

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

function unavailable(reason: string): ArtifactDirectoryProjectionV1 {
  return {
    availability: "unavailable",
    observedAt: null,
    completeness: null,
    omittedCount: 0,
    nextCursor: null,
    items: [],
    reason,
  };
}

function ownerEndpoint(baseUrl: string, cursor?: ArtifactDirectoryCursorV1): URL | null {
  try {
    const base = new URL(baseUrl);
    if (!["http:", "https:"].includes(base.protocol) || base.username || base.password
      || base.pathname !== "/" || base.search || base.hash) return null;
    const endpoint = new URL("/v1/artifact-builds/directory", base);
    endpoint.searchParams.set("limit", "20");
    if (cursor) {
      endpoint.searchParams.set("after_prepared_at_epoch_ms", String(cursor.preparedAtEpochMs));
      endpoint.searchParams.set("after_build_request_identity", cursor.buildRequestIdentity);
    }
    return endpoint;
  } catch {
    return null;
  }
}

function projectCursor(value: unknown): ArtifactDirectoryCursorV1 | null {
  if (!object(value) || !exactKeys(value, CURSOR_KEYS)
    || !safeEpoch(value.prepared_at_epoch_ms)
    || !identity(value.build_request_identity)) return null;
  return {
    preparedAtEpochMs: value.prepared_at_epoch_ms,
    buildRequestIdentity: value.build_request_identity,
  };
}

export function projectArtifactDirectoryOwnerReadbackV1(
  value: unknown,
): ArtifactDirectoryProjectionV1 | null {
  if (!object(value) || !exactKeys(value, OWNER_KEYS)
    || value.schema_version !== 1
    || !safeEpoch(value.observed_at_epoch_ms)
    || (value.completeness !== "COMPLETE" && value.completeness !== "PARTIAL")
    || !Number.isSafeInteger(value.omitted_count)
    || Number(value.omitted_count) < 0
    || Number(value.omitted_count) > 60
    || !Array.isArray(value.items)
    || value.items.length > 20) return null;
  if ((value.completeness === "COMPLETE") !== (value.omitted_count === 0)) return null;

  const items: ArtifactDirectoryItemV1[] = [];
  const identities = new Set<string>();
  for (const candidate of value.items) {
    if (!object(candidate) || !exactKeys(candidate, ITEM_KEYS)
      || !identity(candidate.build_request_identity)
      || !identity(candidate.attempt_identity)
      || !identity(candidate.artifact_identity)
      || !identity(candidate.intent_identity)
      || !safeEpoch(candidate.committed_at_epoch_ms)
      || typeof candidate.build_target !== "string"
      || candidate.build_target.length < 1
      || candidate.build_target.length > 128
      || candidate.build_security_state !== "ADMITTED"
      || identities.has(candidate.build_request_identity)
      || identities.has(candidate.attempt_identity)
      || identities.has(candidate.artifact_identity)) return null;
    identities.add(candidate.build_request_identity);
    identities.add(candidate.attempt_identity);
    identities.add(candidate.artifact_identity);
    items.push({
      buildRequestIdentity: candidate.build_request_identity,
      attemptIdentity: candidate.attempt_identity,
      artifactIdentity: candidate.artifact_identity,
      intentIdentity: candidate.intent_identity,
      committedAt: new Date(candidate.committed_at_epoch_ms).toISOString(),
      buildTarget: candidate.build_target,
      buildSecurityState: "ADMITTED",
    });
  }

  const nextCursor = value.next_cursor === null ? null : projectCursor(value.next_cursor);
  if (value.next_cursor !== null && !nextCursor) return null;
  return {
    availability: "available",
    observedAt: new Date(value.observed_at_epoch_ms).toISOString(),
    completeness: value.completeness === "COMPLETE" ? "complete" : "partial",
    omittedCount: Number(value.omitted_count),
    nextCursor,
    items,
    reason: null,
  };
}

export function parseArtifactDirectoryBrowserProjectionV1(
  value: unknown,
): ArtifactDirectoryProjectionV1 | null {
  if (!object(value) || !exactKeys(value, BROWSER_KEYS)
    || (value.availability !== "available" && value.availability !== "unavailable")
    || !Number.isSafeInteger(value.omittedCount)
    || Number(value.omittedCount) < 0
    || !Array.isArray(value.items)) return null;
  if (value.availability === "unavailable") {
    return value.observedAt === null && value.completeness === null
      && value.omittedCount === 0 && value.nextCursor === null
      && value.items.length === 0 && typeof value.reason === "string"
      ? value as ArtifactDirectoryProjectionV1
      : null;
  }
  if (!canonicalTime(value.observedAt)
    || (value.completeness !== "complete" && value.completeness !== "partial")
    || (value.completeness === "complete") !== (value.omittedCount === 0)
    || value.reason !== null
    || value.items.length > 20) return null;

  for (const item of value.items) {
    if (!object(item) || !exactKeys(item, BROWSER_ITEM_KEYS)
      || !identity(item.buildRequestIdentity)
      || !identity(item.attemptIdentity)
      || !identity(item.artifactIdentity)
      || !identity(item.intentIdentity)
      || !canonicalTime(item.committedAt)
      || typeof item.buildTarget !== "string"
      || item.buildTarget.length < 1
      || item.buildTarget.length > 128
      || item.buildSecurityState !== "ADMITTED") return null;
  }
  if (value.nextCursor !== null
    && (!object(value.nextCursor)
      || !exactKeys(value.nextCursor, BROWSER_CURSOR_KEYS)
      || !safeEpoch(value.nextCursor.preparedAtEpochMs)
      || !identity(value.nextCursor.buildRequestIdentity))) return null;
  return value as ArtifactDirectoryProjectionV1;
}

export async function readArtifactDirectoryGatewayV1({
  cursor,
  baseUrl = process.env.RD_OWNER_API_URL,
  token = process.env.RD_OWNER_API_TOKEN,
  fetcher = fetch,
}: {
  cursor?: ArtifactDirectoryCursorV1;
  baseUrl?: string;
  token?: string;
  fetcher?: Fetcher;
} = {}): Promise<ArtifactDirectoryGatewayResultV1> {
  if (cursor && (!safeEpoch(cursor.preparedAtEpochMs) || !identity(cursor.buildRequestIdentity))) {
    return { status: 400, projection: unavailable("ARTIFACT_DIRECTORY_CURSOR_INVALID") };
  }
  const endpoint = baseUrl ? ownerEndpoint(baseUrl, cursor) : null;
  if (!endpoint || !token) {
    return { status: 503, projection: unavailable("OWNER_CONFIGURATION_UNAVAILABLE") };
  }
  try {
    const response = await fetcher(endpoint, {
      method: "GET",
      headers: { authorization: `Bearer ${token}` },
      cache: "no-store",
      signal: AbortSignal.timeout(8_000),
    });
    if (!response.ok) {
      return { status: response.status >= 500 ? 503 : 502, projection: unavailable("OWNER_RESPONSE_UNAVAILABLE") };
    }
    const contentLength = response.headers.get("content-length");
    if (contentLength !== null && (!/^\d+$/u.test(contentLength)
      || Number(contentLength) > MAX_RESPONSE_BYTES)) {
      return { status: 502, projection: unavailable("OWNER_RESPONSE_UNAVAILABLE") };
    }
    const text = await response.text();
    if (new TextEncoder().encode(text).byteLength > MAX_RESPONSE_BYTES) {
      return { status: 502, projection: unavailable("OWNER_RESPONSE_UNAVAILABLE") };
    }
    let raw: unknown;
    try { raw = JSON.parse(text); } catch {
      return { status: 502, projection: unavailable("OWNER_RESPONSE_UNAVAILABLE") };
    }
    const projection = projectArtifactDirectoryOwnerReadbackV1(raw);
    if (projection && cursor && projection.nextCursor
      && !(projection.nextCursor.preparedAtEpochMs < cursor.preparedAtEpochMs
        || (projection.nextCursor.preparedAtEpochMs === cursor.preparedAtEpochMs
          && projection.nextCursor.buildRequestIdentity < cursor.buildRequestIdentity))) {
      return { status: 502, projection: unavailable("OWNER_RESPONSE_UNAVAILABLE") };
    }
    return projection
      ? { status: 200, projection }
      : { status: 502, projection: unavailable("OWNER_RESPONSE_UNAVAILABLE") };
  } catch {
    return { status: 503, projection: unavailable("OWNER_TRANSPORT_UNAVAILABLE") };
  }
}
