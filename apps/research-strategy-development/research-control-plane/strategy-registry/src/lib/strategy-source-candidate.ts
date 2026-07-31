import { createHash } from "node:crypto"
import {
  closeSync,
  existsSync,
  fsyncSync,
  linkSync,
  lstatSync,
  mkdirSync,
  openSync,
  readFileSync,
  unlinkSync,
  writeFileSync,
} from "node:fs"
import { basename, dirname, join, relative, sep } from "node:path"
import {
  canonicalJson,
} from "../../../../../contracts/runtime-core/src/canonical-json"
import type { StrategyDraftBinding } from "../../../contracts/src/lib/control-plane-contracts"
import {
  createStrategySourceCandidate,
  type StrategySourceCandidate,
} from "../../../contracts/src/lib/strategy-source-candidate-contract"
import type { CompiledDraftStrategyInput } from "./draft-strategy-compiler"

export interface PublishedStrategySourceCandidate {
  manifest: StrategySourceCandidate
  manifest_ref: string
}

export function publishStrategySourceCandidate(input: {
  decision_root: string
  compiled: CompiledDraftStrategyInput
  binding: StrategyDraftBinding
}): PublishedStrategySourceCandidate {
  const decisionRoot = required(input.decision_root, "decision_root")
  assertBinding(input.compiled, input.binding)
  const expectedStrategyRoot = join(decisionRoot, "strategies")
  const relativeSource = relative(decisionRoot, input.binding.strategy_ref)
  if (dirname(input.binding.strategy_ref) !== expectedStrategyRoot
      || relativeSource.startsWith(`..${sep}`)
      || relativeSource === ".."
      || relativeSource !== join("strategies", basename(input.binding.strategy_ref))) {
    throw new Error("Strategy source escaped its candidate Decision root")
  }
  const sourceStat = lstatSync(input.binding.strategy_ref)
  if (!sourceStat.isFile() || sourceStat.isSymbolicLink()) {
    throw new Error("Strategy source candidate is not a regular file")
  }
  const source = readFileSync(input.binding.strategy_ref)
  if (sha256(source) !== input.binding.strategy_policy_hash) {
    throw new Error("Strategy source candidate hash drifted")
  }
  const manifest = createStrategySourceCandidate({
    schema_version: "trade.rd-strategy-source-candidate.v1",
    candidate_kind: "draft_strategy_source",
    compiler: {
      version: input.compiled.compiler_version,
      input_hash: digest(
        input.compiled.compiler_input_hash,
        "compiler.input_hash",
      ),
    },
    decision: {
      decision_id: input.compiled.authorization.decision_id,
      draft_id: input.binding.draft_id,
      strategy_id: input.binding.strategy_id,
      strategy_version: input.binding.strategy_version,
      primary_result_id: input.compiled.authorization.primary_result_id,
      primary_result_hash: input.compiled.authorization.primary_result_hash,
    },
    source_provenance: {
      source_revision: revision(input.compiled.source_revision),
      provenance_hash: digest(
        input.compiled.source_provenance_hash,
        "source_provenance.provenance_hash",
      ),
      agent_run_request_hash: digest(
        input.compiled.agent_run_evidence.request_hash,
        "source_provenance.agent_run_request_hash",
      ),
      agent_run_result_hash: digest(
        input.compiled.agent_run_evidence.result_hash,
        "source_provenance.agent_run_result_hash",
      ),
    },
    replay_code_evidence: {
      decision_harness_build_artifact_hash: digest(
        input.compiled.replay_code_evidence
          .decision_harness_build_artifact_hash,
        "replay_code_evidence.decision_harness_build_artifact_hash",
      ),
      decision_harness_runtime_executable_hash: digest(
        input.compiled.replay_code_evidence
          .decision_harness_runtime_executable_hash,
        "replay_code_evidence.decision_harness_runtime_executable_hash",
      ),
    },
    strategy_source: {
      ref: relativeSource.split(sep).join("/"),
      sha256: input.binding.strategy_policy_hash,
      bytes: source.byteLength,
    },
    authority: {
      release_authority: "candidate_source_only",
      deployment_authority: "none",
      trading_authority: false,
    },
    created_at: canonicalUtc(input.compiled.created_at),
  })
  const manifestRef = join(decisionRoot, "candidate.json")
  commitImmutableFile(
    decisionRoot,
    manifestRef,
    `${canonicalJson(manifest)}\n`,
    `strategy-source-candidate:${manifest.manifest_hash}`,
  )
  return { manifest, manifest_ref: manifestRef }
}

