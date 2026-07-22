import { expect, test } from "bun:test"
import {
  DEVELOPER_CONTRACT_FREEZE_COMPATIBILITY_PROJECTION_VERSION,
  DEVELOPER_CONTRACT_FREEZE_COMPILER_VERSION,
  DEVELOPER_CONTRACT_FREEZE_RECORD_SCHEMA_VERSION,
  createDeveloperContractFreezeRecord,
  assertDeveloperContractFreezeRecord,
} from "./developer-contract-freeze"

test("Developer Contract Freeze Record binds formal identities without execution authority", () => {
  const hash = "a".repeat(64)
  const record = createDeveloperContractFreezeRecord({
    schema_version: DEVELOPER_CONTRACT_FREEZE_RECORD_SCHEMA_VERSION,
    freeze_id: "freeze-1", validation_id: "validation-1", validation_hash: hash,
    brief_id: "brief-1", brief_hash: hash, proposal_id: "proposal-1", proposal_revision: 1,
    proposal_hash: hash, draft_revision: 1, submission_hash: hash, contract_draft_hash: hash,
    candidate_assignment_set_hash: hash, experiment_id: "experiment-1", contract_hash: hash,
    trial_group_id: "group-1", trial_group_hash: hash,
    candidates: [{ candidate_id: "candidate-1", candidate_identity_hash: hash, candidate_ordinal: 1 }],
    identity_hash_policy_version: "identity-v1", contract_validator_version: "validator-v1",
    lifecycle_rule_version: "lifecycle-v1", scope_policy_version: "scope-v1",
    freeze_compiler_version: DEVELOPER_CONTRACT_FREEZE_COMPILER_VERSION,
    compatibility_projection_version: DEVELOPER_CONTRACT_FREEZE_COMPATIBILITY_PROJECTION_VERSION,
    bootstrap_lifecycle_event_id: "event-1", frozen_at: "2026-07-22T12:08:00Z",
  })
  expect(record.status).toBe("frozen")
  expect(record).not.toHaveProperty("trial_id")
  expect(record).not.toHaveProperty("reservation_id")
  expect(() => assertDeveloperContractFreezeRecord({ ...record, experiment_id: "drift" })).toThrow("hash-drifted")
})
