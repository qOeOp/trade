import { NextResponse } from "next/server";

import {
  operationAuditPageSizesV1,
  type OperationAuditFilterInputV1,
  type OperationAuditPageSizeV1,
} from "@/lib/operation-audit-contract";
import { configuredOperationAuditGatewayV1 } from "@/lib/operation-audit-gateway";

export const dynamic = "force-dynamic";

const QUERY_KEYS = new Set([
  "observedAt", "range", "principal", "operation", "outcome", "search", "pageSize", "cursor",
]);

function unavailable(reason: string, status: number, pageSize: OperationAuditPageSizeV1 = 50) {
  return NextResponse.json({
    schema_version: 1,
    projection_version: 1,
    operation: "dashboard.operation_audit.read.v1",
    availability: "unavailable",
    unavailable_reason: reason,
    completeness: "partial_unavailable",
    observed_at: new Date().toISOString(),
    retention_limit: 512,
    source_cut: null,
    filter_cut: null,
    filter_cut_digest: null,
    summary: null,
    principals: [],
    operations: [],
    entries: [],
    page_size: pageSize,
    next_cursor: null,
  }, { status, headers: { "cache-control": "no-store" } });
}

function inputFor(request: Request): OperationAuditFilterInputV1 | null {
  const search = new URL(request.url).searchParams;
  if ([...search.keys()].some((key) => !QUERY_KEYS.has(key) || search.getAll(key).length !== 1)) return null;
  const rawPageSize = search.get("pageSize");
  const pageSize = rawPageSize === null ? 50 : Number(rawPageSize);
  if (!Number.isSafeInteger(pageSize)
    || !operationAuditPageSizesV1.includes(pageSize as OperationAuditPageSizeV1)) return null;
  return {
    ...(search.has("observedAt") ? { observedAt: search.get("observedAt")! } : {}),
    ...(search.has("range") ? { range: search.get("range")! } : {}),
    ...(search.has("principal") ? { principalRef: search.get("principal")! } : {}),
    ...(search.has("operation") ? { operation: search.get("operation")! } : {}),
    ...(search.has("outcome") ? { outcome: search.get("outcome")! } : {}),
    ...(search.has("search") ? { search: search.get("search")! } : {}),
    pageSize,
    ...(search.has("cursor") ? { cursor: search.get("cursor")! } : {}),
  };
}

export async function GET(request: Request) {
  const input = inputFor(request);
  if (!input) return unavailable("OPERATION_AUDIT_QUERY_INVALID", 400);
  try {
    const gateway = configuredOperationAuditGatewayV1();
    if (!gateway) return unavailable("RUN_STORE_CONFIGURATION_UNAVAILABLE", 503, input.pageSize as OperationAuditPageSizeV1);
    await gateway.assertSchema();
    return NextResponse.json(await gateway.read(input), {
      status: 200,
      headers: { "cache-control": "no-store" },
    });
  } catch (error) {
    const permissionDenied = Boolean(error && typeof error === "object" && "code" in error && error.code === "42501");
    const reason = permissionDenied ? "OPERATION_AUDIT_PERMISSION_DENIED" : error instanceof Error && [
      "OPERATION_AUDIT_QUERY_INVALID", "OPERATION_AUDIT_CURSOR_INVALID",
      "OPERATION_AUDIT_CURSOR_FILTER_MISMATCH", "OPERATION_AUDIT_CUT_INVALID",
    ].includes(error.message) ? error.message : "OPERATION_AUDIT_STORE_UNAVAILABLE";
    const status = reason === "OPERATION_AUDIT_CURSOR_FILTER_MISMATCH" ? 409
      : ["OPERATION_AUDIT_STORE_UNAVAILABLE", "OPERATION_AUDIT_PERMISSION_DENIED"].includes(reason) ? 503 : 400;
    return unavailable(reason, status, input.pageSize as OperationAuditPageSizeV1);
  }
}
