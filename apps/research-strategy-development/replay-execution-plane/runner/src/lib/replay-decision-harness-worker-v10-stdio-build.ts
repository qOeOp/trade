import { spawnSync } from "node:child_process"
import { createHash } from "node:crypto"
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, isAbsolute, join, relative, resolve } from "node:path"
import { canonicalJson } from "../../../contracts/src/lib/replay-contracts"
import {
  assertReplayDecisionHarnessWorkerV10TransportContract,
  type ReplayDecisionHarnessWorkerV10TransportContract,
} from "../../../contracts/src/lib/replay-decision-harness-worker-v10-transport-contract"
import {
  REPLAY_DECISION_HARNESS_WORKER_V10_NEGATIVE_PROBE_POLICY_VERSION,
  REPLAY_DECISION_HARNESS_WORKER_V10_STDIO_ARTIFACT_FILE,
  REPLAY_DECISION_HARNESS_WORKER_V10_STDIO_BUILD_POLICY_VERSION,
  REPLAY_DECISION_HARNESS_WORKER_V10_STDIO_CAPABILITY_SCHEMA_VERSION,
  REPLAY_DECISION_HARNESS_WORKER_V10_STDIO_GENERATED_ENTRYPOINT,
  assertReplayDecisionHarnessWorkerV10StdioCapability,
  createReplayDecisionHarnessWorkerV10StdioCapability,
  replayDecisionHarnessWorkerV10ProbeErrorLine,
  replayDecisionHarnessWorkerV10StdioCapabilityKey,
  type ReplayDecisionHarnessWorkerV10StdioCapability,
} from "../../../contracts/src/lib/replay-decision-harness-worker-v10-stdio-capability"

const BUILD_METAFILE = "worker-v10-stdio-metafile.json"
const FIXED_ENVIRONMENT = Object.freeze({ TZ: "UTC", LANG: "C", LC_ALL: "C" })

interface BunBuildMetafile {
  inputs: Record<string, unknown>
  outputs: Record<string, { imports?: Array<{ path: string; external?: boolean }> }>
}

export interface BuildReplayDecisionHarnessWorkerV10StdioCapabilityInput {
  source_transport_contract: ReplayDecisionHarnessWorkerV10TransportContract
}

