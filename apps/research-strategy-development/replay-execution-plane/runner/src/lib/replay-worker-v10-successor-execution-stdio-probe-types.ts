import type { ReplayDecisionHarnessWorkerV10SuccessorExecutionTransportAdmission } from "../../../contracts/src/lib/replay-decision-harness-worker-v10-successor-execution-transport-admission"
import type { ReplayWorkerV10NegativeProbeClock } from "./replay-worker-v10-negative-probe-registry"

export interface RegisterReplayWorkerV10SuccessorExecutionStdioProbeInput {
  registry_root: string
  source_successor_execution_transport_admission:
    ReplayDecisionHarnessWorkerV10SuccessorExecutionTransportAdmission
  clock?: ReplayWorkerV10NegativeProbeClock
}

export interface ReplayWorkerV10SuccessorExecutionPredecessorEvidence {
  stdio_capability_hash: string
  transport_contract_hash: string
  execution_contract_hash: string
}
