const MAX_OWNER_RESPONSE_BYTES = 2 * 1024 * 1024;

export type RdOwnerHttpTransportV1 = {
  owner_url: string;
  owner_token: string;
  fetcher: typeof fetch;
};

export type RdOwnerJsonOutcomeV1 =
  | { state: "AVAILABLE"; value: Record<string, unknown> }
  | { state: "ABSENT"; value: null }
  | { state: "UNKNOWN"; value: null }
  | { state: "UNAVAILABLE"; value: null };

function ownerOutcomeUnknownV1(value: unknown): boolean {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return false;
  const record = value as Record<string, unknown>;
  const keys = Object.keys(record).sort();
  const sourceUnknown = keys.length === 3
    && keys[0] === "next_legal_action"
    && keys[1] === "request_identity"
    && keys[2] === "resolution"
    && record.resolution === "SUBMITTED_OR_UNKNOWN"
    && record.next_legal_action === "RESOLVE_SAME_REQUEST";
  const researchUnknown = keys.length === 10
    && keys.join(",") === [
      "independence_basis", "next_legal_action", "owner_receipt", "protected_feedback",
      "request_identity", "research_view", "resolution", "schema_version", "trial_family",
      "trial_family_resolution",
    ].join(",")
    && record.schema_version === 2
    && record.resolution === "SUBMITTED_OR_UNKNOWN"
    && record.next_legal_action === "RESOLVE_SAME_REQUEST_IDENTITY"
    && record.owner_receipt === null
    && record.research_view === null
    && record.independence_basis === null
    && record.protected_feedback === null
    && record.trial_family === null
    && record.trial_family_resolution === "UNAVAILABLE";
  return typeof record.request_identity === "string"
    && /^[A-Za-z0-9._:/-]{1,192}$/.test(record.request_identity)
    && (sourceUnknown || researchUnknown);
}

function loopbackOwnerUrl(raw: string | undefined): string | null {
  if (!raw) return null;
  try {
    const value = new URL(raw);
    const loopback = ["localhost", "127.0.0.1", "[::1]", "::1"].includes(value.hostname);
    if (!loopback || value.protocol !== "http:" || value.username || value.password
      || value.search || value.hash || value.pathname !== "/") return null;
    return value.origin;
  } catch {
    return null;
  }
}

export function configuredDisposableOwnerTransportV1({
  environment,
  enablementKey,
  fetcher,
}: {
  environment: Record<string, string | undefined>;
  enablementKey: "DASHBOARD_DISPOSABLE_SOURCE_RESEARCH_EXECUTION";
  fetcher: typeof fetch;
}): RdOwnerHttpTransportV1 | null {
  const ownerUrl = loopbackOwnerUrl(environment.RD_OWNER_API_URL);
  const ownerToken = environment.RD_OWNER_API_TOKEN;
  if (environment.DASHBOARD_DEPLOYMENT_CLASS !== "DISPOSABLE_LOCAL"
    || environment[enablementKey] !== "ENABLED"
    || !ownerUrl || !ownerToken) return null;
  return { owner_url: ownerUrl, owner_token: ownerToken, fetcher };
}

export async function rdOwnerJsonOutcomeV1({
  transport,
  path,
  method,
  body,
  tradeDashboardDispatcher = false,
}: {
  transport: RdOwnerHttpTransportV1;
  path: string;
  method: "GET" | "POST";
  body?: unknown;
  tradeDashboardDispatcher?: boolean;
}): Promise<RdOwnerJsonOutcomeV1> {
  if (!path.startsWith("/") || path.includes("?") || path.includes("#")) {
    return { state: "UNAVAILABLE", value: null };
  }
  try {
    const response = await transport.fetcher(`${transport.owner_url}${path}`, {
      method,
      headers: {
        authorization: `Bearer ${transport.owner_token}`,
        "content-type": "application/json",
        ...(tradeDashboardDispatcher ? { "x-trade-effect-dispatcher": "TRADE_DASHBOARD" } : {}),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      cache: "no-store",
      signal: AbortSignal.timeout(30_000),
    });
    if (response.status === 404) return { state: "ABSENT", value: null };
    const text = await response.text();
    if (!text
      || new TextEncoder().encode(text).byteLength > MAX_OWNER_RESPONSE_BYTES) {
      return { state: "UNAVAILABLE", value: null };
    }
    const parsed: unknown = JSON.parse(text);
    if (response.status === 202) {
      return ownerOutcomeUnknownV1(parsed)
        ? { state: "UNKNOWN", value: null }
        : { state: "UNAVAILABLE", value: null };
    }
    if (!response.ok) return { state: "UNAVAILABLE", value: null };
    return parsed !== null && typeof parsed === "object" && !Array.isArray(parsed)
      ? { state: "AVAILABLE", value: parsed as Record<string, unknown> }
      : { state: "UNAVAILABLE", value: null };
  } catch {
    return { state: "UNAVAILABLE", value: null };
  }
}

export async function rdOwnerJsonV1(
  input: Parameters<typeof rdOwnerJsonOutcomeV1>[0],
): Promise<Record<string, unknown> | null> {
  const outcome = await rdOwnerJsonOutcomeV1(input);
  return outcome.state === "AVAILABLE" ? outcome.value : null;
}