export function buildReplayDecisionHarnessWorkerV10StdioCapability(
  input: BuildReplayDecisionHarnessWorkerV10StdioCapabilityInput,
): ReplayDecisionHarnessWorkerV10StdioCapability {
  assertReplayDecisionHarnessWorkerV10TransportContract(input.source_transport_contract)
  const contract = input.source_transport_contract
  const decoder = contract.source_worker_v10_build_capability
  const sourceBundle = decoder.source_code_admission.registry_entry.source_bundle
  const generatedSource = workerV10StdioEntrypointSource(contract)
  const root = mkdtempSync(join(tmpdir(), "rd-replay-worker-v10-stdio-build-"))
  try {
    for (const file of sourceBundle.files) {
      const path = join(root, file.path)
      mkdirSync(dirname(path), { recursive: true })
      writeFileSync(path, file.content_utf8, { encoding: "utf8", flag: "wx" })
    }
    writeFileSync(join(root, decoder.generated_entrypoint_path), decoder.generated_entrypoint_content_utf8, {
      encoding: "utf8",
      flag: "wx",
    })
    writeFileSync(join(root, REPLAY_DECISION_HARNESS_WORKER_V10_STDIO_GENERATED_ENTRYPOINT), generatedSource, {
      encoding: "utf8",
      flag: "wx",
    })
    const buildArguments = [
      "build",
      REPLAY_DECISION_HARNESS_WORKER_V10_STDIO_GENERATED_ENTRYPOINT,
      ...decoder.build_arguments,
      `--outfile=${REPLAY_DECISION_HARNESS_WORKER_V10_STDIO_ARTIFACT_FILE}`,
      `--metafile=${BUILD_METAFILE}`,
    ]
    const build = spawnSync(process.execPath, buildArguments, {
      cwd: root,
      encoding: "utf8",
      env: FIXED_ENVIRONMENT,
      maxBuffer: contract.max_response_frame_bytes,
      timeout: contract.timeout_ms,
    })
    assertSuccessfulProcess(build, "decision harness Worker v10 stdio process build")
    assertExactBuildClosure(
      JSON.parse(readFileSync(join(root, BUILD_METAFILE), "utf8")) as BunBuildMetafile,
      root,
      sourceBundle.files.map((file) => file.path),
      decoder.generated_entrypoint_path,
    )
    const artifactContent = readFileSync(join(root, REPLAY_DECISION_HARNESS_WORKER_V10_STDIO_ARTIFACT_FILE), "utf8")
    assertNoRuntimeImports(artifactContent)
    const capabilityKey = replayDecisionHarnessWorkerV10StdioCapabilityKey({
      transport_contract_hash: contract.contract_hash,
      build_policy_version: REPLAY_DECISION_HARNESS_WORKER_V10_STDIO_BUILD_POLICY_VERSION,
    })
    return createReplayDecisionHarnessWorkerV10StdioCapability({
      schema_version: REPLAY_DECISION_HARNESS_WORKER_V10_STDIO_CAPABILITY_SCHEMA_VERSION,
      capability_id: `decision-harness-worker-v10-stdio-${capabilityKey.slice(0, 24)}`,
      capability_key: capabilityKey,
      build_policy_version: REPLAY_DECISION_HARNESS_WORKER_V10_STDIO_BUILD_POLICY_VERSION,
      scope: "local_deterministic_v10_stdio_process_build_without_request_dispatch",
      owner: "replay_runner_worker_v10_stdio_capability_registry",
      purpose: "attest_a_successor_stdio_process_artifact_while_r4_119_remains_zero_instance",
      status: "stdio_process_capability_available_transport_activation_not_granted",
      source_transport_contract_id: contract.contract_id,
      source_transport_contract_hash: contract.contract_hash,
      source_transport_contract: structuredClone(contract),
      source_decoder_capability_hash: decoder.capability_hash,
      source_decoder_artifact_hash: decoder.artifact.sha256,
      source_legacy_v9_artifact_hash: decoder.legacy_v9_artifact_hash,
      source_code_admission_hash: decoder.source_code_admission_hash,
      source_bundle_hash: decoder.source_bundle_hash,
      artifact_migration_relation: "distinct_successor_of_decoder_and_legacy_v9_artifacts",
      r4_119_binding_relation: "successor_artifact_requires_new_transport_contract_no_retroactive_rewrite",
      generated_entrypoint_path: REPLAY_DECISION_HARNESS_WORKER_V10_STDIO_GENERATED_ENTRYPOINT,
      generated_entrypoint_content_utf8: generatedSource,
      generated_entrypoint_hash: sha256(generatedSource),
      decoder_entrypoint_path: decoder.generated_entrypoint_path,
      decoder_entrypoint_hash: decoder.generated_entrypoint_hash,
      build_arguments: decoder.build_arguments,
      dependency_policy: "exact_source_bundle_plus_decoder_plus_stdio_entrypoint_no_external_imports",
      deterministic_rebuild_policy: "same_transport_contract_runtime_and_policy_must_rebuild_byte_identical",
      runtime: structuredClone(decoder.runtime),
      artifact: {
        format: "bun_esm_stdio_process_utf8",
        file_name: REPLAY_DECISION_HARNESS_WORKER_V10_STDIO_ARTIFACT_FILE,
        content_utf8: artifactContent,
        sha256: sha256(artifactContent),
      },
      process_model: "fresh_single_request_process_no_pool_keepalive_or_multiplex",
      stdio_loop: "single_bounded_stdin_read_until_eof",
      frame_semantics_source: "exact_r4_119_transport_contract",
      request_frame_encoding: "canonical_json_utf8_lf_then_eof",
      max_request_frame_bytes: contract.max_request_frame_bytes,
      valid_frame_policy: "reject_before_decode_until_successor_transport_activation",
      valid_frame_exit_code: 70,
      valid_frame_error_code: "transport_activation_not_granted",
      negative_probe_policy: REPLAY_DECISION_HARNESS_WORKER_V10_NEGATIVE_PROBE_POLICY_VERSION,
      process_instance_count: 0,
      worker_request_frame_instance_count: 0,
      worker_request_decode_occurrence: "not_materialized",
      worker_request_dispatch: "forbidden",
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

export function assertReplayDecisionHarnessWorkerV10StdioCapabilityLineage(
  value: ReplayDecisionHarnessWorkerV10StdioCapability,
  input: BuildReplayDecisionHarnessWorkerV10StdioCapabilityInput,
): void {
  assertReplayDecisionHarnessWorkerV10StdioCapability(value)
  const rebuilt = buildReplayDecisionHarnessWorkerV10StdioCapability(input)
  if (canonicalJson(value) !== canonicalJson(rebuilt)) {
    throw new Error("decision harness Worker v10 Stdio Capability deterministic rebuild drift")
  }
}

export function workerV10StdioEntrypointSource(
  contract: ReplayDecisionHarnessWorkerV10TransportContract,
): string {
  assertReplayDecisionHarnessWorkerV10TransportContract(contract)
  const decoder = contract.source_worker_v10_build_capability
  const errorLine = (code: string) => JSON.stringify(replayDecisionHarnessWorkerV10ProbeErrorLine(code))
  return [
    `import { decodeReplayDecisionHarnessWorkerRequestV10 } from ${JSON.stringify(`./${decoder.generated_entrypoint_path}`)}`,
    `if (typeof decodeReplayDecisionHarnessWorkerRequestV10 !== "function") throw new Error("Worker v10 decoder export is unavailable")`,
    `const maxRequestFrameBytes = ${contract.max_request_frame_bytes}`,
    `function reject(exitCode, errorCode) {`,
    `  const lines = {`,
    `    empty_request_frame: ${errorLine("empty_request_frame")},`,
    `    invalid_request_frame_json: ${errorLine("invalid_request_frame_json")},`,
    `    request_frame_too_large: ${errorLine("request_frame_too_large")},`,
    `    request_frame_missing_lf: ${errorLine("request_frame_missing_lf")},`,
    `    request_frame_trailing_bytes: ${errorLine("request_frame_trailing_bytes")},`,
    `    invalid_request_frame_utf8: ${errorLine("invalid_request_frame_utf8")},`,
    `    transport_activation_not_granted: ${errorLine("transport_activation_not_granted")},`,
    `  }`,
    `  process.stderr.write(lines[errorCode])`,
    `  process.exit(exitCode)`,
    `}`,
    `const chunks = []`,
    `let inputBytes = 0`,
    `for await (const chunk of Bun.stdin.stream()) {`,
    `  const bytes = Buffer.from(chunk)`,
    `  inputBytes += bytes.byteLength`,
    `  if (inputBytes > maxRequestFrameBytes) reject(66, "request_frame_too_large")`,
    `  chunks.push(bytes)`,
    `}`,
    `if (inputBytes === 0) reject(64, "empty_request_frame")`,
    `const input = Buffer.concat(chunks)`,
    `let text`,
    `try { text = new TextDecoder("utf-8", { fatal: true }).decode(input) }`,
    `catch { reject(69, "invalid_request_frame_utf8") }`,
    `if (!text.endsWith("\\n")) reject(67, "request_frame_missing_lf")`,
    `if (text.indexOf("\\n") !== text.length - 1) reject(68, "request_frame_trailing_bytes")`,
    `try { JSON.parse(text.slice(0, -1)) }`,
    `catch { reject(65, "invalid_request_frame_json") }`,
    `reject(70, "transport_activation_not_granted")`,
    `void decodeReplayDecisionHarnessWorkerRequestV10`,
    "",
  ].join("\n")
}

function assertExactBuildClosure(
  metafile: BunBuildMetafile,
  root: string,
  sourcePaths: string[],
  decoderEntrypointPath: string,
): void {
  const actualInputs = Object.keys(metafile.inputs).map((path) => normalizeBuildInput(path, root)).sort()
  const expectedInputs = [REPLAY_DECISION_HARNESS_WORKER_V10_STDIO_GENERATED_ENTRYPOINT,
    decoderEntrypointPath, ...sourcePaths].sort()
  if (canonicalJson(actualInputs) !== canonicalJson(expectedInputs)) {
    throw new Error("decision harness Worker v10 stdio build dependency closure drift")
  }
  const residualImports = Object.values(metafile.outputs).flatMap((output) => output.imports ?? [])
  if (residualImports.length > 0) {
    throw new Error("decision harness Worker v10 stdio build contains external imports")
  }
}

function normalizeBuildInput(path: string, root: string): string {
  const absolute = isAbsolute(path) ? path : resolve(root, path)
  const normalized = relative(root, absolute).replaceAll("\\", "/")
  if (normalized.startsWith("../") || normalized === "..") {
    throw new Error("decision harness Worker v10 stdio build imported outside its source closure")
  }
  return normalized
}

function assertNoRuntimeImports(artifactContent: string): void {
  if (/(?:^|\n)\s*import\s|\bimport\s*\(|\brequire\s*\(/m.test(artifactContent)) {
    throw new Error("decision harness Worker v10 stdio build contains external imports")
  }
}

function assertSuccessfulProcess(
  result: { status: number | null; signal: NodeJS.Signals | null; error?: Error; stderr: string },
  operation: string,
): void {
  if (result.error) throw new Error(`${operation} failed: ${result.error.message}`)
  if (result.status !== 0) {
    const detail = result.stderr.trim().slice(0, 512)
    throw new Error(`${operation} failed with status ${result.status ?? "signal"}${detail ? `: ${detail}` : ""}`)
  }
}

function sha256(value: string | Buffer): string {
  return createHash("sha256").update(value).digest("hex")
}
