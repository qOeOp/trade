import { isRunIdentityV1, configuredRunStoreV1 } from "./run-store.ts";
import {
  canonicalRunLogFilterV1,
  type RunLogEnvelopeV1,
  type RunLogFilterV1,
} from "./run-log-contract.ts";

export type RunLogGatewayResultV1 = { status: number; envelope: RunLogEnvelopeV1 };

const defaultFilters: RunLogFilterV1 = { level: "all", source: "all", query: "" };

function unavailable(
  runIdentity: string,
  reason: string,
  status: number,
  filters: RunLogFilterV1 = defaultFilters,
): RunLogGatewayResultV1 {
  return {
    status,
    envelope: {
      schema_version: 1,
      operation: "dashboard.run_logs.page.v1",
      availability: "unavailable",
      unavailable_reason: reason,
      observed_at: new Date().toISOString(),
      run_identity: runIdentity,
      filters,
      page_limit: 64,
      retained_until: null,
      logs: [],
      next_cursor: null,
    },
  };
}

function parseRequest(search: URLSearchParams, allowCursor: boolean): {
  filters: RunLogFilterV1;
  cursor?: string;
} | null {
  const allowed = new Set(["level", "source", "query", ...(allowCursor ? ["cursor"] : [])]);
  if ([...search.keys()].some((key) => !allowed.has(key))
    || [...allowed].some((key) => search.getAll(key).length > 1)) return null;
  const filters = canonicalRunLogFilterV1({
    level: search.get("level") ?? "all",
    source: search.get("source") ?? "all",
    query: (search.get("query") ?? "").trim().toLowerCase(),
  });
  if (!filters) return null;
  const cursor = allowCursor ? search.get("cursor") ?? undefined : undefined;
  if (cursor !== undefined && (cursor.length < 32 || cursor.length > 1_024)) return null;
  return { filters, cursor };
}

export async function readRunLogGatewayV1({
  runIdentity,
  search,
  download = false,
}: {
  runIdentity: string;
  search: URLSearchParams;
  download?: boolean;
}): Promise<RunLogGatewayResultV1> {
  if (!isRunIdentityV1(runIdentity)) return unavailable(runIdentity, "RUN_IDENTITY_INVALID", 400);
  const request = parseRequest(search, !download);
  if (!request) return unavailable(runIdentity, "RUN_LOG_QUERY_INVALID", 400);
  try {
    const store = configuredRunStoreV1();
    if (!store) return unavailable(runIdentity, "RUN_STORE_CONFIGURATION_UNAVAILABLE", 503, request.filters);
    await store.assertSchema();
    const page = await store.readRunLogPage({
      runIdentity,
      ...request.filters,
      cursor: request.cursor,
      limit: download ? 256 : 64,
    });
    if (!page) return unavailable(runIdentity, "RUN_NOT_FOUND", 404, request.filters);
    return {
      status: 200,
      envelope: {
        schema_version: 1,
        operation: "dashboard.run_logs.page.v1",
        availability: "available",
        unavailable_reason: null,
        observed_at: page.observed_at,
        run_identity: runIdentity,
        filters: request.filters,
        page_limit: download ? 256 : 64,
        retained_until: page.retained_until,
        logs: page.logs,
        next_cursor: page.next_cursor,
      },
    };
  } catch (error) {
    const reason = error instanceof Error ? error.message : "RUN_LOG_STORE_UNAVAILABLE";
    if (["RUN_LOG_CURSOR_INVALID", "RUN_LOG_CURSOR_FILTER_MISMATCH", "RUN_LOG_REQUEST_INVALID"]
      .includes(reason)) return unavailable(runIdentity, reason, 400, request.filters);
    if (reason === "OPERATIONAL_CACHE_DELETED") {
      return unavailable(runIdentity, reason, 410, request.filters);
    }
    if (reason === "OPERATIONAL_DATA_EXPIRED") {
      return unavailable(runIdentity, reason, 410, request.filters);
    }
    return unavailable(runIdentity, "RUN_LOG_STORE_UNAVAILABLE", 503, request.filters);
  }
}
