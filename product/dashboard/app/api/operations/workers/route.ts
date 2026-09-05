import { NextResponse } from "next/server";

import { configuredRunStoreV1 } from "@/lib/run-store";

export const dynamic = "force-dynamic";

function unavailable(reason: string) {
  return NextResponse.json({
    schema_version: 1,
    operation: "dashboard.shadow_workers.list.v1",
    availability: "unavailable",
    unavailable_reason: reason,
    observed_at: new Date().toISOString(),
    workers: [],
  }, { status: 503, headers: { "cache-control": "no-store" } });
}

export async function GET() {
  try {
    const store = configuredRunStoreV1();
    if (!store) return unavailable("RUN_STORE_CONFIGURATION_UNAVAILABLE");
    await store.assertSchema();
    const result = await store.listShadowWorkers();
    return NextResponse.json({
      schema_version: 1,
      operation: "dashboard.shadow_workers.list.v1",
      availability: "available",
      unavailable_reason: null,
      ...result,
    }, { status: 200, headers: { "cache-control": "no-store" } });
  } catch {
    return unavailable("WORKER_STORE_UNAVAILABLE");
  }
}
