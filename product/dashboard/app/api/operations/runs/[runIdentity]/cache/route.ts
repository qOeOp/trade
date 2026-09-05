import { NextResponse } from "next/server";

import {
  operatorCapabilityAuthorizationDigestV1,
  verifyOperatorCapabilityV1,
} from "@/lib/operator-capability";
import { isRunIdentityV1, configuredRunStoreV1 } from "@/lib/run-store";

export const dynamic = "force-dynamic";

function unavailable(runIdentity: string, reason: string, status: number) {
  return NextResponse.json({
    schema_version: 1,
    operation: "dashboard.operational_cache.delete.v1",
    availability: "unavailable",
    unavailable_reason: reason,
    observed_at: new Date().toISOString(),
    run_identity: runIdentity,
    receipt: null,
  }, { status, headers: { "cache-control": "no-store" } });
}

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ runIdentity: string }> },
) {
  const { runIdentity } = await params;
  if (!isRunIdentityV1(runIdentity)) return unavailable(runIdentity, "RUN_IDENTITY_INVALID", 400);
  const capability = verifyOperatorCapabilityV1(request.headers.get("authorization"));
  const authorizationDigest = operatorCapabilityAuthorizationDigestV1();
  if (capability !== "available" || !authorizationDigest) {
    return unavailable(runIdentity, capability === "configuration_unavailable" || !authorizationDigest
      ? "OPERATOR_CAPABILITY_CONFIGURATION_UNAVAILABLE" : "OPERATOR_CAPABILITY_DENIED",
    capability === "configuration_unavailable" || !authorizationDigest ? 503 : 401);
  }
  const declaredLength = Number(request.headers.get("content-length") ?? "0");
  if (!Number.isSafeInteger(declaredLength) || declaredLength < 1 || declaredLength > 1_024) {
    return unavailable(runIdentity, "RUN_CACHE_DELETION_REQUEST_INVALID", 400);
  }
  let body: unknown;
  try {
    const text = await request.text();
    if (new TextEncoder().encode(text).byteLength > 1_024) {
      return unavailable(runIdentity, "RUN_CACHE_DELETION_REQUEST_INVALID", 400);
    }
    body = JSON.parse(text);
  } catch {
    return unavailable(runIdentity, "RUN_CACHE_DELETION_REQUEST_INVALID", 400);
  }
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return unavailable(runIdentity, "RUN_CACHE_DELETION_REQUEST_INVALID", 400);
  }
  const value = body as Record<string, unknown>;
  if (Object.keys(value).sort().join(",") !== "confirmation,expected_transition_version"
    || value.confirmation !== "DELETE_OPERATIONAL_CACHE"
    || !Number.isSafeInteger(value.expected_transition_version)
    || Number(value.expected_transition_version) < 1) {
    return unavailable(runIdentity, "RUN_CACHE_DELETION_REQUEST_INVALID", 400);
  }
  try {
    const store = configuredRunStoreV1();
    if (!store) return unavailable(runIdentity, "RUN_STORE_CONFIGURATION_UNAVAILABLE", 503);
    await store.assertSchema();
    const receipt = await store.deleteOperationalCache({
      runIdentity,
      expectedTransitionVersion: Number(value.expected_transition_version),
      authorizationDigest,
    });
    return NextResponse.json({
      schema_version: 1,
      operation: "dashboard.operational_cache.delete.v1",
      availability: "available",
      unavailable_reason: null,
      observed_at: new Date().toISOString(),
      run_identity: runIdentity,
      receipt,
    }, { status: 200, headers: { "cache-control": "no-store" } });
  } catch (error) {
    const reason = error instanceof Error ? error.message : "RUN_CACHE_DELETION_UNAVAILABLE";
    const status = reason === "RUN_NOT_FOUND" ? 404
      : ["RUN_CACHE_DELETION_REQUEST_INVALID", "RUN_CACHE_DELETION_NOT_TERMINAL",
        "RUN_CACHE_DELETION_TRANSITION_MISMATCH"].includes(reason) ? 409 : 503;
    return unavailable(runIdentity, reason, status);
  }
}
