import type { ReplayDecisionHarnessWorkerV10SuccessorExecutionEnvelopeAdmission } from "../../../contracts/src/lib/replay-decision-harness-worker-v10-successor-execution-envelope-admission"

export interface RegisterReplayWorkerV10SuccessorExecutionTransportInput {
  registry_root: string
  source_successor_execution_envelope_admission:
    ReplayDecisionHarnessWorkerV10SuccessorExecutionEnvelopeAdmission
}
