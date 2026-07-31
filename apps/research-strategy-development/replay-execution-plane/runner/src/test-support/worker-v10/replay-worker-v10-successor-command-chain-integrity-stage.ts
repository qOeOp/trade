import { expect } from "bun:test"
import { readdirSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import type { ReplayDecisionHarnessWorkerV10SuccessorExecutionContractAdmission } from "../../../../contracts/src/lib/replay-decision-harness-worker-v10-successor-execution-contract-admission"
import { canonicalJson } from "../../../../contracts/src/lib/replay-contracts"
import type { runReplayWorkerV10SuccessorCommandStage } from "./replay-worker-v10-successor-command-stage"
import { readReplayWorkerV10SuccessorExecutionAdmissionCommand, readReplayWorkerV10SuccessorExecutionCommandAdmission, readReplayWorkerV10SuccessorExecutionDispatchClaim } from "../../lib/replay-worker-v10-successor-execution-command-registry"
import { readReplayWorkerV10SuccessorExecutionAdmission, readReplayWorkerV10SuccessorExecutionArtifactTransport, readReplayWorkerV10SuccessorExecutionContract } from "../../lib/replay-worker-v10-successor-execution-contract-registry"
import { readReplayWorkerV10SuccessorExecutionStdioProbe } from "../../lib/replay-worker-v10-successor-execution-stdio-probe-registry"

export interface ReplayWorkerV10SuccessorCommandChainIntegrityStageInput {
  registry_root: string
  command_stage: ReturnType<typeof runReplayWorkerV10SuccessorCommandStage>
  execution_contract_admission:
    ReplayDecisionHarnessWorkerV10SuccessorExecutionContractAdmission
  stdio_probe_admission:
    Parameters<typeof readReplayWorkerV10SuccessorExecutionContract>[0][
      "source_successor_execution_stdio_probe_admission"
    ]
  transport_admission:
    Parameters<typeof readReplayWorkerV10SuccessorExecutionStdioProbe>[0][
      "source_successor_execution_transport_admission"
    ]
}

export function runReplayWorkerV10SuccessorCommandChainIntegrityStage(
  input: ReplayWorkerV10SuccessorCommandChainIntegrityStageInput,
): void {
  const root = input.registry_root
  const commandInput = input.command_stage.command_input
  const commandAdmission = input.command_stage.command_admission
  const claim = input.command_stage.dispatch_claim
  const command = input.command_stage.execution_command
  const executionAdmission =
    input.execution_contract_admission.successor_execution_admission_contract
  const artifactTransport =
    input.execution_contract_admission.successor_artifact_bound_transport_contract

  const claimFile = readdirSync(root).find((name) => name
    === `worker-v10-successor-execution-dispatch-claim-${claim.claim_key}.json`)
  if (!claimFile) throw new Error("expected successor Dispatch Claim file")
  writeFileSync(join(root, claimFile), "{}\n", "utf8")
  expect(() => readReplayWorkerV10SuccessorExecutionDispatchClaim({
    registry_root: root,
    ...commandInput,
  })).toThrow()
  writeFileSync(join(root, claimFile), `${canonicalJson(claim)}\n`, "utf8")

  const commandFile = readdirSync(root).find((name) => name
    === `worker-v10-successor-execution-command-${command.command_key}.json`)
  if (!commandFile) throw new Error("expected successor Execution Command file")
  writeFileSync(join(root, commandFile), "{}\n", "utf8")
  expect(() => readReplayWorkerV10SuccessorExecutionAdmissionCommand({
    registry_root: root,
    ...commandInput,
  })).toThrow()
  writeFileSync(join(root, commandFile), `${canonicalJson(command)}\n`, "utf8")

  const admissionFile = readdirSync(root).find((name) => name
    === `worker-v10-successor-execution-command-admission-${commandAdmission.admission_key}.json`)
  if (!admissionFile) throw new Error("expected successor Command Admission file")
  writeFileSync(join(root, admissionFile), "{}\n", "utf8")
  expect(() => readReplayWorkerV10SuccessorExecutionCommandAdmission({
    registry_root: root,
    ...commandInput,
  })).toThrow()
  writeFileSync(join(root, admissionFile), `${canonicalJson(commandAdmission)}\n`, "utf8")

  const contractFile = readdirSync(root).find((name) => name
    === `worker-v10-successor-execution-contract-${input.execution_contract_admission.admission_key}.json`)
  if (!contractFile) throw new Error("expected Worker v10 successor execution Contract Admission file")
  writeFileSync(join(root, contractFile), "{}\n", "utf8")
  expect(() => readReplayWorkerV10SuccessorExecutionContract({
    registry_root: root,
    source_successor_execution_stdio_probe_admission: input.stdio_probe_admission,
  })).toThrow()
  expect(() => readReplayWorkerV10SuccessorExecutionCommandAdmission({
    registry_root: root,
    ...commandInput,
  })).toThrow()

  const executionFile = readdirSync(root).find((name) => name
    === `worker-v10-successor-execution-admission-${executionAdmission.contract_key}.json`)
  if (!executionFile) throw new Error("expected successor Worker v10 Execution Admission Contract file")
  writeFileSync(join(root, executionFile), "{}\n", "utf8")
  expect(() => readReplayWorkerV10SuccessorExecutionAdmission({
    registry_root: root,
    source_successor_execution_stdio_probe_admission: input.stdio_probe_admission,
  })).toThrow()

  const artifactFile = readdirSync(root).find((name) => name
    === `worker-v10-successor-execution-artifact-transport-${artifactTransport.contract_key}.json`)
  if (!artifactFile) throw new Error("expected successor artifact-bound Worker v10 Transport Contract file")
  writeFileSync(join(root, artifactFile), "{}\n", "utf8")
  expect(() => readReplayWorkerV10SuccessorExecutionArtifactTransport({
    registry_root: root,
    source_successor_execution_stdio_probe_admission: input.stdio_probe_admission,
  })).toThrow()

  const stdioFile = readdirSync(root).find((name) => name
    === `worker-v10-successor-execution-stdio-probe-${input.stdio_probe_admission.admission_key}.json`)
  if (!stdioFile) throw new Error("expected Worker v10 successor execution Stdio Probe Admission file")
  writeFileSync(join(root, stdioFile), "{}\n", "utf8")
  expect(() => readReplayWorkerV10SuccessorExecutionStdioProbe({
    registry_root: root,
    source_successor_execution_transport_admission: input.transport_admission,
  })).toThrow()
}
