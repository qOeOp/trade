import type { ReplayDecisionHarnessWorkerV10CutoverReceipt } from "../../../contracts/src/lib/replay-decision-harness-worker-v10-cutover-receipt"
import type { ReplayDecisionHarnessWorkerV10ReproducibilityPairContract } from "../../../contracts/src/lib/replay-decision-harness-worker-v10-reproducibility-pair-contract"
import type { ReplayDecisionHarnessWorkerV10SuccessorAuthorityCapsuleRecord } from "../../../contracts/src/lib/replay-decision-harness-worker-v10-successor-authority-capsule"
import type { ReplayDecisionHarnessWorkerV10SuccessorExecutionStdioProbeAdmission } from "../../../contracts/src/lib/replay-decision-harness-worker-v10-successor-execution-stdio-probe-admission"
import type { ReplayDecisionHarnessWorkerV10SuccessorProcessLaunchIntent } from "../../../contracts/src/lib/replay-decision-harness-worker-v10-successor-process-launch-intent"
import type { ReplayDecisionHarnessWorkerV10SuccessorSpawnBoundaryRevalidation } from "../../../contracts/src/lib/replay-decision-harness-worker-v10-successor-spawn-boundary-revalidation"
import type {
  ReplaySpawnBoundaryRevalidationReceipt,
  ReplaySpawnBoundaryRevalidationRequest,
} from "../../../../research-control-plane/contracts/src/lib/control-plane-contracts"

export interface ExecuteReplayWorkerV10CutoverInput {
  registry_root: string
  source_pair_contract: ReplayDecisionHarnessWorkerV10ReproducibilityPairContract
  source_successor_spawn_revalidation: ReplayDecisionHarnessWorkerV10SuccessorSpawnBoundaryRevalidation
  source_successor_authority_capsule: ReplayDecisionHarnessWorkerV10SuccessorAuthorityCapsuleRecord
  source_successor_process_launch_intent: ReplayDecisionHarnessWorkerV10SuccessorProcessLaunchIntent
  source_successor_stdio_probe_admission:
    ReplayDecisionHarnessWorkerV10SuccessorExecutionStdioProbeAdmission
  authority_port: {
    revalidate(request: ReplaySpawnBoundaryRevalidationRequest): ReplaySpawnBoundaryRevalidationReceipt
  }
}

export type ReplayWorkerV10CutoverDisposition = "new_cutover_receipt" | "existing_cutover_receipt"

export interface ReplayWorkerV10CutoverOutcome {
  receipt: ReplayDecisionHarnessWorkerV10CutoverReceipt
  disposition: ReplayWorkerV10CutoverDisposition
}

export interface ReplayWorkerV10CutoverAdapter {
  transport_contract_hash: string
  execution_admission_command_hash: string
  process_launch_intent_hash: string
  authority_capsule: {
    execution_admission_command_hash: string
    execution_envelope_hash: string
    logical_request_id: string
    process_artifact_hash: string
    process_launch_intent_hash: string
    transport_contract_hash: string
    worker_request_hash: string
  }
  authority_capsule_hash: string
  authority_capsule_record_hash: string
  revalidation_request: ReplaySpawnBoundaryRevalidationRequest
}
