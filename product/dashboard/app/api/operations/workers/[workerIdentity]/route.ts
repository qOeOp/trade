import { NextResponse } from "next/server";

import { configuredRunStoreV1 } from "@/lib/run-store";
import { decodeWorkerIdentitySegmentV1 } from "@/lib/worker-browser-contract";

export const dynamic = "force-dynamic";

function unavailable(workerIdentity: string, reason: string, status: number) {
  return NextResponse.json({
    schema_version: 1,
    operation: "dashboard.shadow_workers.detail.v1",
    availability: "unavailable",
    unavailable_reason: reason,
    observed_at: new Date().toISOString(),
    requested_worker_identity: workerIdentity,
    worker: null,
  }, { status, headers: { "cache-control": "no-store" } });
}

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ workerIdentity: string }> },
) {
  const { workerIdentity: segment } = await params;
  const workerIdentity = decodeWorkerIdentitySegmentV1(segment);
  if (workerIdentity === null) return unavailable(segment, "WORKER_IDENTITY_INVALID", 400);
  try {
    const store = configuredRunStoreV1();
    if (!store) return unavailable(workerIdentity, "RUN_STORE_CONFIGURATION_UNAVAILABLE", 503);
    await store.assertSchema();
    const result = await store.readShadowWorker(workerIdentity);
    if (!result.worker) return unavailable(workerIdentity, "WORKER_NOT_FOUND", 404);
    return NextResponse.json({
      schema_version: 1,
      operation: "dashboard.shadow_workers.detail.v1",
      availability: "available",
      unavailable_reason: null,
      observed_at: result.observed_at,
      requested_worker_identity: workerIdentity,
      worker: result.worker,
    }, { status: 200, headers: { "cache-control": "no-store" } });
  } catch {
    return unavailable(workerIdentity, "WORKER_STORE_UNAVAILABLE", 503);
  }
}
