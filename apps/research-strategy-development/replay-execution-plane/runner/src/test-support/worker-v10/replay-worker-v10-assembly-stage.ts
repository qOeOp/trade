import { expect } from "bun:test"
import type {
  ReplayPositionOpenStateInputMaterialization,
} from "../../../../contracts/src/lib/replay-position-open-state-input-materialization"
import {
  assertReplayDecisionWorkerInputAssemblyV3,
} from "../../../../contracts/src/lib/replay-decision-worker-input-assembly-v3"
import {
  assertReplayDecisionWorkerInputAssemblyV4,
  type ReplayDecisionWorkerInputAssemblyV4,
} from "../../../../contracts/src/lib/replay-decision-worker-input-assembly-v4"
import type {
  ReplayDecisionHarnessBuildAttestation,
  ReplayDecisionHarnessSourceBundle,
} from "../../../../contracts/src/lib/replay-contracts"
import {
  createReplayDecisionHarnessBuildAttestation,
  createReplayDecisionHarnessSourceBundle,
} from "../../../../contracts/src/lib/replay-contracts"
import type {
  ReplayDecisionWorkerInputAssemblyV2,
} from "../../../../contracts/src/lib/replay-decision-worker-input-assembly-v2"
import type {
  ReplaySourceEventDecisionObservationHarnessContextBinding,
} from "../../../../contracts/src/lib/replay-source-event-decision-observation-harness-context-binding"
import {
  assertReplayDecisionWorkerInputAssemblyV3Lineage,
  buildReplayDecisionWorkerInputAssemblyV3,
  type ReplayDecisionWorkerInputAssemblyV3Input,
} from "../../../../engine/src/lib/replay-decision-worker-input-assembly-v3"
import { buildReplayDecisionHarness } from "../../lib/replay-decision-harness-build"
import {
  assertReplayDecisionWorkerInputAssemblyV4Lineage,
  buildReplayDecisionWorkerInputAssemblyV4,
} from "../../lib/replay-decision-worker-input-assembly-v4"

export interface ReplayWorkerV10AssemblyStageInput {
  source_assembly_v2: ReplayDecisionWorkerInputAssemblyV2
  state_input_materialization: ReplayPositionOpenStateInputMaterialization
  harness_context_binding: ReplaySourceEventDecisionObservationHarnessContextBinding
  source_bundle: ReplayDecisionHarnessSourceBundle
  build_attestation: ReplayDecisionHarnessBuildAttestation
}

export interface ReplayWorkerV10AssemblyStageOutput {
  assembly_v3_input: ReplayDecisionWorkerInputAssemblyV3Input
  assembly_v4: ReplayDecisionWorkerInputAssemblyV4
  forged_build_attestation: ReplayDecisionHarnessBuildAttestation
}

