import { NextResponse } from "next/server";

import { serviceLogPageSizesV1, type ServiceLogFilterInputV1, type ServiceLogPageSizeV1 } from "@/lib/service-log-contract";
import { configuredServiceLogGatewayV1 } from "@/lib/service-log-gateway";

export const dynamic = "force-dynamic";

const QUERY_KEYS = new Set(["observedAt", "range", "kind", "service", "instance", "severity", "search", "pageSize", "cursor"]);

function unavailable(reason: string, status: number, pageSize: ServiceLogPageSizeV1 = 50) {
  return NextResponse.json({
    schema_version: 1,
    projection_version: 1,
    operation: "dashboard.service_log_gateway.read.v1",
    availability: "unavailable",
    unavailable_reason: reason,
    completeness: "partial_unavailable",
    observed_at: new Date().toISOString(),
    retention_limit: 512,
    filter_cut: null,
    filter_cut_digest: null,
    summary: null,
    instances: [],
    selected_instance_identity: null,
    entries: [],
    page_size: pageSize,
    next_cursor: null,
  }, { status, headers: { "cache-control": "no-store" } });
}

function query(request: Request): ServiceLogFilterInputV1 | null {
  const search = new URL(request.url).searchParams;
  if ([...search.keys()].some((key) => !QUERY_KEYS.has(key) || search.getAll(key).length !== 1)) return null;
  const rawPageSize = search.get("pageSize");
  const pageSize = rawPageSize === null ? 50 : Number(rawPageSize);
  if (!Number.isSafeInteger(pageSize) || !serviceLogPageSizesV1.includes(pageSize as ServiceLogPageSizeV1)) return null;
  return {
    ...(search.has("observedAt") ? { observedAt: search.get("observedAt")! } : {}),
    ...(search.has("range") ? { range: search.get("range")! } : {}),
    ...(search.has("kind") ? { kind: search.get("kind")! } : {}),
    ...(search.has("service") ? { service: search.get("service")! } : {}),
    ...(search.has("instance") ? { instanceIdentity: search.get("instance")! } : {}),
    ...(search.has("severity") ? { severity: search.get("severity")! } : {}),
    ...(search.has("search") ? { search: search.get("search")! } : {}),
    pageSize,
    ...(search.has("cursor") ? { cursor: search.get("cursor")! } : {}),
  };
}

export async function GET(request: Request) {
  const input = query(request);
  if (!input) return unavailable("SERVICE_LOG_QUERY_INVALID", 400);
  try {
    const gateway = configuredServiceLogGatewayV1();
    if (!gateway) return unavailable("RUN_STORE_CONFIGURATION_UNAVAILABLE", 503, input.pageSize as ServiceLogPageSizeV1);
    return NextResponse.json(await gateway.read(input), {
      status: 200,
      headers: { "cache-control": "no-store" },
    });
  } catch (error) {
    const permissionDenied = Boolean(error && typeof error === "object" && "code" in error && error.code === "42501");
    const reason = permissionDenied ? "SERVICE_LOG_PERMISSION_DENIED" : error instanceof Error && [
      "SERVICE_LOG_QUERY_INVALID", "SERVICE_LOG_CURSOR_INVALID", "SERVICE_LOG_CURSOR_EXPIRED", "SERVICE_LOG_CUT_INVALID",
    ].includes(error.message) ? error.message : "SERVICE_LOG_STORE_UNAVAILABLE";
    const status = ["SERVICE_LOG_STORE_UNAVAILABLE", "SERVICE_LOG_PERMISSION_DENIED"].includes(reason)
      ? 503 : reason === "SERVICE_LOG_CURSOR_EXPIRED" ? 410 : 400;
    return unavailable(reason, status, input.pageSize as ServiceLogPageSizeV1);
  }
}
