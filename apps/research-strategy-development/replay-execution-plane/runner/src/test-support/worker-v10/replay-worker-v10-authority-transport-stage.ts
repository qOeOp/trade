import type { ReplayDecisionHarnessExecutionEnvelope } from "../../../../contracts/src/lib/replay-decision-harness-execution-envelope"
import type { ReplayDecisionHarnessWorkerRequestV10 } from "../../../../contracts/src/lib/replay-decision-harness-worker-request-v10"
import type { ReplayDecisionHarnessWorkerResponseV10 } from "../../../../contracts/src/lib/replay-decision-harness-worker-response-v10-contract"
import type { ReplayDecisionHarnessWorkerV10ProcessLaunchReadinessGate } from "../../../../contracts/src/lib/replay-decision-harness-worker-v10-process-launch-readiness-gate"
import type { ReplayDecisionHarnessWorkerV10SuccessorTransportContract } from "../../../../contracts/src/lib/replay-decision-harness-worker-v10-successor-transport-contract"
import { runReplayWorkerV10ActivatedStdioStage } from "./replay-worker-v10-activated-stdio-stage"
import { runReplayWorkerV10AuthorityFrameBuildStage } from "./replay-worker-v10-authority-frame-build-stage"
import { runReplayWorkerV10AuthorityTransportContractStage } from "./replay-worker-v10-authority-transport-contract-stage"

export interface ReplayWorkerV10AuthorityTransportStageInput {
  registry_root: string
  process_launch_readiness: ReplayDecisionHarnessWorkerV10ProcessLaunchReadinessGate
  first_worker_request: ReplayDecisionHarnessWorkerRequestV10
  execution_envelope: ReplayDecisionHarnessExecutionEnvelope
  first_worker_response: ReplayDecisionHarnessWorkerResponseV10
  predecessor_successor_transport_contract:
    ReplayDecisionHarnessWorkerV10SuccessorTransportContract
  profile(stage: string): void
}

export function runReplayWorkerV10AuthorityTransportStage(
  input: ReplayWorkerV10AuthorityTransportStageInput,
) {
  const frameStage = runReplayWorkerV10AuthorityFrameBuildStage(input)
  const stdioStage = runReplayWorkerV10ActivatedStdioStage({
    registry_root: input.registry_root,
    frame_build: frameStage.frame_build,
    process_launch_readiness: input.process_launch_readiness,
    profile: input.profile,
  })
  const transportStage = runReplayWorkerV10AuthorityTransportContractStage({
    registry_root: input.registry_root,
    activated_stdio: stdioStage.activated_stdio,
    predecessor_successor_transport_contract: input.predecessor_successor_transport_contract,
  })
  return {
    frame_build_input: frameStage.frame_build_input,
    frame_build: frameStage.frame_build,
    activated_stdio_input: stdioStage.activated_stdio_input,
    activated_stdio: stdioStage.activated_stdio,
    transport_input: transportStage.transport_input,
    transport: transportStage.transport,
  }
}
