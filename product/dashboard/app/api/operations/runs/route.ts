import { NextResponse } from "next/server";

import {
  operationDeploymentForIdV1,
  operationDispatchBindingForIdV1,
  operationByIdV1,
  type RegisteredOperationId,
} from "@/lib/operation-registry";
import { verifyOperatorCapabilityV1 } from "@/lib/operator-capability";
import { projectRunListBrowserEnvelopeV1 } from "@/lib/run-list-browser-projection";
import {
  configuredRunStoreV1,
  type RunOperationalState,
} from "@/lib/run-store";

export const dynamic = "force-dynamic";

const states = new Set<RunOperationalState>([
  "queued", "running", "succeeded", "failed", "cancelled", "unknown",
]);

function listUnavailable(reason: string, status: number) {
  return NextResponse.json({
    schema_version: 1,
    operation: "dashboard.run_store.list.v1",
    availability: "unavailable",
    unavailable_reason: reason,
    observed_at: new Date().toISOString(),
    runs: [],
    next_cursor: null,
  }, { status, headers: { "cache-control": "no-store" } });
}

function enqueueUnavailable(reason: string, status: number) {
  return NextResponse.json({
    schema_version: 1,
    operation: "dashboard.shadow_dispatch.enqueue.v1",
    availability: "unavailable",
    unavailable_reason: reason,
    observed_at: new Date().toISOString(),
    run: null,
  }, { status, headers: { "cache-control": "no-store" } });
}

export async function GET(request: Request) {
  const search = new URL(request.url).searchParams;
  const rawLimit = search.get("limit");
  const limit = rawLimit === null ? 50 : Number(rawLimit);
  const rawOperationId = search.get("operationId");
  const rawState = search.get("state");
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 100
    || (rawState !== null && !states.has(rawState as RunOperationalState))) {
    return listUnavailable("RUN_STORE_QUERY_INVALID", 400);
  }
  let operationId: RegisteredOperationId | undefined;
  if (rawOperationId !== null) {
    try {
      operationByIdV1(rawOperationId as RegisteredOperationId);
      operationId = rawOperationId as RegisteredOperationId;
    } catch {
      return listUnavailable("RUN_STORE_QUERY_INVALID", 400);
    }
  }
  try {
    const store = configuredRunStoreV1();
    if (!store) return listUnavailable("RUN_STORE_CONFIGURATION_UNAVAILABLE", 503);
    await store.assertSchema();
    const page = await store.listRuns({
      limit,
      cursor: search.get("cursor") ?? undefined,
      operationId,
      state: rawState ? rawState as RunOperationalState : undefined,
    });
    return NextResponse.json(projectRunListBrowserEnvelopeV1(page), {
      status: 200,
      headers: { "cache-control": "no-store" },
    });
  } catch {
    return listUnavailable("RUN_STORE_UNAVAILABLE", 503);
  }
}

export async function POST(request: Request) {
  const capability = verifyOperatorCapabilityV1(request.headers.get("authorization"));
  if (capability !== "available") {
    return enqueueUnavailable(
      capability === "configuration_unavailable"
        ? "OPERATOR_CAPABILITY_CONFIGURATION_UNAVAILABLE"
        : "OPERATOR_CAPABILITY_DENIED",
      capability === "configuration_unavailable" ? 503 : 401,
    );
  }
  const declaredLength = Number(request.headers.get("content-length") ?? "0");
  if (!Number.isSafeInteger(declaredLength) || declaredLength < 0 || declaredLength > 16_384) {
    return enqueueUnavailable("RUN_SUBMISSION_INVALID", 400);
  }
  let raw: unknown;
  try {
    const text = await request.text();
    if (new TextEncoder().encode(text).byteLength > 16_384) {
      return enqueueUnavailable("RUN_SUBMISSION_INVALID", 400);
    }
    raw = JSON.parse(text);
  } catch {
    return enqueueUnavailable("RUN_SUBMISSION_INVALID", 400);
  }
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return enqueueUnavailable("RUN_SUBMISSION_INVALID", 400);
  }
  const body = raw as Record<string, unknown>;
  if (Object.keys(body).sort().join(",") !== "operation_id,recovery_identity"
    || typeof body.operation_id !== "string" || !body.recovery_identity
    || typeof body.recovery_identity !== "object" || Array.isArray(body.recovery_identity)) {
    return enqueueUnavailable("RUN_SUBMISSION_INVALID", 400);
  }
  let operationId: RegisteredOperationId;
  try {
    operationByIdV1(body.operation_id as RegisteredOperationId);
    operationId = body.operation_id as RegisteredOperationId;
  } catch {
    return enqueueUnavailable("RUN_SUBMISSION_INVALID", 400);
  }
  const deployment = operationDeploymentForIdV1(operationId);
  const dispatchBinding = operationDispatchBindingForIdV1(operationId);
  if (deployment.deployment_state !== "available" || !dispatchBinding) {
    return enqueueUnavailable(deployment.deployment_unavailable_reason ?? "DEPLOYMENT_UNAVAILABLE", 503);
  }
  try {
    const store = configuredRunStoreV1();
    if (!store) return enqueueUnavailable("RUN_STORE_CONFIGURATION_UNAVAILABLE", 503);
    await store.assertSchema();
    const run = await store.enqueueRead(
      operationId,
      body.recovery_identity as Record<string, string>,
      dispatchBinding,
    );
    return NextResponse.json({
      schema_version: 1,
      operation: "dashboard.shadow_dispatch.enqueue.v1",
      availability: "available",
      unavailable_reason: null,
      observed_at: new Date().toISOString(),
      run,
    }, { status: 202, headers: { "cache-control": "no-store" } });
  } catch {
    return enqueueUnavailable("RUN_STORE_UNAVAILABLE", 503);
  }
}