export function runReplayWorkerV10AssemblyStage(
  input: ReplayWorkerV10AssemblyStageInput,
): ReplayWorkerV10AssemblyStageOutput {
  const sourceAssemblyV2 = input.source_assembly_v2
  const materialization = input.state_input_materialization
  const binding = input.harness_context_binding
  const sourceBundle = input.source_bundle
  const buildAttestation = input.build_attestation

  const assemblyV3Input = {
    source_assembly_v2: sourceAssemblyV2,
    state_input_materializations: [materialization],
  }
  const assemblyV3 = buildReplayDecisionWorkerInputAssemblyV3(assemblyV3Input)
  expect(assemblyV3.owner).toBe("replay_engine_runtime")
  expect(assemblyV3.source_assembly_v2_hash).toBe(sourceAssemblyV2.assembly_hash)
  expect(assemblyV3.state_materialization_count).toBe(1)
  expect(assemblyV3.complete_entry_count).toBe(2)
  expect(assemblyV3.incomplete_state_entry_count).toBe(0)
  expect(assemblyV3.entries[1]!.state_input_materialization_hash).toBe(materialization.materialization_hash)
  expect(assemblyV3.entries[1]!.input_tuple_status).toBe("complete_non_executable_build_unbound")
  expect(assemblyV3.worker_request_count).toBe(0)
  expect(assemblyV3.entries.every((entry) => entry.worker_request === null)).toBeTrue()
  expect(() => assertReplayDecisionWorkerInputAssemblyV3(assemblyV3)).not.toThrow()
  expect(() => assertReplayDecisionWorkerInputAssemblyV3Lineage(assemblyV3, assemblyV3Input)).not.toThrow()
  expect(buildReplayDecisionWorkerInputAssemblyV3(structuredClone(assemblyV3Input))).toEqual(assemblyV3)
  expect(() => buildReplayDecisionWorkerInputAssemblyV3({
    ...assemblyV3Input,
    state_input_materializations: [],
  })).toThrow("exactly one State parent")
  expect(() => assertReplayDecisionWorkerInputAssemblyV3({
    ...assemblyV3,
    worker_request_count: 1 as never,
  })).toThrow("unsupported decision Worker input assembly v3 authority")

  const assemblyV4Input = {
    source_assembly_v3: assemblyV3,
    harness_context_binding: binding,
    source_bundle: sourceBundle,
    build_attestation: buildAttestation,
  }
  const assemblyV4 = buildReplayDecisionWorkerInputAssemblyV4(assemblyV4Input)
  expect(assemblyV4.owner).toBe("replay_runner_code_admission")
  expect(assemblyV4.input_tuple_status).toBe("complete_non_executable_build_bound")
  expect(assemblyV4.source_bundle_hash).toBe(sourceBundle.bundle_hash)
  expect(assemblyV4.build_attestation_hash).toBe(buildAttestation.attestation_hash)
  expect(assemblyV4.build_artifact_hash).toBe(buildAttestation.artifact.sha256)
  expect(assemblyV4.worker_request_count).toBe(0)
  expect(assemblyV4.worker_request_materialization).toBe("forbidden")
  expect(assemblyV4.harness_invocation).toBe("forbidden")
  expect(() => assertReplayDecisionWorkerInputAssemblyV4(assemblyV4)).not.toThrow()
  expect(() => assertReplayDecisionWorkerInputAssemblyV4Lineage(assemblyV4, assemblyV4Input)).not.toThrow()
  expect(buildReplayDecisionWorkerInputAssemblyV4(structuredClone(assemblyV4Input))).toEqual(assemblyV4)
  const forgedBuild = createReplayDecisionHarnessBuildAttestation({
    source_bundle: sourceBundle,
    runtime_version: buildAttestation.runtime.runtime_version,
    runtime_executable_sha256: buildAttestation.runtime.executable_sha256,
    artifact_content_utf8: `${buildAttestation.artifact.content_utf8}// forged\n`,
  })
  expect(() => buildReplayDecisionWorkerInputAssemblyV4({
    ...assemblyV4Input,
    build_attestation: forgedBuild,
  })).toThrow("does not match deterministic rebuild")
  const mismatchedBundle = createReplayDecisionHarnessSourceBundle({
    bundle_ref: "fixture://decision-harness/r4-104-mismatch",
    entrypoint: { file_path: "strategy.ts", export_name: "decide" },
    files: [{ path: "strategy.ts", content_utf8: "export function decide() { return null }\n" }],
  })
  expect(() => buildReplayDecisionWorkerInputAssemblyV4({
    ...assemblyV4Input,
    source_bundle: mismatchedBundle,
    build_attestation: buildReplayDecisionHarness(mismatchedBundle),
  })).toThrow("input/Context/code binding drift")
  expect(() => assertReplayDecisionWorkerInputAssemblyV4({
    ...assemblyV4,
    worker_request_count: 1 as never,
  })).toThrow("unsupported decision Worker input assembly v4 authority")

  return {
    assembly_v3_input: assemblyV3Input,
    assembly_v4: assemblyV4,
    forged_build_attestation: forgedBuild,
  }
}
