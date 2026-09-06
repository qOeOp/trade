import { NextResponse } from "next/server";

import { configuredRunStoreV1 } from "@/lib/run-store";
import { configuredShadowScheduleSetV1 } from "@/lib/shadow-scheduler";

export const dynamic = "force-dynamic";

function unavailable(reason: string) {
  return NextResponse.json({
    schema_version: 1,
    operation: "dashboard.shadow_schedules.list.v1",
    availability: "unavailable",
    unavailable_reason: reason,
    observed_at: new Date().toISOString(),
    schedules: [],
  }, { status: 503, headers: { "cache-control": "no-store" } });
}

export async function GET() {
  try {
    const configured = configuredShadowScheduleSetV1();
    if (configured.state === "unavailable") {
      return unavailable(configured.unavailable_reason === "SCHEDULE_SET_UNAVAILABLE"
        ? "SCHEDULE_CONFIGURATION_UNAVAILABLE"
        : "SCHEDULE_COMPATIBILITY_UNAVAILABLE");
    }
    const store = configuredRunStoreV1();
    if (!store) return unavailable("RUN_STORE_CONFIGURATION_UNAVAILABLE");
    await store.assertSchema();
    const result = await store.readBoundScheduledReads(configured.schedules.map((schedule) => ({
      schedule_identity: schedule.schedule_identity,
      schedule_digest: schedule.schedule_digest,
      operation_id: schedule.operation_id,
      recovery_identity: schedule.recovery_identity,
      cadence_seconds: schedule.cadence_seconds,
      anchor_epoch_ms: schedule.anchor_epoch_ms,
      dispatch_binding: schedule.dispatch_binding,
    })));
    return NextResponse.json({
      schema_version: 1,
      operation: "dashboard.shadow_schedules.list.v1",
      availability: "available",
      unavailable_reason: null,
      observed_at: result.observed_at,
      schedules: result.schedules,
    }, { status: 200, headers: { "cache-control": "no-store" } });
  } catch {
    return unavailable("SCHEDULE_STORE_UNAVAILABLE");
  }
}
