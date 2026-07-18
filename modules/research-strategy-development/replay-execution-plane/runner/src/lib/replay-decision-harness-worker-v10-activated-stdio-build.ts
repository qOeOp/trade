import { spawnSync } from "node:child_process"
import { createHash } from "node:crypto"
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, isAbsolute, join, relative, resolve } from "node:path"
import { canonicalJson } from "../../../contracts/src/lib/replay-contracts"
import {
  REPLAY_DECISION_HARNESS_TARGET_WORKER_PROTOCOL_VERSION,
} from "../../../contracts/src/lib/replay-decision-harness-logical-request-identity-upgrade"
import {
  REPLAY_DECISION_HARNESS_WORKER_REQUEST_V10_FIELDS,
} from "../../../contracts/src/lib/replay-decision-harness-worker-request-v10"
import {
  REPLAY_DECISION_HARNESS_TARGET_WORKER_RESPONSE_SCHEMA_VERSION,
} from "../../../contracts/src/lib/replay-decision-harness-worker-response-v10-contract"
import {
  REPLAY_DECISION_HARNESS_WORKER_V10_ACTIVATED_STDIO_ARTIFACT_FILE,
  REPLAY_DECISION_HARNESS_WORKER_V10_ACTIVATED_STDIO_BUILD_POLICY_VERSION,
  REPLAY_DECISION_HARNESS_WORKER_V10_ACTIVATED_STDIO_CAPABILITY_SCHEMA_VERSION,
  REPLAY_DECISION_HARNESS_WORKER_V10_ACTIVATED_STDIO_GENERATED_ENTRYPOINT,
  REPLAY_DECISION_HARNESS_WORKER_V10_AUTHORITY_CAPSULE_ENV,
  REPLAY_DECISION_HARNESS_WORKER_V10_AUTHORITY_CAPSULE_FIELDS,
  assertReplayDecisionHarnessWorkerV10ActivatedStdioCapability,
  createReplayDecisionHarnessWorkerV10ActivatedStdioCapability,
  replayDecisionHarnessWorkerV10ActivatedStdioBlockers,
  replayDecisionHarnessWorkerV10ActivatedStdioCapabilityKey,
  type ReplayDecisionHarnessWorkerV10ActivatedStdioCapability,
} from "../../../contracts/src/lib/replay-decision-harness-worker-v10-activated-stdio-capability"
import {
  REPLAY_DECISION_HARNESS_WORKER_V10_AUTHORITY_REQUEST_FRAME_FIELDS,
  REPLAY_DECISION_HARNESS_WORKER_V10_AUTHORITY_RESPONSE_FRAME_FIELDS,
  assertReplayDecisionHarnessWorkerV10AuthorityFrameBuildContract,
  type ReplayDecisionHarnessWorkerV10AuthorityFrameBuildContract,
} from "../../../contracts/src/lib/replay-decision-harness-worker-v10-authority-frame-build-contract"

const BUILD_METAFILE = "worker-v10-authority-stdio-metafile.json"
const FIXED_ENVIRONMENT = Object.freeze({ TZ: "UTC", LANG: "C", LC_ALL: "C" })

interface BunBuildMetafile {
  inputs: Record<string, unknown>
  outputs: Record<string, { imports?: Array<{ path: string; external?: boolean }> }>
}

export interface BuildReplayDecisionHarnessWorkerV10ActivatedStdioCapabilityInput {
  source_authority_frame_build_contract: ReplayDecisionHarnessWorkerV10AuthorityFrameBuildContract
}

