import { canonicalHash, canonicalJson } from "../../../contracts/src/lib/replay-contracts"
import {
  REPLAY_DECISION_WORKER_INPUT_ASSEMBLY_V4_POLICY_VERSION,
  REPLAY_DECISION_WORKER_INPUT_ASSEMBLY_V4_SCHEMA_VERSION,
  assertReplayDecisionWorkerInputAssemblyV4,
  createReplayDecisionWorkerInputAssemblyV4,
  type ReplayDecisionWorkerInputAssemblyV4,
  type ReplayDecisionWorkerInputAssemblyV4Body,
} from "../../../contracts/src/lib/replay-decision-worker-input-assembly-v4"
import {
  assertReplayDecisionWorkerInputAssemblyV3,
  type ReplayDecisionWorkerInputAssemblyV3,
} from "../../../contracts/src/lib/replay-decision-worker-input-assembly-v3"
import {
  assertReplaySourceEventDecisionObservationHarnessContextBinding,
  type ReplaySourceEventDecisionObservationHarnessContextBinding,
} from "../../../contracts/src/lib/replay-source-event-decision-observation-harness-context-binding"
import {
  assertReplayDecisionHarnessBuildAttestation,
  assertReplayDecisionHarnessSourceBundle,
  type ReplayDecisionHarnessBuildAttestation,
  type ReplayDecisionHarnessSourceBundle,
} from "../../../contracts/src/lib/replay-contracts"
import { buildReplayDecisionHarness } from "./replay-decision-harness-build"

export interface ReplayDecisionWorkerInputAssemblyV4Input {
  source_assembly_v3: ReplayDecisionWorkerInputAssemblyV3
  harness_context_binding: ReplaySourceEventDecisionObservationHarnessContextBinding
  source_bundle: ReplayDecisionHarnessSourceBundle
  build_attestation: ReplayDecisionHarnessBuildAttestation
}

export function buildReplayDecisionWorkerInputAssemblyV4(
  input: ReplayDecisionWorkerInputAssemblyV4Input,
): ReplayDecisionWorkerInputAssemblyV4 {
  assertInputAuthority(input)
  const bodyWithoutId = buildBodyWithoutId(input)
  const value = createReplayDecisionWorkerInputAssemblyV4({
    ...bodyWithoutId,
    assembly_id: `decision-worker-input-v4-${canonicalHash(bodyWithoutId).slice(0, 24)}`,
  })
  assertReplayDecisionWorkerInputAssemblyV4Lineage(value, input)
  return value
}

export function assertReplayDecisionWorkerInputAssemblyV4Lineage(
  value: ReplayDecisionWorkerInputAssemblyV4,
  input: ReplayDecisionWorkerInputAssemblyV4Input,
): void {
  assertReplayDecisionWorkerInputAssemblyV4(value)
  assertInputAuthority(input)
  const bodyWithoutId = buildBodyWithoutId(input)
  const expected = createReplayDecisionWorkerInputAssemblyV4({
    ...bodyWithoutId,
    assembly_id: `decision-worker-input-v4-${canonicalHash(bodyWithoutId).slice(0, 24)}`,
  })
  if (canonicalHash(value) !== canonicalHash(expected)) {
    throw new Error("decision Worker input assembly v4 parent lineage drift")
  }
}

function buildBodyWithoutId(
  input: ReplayDecisionWorkerInputAssemblyV4Input,
): Omit<ReplayDecisionWorkerInputAssemblyV4Body, "assembly_id"> {
  const build = input.build_attestation
  return {
    schema_version: REPLAY_DECISION_WORKER_INPUT_ASSEMBLY_V4_SCHEMA_VERSION,
    assembly_policy_version: REPLAY_DECISION_WORKER_INPUT_ASSEMBLY_V4_POLICY_VERSION,
    scope: "pre_worker_non_economic_complete_input_and_code_evidence_assembly",
    owner: "replay_runner_code_admission",
    purpose: "bind_complete_r4_103_inputs_to_immutable_source_and_build_without_worker_request",
    parent_validation: "embedded_parent_schema_hash_and_cross_object_binding",
    build_derivation_policy: "runner_deterministic_local_rebuild_exact_match_required",
    independent_build_revalidation: "external_deterministic_rebuild_required",
    registry_admission: "not_bound",
    invocation_identity_materialization: "forbidden",
    worker_request_materialization: "forbidden",
    harness_invocation: "forbidden",
    decision_output_authority: "none",
    signal_authority: "none",
    order_authority: "none",
    economic_authority: "none",
    runner_execution_compatibility: "not_bound",
    source_assembly_v3_id: input.source_assembly_v3.assembly_id,
    source_assembly_v3_hash: input.source_assembly_v3.assembly_hash,
    source_assembly_v3: structuredClone(input.source_assembly_v3),
    harness_context_binding_id: input.harness_context_binding.binding_id,
    harness_context_binding_hash: input.harness_context_binding.binding_hash,
    harness_context_binding: structuredClone(input.harness_context_binding),
    source_bundle_ref: input.source_bundle.bundle_ref,
    source_bundle_hash: input.source_bundle.bundle_hash,
    source_bundle: structuredClone(input.source_bundle),
    build_attestation_hash: build.attestation_hash,
    build_artifact_hash: build.artifact.sha256,
    runtime_id: "bun",
    runtime_version: build.runtime.runtime_version,
    runtime_executable_hash: build.runtime.executable_sha256,
    build_attestation: structuredClone(build),
    input_tuple_status: "complete_non_executable_build_bound",
    code_evidence_status: "source_bundle_and_build_attestation_bound",
    worker_request_count: 0,
  }
}

function assertInputAuthority(input: ReplayDecisionWorkerInputAssemblyV4Input): void {
  assertReplayDecisionWorkerInputAssemblyV3(input.source_assembly_v3)
  assertReplaySourceEventDecisionObservationHarnessContextBinding(input.harness_context_binding)
  assertReplayDecisionHarnessSourceBundle(input.source_bundle)
  assertReplayDecisionHarnessBuildAttestation(input.build_attestation, input.source_bundle)
  const sourceV2 = input.source_assembly_v3.source_assembly_v2
  if (input.harness_context_binding.request_hash !== sourceV2.request_hash
      || input.harness_context_binding.binding_id !== sourceV2.harness_context_binding_id
      || input.harness_context_binding.binding_hash !== sourceV2.harness_context_binding_hash
      || input.harness_context_binding.harness_hash !== input.source_bundle.bundle_hash) {
    throw new Error("decision Worker input assembly v4 input/Context/code binding drift")
  }
  const rebuilt = buildReplayDecisionHarness(input.source_bundle)
  if (canonicalJson(rebuilt) !== canonicalJson(input.build_attestation)) {
    throw new Error("decision Worker input assembly v4 build attestation does not match deterministic rebuild")
  }
}
