import { NextResponse } from "next/server";

import {
  validExploratoryReplayRunRequestV2,
  type ExploratoryReplayRunRequestV2,
} from "@/lib/exploratory-replay-action-contract";
import { handleExploratoryReplayActionV2 } from "@/lib/dashboard-operation-handler";
import {
  operatorCapabilityAuthorizationDigestV1,
  verifyOperatorCapabilityV1,
} from "@/lib/operator-capability";

export const dynamic = "force-dynamic";

const MAX_REQUEST_BYTES = 256 * 1024;

function unavailable(reason: string, status: number) {
  return NextResponse.json({
    schema_version: 1,
    operation: "exploratory_replay.submit_or_resolve.v2",
    channel: "DASHBOARD_DISPOSABLE_EXECUTION",
    availability: "unavailable",
    unavailable_reason: reason,
    request_identity: null,
    meaning_digest: null,
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
  let body: ExploratoryReplayRunRequestV2;
  try {
    const text = await request.text();
    if (new TextEncoder().encode(text).byteLength > MAX_REQUEST_BYTES) {
      return unavailable("EXECUTION_REQUEST_INVALID", 400);
    }
    const raw: unknown = JSON.parse(text);
    if (!validExploratoryReplayRunRequestV2(raw)) {
      return unavailable("EXECUTION_REQUEST_INVALID", 400);
    }
    body = raw;
  } catch {
    return unavailable("EXECUTION_REQUEST_INVALID", 400);
  }
  const result = await handleExploratoryReplayActionV2({
    request: body,
    actionContext: {
      authorizationDigest,
      principalRef: "local_operator",
      requestedAction: "RUN",
    },
  });
  return NextResponse.json(result.envelope, {
    status: result.status,
    headers: { "cache-control": "no-store" },
  });
}
