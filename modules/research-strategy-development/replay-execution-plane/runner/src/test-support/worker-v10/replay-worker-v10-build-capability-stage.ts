import { expect } from "bun:test"
import { createHash } from "node:crypto"
import { mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import type {
  ReplayDecisionHarnessCodeAdmission,
} from "../../../../contracts/src/lib/replay-decision-harness-code-admission"
import {
  assertReplayDecisionHarnessWorkerV10BuildCapability,
  createReplayDecisionHarnessWorkerV10BuildCapability,
  type ReplayDecisionHarnessWorkerV10BuildCapability,
} from "../../../../contracts/src/lib/replay-decision-harness-worker-v10-build-capability"
import { canonicalJson } from "../../../../contracts/src/lib/replay-contracts"
import {
  assertReplayDecisionHarnessWorkerV10BuildCapabilityLineage,
  buildReplayDecisionHarnessWorkerV10Capability,
} from "../../lib/replay-decision-harness-worker-v10-build"
import {
  readReplayWorkerV10BuildCapability,
  registerReplayWorkerV10BuildCapability,
} from "../../lib/replay-worker-v10-build-capability-registry"

export interface ReplayWorkerV10BuildCapabilityStageInput {
  code_admission: ReplayDecisionHarnessCodeAdmission
  legacy_artifact_hash: string
}

export interface ReplayWorkerV10BuildCapabilityStageOutput {
  worker_v10_build_capability: ReplayDecisionHarnessWorkerV10BuildCapability
}

export function runReplayWorkerV10BuildCapabilityStage(
  input: ReplayWorkerV10BuildCapabilityStageInput,
): ReplayWorkerV10BuildCapabilityStageOutput {
  const codeAdmission = input.code_admission
  const legacyArtifactHash = input.legacy_artifact_hash

  const workerV10BuildInput = { source_code_admission: codeAdmission }
  const workerV10BuildCapability = buildReplayDecisionHarnessWorkerV10Capability(workerV10BuildInput)
  expect(workerV10BuildCapability.activation_status)
    .toBe("build_capability_available_process_not_admitted")
  expect(workerV10BuildCapability.legacy_v9_worker_protocol_version)
    .toBe("rd-replay-harness-worker-stdio-v9")
  expect(workerV10BuildCapability.target_worker_protocol_version)
    .toBe("rd-replay-harness-worker-stdio-v10")
  expect(workerV10BuildCapability.migration_policy)
    .toBe("separate_v10_artifact_v9_execution_path_unchanged")
  expect(workerV10BuildCapability.artifact.sha256).not.toBe(legacyArtifactHash)
  expect(workerV10BuildCapability.artifact_relation).toBe("distinct_from_legacy_v9_worker_artifact")
  expect(workerV10BuildCapability.decoder_input_surface).toBe("one_in_memory_plain_object_no_byte_frame")
  expect(workerV10BuildCapability.decoder_validation_policy)
    .toBe("exact_field_whitelist_protocol_schema_and_non_executable_markers")
  expect(workerV10BuildCapability.semantic_validation_policy)
    .toBe("runner_v10_contract_validation_still_required_before_future_dispatch")
  expect(workerV10BuildCapability.transport_frame_design_status).toBe("not_designed")
  expect(workerV10BuildCapability.stdio_loop).toBe("not_materialized")
  expect(workerV10BuildCapability.process_launch).toBe("not_materialized")
  expect(workerV10BuildCapability.worker_request_instance_count).toBe(0)
  expect(workerV10BuildCapability.request_decode_occurrence).toBe("not_materialized")
  expect(workerV10BuildCapability.dispatch_occurrence).toBe("not_materialized")
  expect(workerV10BuildCapability.harness_invocation).toBe("forbidden")
  expect(workerV10BuildCapability.response_instance).toBeNull()
  expect(workerV10BuildCapability.decision_output_authority).toBe("none")
  expect(() => assertReplayDecisionHarnessWorkerV10BuildCapability(workerV10BuildCapability)).not.toThrow()
  expect(() => assertReplayDecisionHarnessWorkerV10BuildCapabilityLineage(
    workerV10BuildCapability,
    workerV10BuildInput,
  )).not.toThrow()
  expect(buildReplayDecisionHarnessWorkerV10Capability({
    source_code_admission: structuredClone(codeAdmission),
  })).toEqual(workerV10BuildCapability)

  expect(() => assertReplayDecisionHarnessWorkerV10BuildCapability({
    ...workerV10BuildCapability,
    target_worker_protocol_version: "rd-replay-harness-worker-stdio-v9" as never,
  })).toThrow("unsupported decision harness Worker v10 build capability authority")
  expect(() => assertReplayDecisionHarnessWorkerV10BuildCapability({
    ...workerV10BuildCapability,
    worker_request_instance_count: 1 as never,
  })).toThrow("unsupported decision harness Worker v10 build capability authority")
  expect(() => assertReplayDecisionHarnessWorkerV10BuildCapability({
    ...workerV10BuildCapability,
    artifact: { ...workerV10BuildCapability.artifact, content_utf8: "forged" },
  })).toThrow("parent or artifact binding drift")

  const workerV10RegistryRoot = mkdtempSync(join(tmpdir(), "replay-worker-v10-build-registry-"))
  try {
    expect(readReplayWorkerV10BuildCapability({
      registry_root: workerV10RegistryRoot,
      source_code_admission: codeAdmission,
    })).toBeNull()
    const registeredWorkerV10Capability = registerReplayWorkerV10BuildCapability({
      registry_root: workerV10RegistryRoot,
      source_code_admission: codeAdmission,
    })
    expect(registeredWorkerV10Capability).toEqual(workerV10BuildCapability)
    expect(registerReplayWorkerV10BuildCapability({
      registry_root: workerV10RegistryRoot,
      source_code_admission: structuredClone(codeAdmission),
    })).toEqual(workerV10BuildCapability)
    expect(readReplayWorkerV10BuildCapability({
      registry_root: workerV10RegistryRoot,
      source_code_admission: codeAdmission,
    })).toEqual(workerV10BuildCapability)
    const capabilityFile = readdirSync(workerV10RegistryRoot)
      .find((name) => name.startsWith("worker-v10-build-capability-"))
    if (!capabilityFile) throw new Error("expected Replay Worker v10 build capability registry file")
    writeFileSync(join(workerV10RegistryRoot, capabilityFile), "{}\n", "utf8")
    expect(() => readReplayWorkerV10BuildCapability({
      registry_root: workerV10RegistryRoot,
      source_code_admission: codeAdmission,
    })).toThrow()
  } finally {
    rmSync(workerV10RegistryRoot, { recursive: true, force: true })
  }

  const differentWorkerV10RegistryRoot = mkdtempSync(join(tmpdir(), "replay-worker-v10-build-different-"))
  try {
    const { capability_hash: originalCapabilityHash, ...workerV10CapabilityBody } = workerV10BuildCapability
    expect(originalCapabilityHash).toHaveLength(64)
    const forgedGeneratedSource = `${workerV10CapabilityBody.generated_entrypoint_content_utf8}// forged\n`
    const forgedArtifact = `${workerV10CapabilityBody.artifact.content_utf8}// forged\n`
    const forgedCapability = createReplayDecisionHarnessWorkerV10BuildCapability({
      ...workerV10CapabilityBody,
      generated_entrypoint_content_utf8: forgedGeneratedSource,
      generated_entrypoint_hash: createHash("sha256").update(forgedGeneratedSource, "utf8").digest("hex"),
      artifact: {
        ...workerV10CapabilityBody.artifact,
        content_utf8: forgedArtifact,
        sha256: createHash("sha256").update(forgedArtifact, "utf8").digest("hex"),
      },
    })
    const differentFile = join(
      differentWorkerV10RegistryRoot,
      `worker-v10-build-capability-${forgedCapability.capability_key}.json`,
    )
    writeFileSync(differentFile, `${canonicalJson(forgedCapability)}\n`, "utf8")
    expect(() => registerReplayWorkerV10BuildCapability({
      registry_root: differentWorkerV10RegistryRoot,
      source_code_admission: codeAdmission,
    })).toThrow("already registered with different evidence")
  } finally {
    rmSync(differentWorkerV10RegistryRoot, { recursive: true, force: true })
  }
  return {
    worker_v10_build_capability: workerV10BuildCapability,
  }
}
