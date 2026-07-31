import type { ReplayAttemptLeaseObservationEnvelopeView } from "../../../contracts/src/lib/replay-decision-harness-dispatch-lease-authority-binding"
import type { ReplayDispatchClockAttestationView } from "../../../contracts/src/lib/replay-decision-harness-worker-v10-execution-admission-clock-attestation"
import type { ReplayAttemptLeaseObservationRegistryReadReceiptView } from "../../../contracts/src/lib/replay-decision-harness-worker-v10-execution-admission-registry-provenance"
import type { ReplayDecisionHarnessWorkerV10SuccessorExecutionContractAdmission } from "../../../contracts/src/lib/replay-decision-harness-worker-v10-successor-execution-contract-admission"

export interface ReplayWorkerV10SuccessorExecutionCommandRegistryInput {
  registry_root: string
  source_successor_execution_contract_admission:
    ReplayDecisionHarnessWorkerV10SuccessorExecutionContractAdmission
  source_current_lease_observation: ReplayAttemptLeaseObservationEnvelopeView
  control_plane_registry_read_receipt: ReplayAttemptLeaseObservationRegistryReadReceiptView
  control_plane_clock_attestation: ReplayDispatchClockAttestationView
  dispatcher_claimant_id: string
  claimed_at: string
}

export interface ReplayWorkerV10SuccessorExecutionCommandParentSnapshot {
  source: ReplayDecisionHarnessWorkerV10SuccessorExecutionContractAdmission
  file_sha256: string
}
