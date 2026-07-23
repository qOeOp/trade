import { expect, test } from "bun:test"
import {
  assertForwardDatasetReadinessAssessment,
  createForwardDatasetReadinessAssessment,
} from "./forward-dataset-readiness-assessment"

const HASH = "a".repeat(64)

test("Forward dataset readiness exposes required and conditional missing inputs without authority", () => {
  const base = {
    candidate_id: "forward-dataset:candidate-1",
    candidate_hash: HASH,
    program_id: "forward-program-1",
    program_hash: HASH,
    historical_replay_request_registration_id: "registration-1",
    historical_replay_request_hash: HASH,
    historical_dataset_manifest_hash: HASH,
    historical_mark_coverage: "none" as const,
    historical_supplemental_requirement_mode: "none" as const,
    assessed_at: "2026-07-23T12:00:00.000Z",
  }
  const ohlcvOnly = createForwardDatasetReadinessAssessment(base)
  expect(ohlcvOnly.blockers).toContain("funding_window_unverified")
  expect(ohlcvOnly.blockers).not.toContain("mark_window_unverified")
  expect(ohlcvOnly.blockers).not.toContain(
    "supplemental_window_unverified",
  )
  expect(ohlcvOnly.authority.forward_replay_admission_authority)
    .toBe("none")
  expect(() => assertForwardDatasetReadinessAssessment(ohlcvOnly))
    .not.toThrow()

  const enriched = createForwardDatasetReadinessAssessment({
    ...base,
    historical_mark_coverage: "complete_grid",
    historical_supplemental_requirement_mode:
      "signal_time_complete",
  })
  expect(enriched.blockers).toContain("mark_window_unverified")
  expect(enriched.blockers).toContain("supplemental_window_unverified")
  expect(enriched.required_forward_inputs.liquidity_capacity_attestation)
    .toBe("decision_dependent_on_entry_order_type")
})
