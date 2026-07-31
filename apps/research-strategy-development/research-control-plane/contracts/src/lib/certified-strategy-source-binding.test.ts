import { expect, test } from "bun:test"
import {
  CERTIFIED_STRATEGY_SOURCE_BINDING_SCHEMA_VERSION,
  assertCertifiedStrategySourceBinding,
  createCertifiedStrategySourceBinding,
} from "./certified-strategy-source-binding"

const HASH = "a".repeat(64)

test("certified Strategy source binding is canonical and carries no promotion authority", () => {
  const binding = createCertifiedStrategySourceBinding({
    schema_version: CERTIFIED_STRATEGY_SOURCE_BINDING_SCHEMA_VERSION,
    admission_id: "forward-source-1",
    experiment_id: "experiment-1",
    decision_id: "decision-1",
    draft_id: "draft-1",
    strategy_id: "S-1",
    strategy_version: "draft-1",
    strategy_source_ref: "strategies/candidate-1.md",
    strategy_source_hash: HASH,
    source_candidate_manifest_ref:
      "data/release-candidates/strategy-drafts/decision-1/candidate.json",
    source_candidate_manifest_hash: HASH,
    source_adoption_id: "strategy:adoption-1",
    source_adoption_manifest_ref:
      "data/release-candidates/strategy-adoptions/adoption-1/manifest.json",
    source_adoption_manifest_hash: HASH,
    candidate_source_revision: "b".repeat(40),
    source_archive_ref:
      "data/release-candidates/strategy-adoptions/adoption-1/source.tar",
    source_archive_hash: HASH,
    historical_replay_build_artifact_hash: HASH,
    historical_replay_runtime_executable_hash: HASH,
    certified_at: "2026-07-23T00:00:00.000Z",
    authority: {
      forward_evidence_authority: "source_binding_only",
      deployment_authority: "none",
      trading_authority: false,
    },
  })
  expect(() => assertCertifiedStrategySourceBinding(binding)).not.toThrow()
  expect(binding.authority.deployment_authority).toBe("none")
  expect(binding.authority.trading_authority).toBe(false)
  expect(() => assertCertifiedStrategySourceBinding({
    ...binding,
    source_archive_hash: "c".repeat(64),
  })).toThrow()
})