export function buildReplayDecisionHarnessWorkerV10ActivatedStdioCapability(
  input: BuildReplayDecisionHarnessWorkerV10ActivatedStdioCapabilityInput,
): ReplayDecisionHarnessWorkerV10ActivatedStdioCapability {
  assertReplayDecisionHarnessWorkerV10AuthorityFrameBuildContract(input.source_authority_frame_build_contract)
  const contract = input.source_authority_frame_build_contract
  const command = contract.source_launch_readiness_gate.source_process_launch_intent
    .source_execution_admission_command
  const successor = command.source_clock_binding.source_registry_provenance.source_pre_issue_bundle
    .source_execution_admission_contract.source_successor_transport_contract
  const predecessorStdio = successor.source_negative_probe_receipt.source_stdio_capability
  const decoder = predecessorStdio.source_transport_contract.source_worker_v10_build_capability
  const sourceBundle = decoder.source_code_admission.registry_entry.source_bundle
  const generatedSource = workerV10ActivatedStdioEntrypointSource(contract)
  const root = mkdtempSync(join(tmpdir(), "rd-replay-worker-v10-authority-stdio-build-"))
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
    writeFileSync(join(root, REPLAY_DECISION_HARNESS_WORKER_V10_ACTIVATED_STDIO_GENERATED_ENTRYPOINT),
      generatedSource, { encoding: "utf8", flag: "wx" })
    const buildArguments = [
      "build",
      REPLAY_DECISION_HARNESS_WORKER_V10_ACTIVATED_STDIO_GENERATED_ENTRYPOINT,
      ...decoder.build_arguments,
      `--outfile=${REPLAY_DECISION_HARNESS_WORKER_V10_ACTIVATED_STDIO_ARTIFACT_FILE}`,
      `--metafile=${BUILD_METAFILE}`,
    ]
    const build = spawnSync(process.execPath, buildArguments, {
      cwd: root,
      encoding: "utf8",
      env: FIXED_ENVIRONMENT,
      maxBuffer: successor.max_response_frame_bytes,
      timeout: successor.timeout_ms,
    })
    assertSuccessfulProcess(build, "decision harness Worker v10 activated stdio build")
    assertExactBuildClosure(
      JSON.parse(readFileSync(join(root, BUILD_METAFILE), "utf8")) as BunBuildMetafile,
      root,
      sourceBundle.files.map((file) => file.path),
      decoder.generated_entrypoint_path,
    )
    const artifactContent = readFileSync(
      join(root, REPLAY_DECISION_HARNESS_WORKER_V10_ACTIVATED_STDIO_ARTIFACT_FILE),
      "utf8",
    )
    assertNoRuntimeImports(artifactContent)
    const key = replayDecisionHarnessWorkerV10ActivatedStdioCapabilityKey({
      authority_frame_build_contract_hash: contract.contract_hash,
      build_policy_version: REPLAY_DECISION_HARNESS_WORKER_V10_ACTIVATED_STDIO_BUILD_POLICY_VERSION,
    })
    return createReplayDecisionHarnessWorkerV10ActivatedStdioCapability({
      schema_version: REPLAY_DECISION_HARNESS_WORKER_V10_ACTIVATED_STDIO_CAPABILITY_SCHEMA_VERSION,
      capability_id: `decision-harness-worker-v10-activated-stdio-${key.slice(0, 24)}`,
      capability_key: key,
      build_policy_version: REPLAY_DECISION_HARNESS_WORKER_V10_ACTIVATED_STDIO_BUILD_POLICY_VERSION,
      scope: "local_deterministic_authority_frame_stdio_build_without_transport_or_dispatch",
      owner: "replay_runner_worker_v10_activated_stdio_capability_registry",
      purpose: "attest_authority_frame_capable_artifact_while_all_execution_instances_remain_zero",
      status: "artifact_built_successor_transport_and_authority_not_materialized",
      source_authority_frame_build_contract_id: contract.contract_id,
      source_authority_frame_build_contract_hash: contract.contract_hash,
      source_authority_frame_build_contract: structuredClone(contract),
      source_decoder_capability_hash: decoder.capability_hash,
      source_decoder_artifact_hash: decoder.artifact.sha256,
      source_predecessor_stdio_capability_hash: predecessorStdio.capability_hash,
      source_predecessor_stdio_artifact_hash: predecessorStdio.artifact.sha256,
      source_code_admission_hash: decoder.source_code_admission_hash,
      source_bundle_hash: decoder.source_bundle_hash,
      generated_entrypoint_path: REPLAY_DECISION_HARNESS_WORKER_V10_ACTIVATED_STDIO_GENERATED_ENTRYPOINT,
      generated_entrypoint_content_utf8: generatedSource,
      generated_entrypoint_hash: sha256(generatedSource),
      decoder_entrypoint_path: decoder.generated_entrypoint_path,
      decoder_entrypoint_hash: decoder.generated_entrypoint_hash,
      build_arguments: decoder.build_arguments,
      dependency_policy: "exact_source_bundle_plus_decoder_plus_authority_stdio_entrypoint_no_external_imports",
      deterministic_rebuild_policy: "same_authority_build_contract_runtime_and_policy_rebuilds_byte_identical",
      runtime: structuredClone(decoder.runtime),
      artifact: {
        format: "bun_esm_authority_stdio_process_utf8",
        file_name: REPLAY_DECISION_HARNESS_WORKER_V10_ACTIVATED_STDIO_ARTIFACT_FILE,
        content_utf8: artifactContent,
        sha256: sha256(artifactContent),
      },
      artifact_relation: "distinct_successor_of_terminal_r4_120_stdio_artifact",
      process_model: "fresh_single_request_process_no_pool_keepalive_or_multiplex",
      stdio_loop: "single_bounded_stdin_read_until_eof_then_single_response_lf",
      request_frame_schema_version: contract.request_frame_schema_version,
      response_frame_schema_version: contract.response_frame_schema_version,
      request_frame_fields: REPLAY_DECISION_HARNESS_WORKER_V10_AUTHORITY_REQUEST_FRAME_FIELDS,
      response_frame_fields: REPLAY_DECISION_HARNESS_WORKER_V10_AUTHORITY_RESPONSE_FRAME_FIELDS,
      frame_encoding: "canonical_json_utf8_lf_single_frame_per_direction",
      malformed_utf8_policy: "fatal_no_replacement_decoding",
      timeout_ms: successor.timeout_ms,
      max_request_frame_bytes: successor.max_request_frame_bytes,
      max_response_frame_bytes: successor.max_response_frame_bytes,
      authority_capsule_environment_variable: REPLAY_DECISION_HARNESS_WORKER_V10_AUTHORITY_CAPSULE_ENV,
      authority_capsule_fields: REPLAY_DECISION_HARNESS_WORKER_V10_AUTHORITY_CAPSULE_FIELDS,
      authority_capsule_encoding: "canonical_json_utf8_environment_value",
      authority_capsule_source:
        "future_process_launcher_derives_from_exact_transport_artifact_envelope_command_intent_and_request",
      authority_capsule_binding:
        "future_process_launch_intent_freezes_derivation_policy_spawn_receipt_binds_observed_value_hash",
      authority_capsule_absence_policy: "fatal_before_stdin_read_or_harness_invocation",
      frame_authority_validation:
        "every_outer_authority_field_must_equal_capsule_before_worker_request_decode",
      worker_request_validation:
        "decoder_whitelist_markers_and_self_hash_then_exact_capsule_request_hash",
      harness_invocation_policy: "only_after_capsule_frame_and_worker_request_validation",
      inner_response_validation:
        "artifact_constructs_exact_echo_and_hashes_runner_full_contract_validation_required_before_admission",
      response_authority_echo:
        "exact_transport_artifact_envelope_command_intent_request_frame_and_worker_request",
      valid_authority_frame_probe: "not_materialized_until_successor_authority_exists",
      blocker_set_policy: "complete_deterministic_ordered_post_build_pre_dispatch_blockers",
      blockers: replayDecisionHarnessWorkerV10ActivatedStdioBlockers(),
      activated_stdio_artifact_count: 1,
      successor_transport_contract_count: 0,
      successor_execution_admission_command_count: 0,
      successor_process_launch_intent_count: 0,
      authority_capsule_instance_count: 0,
      process_launch_receipt_count: 0,
      admitted_process_instance_count: 0,
      request_frame_instance_count: 0,
      response_frame_instance_count: 0,
      dispatch_occurrence: "not_materialized",
      transport_activation: "blocked",
      harness_invocation: "forbidden",
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

export function assertReplayDecisionHarnessWorkerV10ActivatedStdioCapabilityLineage(
  value: ReplayDecisionHarnessWorkerV10ActivatedStdioCapability,
  input: BuildReplayDecisionHarnessWorkerV10ActivatedStdioCapabilityInput,
): void {
  assertReplayDecisionHarnessWorkerV10ActivatedStdioCapability(value)
  const rebuilt = buildReplayDecisionHarnessWorkerV10ActivatedStdioCapability(input)
  if (canonicalJson(value) !== canonicalJson(rebuilt)) {
    throw new Error("Activated Stdio Capability deterministic rebuild drift")
  }
}

export function workerV10ActivatedStdioEntrypointSource(
  contract: ReplayDecisionHarnessWorkerV10AuthorityFrameBuildContract,
): string {
  assertReplayDecisionHarnessWorkerV10AuthorityFrameBuildContract(contract)
  const command = contract.source_launch_readiness_gate.source_process_launch_intent
    .source_execution_admission_command
  const successor = command.source_clock_binding.source_registry_provenance.source_pre_issue_bundle
    .source_execution_admission_contract.source_successor_transport_contract
  const decoder = successor.source_negative_probe_receipt.source_stdio_capability.source_transport_contract
    .source_worker_v10_build_capability
  const bundle = decoder.source_code_admission.registry_entry.source_bundle
  return [
    `import { decodeReplayDecisionHarnessWorkerRequestV10 } from ${JSON.stringify(`./${decoder.generated_entrypoint_path}`)}`,
    `import * as harnessModule from ${JSON.stringify(`./${bundle.entrypoint.file_path}`)}`,
    `const execute = harnessModule[${JSON.stringify(bundle.entrypoint.export_name)}]`,
    `if (typeof execute !== "function") throw new Error("decision harness entrypoint export is not a function")`,
    `const requestFrameFields = ${JSON.stringify(REPLAY_DECISION_HARNESS_WORKER_V10_AUTHORITY_REQUEST_FRAME_FIELDS)}`,
    `const responseFrameFields = ${JSON.stringify(REPLAY_DECISION_HARNESS_WORKER_V10_AUTHORITY_RESPONSE_FRAME_FIELDS)}`,
    `const capsuleFields = ${JSON.stringify(REPLAY_DECISION_HARNESS_WORKER_V10_AUTHORITY_CAPSULE_FIELDS)}`,
    `const workerRequestFields = ${JSON.stringify(REPLAY_DECISION_HARNESS_WORKER_REQUEST_V10_FIELDS)}`,
    `const requestFrameSchema = ${JSON.stringify(contract.request_frame_schema_version)}`,
    `const responseFrameSchema = ${JSON.stringify(contract.response_frame_schema_version)}`,
    `const workerProtocol = ${JSON.stringify(REPLAY_DECISION_HARNESS_TARGET_WORKER_PROTOCOL_VERSION)}`,
    `const workerResponseSchema = ${JSON.stringify(REPLAY_DECISION_HARNESS_TARGET_WORKER_RESPONSE_SCHEMA_VERSION)}`,
    `const maxRequestBytes = ${successor.max_request_frame_bytes}`,
    `const maxResponseBytes = ${successor.max_response_frame_bytes}`,
    `function canonicalJson(value) {`,
    `  if (value === null || typeof value === "string" || typeof value === "boolean") return JSON.stringify(value)`,
    `  if (typeof value === "number") { if (!Number.isFinite(value)) throw new Error("non-finite"); return JSON.stringify(Object.is(value, -0) ? 0 : value) }`,
    `  if (Array.isArray(value)) return "[" + value.map(canonicalJson).join(",") + "]"`,
    `  if (value && typeof value === "object") {`,
    `    const entries = Object.entries(value).filter(([, item]) => item !== undefined).sort(([a], [b]) => a.localeCompare(b))`,
    `    return "{" + entries.map(([key, item]) => JSON.stringify(key) + ":" + canonicalJson(item)).join(",") + "}"`,
    `  }`,
    `  throw new Error("unsupported canonical value")`,
    `}`,
    `function hash(value) { return new Bun.CryptoHasher("sha256").update(canonicalJson(value)).digest("hex") }`,
    `function reject(status, code) { process.stderr.write(canonicalJson({ error_code: code }) + "\\n"); process.exit(status) }`,
    `function exactFields(value, fields) { return value && typeof value === "object" && !Array.isArray(value) && JSON.stringify(Object.keys(value).sort()) === JSON.stringify([...fields].sort()) }`,
    `function isHash(value) { return typeof value === "string" && /^[0-9a-f]{64}$/.test(value) }`,
    `function without(value, field) { const copy = { ...value }; delete copy[field]; return copy }`,
    `const capsuleText = process.env[${JSON.stringify(REPLAY_DECISION_HARNESS_WORKER_V10_AUTHORITY_CAPSULE_ENV)}]`,
    `if (!capsuleText) reject(71, "launch_authority_capsule_missing")`,
    `let capsule`,
    `try { capsule = JSON.parse(capsuleText) } catch { reject(72, "launch_authority_capsule_invalid") }`,
    `if (!exactFields(capsule, capsuleFields) || canonicalJson(capsule) !== capsuleText || !capsuleFields.every((field) => isHash(capsule[field]))) reject(72, "launch_authority_capsule_invalid")`,
    `const chunks = []`,
    `let inputBytes = 0`,
    `for await (const chunk of Bun.stdin.stream()) { const bytes = Buffer.from(chunk); inputBytes += bytes.byteLength; if (inputBytes > maxRequestBytes) reject(66, "request_frame_too_large"); chunks.push(bytes) }`,
    `if (inputBytes === 0) reject(64, "empty_request_frame")`,
    `let text`,
    `try { text = new TextDecoder("utf-8", { fatal: true }).decode(Buffer.concat(chunks)) } catch { reject(69, "invalid_request_frame_utf8") }`,
    `if (!text.endsWith("\\n")) reject(67, "request_frame_missing_lf")`,
    `if (text.indexOf("\\n") !== text.length - 1) reject(68, "request_frame_trailing_bytes")`,
    `let frame`,
    `try { frame = JSON.parse(text.slice(0, -1)) } catch { reject(65, "invalid_request_frame_json") }`,
    `if (canonicalJson(frame) !== text.slice(0, -1)) reject(73, "request_frame_not_canonical")`,
    `if (!exactFields(frame, requestFrameFields) || frame.schema_version !== requestFrameSchema || frame.frame_kind !== "worker_request" || frame.worker_protocol_version !== workerProtocol || frame.authority_status !== "authority_bound_candidate_not_admitted" || !isHash(frame.frame_hash) || hash(without(frame, "frame_hash")) !== frame.frame_hash) reject(74, "request_frame_contract_invalid")`,
    `for (const field of capsuleFields) if (frame[field] !== capsule[field]) reject(75, "request_frame_authority_mismatch")`,
    `let request`,
    `try { request = decodeReplayDecisionHarnessWorkerRequestV10(frame.worker_request) } catch { reject(76, "worker_request_invalid") }`,
    `if (!exactFields(request, workerRequestFields) || hash(without(request, "request_hash")) !== request.request_hash || frame.worker_request_hash !== request.request_hash || frame.logical_request_id !== request.logical_request_id) reject(76, "worker_request_invalid")`,
    `let output`,
    `try { output = await execute({ request_context: request.request_context, decision_input_snapshot: request.decision_input_snapshot, decision_market_input_snapshot: request.decision_market_input_snapshot, decision_state_snapshot: request.decision_state_snapshot }) } catch { reject(77, "harness_invocation_failed") }`,
    `if (!output || typeof output !== "object" || !output.decision_output || typeof output.decision_output !== "object" || output.trace === undefined) reject(77, "harness_response_invalid")`,
    `const responseBody = { schema_version: workerResponseSchema, worker_protocol_version: workerProtocol, logical_request_id: request.logical_request_id, request_hash: request.request_hash, run_id: request.run_id, code_admission_hash: request.code_admission_hash, source_bundle_hash: request.source_bundle_hash, artifact_hash: request.artifact_hash, request_context_hash: request.request_context_hash, decision_input_snapshot_hash: request.decision_input_snapshot_hash, decision_market_input_snapshot_hash: request.decision_market_input_snapshot_hash, decision_state_snapshot_hash: request.decision_state_snapshot_hash, decision_output: output.decision_output, decision_output_hash: hash(output.decision_output), trace: output.trace, trace_hash: hash(output.trace), authority_status: "unadmitted_worker_claim" }`,
    `const workerResponse = { ...responseBody, response_hash: hash(responseBody) }`,
    `const outerBody = { schema_version: responseFrameSchema, frame_kind: "worker_response", worker_protocol_version: workerProtocol, transport_contract_hash: frame.transport_contract_hash, execution_envelope_hash: frame.execution_envelope_hash, process_artifact_hash: frame.process_artifact_hash, execution_admission_command_hash: frame.execution_admission_command_hash, process_launch_intent_hash: frame.process_launch_intent_hash, request_frame_hash: frame.frame_hash, logical_request_id: frame.logical_request_id, worker_request_hash: frame.worker_request_hash, worker_response_hash: workerResponse.response_hash, worker_response: workerResponse, authority_status: "authority_bound_candidate_not_admitted" }`,
    `const responseFrame = { ...outerBody, frame_hash: hash(outerBody) }`,
    `if (!exactFields(responseFrame, responseFrameFields)) reject(77, "response_frame_contract_invalid")`,
    `const responseText = canonicalJson(responseFrame) + "\\n"`,
    `if (Buffer.byteLength(responseText, "utf8") > maxResponseBytes) reject(78, "response_frame_too_large")`,
    `process.stdout.write(responseText)`,
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
  const expectedInputs = [REPLAY_DECISION_HARNESS_WORKER_V10_ACTIVATED_STDIO_GENERATED_ENTRYPOINT,
    decoderEntrypointPath, ...sourcePaths].sort()
  if (canonicalJson(actualInputs) !== canonicalJson(expectedInputs)) {
    throw new Error("Activated Stdio build dependency closure drift")
  }
  const residualImports = Object.values(metafile.outputs).flatMap((output) => output.imports ?? [])
  if (residualImports.length > 0) throw new Error("Activated Stdio build contains external imports")
}

function normalizeBuildInput(path: string, root: string): string {
  const absolute = isAbsolute(path) ? path : resolve(root, path)
  const normalized = relative(root, absolute).replaceAll("\\", "/")
  if (normalized.startsWith("../") || normalized === "..") {
    throw new Error("Activated Stdio build imported outside its source closure")
  }
  return normalized
}

function assertNoRuntimeImports(artifactContent: string): void {
  if (/(?:^|\n)\s*import\s|\bimport\s*\(|\brequire\s*\(/m.test(artifactContent)) {
    throw new Error("Activated Stdio build contains external imports")
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
