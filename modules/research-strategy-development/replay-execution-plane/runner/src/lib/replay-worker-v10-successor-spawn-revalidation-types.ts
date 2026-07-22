import type {
  ReplaySpawnBoundaryRevalidationReceipt,
  ReplaySpawnBoundaryRevalidationRequest,
} from "../../../../research-control-plane/contracts/src/lib/control-plane-contracts"
import type { ReplayDecisionHarnessWorkerV10SuccessorAuthorityCapsuleRecord } from "../../../contracts/src/lib/replay-decision-harness-worker-v10-successor-authority-capsule"
import type { ReplayDecisionHarnessWorkerV10SuccessorProcessLaunchIntent } from "../../../contracts/src/lib/replay-decision-harness-worker-v10-successor-process-launch-intent"
import type { ReplayDecisionHarnessWorkerV10SuccessorSpawnBoundaryRevalidation } from "../../../contracts/src/lib/replay-decision-harness-worker-v10-successor-spawn-boundary-revalidation"

export interface ReplayWorkerV10SuccessorSpawnRevalidationAuthorityPort {
  revalidate(request: ReplaySpawnBoundaryRevalidationRequest): ReplaySpawnBoundaryRevalidationReceipt
}

export interface ReplayWorkerV10SuccessorSpawnBoundaryRevalidationReadInput {
  registry_root: string
  source_successor_authority_capsule: ReplayDecisionHarnessWorkerV10SuccessorAuthorityCapsuleRecord
  source_successor_process_launch_intent: ReplayDecisionHarnessWorkerV10SuccessorProcessLaunchIntent
}

export interface ReplayWorkerV10SuccessorSpawnBoundaryRevalidationInput
  extends ReplayWorkerV10SuccessorSpawnBoundaryRevalidationReadInput {
  authority_port: ReplayWorkerV10SuccessorSpawnRevalidationAuthorityPort
}

export interface ReplayWorkerV10SuccessorSpawnBoundaryRevalidationResult {
  revalidation_request: ReplaySpawnBoundaryRevalidationRequest
  control_plane_revalidation_receipt: ReplaySpawnBoundaryRevalidationReceipt
  spawn_boundary_revalidation: ReplayDecisionHarnessWorkerV10SuccessorSpawnBoundaryRevalidation
}

export interface ReplayWorkerV10SuccessorSpawnDurableParents {
  capsule: ReplayDecisionHarnessWorkerV10SuccessorAuthorityCapsuleRecord
  capsule_file_sha256: string
  intent: ReplayDecisionHarnessWorkerV10SuccessorProcessLaunchIntent
  intent_file_sha256: string
}