function assertBinding(
  compiled: CompiledDraftStrategyInput,
  binding: StrategyDraftBinding,
): void {
  if (binding.materialization_status !== "ready"
      || binding.draft_id !== compiled.draft_id
      || binding.strategy_version !== compiled.strategy_version
      || binding.authorization.decision_id
        !== compiled.authorization.decision_id
      || binding.strategy_policy_hash.length !== 64) {
    throw new Error("Strategy source candidate binding drifted")
  }
}

function commitImmutableFile(
  root: string,
  target: string,
  content: string,
  idempotencyKey: string,
): void {
  mkdirSync(root, { recursive: true, mode: 0o700 })
  const rootStat = lstatSync(root)
  if (!rootStat.isDirectory() || rootStat.isSymbolicLink()) {
    throw new Error("Strategy source candidate root is not a regular directory")
  }
  if (existsSync(target)) {
    assertExactRegularFile(target, content)
    return
  }
  const temporary = `${target}.${sha256(idempotencyKey).slice(0, 12)}.tmp`
  if (existsSync(temporary)) {
    assertExactRegularFile(temporary, content)
  } else {
    writeFileSync(temporary, content, {
      encoding: "utf8",
      flag: "wx",
      mode: 0o600,
    })
  }
  fsyncFile(temporary)
  try {
    linkSync(temporary, target)
  } catch (error) {
    if (!isAlreadyExistsError(error)) throw error
    assertExactRegularFile(target, content)
  } finally {
    if (existsSync(temporary)) unlinkSync(temporary)
  }
  fsyncDirectory(root)
  assertExactRegularFile(target, content)
}

function assertExactRegularFile(path: string, expected: string): void {
  const stat = lstatSync(path)
  if (!stat.isFile() || stat.isSymbolicLink()) {
    throw new Error("Strategy source candidate manifest is not a regular file")
  }
  if (readFileSync(path, "utf8") !== expected) {
    throw new Error("Strategy source candidate manifest content drifted")
  }
}

function fsyncFile(path: string): void {
  const descriptor = openSync(path, "r")
  try {
    fsyncSync(descriptor)
  } finally {
    closeSync(descriptor)
  }
}

function fsyncDirectory(path: string): void {
  const descriptor = openSync(path, "r")
  try {
    fsyncSync(descriptor)
  } finally {
    closeSync(descriptor)
  }
}

function isAlreadyExistsError(error: unknown): boolean {
  return error instanceof Error
    && "code" in error
    && (error as NodeJS.ErrnoException).code === "EEXIST"
}

function required(value: unknown, field: string): string {
  if (typeof value !== "string" || !value.trim()) {
    throw new Error(`${field} is required`)
  }
  return value
}

function revision(value: unknown): string {
  const text = required(value, "source_revision")
  if (!/^[A-Za-z0-9][A-Za-z0-9._+-]{0,127}$/.test(text)) {
    throw new Error("source_revision is invalid")
  }
  return text
}

function digest(value: unknown, field: string): string {
  const text = required(value, field)
  if (!/^[a-f0-9]{64}$/.test(text)) {
    throw new Error(`${field} must be sha256`)
  }
  return text
}

function canonicalUtc(value: unknown): string {
  const text = required(value, "created_at")
  const date = new Date(text)
  if (!Number.isFinite(date.getTime()) || date.toISOString() !== text) {
    throw new Error("created_at must be canonical UTC")
  }
  return text
}

function sha256(value: string | Buffer): string {
  return createHash("sha256").update(value).digest("hex")
}
