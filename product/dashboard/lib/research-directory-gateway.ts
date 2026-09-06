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
  "availability",
  "committed_at_epoch_ms",
  "disposition",
  "intent_identity",
  "phase",
  "request_identity",
];
const CURSOR_KEYS = ["committed_at_epoch_ms", "request_identity"];
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
  "availability",
  "committedAt",
  "disposition",
  "intentIdentity",
  "phase",
  "requestIdentity",
];
const BROWSER_CURSOR_KEYS = ["committedAtEpochMs", "requestIdentity"];

type Fetcher = typeof fetch;

export type ResearchDirectoryCursorV1 = Readonly<{
  committedAtEpochMs: number;
  requestIdentity: string;
}>;

export type ResearchDirectoryItemV1 = Readonly<{
  requestIdentity: string;
  intentIdentity: string | null;
  disposition: "ACCEPTED" | "REJECTED_NO_WRITE";
  availability: "AVAILABLE" | "STALE" | "UNAVAILABLE" | null;
  phase: "REQUEST_UNRESOLVED" | "INTENT_FROZEN" | "ARTIFACT_AVAILABLE" | null;
  committedAt: string;
}>;

export type ResearchDirectoryProjectionV1 = Readonly<{
  availability: "available" | "unavailable";
  observedAt: string | null;
  completeness: "complete" | "partial" | null;
  omittedCount: number;
  nextCursor: ResearchDirectoryCursorV1 | null;
  items: readonly ResearchDirectoryItemV1[];
  reason: string | null;
}>;

export type ResearchDirectoryGatewayResultV1 = Readonly<{
  status: 200 | 400 | 502 | 503;
  projection: ResearchDirectoryProjectionV1;
}>;

export function createResearchDirectoryRequestGuardV1() {
  let current = 0;
  return {
    begin: () => { current += 1; return current; },
    isCurrent: (requestIdentity: number) => requestIdentity === current,
  };
}

