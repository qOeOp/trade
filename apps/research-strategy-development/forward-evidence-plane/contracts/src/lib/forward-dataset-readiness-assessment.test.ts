import { expect, test } from "bun:test"
import {
  assertForwardDatasetReadinessAssessment,
  createForwardDatasetReadinessAssessment,
  createForwardDatasetReadinessAssessmentV2,
  createForwardDatasetReadinessAssessmentV3,
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

  const funded = createForwardDatasetReadinessAssessmentV2({
    ...base,
    funding_evidence: {
      binding_id: "forward-funding:binding-1",
      binding_hash: HASH,
      market_data_fact_hash: HASH,
      funding_slice_hash: HASH,
      funding_slice_content_sha256: HASH,
    },
  })
  expect(funded.schema_version)
    .toBe("trade.rd-forward-dataset-readiness-assessment.v2")
  expect(funded.blockers).not.toContain("funding_window_unverified")
  expect(funded.blockers).toContain("instrument_spec_window_unverified")
  expect(() => assertForwardDatasetReadinessAssessment(funded))
    .not.toThrow()

  const instrumentBound = createForwardDatasetReadinessAssessmentV3({
    ...base,
    funding_evidence: funded.verified_components.funding_events,
    current_instrument_evidence: {
      binding_id: "forward-current-instrument:binding-1",
      binding_hash: HASH,
      provider_certification_hash: HASH,
      evidence_series_hash: HASH,
      instrument_status_series_hash: HASH,
      instrument_status_provenance_series_hash: HASH,
      instrument_spec_series_hash: HASH,
      coverage_start: "2026-07-23T04:00:00.000Z",
      coverage_end: "2026-07-23T08:00:00.000Z",
      observation_count: 13,
      inter_sample_history_claim: "not_proven",
    },
  })
  expect(instrumentBound.blockers)
    .not.toContain("instrument_status_window_unverified")
  expect(instrumentBound.blockers)
    .not.toContain("instrument_spec_window_unverified")
  expect(instrumentBound.required_forward_inputs.instrument_status)
    .toBe("required_bounded_post_freeze_current_snapshot_series")
  expect(() => assertForwardDatasetReadinessAssessment(instrumentBound))
    .not.toThrow()
})
