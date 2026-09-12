import { NextResponse } from "next/server";

import { preflightDisposableArtifactFormationV1 } from "@/lib/artifact-formation-client";
import { verifyOperatorCapabilityV1 } from "@/lib/operator-capability";

export const dynamic = "force-dynamic";

const MAX_REQUEST_BYTES = 4_096;

function unavailable(reason: string, status: number, researchRequestIdentity = "") {
  return NextResponse.json({
    schema_version: 1,
    operation: "artifact_build.formation_execute.v1",
    channel: "DASHBOARD_DISPOSABLE_EXECUTION",
    phase: "PREFLIGHT",
    availability: "unavailable",
    unavailable_reason: reason,
    research_request_identity: researchRequestIdentity,
    action_state: "REVALIDATION_REQUIRED",
  }, { status, headers: { "cache-control": "no-store" } });
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
  let researchRequestIdentity: string;
  try {
    const text = await request.text();
    if (new TextEncoder().encode(text).byteLength > MAX_REQUEST_BYTES) {
      return unavailable("EXECUTION_REQUEST_INVALID", 400);
    }
    const raw: unknown = JSON.parse(text);
    if (!raw || typeof raw !== "object" || Array.isArray(raw)
      || Object.keys(raw).length !== 1
      || !("research_request_identity" in raw)
      || typeof raw.research_request_identity !== "string") {
      return unavailable("EXECUTION_REQUEST_INVALID", 400);
    }
    researchRequestIdentity = raw.research_request_identity;
  } catch {
    return unavailable("EXECUTION_REQUEST_INVALID", 400);
  }
  const result = await preflightDisposableArtifactFormationV1({ researchRequestIdentity });
  return NextResponse.json(result.envelope, {
    status: result.status,
    headers: { "cache-control": "no-store" },
  });
}
