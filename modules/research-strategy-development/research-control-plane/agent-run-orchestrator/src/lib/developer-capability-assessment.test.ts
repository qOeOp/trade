import { expect, test } from "bun:test"
import type { DeveloperDevelopmentBrief } from "../../../contracts/src/lib/developer-contract-draft"
import {
  DEVELOPER_DATA_SNAPSHOT_BINDING_SCHEMA_VERSION,
  createDeveloperCapabilityAssessment,
  createDeveloperDataSnapshotBinding,
} from "./developer-capability-assessment"

const HASH = "a".repeat(64)

test("Developer capability assessment separates proposal, data, and ready paths", () => {
  const incompatible = createDeveloperCapabilityAssessment({
    brief: brief({ lookback_period: [20, 40] }),
    source_revision: "abc123",
  })
  expect(incompatible.required_mode).toBe("tool_blocked")
  expect(incompatible.reason_code).toBe("candidate_space_incompatible")

  const compatibleBrief = brief({ lookback_bars: [20, 40], threshold_atr: [1.5, 2] })
  const dataBlocked = createDeveloperCapabilityAssessment({
    brief: compatibleBrief,
    source_revision: "abc123",
  })
  expect(dataBlocked.required_mode).toBe("data_blocked")
  expect(dataBlocked.reason_code).toBe("dataset_snapshot_binding_missing")

  const binding = createDeveloperDataSnapshotBinding({
    schema_version: DEVELOPER_DATA_SNAPSHOT_BINDING_SCHEMA_VERSION,
    snapshot_ref: "dataset://btc-4h/discovery/v1",
    snapshot_hash: HASH,
    dataset_kinds: ["ohlcv"],
    hypothesis_id: "hypothesis-1",
    segment: "discovery",
    timeframe: "4h",
    manifest_ref: "data/rd-datasets/example/discovery/manifest.json",
    evidence_ref: "artifact://dataset-manifest/a",
  })
  const ready = createDeveloperCapabilityAssessment({
    brief: compatibleBrief,
    source_revision: "abc123",
    data_snapshot_binding: binding,
  })
  expect(ready.required_mode).toBe("existing_implementation")
  expect(ready.data_snapshot_binding).toEqual(binding)
})

function brief(candidateSpace: Record<string, unknown>): DeveloperDevelopmentBrief {
  return {
    schema_version: "trade.rd-developer-development-brief.v1",
    brief_id: "brief-1",
    proposal_id: "proposal-1",
    proposal_revision: 1,
    proposal_hash: HASH,
    proposal_admission_hash: HASH,
    hypothesis_id: "hypothesis-1",
    universe_node_id: "canonical:trend/time-series-trend/time-series-momentum",
    objective: "test",
    dataset_requirements: ["ohlcv"],
    candidate_space: candidateSpace,
    allowed_candidate_space_hash: HASH,
    max_trial_budget: 2,
    evaluation_protocol_ref: "protocol://v1",
    target_contract_schema_version: "trade-flow.rd-experiment-contract.v3",
    authority_scope: "contract_draft_only",
    issued_at: "2026-07-23T00:00:00Z",
    brief_hash: HASH,
  }
}
