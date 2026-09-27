import { validExploratoryReplayOpaqueIdentityV2 } from "./exploratory-replay-identity.ts";
import { announcedOwnerReadBudgetMsV1 } from "./operation-registry.ts";
import { dashboardReadApiTargetV1, ownerApiTargetAvailableV1 } from "./owner-api-target.ts";

// The `/backtest` read that lists one Replay request's Results as the Backtest Owner holds them, as
// `docs/guide/dashboard.md` admits it, so a Result is opened from that list rather than by a
// hand-typed identity. The Owner route is exactly
// `/v2/exploratory-replay-results?request_identity={request_identity}&meaning_digest={meaning_digest}`. It states which Results exist and their terminals, and nothing about whether
// a report can be stated: the report is read, as before, once a Result is opened.

const MAX_OWNER_RESPONSE_BYTES = 1_048_576;
const DIGEST = /^(?:sha256|blake3):[0-9a-f]{64}$/u;
const REASON = /^[A-Z0-9_]{1,128}$/u;
const TERMINALS = ["RUN_REJECTED", "TERMINAL_RESULT", "INVALID_REPLAY_EVIDENCE"] as const;

/** The most Results one directory lists; the Owner refuses a longer one by name. */
export const EXPLORATORY_REPLAY_RESULT_DIRECTORY_BOUND_V1 = 256;
export const INVALID_EXPLORATORY_REPLAY_RESULT_DIRECTORY_SELECTOR =
  "INVALID_EXPLORATORY_REPLAY_RESULT_DIRECTORY_SELECTOR";

export type ExploratoryReplayResultDirectoryEntryV1 = Readonly<{
  attemptIdentity: string;
  resultIdentity: string;
  terminal: typeof TERMINALS[number];
  committedAt: string;
}>;

export type ExploratoryReplayResultDirectoryV1 =
  | Readonly<{
    state: "available";
    requestIdentity: string;
    meaningDigest: string;
    results: readonly ExploratoryReplayResultDirectoryEntryV1[];
  }>
  | Readonly<{
    state: "unavailable";
    requestIdentity: string;
    meaningDigest: string;
    reason: string;
  }>;

export type ExploratoryReplayResultDirectoryGatewayResultV1 = Readonly<{
  status: number;
  body: ExploratoryReplayResultDirectoryV1;
}>;

type Json = Record<string, unknown>;
type Fetcher = typeof fetch;
type Selector = Readonly<{ requestIdentity: string; meaningDigest: string }>;

