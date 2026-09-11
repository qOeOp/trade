import { NextResponse } from "next/server";

import { configuredOperationAuditGatewayV1 } from "@/lib/operation-audit-gateway";

export const dynamic = "force-dynamic";

function unavailable(reason: string, status: number) {
  return NextResponse.json({
    schema_version: 1,
    projection_version: 1,
    operation: "dashboard.operation_audit.detail.read.v1",
    availability: "unavailable",
    unavailable_reason: reason,
    completeness: "partial_unavailable",
    observed_at: new Date().toISOString(),
    source_cut: null,
    entry: null,
    timeline: [],
  }, { status, headers: { "cache-control": "no-store" } });
}

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ auditIdentity: string }> },
) {
  const { auditIdentity } = await params;
  try {
    const gateway = configuredOperationAuditGatewayV1();
    if (!gateway) return unavailable("RUN_STORE_CONFIGURATION_UNAVAILABLE", 503);
    await gateway.assertSchema();
    return NextResponse.json(await gateway.readDetail(auditIdentity), {
      status: 200,
      headers: { "cache-control": "no-store" },
    });
  } catch (error) {
    const permissionDenied = Boolean(error && typeof error === "object" && "code" in error && error.code === "42501");
    const reason = permissionDenied ? "OPERATION_AUDIT_PERMISSION_DENIED" : error instanceof Error && [
      "OPERATION_AUDIT_IDENTITY_INVALID", "AUDIT_EVENT_NOT_FOUND",
    ].includes(error.message) ? error.message : "OPERATION_AUDIT_STORE_UNAVAILABLE";
    const status = reason === "AUDIT_EVENT_NOT_FOUND" ? 404
      : reason === "OPERATION_AUDIT_IDENTITY_INVALID" ? 400 : 503;
    return unavailable(reason, status);
  }
}
