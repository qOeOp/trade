import { expect, test } from "bun:test"
import {
  PLANNER_CONTROL_PLANE_CONTEXT_SNAPSHOT_SCHEMA_VERSION,
  createPlannerControlPlaneContextSnapshot,
} from "../../../../research-control-plane/contracts/src/lib/planner-control-plane-context"
import { buildPlannerProposal } from "./planner-role"

function context(coverageStatus: "ready" | "blocked" = "ready") {
  return createPlannerControlPlaneContextSnapshot({
    schema_version: PLANNER_CONTROL_PLANE_CONTEXT_SNAPSHOT_SCHEMA_VERSION,
    active_canonicals: [{
      node_id: "canonical:trend/time-series-trend/time-series-momentum",
      path: "strategy-universe/trend/family/canonical",
      name: "Canonical",
      research_scope_status: "active",
      implementation_scope_status: "ready",
      coverage: [{ coverage_type: "data", scope_ref: "ohlcv", coverage_status: coverageStatus }],
      data_surface_requirements: [{
        surface_id: "surface-ohlcv",
        requirement_type: "required",
        coverage_status: coverageStatus,
      }],
    }],
    data_surfaces: [{
      surface_id: "surface-ohlcv",
      slug: "ohlcv",
      coverage_status: coverageStatus,
      owner_module: "apps/market-data-products/ohlcv-store",
      evidence_ref: "evidence://ohlcv",
    }],
    capabilities: [],
    lessons: [],
  })
}

function proposalInput() {
  return {
    proposal_id: "proposal-1",
    hypothesis_id: "hypothesis-1",
    universe_node_id: "canonical:trend/time-series-trend/time-series-momentum",
    objective: "Test one bounded causal mechanism",
    dataset_requirements: ["ohlcv"],
    candidate_space: { lookback: [20, 40] },
    trial_budget: 2,
    evaluation_protocol_ref: "protocol:time-series-momentum-eval-v1",
    control_plane_context: context(),
    created_at: "2026-07-14T08:00:00Z",
  }
}

test("Planner binds a bounded Proposal to authoritative Control Plane context", () => {
  const input = proposalInput()
  const result = buildPlannerProposal(input)
  expect(result.revision).toBe(2)
  expect(result.control_plane_context_hash).toBe(input.control_plane_context.context_hash)
  expect(result.proposal_hash).toHaveLength(64)
  expect(result).not.toHaveProperty("control_plane_context")
  expect(result).not.toHaveProperty("trial_id")
})

test("Planner rejects context tamper, inactive canonical, and unavailable data", () => {
  const input = proposalInput()
  expect(() => buildPlannerProposal({
    ...input,
    control_plane_context: { ...input.control_plane_context, context_hash: "0".repeat(64) },
  })).toThrow("hash-drifted")
  expect(() => buildPlannerProposal({ ...input, universe_node_id: "canonical-unknown" }))
    .toThrow("not active")
  expect(() => buildPlannerProposal({ ...input, control_plane_context: context("blocked") }))
    .toThrow("not ready")
  expect(() => buildPlannerProposal({ ...input, dataset_requirements: ["funding"] }))
    .toThrow("absent")
  expect(() => buildPlannerProposal({
    ...input,
    evaluation_protocol_ref: "protocol:caller-selected",
  })).toThrow("registered protocol")
  const unlinked = createPlannerControlPlaneContextSnapshot({
    ...input.control_plane_context,
    active_canonicals: [{
      ...input.control_plane_context.active_canonicals[0]!,
      data_surface_requirements: [],
    }],
  })
  expect(() => buildPlannerProposal({ ...input, control_plane_context: unlinked }))
    .toThrow("not linked")
})