function object(value: unknown): value is Json {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function exactKeys(value: Json, keys: readonly string[]): boolean {
  return Object.keys(value).sort().join("|") === [...keys].sort().join("|");
}

function canonicalTime(value: unknown): value is string {
  return typeof value === "string" && !Number.isNaN(Date.parse(value))
    && new Date(value).toISOString() === value;
}

function terminal(value: unknown): value is typeof TERMINALS[number] {
  return typeof value === "string" && (TERMINALS as readonly string[]).includes(value);
}

function unavailable(status: number, selector: Selector, reason: string): ExploratoryReplayResultDirectoryGatewayResultV1 {
  return { status, body: { state: "unavailable", ...selector, reason } };
}

function uniqueResults(results: readonly { resultIdentity: string }[]): boolean {
  return new Set(results.map((entry) => entry.resultIdentity)).size === results.length;
}

// The Owner's answer for exactly this selector, or nothing: every key, every identity and the bound
// are held here, and an entry in progress is not a Result the Backtest Owner can list.
function projectOwnerDirectory(raw: unknown, selector: Selector): ExploratoryReplayResultDirectoryV1 | null {
  if (!object(raw) || !exactKeys(raw, ["schema_version", "request_identity", "meaning_digest", "results"])
    || raw.schema_version !== 1 || raw.request_identity !== selector.requestIdentity
    || raw.meaning_digest !== selector.meaningDigest || !Array.isArray(raw.results)
    || raw.results.length > EXPLORATORY_REPLAY_RESULT_DIRECTORY_BOUND_V1) return null;
  const results: ExploratoryReplayResultDirectoryEntryV1[] = [];
  for (const entry of raw.results) {
    if (!object(entry)
      || !exactKeys(entry, ["attempt_identity", "result_identity", "terminal", "committed_at_epoch_ms"])
      || !validExploratoryReplayOpaqueIdentityV2(entry.attempt_identity)
      || !validExploratoryReplayOpaqueIdentityV2(entry.result_identity)
      || !terminal(entry.terminal)
      || !Number.isSafeInteger(entry.committed_at_epoch_ms) || Number(entry.committed_at_epoch_ms) < 0) return null;
    results.push({
      attemptIdentity: entry.attempt_identity,
      resultIdentity: entry.result_identity,
      terminal: entry.terminal,
      committedAt: new Date(Number(entry.committed_at_epoch_ms)).toISOString(),
    });
  }
  return uniqueResults(results) ? { state: "available", ...selector, results } : null;
}

/** The browser's check of the route's body, for the selector it asked about. */
export function parseExploratoryReplayResultDirectoryV1(
  value: unknown,
  selector: Selector,
): ExploratoryReplayResultDirectoryV1 | null {
  if (!object(value) || value.requestIdentity !== selector.requestIdentity
    || value.meaningDigest !== selector.meaningDigest) return null;
  if (value.state === "unavailable") {
    return exactKeys(value, ["state", "requestIdentity", "meaningDigest", "reason"])
      && typeof value.reason === "string" && REASON.test(value.reason)
      ? value as ExploratoryReplayResultDirectoryV1
      : null;
  }
  if (value.state !== "available" || !exactKeys(value, ["state", "requestIdentity", "meaningDigest", "results"])
    || !Array.isArray(value.results) || value.results.length > EXPLORATORY_REPLAY_RESULT_DIRECTORY_BOUND_V1) return null;
  const valid = value.results.every((entry) => object(entry)
    && exactKeys(entry, ["attemptIdentity", "resultIdentity", "terminal", "committedAt"])
    && validExploratoryReplayOpaqueIdentityV2(entry.attemptIdentity)
    && validExploratoryReplayOpaqueIdentityV2(entry.resultIdentity)
    && terminal(entry.terminal) && canonicalTime(entry.committedAt));
  return valid && uniqueResults(value.results as { resultIdentity: string }[])
    ? value as ExploratoryReplayResultDirectoryV1
    : null;
}

function ownerEndpoint(baseUrl: string, selector: Selector): URL | null {
  try {
    const base = new URL(baseUrl);
    if (base.pathname !== "/") return null;
    const endpoint = new URL("/v2/exploratory-replay-results", base);
    endpoint.searchParams.set("request_identity", selector.requestIdentity);
    endpoint.searchParams.set("meaning_digest", selector.meaningDigest);
    return endpoint;
  } catch {
    return null;
  }
}

export async function readExploratoryReplayResultDirectoryGatewayV1({
  requestIdentity,
  meaningDigest,
  environment = process.env,
  fetcher = fetch,
}: {
  requestIdentity: string;
  meaningDigest: string;
  environment?: Record<string, string | undefined>;
  fetcher?: Fetcher;
}): Promise<ExploratoryReplayResultDirectoryGatewayResultV1> {
  const selector = { requestIdentity, meaningDigest };
  if (!validExploratoryReplayOpaqueIdentityV2(requestIdentity) || !DIGEST.test(meaningDigest)) {
    return unavailable(400, selector, INVALID_EXPLORATORY_REPLAY_RESULT_DIRECTORY_SELECTOR);
  }
  const target = dashboardReadApiTargetV1(environment);
  const endpoint = target.baseUrl ? ownerEndpoint(target.baseUrl, selector) : null;
  if (!ownerApiTargetAvailableV1(target) || !endpoint || !target.token) {
    return unavailable(503, selector, "OWNER_CONFIGURATION_UNAVAILABLE");
  }
  const budgetMs = announcedOwnerReadBudgetMsV1("exploratory replay result directory", 8_000);
  try {
    const response = await fetcher(endpoint, {
      method: "GET",
      headers: { authorization: `Bearer ${target.token}` },
      cache: "no-store",
      signal: AbortSignal.timeout(budgetMs),
    });
    if (response.status === 401 || response.status === 403) {
      return unavailable(403, selector, "OWNER_PERMISSION_DENIED");
    }
    if (![200, 409, 503].includes(response.status)) {
      return unavailable(502, selector, "OWNER_RESPONSE_UNAVAILABLE");
    }
    const text = await response.text();
    if (new TextEncoder().encode(text).byteLength > MAX_OWNER_RESPONSE_BYTES) {
      return unavailable(502, selector, "OWNER_RESPONSE_UNAVAILABLE");
    }
    let raw: unknown;
    try { raw = JSON.parse(text); } catch {
      // A 503 with no body is the read API saying it could not reach the Owner at all.
      return response.status === 503
        ? unavailable(503, selector, "OWNER_TRANSPORT_UNAVAILABLE")
        : unavailable(502, selector, "OWNER_RESPONSE_UNAVAILABLE");
    }
    // 200 carries a directory; 409 (a Result under another meaning digest) and 503 (any other
    // refusal) carry the unavailable envelope under the Owner's own reason. Either body under the
    // other status is no answer.
    if (response.status !== 200) {
      return object(raw) && exactKeys(raw, ["state", "reason"]) && raw.state === "UNAVAILABLE"
        && typeof raw.reason === "string" && REASON.test(raw.reason)
        ? unavailable(response.status, selector, raw.reason)
        : unavailable(502, selector, "OWNER_RESPONSE_UNAVAILABLE");
    }
    const directory = projectOwnerDirectory(raw, selector);
    return directory
      ? { status: 200, body: directory }
      : unavailable(502, selector, "OWNER_RESPONSE_UNAVAILABLE");
  } catch {
    return unavailable(503, selector, "OWNER_TRANSPORT_UNAVAILABLE");
  }
}
