import { expect, test } from "bun:test"
import { buildPlannerProposal } from "./planner-role"

test("Planner emits a bounded Proposal submission, not authority facts", () => {
  const result = buildPlannerProposal({ proposal_id: "proposal-1", hypothesis_id: "hypothesis-1", universe_node_id: "canonical-1", objective: "Test one bounded causal mechanism", dataset_requirements: ["ohlcv-4h"], candidate_space: { lookback: [20, 40] }, trial_budget: 2, evaluation_protocol_ref: "protocol://historical-v1", context_fingerprint: "context-1", created_at: "2026-07-14T08:00:00Z" })
  expect(result.revision).toBe(1)
  expect(result.proposal_hash).toHaveLength(64)
  expect(result).not.toHaveProperty("trial_id")
})
