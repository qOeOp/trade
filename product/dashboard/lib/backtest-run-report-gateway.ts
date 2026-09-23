import {
  isBacktestRunReportUnavailableEnvelope,
  normalizeBacktestRunReport,
  type BacktestRunReportLocator,
} from "./backtest-run-report-contract.ts";
import { validExploratoryReplayOpaqueIdentityV2 } from "./exploratory-replay-identity.ts";
import { announcedOwnerReadBudgetMsV1 } from "./operation-registry.ts";
import { dashboardReadApiTargetV1, ownerApiTargetAvailableV1 } from "./owner-api-target.ts";

// The `/backtest` read route for one run's report, as `docs/guide/dashboard.md` admits it: it relays
// the Backtest Owner projection's answer and adds nothing. An Owner answer is passed on as the Owner
// wrote it, including an unavailable one under the Owner's own reason. Only when no Owner answer
// arrives does the route name a reason of its own, and each of those says which leg failed.

const MAX_OWNER_RESPONSE_BYTES = 1_048_576;

export const INVALID_BACKTEST_RUN_REPORT_SELECTOR = "INVALID_BACKTEST_RUN_REPORT_SELECTOR";

export type BacktestRunReportGatewayResultV1 = Readonly<{ status: number; body: unknown }>;

type Fetcher = typeof fetch;

function unavailable(status: number, reason: string): BacktestRunReportGatewayResultV1 {
  return { status, body: { state: "UNAVAILABLE", reason } };
}

function ownerEndpoint(baseUrl: string, locator: BacktestRunReportLocator): URL | null {
  try {
    const base = new URL(baseUrl);
    if (base.pathname !== "/") return null;
    const endpoint = new URL(
      `/v1/backtest-run-reports/${encodeURIComponent(locator.result_identity)}`,
      base,
    );
    endpoint.searchParams.set("request_identity", locator.request_identity);
    endpoint.searchParams.set("attempt_identity", locator.attempt_identity);
    return endpoint;
  } catch {
    return null;
  }
}

export async function readBacktestRunReportGatewayV1({
  locator,
  environment = process.env,
  fetcher = fetch,
}: {
  locator: BacktestRunReportLocator;
  environment?: Record<string, string | undefined>;
  fetcher?: Fetcher;
}): Promise<BacktestRunReportGatewayResultV1> {
  if (![locator.result_identity, locator.request_identity, locator.attempt_identity]
    .every(validExploratoryReplayOpaqueIdentityV2)) {
    return unavailable(400, INVALID_BACKTEST_RUN_REPORT_SELECTOR);
  }
  const target = dashboardReadApiTargetV1(environment);
  const endpoint = target.baseUrl ? ownerEndpoint(target.baseUrl, locator) : null;
  if (!ownerApiTargetAvailableV1(target) || !endpoint || !target.token) {
    return unavailable(503, "OWNER_CONFIGURATION_UNAVAILABLE");
  }
  const budgetMs = announcedOwnerReadBudgetMsV1("backtest run report", 8_000);
  try {
    const response = await fetcher(endpoint, {
      method: "GET",
      headers: { authorization: `Bearer ${target.token}` },
      cache: "no-store",
      signal: AbortSignal.timeout(budgetMs),
    });
    if (response.status === 401 || response.status === 403) {
      return unavailable(403, "OWNER_PERMISSION_DENIED");
    }
    if (![200, 404, 503].includes(response.status)) {
      return unavailable(502, "OWNER_RESPONSE_UNAVAILABLE");
    }
    const text = await response.text();
    if (new TextEncoder().encode(text).byteLength > MAX_OWNER_RESPONSE_BYTES) {
      return unavailable(502, "OWNER_RESPONSE_UNAVAILABLE");
    }
    let raw: unknown;
    try { raw = JSON.parse(text); } catch {
      // A 503 with no body is the read API saying it could not reach the Owner at all.
      return response.status === 503
        ? unavailable(503, "OWNER_TRANSPORT_UNAVAILABLE")
        : unavailable(502, "OWNER_RESPONSE_UNAVAILABLE");
    }
    // Each status carries one kind of answer: 200 a report, and 404 (no such run) or 503 (a refusal)
    // an unavailable envelope under the Owner's reason. A body of the other kind is no answer.
    if (response.status !== 200) {
      return isBacktestRunReportUnavailableEnvelope(raw)
        ? { status: response.status, body: raw }
        : unavailable(502, "OWNER_RESPONSE_UNAVAILABLE");
    }
    if (raw !== null && typeof raw === "object" && (raw as { state?: unknown }).state === "UNAVAILABLE") {
      return unavailable(502, "OWNER_RESPONSE_UNAVAILABLE");
    }
    // A report this contract refuses is not relayed; the refusal is the answer, under its reason.
    const report = normalizeBacktestRunReport(raw, locator);
    return report.state === "unavailable"
      ? unavailable(502, report.reason)
      : { status: 200, body: raw };
  } catch {
    return unavailable(503, "OWNER_TRANSPORT_UNAVAILABLE");
  }
}
