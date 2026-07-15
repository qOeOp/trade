import { spawnSync } from "node:child_process"
import { createHash } from "node:crypto"
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { dirname, isAbsolute, join, relative, resolve } from "node:path"
import { tmpdir } from "node:os"
import {
  REPLAY_DECISION_HARNESS_BUILD_ARGUMENTS,
  REPLAY_DECISION_HARNESS_REGISTRY_CAPABILITY,
  REPLAY_DECISION_HARNESS_WORKER_REQUEST_SCHEMA_VERSION,
  REPLAY_DECISION_HARNESS_WORKER_RESPONSE_SCHEMA_VERSION,
  assertReplayDecisionHarnessBuildAttestation,
  assertReplayDecisionHarnessSourceBundle,
  assertReplayDecisionHarnessWorkerRequest,
  assertReplayDecisionHarnessWorkerResponse,
  canonicalHash,
  canonicalJson,
  createReplayDecisionHarnessBuildAttestation,
  createReplayDecisionHarnessContext,
  type ReplayDecisionHarnessBuildAttestation,
  type ReplayDecisionHarnessSourceBundle,
  type ReplayDecisionHarnessWorkerRequest,
  type ReplayDecisionHarnessWorkerResponse,
  type ReplayDecisionInputSnapshot,
  type ReplayDecisionMarketInputSnapshot,
  type ReplayDecisionScheduleEntry,
  type ReplayExecutionRequest,
} from "../../../contracts/src/lib/replay-contracts"

const WORKER_ENTRY_FILE = "__rd_replay_worker__.ts"
const WORKER_ARTIFACT_FILE = "worker.mjs"
const BUILD_METAFILE = "metafile.json"
const FIXED_ENVIRONMENT = Object.freeze({ TZ: "UTC", LANG: "C", LC_ALL: "C" })

interface BunBuildMetafile {
  inputs: Record<string, unknown>
  outputs: Record<string, { imports?: Array<{ path: string; external?: boolean }> }>
}

export interface ReplayDecisionHarnessWorkerExecution {
  worker_request: ReplayDecisionHarnessWorkerRequest
  worker_response: ReplayDecisionHarnessWorkerResponse
}

