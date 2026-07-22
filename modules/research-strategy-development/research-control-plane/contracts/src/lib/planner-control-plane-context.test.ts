import { expect, test } from "bun:test"
import {
  PLANNER_CONTROL_PLANE_CONTEXT_SNAPSHOT_SCHEMA_VERSION,
  assertPlannerControlPlaneContextSnapshot,
  createPlannerControlPlaneContextSnapshot,
} from "./planner-control-plane-context"

function fixture() {
  return createPlannerControlPlaneContextSnapshot({
    schema_version: PLANNER_CONTROL_PLANE_CONTEXT_SNAPSHOT_SCHEMA_VERSION,
    active_canonicals: [{
      node_id: "canonical-1",
      path: "strategy-universe/trend/family/canonical",
      name: "Canonical",
      research_scope_status: "active",
      implementation_scope_status: "ready",
      coverage: [{ coverage_type: "data", scope_ref: "ohlcv", coverage_status: "ready" }],
      data_surface_requirements: [{
        surface_id: "surface-ohlcv",
        requirement_type: "required",
        coverage_status: "ready",
      }],
    }],
    data_surfaces: [{
      surface_id: "surface-ohlcv",
      slug: "ohlcv",
      coverage_status: "ready",
      owner_module: "modules/market-data-products/ohlcv-store",
      evidence_ref: "evidence://ohlcv",
    }],
    capabilities: [{
      item_id: "feature-momentum-v1",
      registry_type: "feature",
      slug: "momentum",
      version: "v1",
      status: "active",
      owner_module: "modules/research-strategy-development/agent-roles/developer/strategy-family-engine",
      capability_tags: ["returns", "closed-candle"],
    }],
    lessons: [{
      kg_node_id: "lesson-1",
      ref_id: "lesson://1",
      slug: "avoid-lookahead",
      name: "Avoid lookahead",
      metadata: { severity: "critical" },
      updated_at: "2026-07-22T12:00:00Z",
    }],
  })
}

test("Planner Control Plane context is canonical, self-hashed, and order independent", () => {
  const value = fixture()
  expect(() => assertPlannerControlPlaneContextSnapshot(value)).not.toThrow()
  expect(value.context_hash).toHaveLength(64)
  const reordered = createPlannerControlPlaneContextSnapshot({
    ...value,
    capabilities: [{ ...value.capabilities[0]!, capability_tags: [...value.capabilities[0]!.capability_tags].reverse() }],
  })
  expect(reordered.context_hash).toBe(value.context_hash)
})

test("Planner Control Plane context rejects scope, identity, and hash drift", () => {
  const value = fixture()
  expect(() => createPlannerControlPlaneContextSnapshot({
    ...value,
    active_canonicals: [{ ...value.active_canonicals[0]!, research_scope_status: "catalog_only" as never }],
  })).toThrow("only active canonicals")
  expect(() => createPlannerControlPlaneContextSnapshot({
    ...value,
    data_surfaces: [value.data_surfaces[0]!, value.data_surfaces[0]!],
  })).toThrow("data surface id must be unique")
  expect(() => assertPlannerControlPlaneContextSnapshot({ ...value, context_hash: "0".repeat(64) }))
    .toThrow("hash-drifted")
})
