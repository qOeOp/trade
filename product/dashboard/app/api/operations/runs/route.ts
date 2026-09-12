import { NextResponse } from "next/server";

import {
  operationDeploymentForIdV1,
  operationDispatchBindingForIdV1,
  operationByIdV1,
  type RegisteredOperationId,
} from "@/lib/operation-registry";
import { verifyOperatorCapabilityV1 } from "@/lib/operator-capability";
import { configuredRunListViewGatewayV2 } from "@/lib/run-list-view-gateway";
import { configuredRunStoreV1 } from "@/lib/run-store";

export const dynamic = "force-dynamic";

function listUnavailable(reason: string, status: number) {
  return NextResponse.json({
    schema_version: 1,
    projection_version: 2,
    operation: "dashboard.run_store.list.v2",
    availability: "unavailable",
    unavailable_reason: reason,
    completeness: "partial_unavailable",
    observed_at: new Date().toISOString(),
    source_cut: null,
    snapshot: null,
    filter_cut: null,
    summary: null,
    filtered_total: null,
    total_pages: null,
    runs: [],
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
  const allowed = new Set(["kind", "state", "search", "duration", "pageSize", "page", "snapshot"]);
  if ([...search.keys()].some((key) => !allowed.has(key))) {
    return listUnavailable("RUN_STORE_QUERY_INVALID", 400);
  }
  try {
    const gateway = configuredRunListViewGatewayV2();
    if (!gateway) return listUnavailable("RUN_STORE_CONFIGURATION_UNAVAILABLE", 503);
    await gateway.assertSchema();
    const pageSize = search.get("pageSize");
    const page = search.get("page");
    return NextResponse.json(await gateway.read({
      kind: search.get("kind") ?? undefined,
      state: search.get("state") ?? undefined,
      search: search.get("search") ?? undefined,
      duration: search.get("duration") ?? undefined,
      pageSize: pageSize === null ? undefined : Number(pageSize),
      page: page === null ? undefined : Number(page),
      snapshot: search.get("snapshot") ?? undefined,
    }), {
      status: 200,
      headers: { "cache-control": "no-store" },
    });
  } catch (error) {
    const reason = error instanceof Error ? error.message : "RUN_STORE_UNAVAILABLE";
    const invalid = reason.startsWith("RUN_LIST_QUERY_") || reason.startsWith("RUN_LIST_PAGE_")
      || reason.startsWith("RUN_LIST_SNAPSHOT_INVALID") || reason.startsWith("RUN_LIST_SNAPSHOT_FILTER_");
    return listUnavailable(invalid ? "RUN_STORE_QUERY_INVALID" : reason, invalid ? 400 : 503);
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