export function buildReplayDecisionHarness(
  sourceBundle: ReplayDecisionHarnessSourceBundle,
): ReplayDecisionHarnessBuildAttestation {
  assertReplayDecisionHarnessSourceBundle(sourceBundle)
  const root = mkdtempSync(join(tmpdir(), "rd-replay-harness-build-"))
  try {
    for (const file of sourceBundle.files) {
      const filePath = join(root, file.path)
      mkdirSync(dirname(filePath), { recursive: true })
      writeFileSync(filePath, file.content_utf8, { encoding: "utf8", flag: "wx" })
    }
    writeFileSync(join(root, WORKER_ENTRY_FILE), workerEntrypointSource(sourceBundle), { encoding: "utf8", flag: "wx" })
    const buildArguments = [
      "build",
      WORKER_ENTRY_FILE,
      ...REPLAY_DECISION_HARNESS_BUILD_ARGUMENTS,
      `--outfile=${WORKER_ARTIFACT_FILE}`,
      `--metafile=${BUILD_METAFILE}`,
    ]
    const build = spawnSync(process.execPath, buildArguments, {
      cwd: root,
      encoding: "utf8",
      env: FIXED_ENVIRONMENT,
      maxBuffer: REPLAY_DECISION_HARNESS_REGISTRY_CAPABILITY.max_output_bytes,
      timeout: REPLAY_DECISION_HARNESS_REGISTRY_CAPABILITY.timeout_ms,
    })
    assertSuccessfulProcess(build, "decision harness build")
    assertExactBuildClosure(JSON.parse(readFileSync(join(root, BUILD_METAFILE), "utf8")) as BunBuildMetafile, root, sourceBundle)
    const artifactContent = readFileSync(join(root, WORKER_ARTIFACT_FILE), "utf8")
    assertNoRuntimeImports(artifactContent)
    return createReplayDecisionHarnessBuildAttestation({
      source_bundle: sourceBundle,
      runtime_version: Bun.version,
      runtime_executable_sha256: sha256(readFileSync(process.execPath)),
      artifact_content_utf8: artifactContent,
    })
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
}

export function executeReplayDecisionHarnessWorker(input: {
  source_bundle: ReplayDecisionHarnessSourceBundle
  build_attestation: ReplayDecisionHarnessBuildAttestation
  request: ReplayExecutionRequest
  schedule_entry: ReplayDecisionScheduleEntry
  decision_input_snapshot: ReplayDecisionInputSnapshot
  decision_market_input_snapshot: ReplayDecisionMarketInputSnapshot
}): ReplayDecisionHarnessWorkerExecution {
  assertReplayDecisionHarnessSourceBundle(input.source_bundle, input.request)
  assertReplayDecisionHarnessBuildAttestation(input.build_attestation, input.source_bundle)
  const currentRuntimeHash = sha256(readFileSync(process.execPath))
  if (Bun.version !== input.build_attestation.runtime.runtime_version
      || currentRuntimeHash !== input.build_attestation.runtime.executable_sha256) {
    throw new Error("decision harness runtime does not match build attestation")
  }
  const workerRequest: ReplayDecisionHarnessWorkerRequest = {
    schema_version: REPLAY_DECISION_HARNESS_WORKER_REQUEST_SCHEMA_VERSION,
    invocation_id: canonicalHash({
      run_id: input.request.run_id,
      source_bundle_hash: input.source_bundle.bundle_hash,
      artifact_hash: input.build_attestation.artifact.sha256,
      decision_input_snapshot_hash: input.decision_input_snapshot.snapshot_hash,
      decision_market_input_snapshot_hash: input.decision_market_input_snapshot.snapshot_hash,
    }),
    source_bundle_hash: input.source_bundle.bundle_hash,
    artifact_hash: input.build_attestation.artifact.sha256,
    request_context: createReplayDecisionHarnessContext(input.request, input.schedule_entry),
    decision_input_snapshot: structuredClone(input.decision_input_snapshot),
    decision_market_input_snapshot: structuredClone(input.decision_market_input_snapshot),
  }
  assertReplayDecisionHarnessWorkerRequest(
    workerRequest,
    input.request,
    input.decision_input_snapshot,
    input.decision_market_input_snapshot,
    input.build_attestation,
  )
  const root = mkdtempSync(join(tmpdir(), "rd-replay-harness-run-"))
  try {
    const artifactPath = join(root, WORKER_ARTIFACT_FILE)
    writeFileSync(artifactPath, input.build_attestation.artifact.content_utf8, { encoding: "utf8", flag: "wx", mode: 0o500 })
    if (sha256(readFileSync(artifactPath)) !== input.build_attestation.artifact.sha256) {
      throw new Error("decision harness materialized artifact hash mismatch")
    }
    const execution = spawnSync(process.execPath, [artifactPath], {
      cwd: root,
      encoding: "utf8",
      env: FIXED_ENVIRONMENT,
      input: `${canonicalJson(workerRequest)}\n`,
      maxBuffer: REPLAY_DECISION_HARNESS_REGISTRY_CAPABILITY.max_output_bytes,
      timeout: REPLAY_DECISION_HARNESS_REGISTRY_CAPABILITY.timeout_ms,
    })
    assertSuccessfulProcess(execution, "decision harness worker")
    let workerResponse: ReplayDecisionHarnessWorkerResponse
    try {
      workerResponse = JSON.parse(execution.stdout) as ReplayDecisionHarnessWorkerResponse
    } catch {
      throw new Error("decision harness worker returned invalid JSON")
    }
    assertReplayDecisionHarnessWorkerResponse(workerResponse, workerRequest)
    return { worker_request: workerRequest, worker_response: workerResponse }
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
}

function workerEntrypointSource(sourceBundle: ReplayDecisionHarnessSourceBundle): string {
  const importPath = `./${sourceBundle.entrypoint.file_path}`
  return [
    `import * as harnessModule from ${JSON.stringify(importPath)}`,
    `const execute = harnessModule[${JSON.stringify(sourceBundle.entrypoint.export_name)}]`,
    `if (typeof execute !== "function") throw new Error("decision harness entrypoint export is not a function")`,
    "const input = JSON.parse(await Bun.stdin.text())",
    "const output = await execute({ request_context: input.request_context, decision_input_snapshot: input.decision_input_snapshot, decision_market_input_snapshot: input.decision_market_input_snapshot })",
    `const response = { schema_version: ${JSON.stringify(REPLAY_DECISION_HARNESS_WORKER_RESPONSE_SCHEMA_VERSION)}, invocation_id: input.invocation_id, source_bundle_hash: ${JSON.stringify(sourceBundle.bundle_hash)}, artifact_hash: input.artifact_hash, decision_output: output?.decision_output, trace: output?.trace }`,
    "process.stdout.write(JSON.stringify(response))",
    "",
  ].join("\n")
}

function assertExactBuildClosure(
  metafile: BunBuildMetafile,
  root: string,
  sourceBundle: ReplayDecisionHarnessSourceBundle,
): void {
  const actualInputs = Object.keys(metafile.inputs).map((path) => normalizeBuildInput(path, root)).sort()
  const expectedInputs = [WORKER_ENTRY_FILE, ...sourceBundle.files.map((file) => file.path)].sort()
  if (canonicalJson(actualInputs) !== canonicalJson(expectedInputs)) {
    throw new Error("decision harness build dependency closure differs from source bundle")
  }
  const residualImports = Object.values(metafile.outputs)
    .flatMap((output) => output.imports ?? [])
  if (residualImports.length > 0) {
    throw new Error("decision harness build contains external imports")
  }
}

function normalizeBuildInput(path: string, root: string): string {
  const absolute = isAbsolute(path) ? path : resolve(root, path)
  const normalized = relative(root, absolute).replaceAll("\\", "/")
  if (normalized.startsWith("../") || normalized === "..") {
    throw new Error("decision harness build imported a file outside the source bundle")
  }
  return normalized
}

function assertNoRuntimeImports(artifactContent: string): void {
  if (/(?:^|\n)\s*import\s|\bimport\s*\(|\brequire\s*\(/m.test(artifactContent)) {
    throw new Error("decision harness build contains external imports")
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
