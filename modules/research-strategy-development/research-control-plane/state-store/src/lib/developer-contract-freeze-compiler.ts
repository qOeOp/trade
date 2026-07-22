import type { JSONRecord } from "../../../../../contracts/runtime-core/src/json"
import { canonicalControlPlaneHash } from "../../../contracts/src/lib/control-plane-contracts"
import {
  candidateIdentityHash,
  trialGroupIdentityHash,
  type TrialGroupWrite,
} from "./research-control-plane"
import { IDENTITY_HASH_POLICY_VERSION } from "./research-identity-hash"
export const DEVELOPER_CONTRACT_FREEZE_SEARCH_SPACE_SCHEMA_VERSION =
  "trade.rd-contract-freeze-search-space.v1" as const
export const DEVELOPER_CONTRACT_FREEZE_SELECTION_PROTOCOL_SCHEMA_VERSION =
  "trade.rd-contract-freeze-selection-protocol.v1" as const
export const DEVELOPER_CONTRACT_FREEZE_TRIAL_ACCOUNTING_POLICY_VERSION =
  "trade-flow.trial-accounting.v1" as const

export interface DeveloperContractFreezeCandidateAssignment {
  candidate_id: string
  parameters: JSONRecord
}

export function compileDeveloperContractFreezeTrialGroup(input: {
  trial_group_id: string
  hypothesis_id: string
  candidate_space: JSONRecord
  candidate_assignments: DeveloperContractFreezeCandidateAssignment[]
  max_trials: number
  compiled_at: string
}): TrialGroupWrite {
  const assignments = input.candidate_assignments
    .map((item) => ({ candidate_id: item.candidate_id.trim(), parameters: structuredClone(item.parameters) }))
    .sort((left, right) => left.candidate_id.localeCompare(right.candidate_id))
  const candidateAssignmentSetHash = canonicalControlPlaneHash(assignments)
  const candidates = assignments.map((item, index) => ({
    candidate_id: item.candidate_id,
    candidate_identity_hash: candidateIdentityHash(item.parameters),
    parameter_assignment_json: item.parameters,
    candidate_ordinal: index + 1,
    created_at: input.compiled_at,
  }))
  const identity: Omit<TrialGroupWrite, "group_hash"> = {
    trial_group_id: input.trial_group_id.trim(),
    hypothesis_scope_ref: input.hypothesis_id.trim(),
    identity_hash_policy_version: IDENTITY_HASH_POLICY_VERSION,
    candidate_mode: "enumerated",
    search_space_json: {
      schema_version: DEVELOPER_CONTRACT_FREEZE_SEARCH_SPACE_SCHEMA_VERSION,
      candidate_space: structuredClone(input.candidate_space),
      candidate_space_hash: canonicalControlPlaneHash(input.candidate_space),
    },
    selection_protocol_json: {
      schema_version: DEVELOPER_CONTRACT_FREEZE_SELECTION_PROTOCOL_SCHEMA_VERSION,
      method: "predeclared-enumeration",
      ordering: "candidate-id-lexicographic",
      candidate_assignment_set_hash: candidateAssignmentSetHash,
    },
    max_trials: input.max_trials,
    trial_accounting_policy_version: DEVELOPER_CONTRACT_FREEZE_TRIAL_ACCOUNTING_POLICY_VERSION,
    registered_at: input.compiled_at,
    created_at: input.compiled_at,
    candidates,
  }
  return { ...identity, group_hash: trialGroupIdentityHash(identity) }
}
