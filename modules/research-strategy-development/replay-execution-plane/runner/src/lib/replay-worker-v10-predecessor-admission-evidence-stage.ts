import type {
  ReplayAttemptLeaseObservationBody,
  ReplayAttemptLeaseObservationSnapshot,
} from "../../../../research-control-plane/contracts/src/lib/control-plane-contracts"
import type { ReplayDecisionHarnessDispatchClaim } from "../../../contracts/src/lib/replay-decision-harness-dispatch-claim"
import type { ReplayDecisionHarnessWorkerV10ExecutionAdmissionContract } from "../../../contracts/src/lib/replay-decision-harness-worker-v10-execution-admission-contract"
import type { ReplayDecisionHarnessWorkerV10SuccessorTransportContract } from "../../../contracts/src/lib/replay-decision-harness-worker-v10-successor-transport-contract"
import { runReplayWorkerV10ClockBindingStage } from "./replay-worker-v10-clock-binding-stage"
import { runReplayWorkerV10PreIssueBundleStage } from "./replay-worker-v10-pre-issue-bundle-stage"
import { runReplayWorkerV10RegistryProvenanceStage } from "./replay-worker-v10-registry-provenance-stage"

export interface ReplayWorkerV10PredecessorAdmissionEvidenceStageInput {
  registry_root: string
  execution_admission_contract: ReplayDecisionHarnessWorkerV10ExecutionAdmissionContract
  dispatch_claim: ReplayDecisionHarnessDispatchClaim
  lease_observation_body: ReplayAttemptLeaseObservationBody
  claim_observation: ReplayAttemptLeaseObservationSnapshot
  renewed_claim_observation: ReplayAttemptLeaseObservationSnapshot
  successor_transport_contract: ReplayDecisionHarnessWorkerV10SuccessorTransportContract
  profile(stage: string): void
}

export function runReplayWorkerV10PredecessorAdmissionEvidenceStage(
  input: ReplayWorkerV10PredecessorAdmissionEvidenceStageInput,
) {
  const preIssue = runReplayWorkerV10PreIssueBundleStage(input)
  const provenance = runReplayWorkerV10RegistryProvenanceStage({
    registry_root: input.registry_root,
    pre_issue_bundle: preIssue.pre_issue_bundle,
    pre_issue_observation: preIssue.pre_issue_observation,
    profile: input.profile,
  })
  const clock = runReplayWorkerV10ClockBindingStage({
    registry_root: input.registry_root,
    registry_provenance: provenance.registry_provenance,
    build_clock: provenance.build_clock,
    profile: input.profile,
  })
  return {
    pre_issue_observation: preIssue.pre_issue_observation,
    pre_issue_input: preIssue.pre_issue_input,
    pre_issue_bundle: preIssue.pre_issue_bundle,
    registry_read_receipt: provenance.registry_read_receipt,
    registry_provenance_input: provenance.registry_provenance_input,
    registry_provenance: provenance.registry_provenance,
    clock_attestation: clock.clock_attestation,
    clock_binding_input: clock.clock_binding_input,
    clock_binding: clock.clock_binding,
  }
}
