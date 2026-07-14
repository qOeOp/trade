import {
  DRAFT_AUTHORIZATION_SCHEMA_VERSION,
  assertDraftStrategyAuthorization,
  type DraftStrategyAuthorization,
  type ResearchIdentityBinding,
} from "../../../../research-control-plane/contracts/src/lib/control-plane-contracts"
import type { ReplayResult } from "../../../../replay-execution-plane/contracts/src/lib/replay-contracts"

export interface ReviewerDraftDecisionInput {
  decision_id: string
  reviewer_run_id: string
  primary_result_id: string
  selected_trial_id: string
  selected_candidate_id: string
  candidate_frozen_at: string
  explicit_decision: "accept_for_draft"
  identity: ResearchIdentityBinding
  result: ReplayResult
}

export function buildDraftAuthorization(input: ReviewerDraftDecisionInput): DraftStrategyAuthorization {
  if (input.result.status !== "completed") throw new Error("Reviewer cannot accept an incomplete Replay Result")
  if (input.result.fingerprint.candidate_hash !== input.identity.candidate_hash
      || input.result.fingerprint.experiment_contract_hash !== input.identity.experiment_contract_hash) {
    throw new Error("Reviewer Result fingerprint does not match the selected identity")
  }
  const authorization: DraftStrategyAuthorization = {
    schema_version: DRAFT_AUTHORIZATION_SCHEMA_VERSION,
    decision: input.explicit_decision,
    decision_id: input.decision_id,
    reviewer_run_id: input.reviewer_run_id,
    primary_result_id: input.primary_result_id,
    primary_result_hash: input.result.fingerprint.result_hash,
    selected_trial_id: input.selected_trial_id,
    selected_candidate_id: input.selected_candidate_id,
    candidate_frozen_at: input.candidate_frozen_at,
    identity: input.identity,
  }
  assertDraftStrategyAuthorization(authorization)
  return authorization
}
