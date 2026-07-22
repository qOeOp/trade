import { Database } from "bun:sqlite"
import { expect, test } from "bun:test"
import {
  PLANNER_CONTROL_PLANE_CONTEXT_SNAPSHOT_SCHEMA_VERSION,
  assertPlannerControlPlaneContextSnapshot,
} from "../../../contracts/src/lib/planner-control-plane-context"
import { readPlannerControlPlaneContext } from "./research-control-plane-operations"
import { ensureResearchStateSchema } from "./research-state-store"
import { seedDefaultResearchControlPlane } from "./research-universe-default-seed"

test("state store emits one canonical self-hashed Planner context snapshot", () => {
  const db = new Database(":memory:")
  try {
    ensureResearchStateSchema(db)
    seedDefaultResearchControlPlane(db, "2026-07-22T12:00:00Z")
    const context = readPlannerControlPlaneContext(db)
    expect(context.schema_version).toBe(PLANNER_CONTROL_PLANE_CONTEXT_SNAPSHOT_SCHEMA_VERSION)
    expect(context.active_canonicals).toHaveLength(7)
    expect(context.data_surfaces).toHaveLength(11)
    expect(context.capabilities).toHaveLength(7)
    expect(context.context_hash).toHaveLength(64)
    expect(context.active_canonicals
      .find((item) => item.node_id === "canonical:trend/time-series-trend/time-series-momentum")
      ?.data_surface_requirements).toEqual([{
      surface_id: "surface:ohlcv",
      requirement_type: "required",
      coverage_status: "ready",
    }])
    expect(() => assertPlannerControlPlaneContextSnapshot(context)).not.toThrow()
    expect(readPlannerControlPlaneContext(db)).toEqual(context)

    db.query("UPDATE rd_data_surface SET coverage_status='blocked' WHERE slug='ohlcv'").run()
    const changed = readPlannerControlPlaneContext(db)
    expect(changed.context_hash).not.toBe(context.context_hash)
    expect(changed.data_surfaces.find((surface) => surface.slug === "ohlcv")?.coverage_status)
      .toBe("blocked")
  } finally {
    db.close()
  }
})
