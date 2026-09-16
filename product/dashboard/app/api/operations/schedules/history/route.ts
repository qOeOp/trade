import { NextResponse } from "next/server";

import { configuredRunStoreV1 } from "@/lib/run-store";

export const dynamic = "force-dynamic";

function unavailable(reason: string) {
  return NextResponse.json({
    schema_version: 1,
    operation: "dashboard.shadow_schedule_history.list.v1",
    availability: "unavailable",
    unavailable_reason: reason,
    completeness: null,
    retention_limit: 100,
    observed_at: new Date().toISOString(),
    schedules: [],
  }, { status: 503, headers: { "cache-control": "no-store" } });
}

export async function GET() {
  try {
    const store = configuredRunStoreV1();
    if (!store) return unavailable("RUN_STORE_CONFIGURATION_UNAVAILABLE");
    await store.assertSchema();
    const result = await store.listScheduledReadHistory();
    return NextResponse.json({
      schema_version: 1,
      operation: "dashboard.shadow_schedule_history.list.v1",
      availability: "available",
      unavailable_reason: null,
      completeness: result.completeness,
      retention_limit: result.retention_limit,
      observed_at: result.observed_at,
      schedules: result.schedules.map((schedule) => ({
        schema_version: 1,
        schedule_identity: schedule.schedule_identity,
        operation_id: schedule.operation_id,
        cadence_seconds: schedule.cadence_seconds,
        registered_at: schedule.created_at,
        last_observed_at: schedule.last_due_at,
        last_run_identity: schedule.last_run_identity,
        recorded_at: schedule.updated_at,
      })),
    }, { status: 200, headers: { "cache-control": "no-store" } });
  } catch {
    return unavailable("SCHEDULE_HISTORY_STORE_UNAVAILABLE");
  }
}
