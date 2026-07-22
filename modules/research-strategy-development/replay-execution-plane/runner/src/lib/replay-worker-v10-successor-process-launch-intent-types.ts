import type { ReplayAttemptLeaseObservationEnvelopeView } from "../../../contracts/src/lib/replay-decision-harness-dispatch-lease-authority-binding"
import type { ReplayDispatchClockAttestationView } from "../../../contracts/src/lib/replay-decision-harness-worker-v10-execution-admission-clock-attestation"
import type { ReplayAttemptLeaseObservationRegistryReadReceiptView } from "../../../contracts/src/lib/replay-decision-harness-worker-v10-execution-admission-registry-provenance"
import type { ReplayDecisionHarnessWorkerV10SuccessorExecutionCommandAdmission } from "../../../contracts/src/lib/replay-decision-harness-worker-v10-successor-execution-command-admission"
import type { ReplayDecisionHarnessWorkerV10SuccessorExecutionContractAdmission } from "../../../contracts/src/lib/replay-decision-harness-worker-v10-successor-execution-contract-admission"
import type { ReplayDecisionHarnessWorkerV10SuccessorExecutionStdioProbeAdmission } from "../../../contracts/src/lib/replay-decision-harness-worker-v10-successor-execution-stdio-probe-admission"

export interface ReplayWorkerV10SuccessorProcessLaunchIntentRegistryInput {
  registry_root: string
  source_successor_execution_command_admission:
    ReplayDecisionHarnessWorkerV10SuccessorExecutionCommandAdmission
  source_successor_execution_contract_admission:
    ReplayDecisionHarnessWorkerV10SuccessorExecutionContractAdmission
  source_successor_stdio_probe_admission:
    ReplayDecisionHarnessWorkerV10SuccessorExecutionStdioProbeAdmission
  post_command_lease_observation: ReplayAttemptLeaseObservationEnvelopeView
  post_command_registry_read_receipt: ReplayAttemptLeaseObservationRegistryReadReceiptView
  post_command_clock_attestation: ReplayDispatchClockAttestationView
}

export interface ReplayWorkerV10SuccessorProcessLaunchIntentSources {
  command: ReplayDecisionHarnessWorkerV10SuccessorExecutionCommandAdmission
  command_file_sha256: string
  execution: ReplayDecisionHarnessWorkerV10SuccessorExecutionContractAdmission
  execution_file_sha256: string
  stdio: ReplayDecisionHarnessWorkerV10SuccessorExecutionStdioProbeAdmission
  stdio_file_sha256: string
}
