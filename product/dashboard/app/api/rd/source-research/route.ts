import { NextResponse } from "next/server";

import {
  executeSourceResearchOperationV1,
  type SourceResearchOperationRequestV1,
} from "@/lib/source-research-operation";
import { verifyOperatorCapabilityV1 } from "@/lib/operator-capability";
import { projectSourceResearchBrowserEnvelopeV1 } from "@/lib/source-research-browser-projection";

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
  const keys = Object.keys(value).sort();
  return keys.length === 3 && keys.join(",") === "action,research,source";
}

export async function POST(request: Request) {
  const capability = verifyOperatorCapabilityV1(request.headers.get("authorization"));
  if (capability !== "available") {
    return unavailable(
      capability === "configuration_unavailable"
        ? "OPERATOR_CAPABILITY_CONFIGURATION_UNAVAILABLE"
        : "OPERATOR_CAPABILITY_DENIED",
      capability === "configuration_unavailable" ? 503 : 401,
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
  const result = await executeSourceResearchOperationV1({ request: body });
  const envelope = await projectSourceResearchBrowserEnvelopeV1({
    result,
    sourceRequestIdentity: body.source.request_identity,
    researchRequestIdentity: body.research.request_identity,
  });
  return NextResponse.json(envelope, {
    status: result.status === 200 && envelope.availability === "unavailable" ? 502 : result.status,
    headers: { "cache-control": "no-store" },
  });
}
