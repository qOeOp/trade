import { expect, test } from "bun:test"
import {
  DEVELOPER_CONTRACT_DRAFT_RECONCILIATION_POLICY_VERSION,
  DEVELOPER_CONTRACT_DRAFT_VALIDATION_RECORD_SCHEMA_VERSION,
  assertDeveloperContractDraftValidationRecord,
  createDeveloperContractDraftValidationRecord,
} from "./developer-contract-draft-validation"

function record(errors: string[] = []) {
  return createDeveloperContractDraftValidationRecord({
    schema_version: DEVELOPER_CONTRACT_DRAFT_VALIDATION_RECORD_SCHEMA_VERSION,
    validation_id: "validation-1",
    brief_id: "brief-1",
    brief_hash: "1".repeat(64),
    proposal_id: "proposal-1",
    proposal_revision: 1,
    proposal_hash: "2".repeat(64),
    draft_revision: 1,
    draft_receipt_hash: "3".repeat(64),
    submission_hash: "4".repeat(64),
    contract_draft_hash: "5".repeat(64),
    contract_candidate_hash: "6".repeat(64),
    candidate_space_hash: "7".repeat(64),
    candidate_assignment_set_hash: "8".repeat(64),
    target_contract_schema_version: "trade-flow.rd-experiment-contract.v3",
    contract_validator_version: "trade-flow.rd-contract-validator.v3",
    reconciliation_policy_version: DEVELOPER_CONTRACT_DRAFT_RECONCILIATION_POLICY_VERSION,
    errors,
    validated_at: "2026-07-22T12:07:00Z",
  })
}

test("Draft Validation Record derives valid or invalid from immutable errors", () => {
  const valid = record()
  expect(valid.status).toBe("valid")
  expect(valid.validation_hash).toHaveLength(64)
  expect(() => assertDeveloperContractDraftValidationRecord(valid)).not.toThrow()
  const invalid = record(["candidate.assignment.out_of_space"])
  expect(invalid.status).toBe("invalid")
  expect(() => assertDeveloperContractDraftValidationRecord({ ...invalid, errors: [] }))
    .toThrow("hash-drifted")
})
