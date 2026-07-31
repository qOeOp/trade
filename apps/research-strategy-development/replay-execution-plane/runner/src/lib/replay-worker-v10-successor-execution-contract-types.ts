import type { ReplayDecisionHarnessWorkerV10SuccessorExecutionStdioProbeAdmission } from "../../../contracts/src/lib/replay-decision-harness-worker-v10-successor-execution-stdio-probe-admission"

export interface ReplayWorkerV10SuccessorExecutionContractRegistryInput {
  registry_root: string
  source_successor_execution_stdio_probe_admission:
    ReplayDecisionHarnessWorkerV10SuccessorExecutionStdioProbeAdmission
}

export interface ReplayWorkerV10SuccessorExecutionParentSnapshot {
  registry_root: string
  registry_root_device: number
  registry_root_inode: number
  source: ReplayDecisionHarnessWorkerV10SuccessorExecutionStdioProbeAdmission
  file_sha256: string
}
