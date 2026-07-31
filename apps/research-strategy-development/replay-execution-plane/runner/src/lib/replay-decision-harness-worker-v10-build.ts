import { spawnSync } from "node:child_process"
import { createHash } from "node:crypto"
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, isAbsolute, join, relative, resolve } from "node:path"
import {
  REPLAY_DECISION_HARNESS_BUILD_ARGUMENTS,
  canonicalJson,
  type ReplayDecisionHarnessSourceBundle,
} from "../../../contracts/src/lib/replay-contracts"
import {
  assertReplayDecisionHarnessCodeAdmission,
  type ReplayDecisionHarnessCodeAdmission,
} from "../../../contracts/src/lib/replay-decision-harness-code-admission"
import {
  REPLAY_DECISION_HARNESS_TARGET_WORKER_PROTOCOL_VERSION,
  REPLAY_DECISION_HARNESS_TARGET_WORKER_REQUEST_SCHEMA_VERSION,
} from "../../../contracts/src/lib/replay-decision-harness-logical-request-identity-upgrade"
import {
  REPLAY_DECISION_HARNESS_WORKER_REQUEST_V10_FIELDS,
} from "../../../contracts/src/lib/replay-decision-harness-worker-request-v10"
import {
  REPLAY_DECISION_HARNESS_TARGET_WORKER_RESPONSE_SCHEMA_VERSION,
} from "../../../contracts/src/lib/replay-decision-harness-worker-response-v10-contract"
import {
  REPLAY_DECISION_HARNESS_WORKER_V10_ARTIFACT_FILE,
  REPLAY_DECISION_HARNESS_WORKER_V10_BUILD_CAPABILITY_SCHEMA_VERSION,
  REPLAY_DECISION_HARNESS_WORKER_V10_BUILD_POLICY_VERSION,
  REPLAY_DECISION_HARNESS_WORKER_V10_GENERATED_ENTRYPOINT,
  assertReplayDecisionHarnessWorkerV10BuildCapability,
  createReplayDecisionHarnessWorkerV10BuildCapability,
  replayDecisionHarnessWorkerV10BuildCapabilityKey,
  type ReplayDecisionHarnessWorkerV10BuildCapability,
} from "../../../contracts/src/lib/replay-decision-harness-worker-v10-build-capability"

const BUILD_METAFILE = "worker-v10-metafile.json"
const FIXED_ENVIRONMENT = Object.freeze({ TZ: "UTC", LANG: "C", LC_ALL: "C" })

interface BunBuildMetafile {
  inputs: Record<string, unknown>
  outputs: Record<string, { imports?: Array<{ path: string; external?: boolean }> }>
}

export interface BuildReplayDecisionHarnessWorkerV10CapabilityInput {
  source_code_admission: ReplayDecisionHarnessCodeAdmission
}

