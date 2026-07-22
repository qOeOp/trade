import { expect, test } from "bun:test"
import {
  DEVELOPER_CONTRACT_DRAFT_INTAKE_POLICY_VERSION,
  DEVELOPER_CONTRACT_DRAFT_RECEIPT_SCHEMA_VERSION,
  DEVELOPER_CONTRACT_DRAFT_SUBMISSION_SCHEMA_VERSION,
  DEVELOPER_DEVELOPMENT_BRIEF_SCHEMA_VERSION,
  DEVELOPER_EXPERIMENT_CONTRACT_DRAFT_PAYLOAD_SCHEMA_VERSION,
  TARGET_EXPERIMENT_CONTRACT_SCHEMA_VERSION,
  assertDeveloperContractDraftSubmission,
  assertDeveloperDevelopmentBrief,
  createDeveloperContractDraftReceipt,
  createDeveloperContractDraftSubmission,
  createDeveloperDevelopmentBrief,
} from "./developer-contract-draft"

function brief() {
  return createDeveloperDevelopmentBrief({
    schema_version: DEVELOPER_DEVELOPMENT_BRIEF_SCHEMA_VERSION,
    brief_id: "brief-1",
    proposal_id: "proposal-1",
    proposal_revision: 1,
    proposal_hash: "1".repeat(64),
    proposal_admission_hash: "2".repeat(64),
    hypothesis_id: "hypothesis-1",
    universe_node_id: "canonical-1",
    objective: "Test one bounded mechanism",
    dataset_requirements: ["ohlcv"],
    candidate_space: { lookback: [20, 40] },
    max_trial_budget: 2,
    evaluation_protocol_ref: "protocol://historical-v1",
    target_contract_schema_version: TARGET_EXPERIMENT_CONTRACT_SCHEMA_VERSION,
    authority_scope: "contract_draft_only",
    issued_at: "2026-07-22T12:04:00Z",
  })
}

function submission() {
  const value = brief()
  return createDeveloperContractDraftSubmission({
    schema_version: DEVELOPER_CONTRACT_DRAFT_SUBMISSION_SCHEMA_VERSION,
    brief_id: value.brief_id,
    brief_hash: value.brief_hash,
    proposal_id: value.proposal_id,
    proposal_revision: value.proposal_revision,
    proposal_hash: value.proposal_hash,
    developer_run_id: "developer-run-1",
    draft_revision: 1,
    allowed_candidate_space_hash: value.allowed_candidate_space_hash,
    requested_trial_budget: 2,
    target_contract_schema_version: TARGET_EXPERIMENT_CONTRACT_SCHEMA_VERSION,
    draft_json: {
      schema_version: DEVELOPER_EXPERIMENT_CONTRACT_DRAFT_PAYLOAD_SCHEMA_VERSION,
      canonical_node_id: "canonical-1",
      required_data: ["ohlcv"],
    },
    created_at: "2026-07-22T12:05:00Z",
  })
}

test("Developer Development Brief freezes Proposal scope without execution authority", () => {
  const value = brief()
  expect(value.authority_scope).toBe("contract_draft_only")
  expect(value.allowed_candidate_space_hash).toHaveLength(64)
  expect(value.brief_hash).toHaveLength(64)
  expect(() => assertDeveloperDevelopmentBrief(value)).not.toThrow()
  expect(() => assertDeveloperDevelopmentBrief({ ...value, max_trial_budget: 3 }))
    .toThrow("hash-drifted")
})

test("Developer Contract Draft and received-unvalidated Receipt are self-hashed", () => {
  const value = submission()
  expect(value.contract_draft_hash).toHaveLength(64)
  expect(value.submission_hash).toHaveLength(64)
  expect(() => assertDeveloperContractDraftSubmission(value)).not.toThrow()
  expect(() => assertDeveloperContractDraftSubmission({ ...value, requested_trial_budget: 3 }))
    .toThrow("hash-drifted")
  const receipt = createDeveloperContractDraftReceipt({
    schema_version: DEVELOPER_CONTRACT_DRAFT_RECEIPT_SCHEMA_VERSION,
    brief_id: value.brief_id,
    brief_hash: value.brief_hash,
    proposal_id: value.proposal_id,
    proposal_revision: value.proposal_revision,
    proposal_hash: value.proposal_hash,
    developer_run_id: value.developer_run_id,
    draft_revision: value.draft_revision,
    submission_hash: value.submission_hash,
    contract_draft_hash: value.contract_draft_hash,
    intake_policy_version: DEVELOPER_CONTRACT_DRAFT_INTAKE_POLICY_VERSION,
    status: "received_unvalidated",
    recorded_at: "2026-07-22T12:06:00Z",
  })
  expect(receipt.status).toBe("received_unvalidated")
  expect(receipt.receipt_hash).toHaveLength(64)
})