export function mergeResearchDirectoryItemsV1(
  current: readonly ResearchDirectoryItemV1[],
  incoming: readonly ResearchDirectoryItemV1[],
): readonly ResearchDirectoryItemV1[] | null {
  const requests = new Set(current.map((item) => item.requestIdentity));
  const intents = new Set(current.flatMap((item) => item.intentIdentity ? [item.intentIdentity] : []));
  for (const item of incoming) {
    if (requests.has(item.requestIdentity)
      || (item.intentIdentity !== null && intents.has(item.intentIdentity))) return null;
    requests.add(item.requestIdentity);
    if (item.intentIdentity !== null) intents.add(item.intentIdentity);
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

function requestIdentity(value: unknown): value is string {
  return identity(value) && value.length >= 16 && value.length <= 128;
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

function unavailable(reason: string): ResearchDirectoryProjectionV1 {
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

function ownerEndpoint(baseUrl: string, cursor?: ResearchDirectoryCursorV1): URL | null {
  try {
    const base = new URL(baseUrl);
    if (!["http:", "https:"].includes(base.protocol) || base.username || base.password
      || base.pathname !== "/" || base.search || base.hash) return null;
    const endpoint = new URL("/v1/research-goals/directory", base);
    endpoint.searchParams.set("limit", "20");
    if (cursor) {
      endpoint.searchParams.set("after_committed_at_epoch_ms", String(cursor.committedAtEpochMs));
      endpoint.searchParams.set("after_request_identity", cursor.requestIdentity);
    }
    return endpoint;
  } catch {
    return null;
  }
}

function projectCursor(value: unknown): ResearchDirectoryCursorV1 | null {
  if (!object(value) || !exactKeys(value, CURSOR_KEYS)
    || !safeEpoch(value.committed_at_epoch_ms)
    || !requestIdentity(value.request_identity)) return null;
  return {
    committedAtEpochMs: value.committed_at_epoch_ms,
    requestIdentity: value.request_identity,
  };
}

function validOwnerItem(
  value: Record<string, unknown>,
  observedAtEpochMs: number,
): value is Record<string, unknown> & {
  request_identity: string;
  intent_identity: string | null;
  disposition: ResearchDirectoryItemV1["disposition"];
  availability: ResearchDirectoryItemV1["availability"];
  phase: ResearchDirectoryItemV1["phase"];
  committed_at_epoch_ms: number;
} {
  if (!exactKeys(value, ITEM_KEYS)
    || !requestIdentity(value.request_identity)
    || (value.intent_identity !== null && !identity(value.intent_identity))
    || (value.disposition !== "ACCEPTED" && value.disposition !== "REJECTED_NO_WRITE")
    || !["AVAILABLE", "STALE", "UNAVAILABLE", null].includes(value.availability as never)
    || !["REQUEST_UNRESOLVED", "INTENT_FROZEN", "ARTIFACT_AVAILABLE", null]
      .includes(value.phase as never)
    || !safeEpoch(value.committed_at_epoch_ms)
    || value.committed_at_epoch_ms > observedAtEpochMs) return false;
  return value.disposition === "ACCEPTED"
    ? value.intent_identity !== null && value.availability !== null && value.phase !== null
    : value.intent_identity === null && value.availability === null && value.phase === null;
}

export function projectResearchDirectoryOwnerReadbackV1(
  value: unknown,
): ResearchDirectoryProjectionV1 | null {
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

  const items: ResearchDirectoryItemV1[] = [];
  const requests = new Set<string>();
  const intents = new Set<string>();
  for (const candidate of value.items) {
    if (!object(candidate) || !validOwnerItem(candidate, value.observed_at_epoch_ms)
      || requests.has(candidate.request_identity)
      || (candidate.intent_identity !== null && intents.has(candidate.intent_identity))) return null;
    requests.add(candidate.request_identity);
    if (candidate.intent_identity !== null) intents.add(candidate.intent_identity);
    items.push({
      requestIdentity: candidate.request_identity,
      intentIdentity: candidate.intent_identity,
      disposition: candidate.disposition,
      availability: candidate.availability,
      phase: candidate.phase,
      committedAt: new Date(candidate.committed_at_epoch_ms).toISOString(),
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

export function parseResearchDirectoryBrowserProjectionV1(
  value: unknown,
): ResearchDirectoryProjectionV1 | null {
  if (!object(value) || !exactKeys(value, BROWSER_KEYS)
    || (value.availability !== "available" && value.availability !== "unavailable")
    || !Number.isSafeInteger(value.omittedCount)
    || Number(value.omittedCount) < 0
    || !Array.isArray(value.items)) return null;
  if (value.availability === "unavailable") {
    return value.observedAt === null && value.completeness === null
      && value.omittedCount === 0 && value.nextCursor === null
      && value.items.length === 0 && typeof value.reason === "string"
      ? value as ResearchDirectoryProjectionV1
      : null;
  }
  if (!canonicalTime(value.observedAt)
    || (value.completeness !== "complete" && value.completeness !== "partial")
    || (value.completeness === "complete") !== (value.omittedCount === 0)
    || Number(value.omittedCount) > 60
    || value.reason !== null
    || value.items.length > 20) return null;
  const observedAtEpochMs = Date.parse(value.observedAt);
  const requests = new Set<string>();
  const intents = new Set<string>();
  for (const item of value.items) {
    if (!object(item) || !exactKeys(item, BROWSER_ITEM_KEYS)
      || !requestIdentity(item.requestIdentity)
      || (item.intentIdentity !== null && !identity(item.intentIdentity))
      || (item.disposition !== "ACCEPTED" && item.disposition !== "REJECTED_NO_WRITE")
      || !["AVAILABLE", "STALE", "UNAVAILABLE", null].includes(item.availability as never)
      || !["REQUEST_UNRESOLVED", "INTENT_FROZEN", "ARTIFACT_AVAILABLE", null]
        .includes(item.phase as never)
      || !canonicalTime(item.committedAt)
      || Date.parse(item.committedAt) > observedAtEpochMs
      || requests.has(item.requestIdentity)
      || (item.intentIdentity !== null && intents.has(item.intentIdentity))) return null;
    if ((item.disposition === "ACCEPTED") !== (item.intentIdentity !== null
      && item.availability !== null && item.phase !== null)) return null;
    requests.add(item.requestIdentity);
    if (item.intentIdentity !== null) intents.add(item.intentIdentity);
  }
  if (value.nextCursor !== null
    && (!object(value.nextCursor)
      || !exactKeys(value.nextCursor, BROWSER_CURSOR_KEYS)
      || !safeEpoch(value.nextCursor.committedAtEpochMs)
      || !requestIdentity(value.nextCursor.requestIdentity))) return null;
  return value as ResearchDirectoryProjectionV1;
}

export async function readResearchDirectoryGatewayV1({
  cursor,
  baseUrl = process.env.RD_OWNER_API_URL,
  token = process.env.RD_OWNER_API_TOKEN,
  fetcher = fetch,
}: {
  cursor?: ResearchDirectoryCursorV1;
  baseUrl?: string;
  token?: string;
  fetcher?: Fetcher;
} = {}): Promise<ResearchDirectoryGatewayResultV1> {
  if (cursor && (!safeEpoch(cursor.committedAtEpochMs) || !requestIdentity(cursor.requestIdentity))) {
    return { status: 400, projection: unavailable("RESEARCH_DIRECTORY_CURSOR_INVALID") };
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
    const projection = projectResearchDirectoryOwnerReadbackV1(raw);
    if (projection && cursor && projection.nextCursor
      && !(projection.nextCursor.committedAtEpochMs < cursor.committedAtEpochMs
        || (projection.nextCursor.committedAtEpochMs === cursor.committedAtEpochMs
          && projection.nextCursor.requestIdentity < cursor.requestIdentity))) {
      return { status: 502, projection: unavailable("OWNER_RESPONSE_UNAVAILABLE") };
    }
    return projection
      ? { status: 200, projection }
      : { status: 502, projection: unavailable("OWNER_RESPONSE_UNAVAILABLE") };
  } catch {
    return { status: 503, projection: unavailable("OWNER_TRANSPORT_UNAVAILABLE") };
  }
}