export function buildReplayDecisionHarnessWorkerV10Capability(
  input: BuildReplayDecisionHarnessWorkerV10CapabilityInput,
): ReplayDecisionHarnessWorkerV10BuildCapability {
  assertReplayDecisionHarnessCodeAdmission(input.source_code_admission)
  const admission = input.source_code_admission
  const sourceBundle = admission.registry_entry.source_bundle
  const generatedSource = workerV10DecoderEntrypointSource(sourceBundle)
  const root = mkdtempSync(join(tmpdir(), "rd-replay-worker-v10-build-"))
  try {
    for (const file of sourceBundle.files) {
      const filePath = join(root, file.path)
      mkdirSync(dirname(filePath), { recursive: true })
      writeFileSync(filePath, file.content_utf8, { encoding: "utf8", flag: "wx" })
    }
    writeFileSync(join(root, REPLAY_DECISION_HARNESS_WORKER_V10_GENERATED_ENTRYPOINT), generatedSource, {
      encoding: "utf8",
      flag: "wx",
    })
    const buildArguments = [
      "build",
      REPLAY_DECISION_HARNESS_WORKER_V10_GENERATED_ENTRYPOINT,
      ...REPLAY_DECISION_HARNESS_BUILD_ARGUMENTS,
      `--outfile=${REPLAY_DECISION_HARNESS_WORKER_V10_ARTIFACT_FILE}`,
      `--metafile=${BUILD_METAFILE}`,
    ]
    const capability = admission.registry_capability
    const build = spawnSync(process.execPath, buildArguments, {
      cwd: root,
      encoding: "utf8",
      env: FIXED_ENVIRONMENT,
      maxBuffer: capability.max_output_bytes,
      timeout: capability.timeout_ms,
    })
    assertSuccessfulProcess(build, "decision harness Worker v10 decoder build")
    assertExactBuildClosure(
      JSON.parse(readFileSync(join(root, BUILD_METAFILE), "utf8")) as BunBuildMetafile,
      root,
      sourceBundle,
    )
    const artifactContent = readFileSync(join(root, REPLAY_DECISION_HARNESS_WORKER_V10_ARTIFACT_FILE), "utf8")
    assertNoRuntimeImports(artifactContent)
    const capabilityKey = replayDecisionHarnessWorkerV10BuildCapabilityKey({
      source_code_admission_hash: admission.admission_hash,
      target_worker_protocol_version: REPLAY_DECISION_HARNESS_TARGET_WORKER_PROTOCOL_VERSION,
      build_policy_version: REPLAY_DECISION_HARNESS_WORKER_V10_BUILD_POLICY_VERSION,
    })
    return createReplayDecisionHarnessWorkerV10BuildCapability({
      schema_version: REPLAY_DECISION_HARNESS_WORKER_V10_BUILD_CAPABILITY_SCHEMA_VERSION,
      capability_id: `decision-harness-worker-v10-build-${capabilityKey.slice(0, 24)}`,
      capability_key: capabilityKey,
      build_policy_version: REPLAY_DECISION_HARNESS_WORKER_V10_BUILD_POLICY_VERSION,
      scope: "local_deterministic_v10_decoder_module_build_without_transport_or_dispatch",
      owner: "replay_runner_worker_v10_build_registry",
      purpose: "attest_a_distinct_v10_request_decoder_artifact_without_relabeling_the_v9_worker",
      activation_status: "build_capability_available_process_not_admitted",
      source_code_admission_id: admission.admission_id,
      source_code_admission_hash: admission.admission_hash,
      source_code_admission: structuredClone(admission),
      source_bundle_hash: sourceBundle.bundle_hash,
      legacy_v9_build_attestation_hash: admission.registry_entry.build_attestation.attestation_hash,
      legacy_v9_artifact_hash: admission.registry_entry.build_attestation.artifact.sha256,
      legacy_v9_worker_protocol_version: admission.registry_entry.build_attestation.worker_protocol_version,
      migration_policy: "separate_v10_artifact_v9_execution_path_unchanged",
      target_worker_protocol_version: REPLAY_DECISION_HARNESS_TARGET_WORKER_PROTOCOL_VERSION,
      target_worker_request_schema_version: REPLAY_DECISION_HARNESS_TARGET_WORKER_REQUEST_SCHEMA_VERSION,
      target_worker_response_schema_version: REPLAY_DECISION_HARNESS_TARGET_WORKER_RESPONSE_SCHEMA_VERSION,
      generated_entrypoint_path: REPLAY_DECISION_HARNESS_WORKER_V10_GENERATED_ENTRYPOINT,
      generated_entrypoint_content_utf8: generatedSource,
      generated_entrypoint_hash: sha256(generatedSource),
      decoder_export_name: "decodeReplayDecisionHarnessWorkerRequestV10",
      decoder_input_surface: "one_in_memory_plain_object_no_byte_frame",
      decoder_validation_policy: "exact_field_whitelist_protocol_schema_and_non_executable_markers",
      request_field_whitelist: [...REPLAY_DECISION_HARNESS_WORKER_REQUEST_V10_FIELDS],
      semantic_validation_policy: "runner_v10_contract_validation_still_required_before_future_dispatch",
      harness_source_linkage: "source_bundle_entrypoint_linked_but_not_invoked",
      build_arguments: REPLAY_DECISION_HARNESS_BUILD_ARGUMENTS,
      dependency_policy: "metafile_exact_source_closure_no_external_imports",
      deterministic_rebuild_policy: "same_source_admission_runtime_and_policy_must_rebuild_byte_identical",
      runtime: {
        runtime_id: "bun",
        runtime_version: Bun.version,
        executable_sha256: sha256(readFileSync(process.execPath)),
      },
      artifact: {
        format: "bun_esm_decoder_module_utf8",
        file_name: REPLAY_DECISION_HARNESS_WORKER_V10_ARTIFACT_FILE,
        content_utf8: artifactContent,
        sha256: sha256(artifactContent),
      },
      artifact_relation: "distinct_from_legacy_v9_worker_artifact",
      transport_frame_design_status: "not_designed",
      stdio_loop: "not_materialized",
      process_launch: "not_materialized",
      process_instance_identity: "not_materialized",
      worker_request_instance_count: 0,
      worker_request_instances: [],
      request_decode_occurrence: "not_materialized",
      worker_request_write: "forbidden",
      dispatch_occurrence: "not_materialized",
      harness_invocation: "forbidden",
      response_instance: null,
      response_admission: "not_granted",
      decision_output_authority: "none",
      signal_authority: "none",
      order_authority: "none",
      economic_authority: "none",
      trial_authority: "none",
    })
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
}

export function assertReplayDecisionHarnessWorkerV10BuildCapabilityLineage(
  value: ReplayDecisionHarnessWorkerV10BuildCapability,
  input: BuildReplayDecisionHarnessWorkerV10CapabilityInput,
): void {
  assertReplayDecisionHarnessWorkerV10BuildCapability(value)
  const rebuilt = buildReplayDecisionHarnessWorkerV10Capability(input)
  if (canonicalJson(value) !== canonicalJson(rebuilt)) {
    throw new Error("decision harness Worker v10 build capability deterministic rebuild drift")
  }
}

export function workerV10DecoderEntrypointSource(sourceBundle: ReplayDecisionHarnessSourceBundle): string {
  const importPath = `./${sourceBundle.entrypoint.file_path}`
  return [
    `import * as harnessModule from ${JSON.stringify(importPath)}`,
    `const harnessEntrypoint = harnessModule[${JSON.stringify(sourceBundle.entrypoint.export_name)}]`,
    `if (typeof harnessEntrypoint !== "function") throw new Error("decision harness entrypoint export is not a function")`,
    `const expectedFields = ${JSON.stringify(REPLAY_DECISION_HARNESS_WORKER_REQUEST_V10_FIELDS)}`,
    `const expectedSchema = ${JSON.stringify(REPLAY_DECISION_HARNESS_TARGET_WORKER_REQUEST_SCHEMA_VERSION)}`,
    `const expectedProtocol = ${JSON.stringify(REPLAY_DECISION_HARNESS_TARGET_WORKER_PROTOCOL_VERSION)}`,
    "export function decodeReplayDecisionHarnessWorkerRequestV10(value) {",
    `  if (value === null || typeof value !== "object" || Array.isArray(value)) throw new Error("Worker Request v10 must be one plain object")`,
    `  const prototype = Object.getPrototypeOf(value)`,
    `  if (prototype !== Object.prototype && prototype !== null) throw new Error("Worker Request v10 must be one plain object")`,
    `  if (JSON.stringify(Object.keys(value).sort()) !== JSON.stringify(expectedFields)) throw new Error("Worker Request v10 field whitelist drift")`,
    `  if (value.schema_version !== expectedSchema || value.worker_protocol_version !== expectedProtocol) throw new Error("Worker Request v10 protocol drift")`,
    `  if (value.execution_admission !== "not_granted" || value.execution_envelope !== null || value.transport_status !== "not_invoked") throw new Error("Worker Request v10 executable markers are forbidden")`,
    "  return structuredClone(value)",
    "}",
    "",
  ].join("\n")
}

function assertExactBuildClosure(
  metafile: BunBuildMetafile,
  root: string,
  sourceBundle: ReplayDecisionHarnessSourceBundle,
): void {
  const actualInputs = Object.keys(metafile.inputs).map((path) => normalizeBuildInput(path, root)).sort()
  const expectedInputs = [
    REPLAY_DECISION_HARNESS_WORKER_V10_GENERATED_ENTRYPOINT,
    ...sourceBundle.files.map((file) => file.path),
  ].sort()
  if (canonicalJson(actualInputs) !== canonicalJson(expectedInputs)) {
    throw new Error("decision harness Worker v10 build dependency closure differs from source bundle")
  }
  const residualImports = Object.values(metafile.outputs).flatMap((output) => output.imports ?? [])
  if (residualImports.length > 0) {
    throw new Error("decision harness Worker v10 build contains external imports")
  }
}

function normalizeBuildInput(path: string, root: string): string {
  const absolute = isAbsolute(path) ? path : resolve(root, path)
  const normalized = relative(root, absolute).replaceAll("\\", "/")
  if (normalized.startsWith("../") || normalized === "..") {
    throw new Error("decision harness Worker v10 build imported a file outside the source bundle")
  }
  return normalized
}

function assertNoRuntimeImports(artifactContent: string): void {
  if (/(?:^|\n)\s*import\s|\bimport\s*\(|\brequire\s*\(/m.test(artifactContent)) {
    throw new Error("decision harness Worker v10 build contains external imports")
  }
}

function assertSuccessfulProcess(
  processResult: { status: number | null; signal: NodeJS.Signals | null; error?: Error; stderr: string },
  operation: string,
): void {
  if (processResult.error) throw new Error(`${operation} failed: ${processResult.error.message}`)
  if (processResult.status !== 0) {
    const detail = processResult.stderr.trim().slice(0, 512)
    throw new Error(`${operation} failed with status ${processResult.status ?? "signal"}${detail ? `: ${detail}` : ""}`)
  }
}

function sha256(value: string | Buffer): string {
  return createHash("sha256").update(value).digest("hex")
}
