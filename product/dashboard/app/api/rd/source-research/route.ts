import { NextResponse } from "next/server";

import { handleSourceResearchActionV1 } from "@/lib/dashboard-operation-handler";
import type { SourceResearchOperationRequestV1 } from "@/lib/source-research-input-contract";
import {
  operatorCapabilityAuthorizationDigestV1,
  verifyOperatorCapabilityV1,
} from "@/lib/operator-capability";

export const dynamic = "force-dynamic";

const MAX_REQUEST_BYTES = 32_768;

function unavailable(reason: string, status: number) {
  return NextResponse.json({
    schema_version: 1,
    operation: "source_intake.research.submit_or_resolve.v1",
    channel: "DASHBOARD_DISPOSABLE_EXECUTION",
    availability: "unavailable",
    unavailable_reason: reason,
    source: null,
    research: null,
    operational_run: {
      schema_version: 1,
      availability: "unavailable",
      unavailable_reason: "RUN_NOT_STARTED",
      run_identity: null,
      state: null,
      owner_outcome_state: null,
      transition_version: null,
    },
  }, { status, headers: { "cache-control": "no-store" } });
}

function exactRequest(value: unknown): value is SourceResearchOperationRequestV1 {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const record = value as Record<string, unknown>;
  const keys = Object.keys(value).sort();
  return record.action === "RUN"
    ? keys.length === 3 && keys.join(",") === "action,research,source"
    : record.action === "RESOLVE"
      && keys.length === 3
      && keys.join(",") === "action,research_request_identity,source_request_identity";
}

export async function POST(request: Request) {
  const capability = verifyOperatorCapabilityV1(request.headers.get("authorization"));
  const authorizationDigest = operatorCapabilityAuthorizationDigestV1();
  if (capability !== "available" || !authorizationDigest) {
    return unavailable(
      capability === "configuration_unavailable" || !authorizationDigest
        ? "OPERATOR_CAPABILITY_CONFIGURATION_UNAVAILABLE"
        : "OPERATOR_CAPABILITY_DENIED",
      capability === "configuration_unavailable" || !authorizationDigest ? 503 : 401,
    );
  }
  const declaredLength = Number(request.headers.get("content-length") ?? "0");
  if (!Number.isSafeInteger(declaredLength) || declaredLength < 0
    || declaredLength > MAX_REQUEST_BYTES) {
    return unavailable("EXECUTION_REQUEST_INVALID", 400);
  }
  let body: SourceResearchOperationRequestV1;
  try {
    const text = await request.text();
    if (new TextEncoder().encode(text).byteLength > MAX_REQUEST_BYTES) {
      return unavailable("EXECUTION_REQUEST_INVALID", 400);
    }
    const raw: unknown = JSON.parse(text);
    if (!exactRequest(raw)) return unavailable("EXECUTION_REQUEST_INVALID", 400);
    body = raw;
  } catch {
    return unavailable("EXECUTION_REQUEST_INVALID", 400);
  }
  const result = await handleSourceResearchActionV1({
    request: body,
    actionContext: {
      authorizationDigest,
      principalRef: "local_operator",
      requestedAction: body.action,
    },
  });
  return NextResponse.json(result.envelope, {
    status: result.status,
    headers: { "cache-control": "no-store" },
  });
}
