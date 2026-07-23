import { createHash } from "node:crypto"
import { spawnSync } from "node:child_process"
import {
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  realpathSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs"
import { dirname, resolve, sep } from "node:path"
import type { Database } from "bun:sqlite"
import {
  canonicalHash,
  canonicalJson,
} from "../../modules/contracts/runtime-core/src/canonical-json"
import { lintStrategyContract } from "../../modules/contracts/strategy-contract/src/strategy-contract"
import type {
  AgentWorkspaceSuite,
  AgentWorkspaceSuiteCheck,
} from "../../modules/orchestration-ops/agent-workspace-manager/src/lib/isolated-package-checker"
import {
  captureAgentWorkspacePatch,
  cleanupAgentWorkspaceSlot,
  createAgentWorkspace,
  removeAgentWorkspace,
  type AgentWorkspace,
} from "../../modules/orchestration-ops/agent-workspace-manager/src/lib/workspace-manager"
import {
  admitStrategySourceAdoption,
  completeStrategySourceAdoption,
  failStrategySourceAdoption,
  readStrategySourceAdoption,
  startStrategySourceAdoption,
  type StrategySourceAdoptionFailureClass,
  type StrategySourceAdoptionRecord,
} from "../../modules/orchestration-ops/ops-runtime-store/src/lib/strategy-source-adoption-store"
import {
  assertStrategySourceCandidate,
  type StrategySourceCandidate,
} from "../../modules/research-strategy-development/research-control-plane/contracts/src/lib/strategy-source-candidate-contract"

export interface StrategySourceAdoptionManifest {
  schema_version: "trade.rd-strategy-source-adoption-manifest.v1"
  status: "candidate_certified"
  adoption_id: string
  source_candidate: {
    manifest_ref: string
    manifest_hash: string
    source_revision: string
    source_commit: string
    replay_build_artifact_hash: string
    replay_runtime_executable_hash: string
  }
  adopted_strategy: {
    ref: string
    sha256: string
    bytes: number
    source_candidate_ref: string
  }
  candidate_source_revision: string
  changed_files: string[]
  suite_checks: AgentWorkspaceSuiteCheck[]
  source_archive: {
    ref: string
    sha256: string
    bytes: number
  }
  review_policy: {
    exact_candidate_bytes: true
    repository_quality_required: true
    independent_replay_release_audit_required: true
    checks_must_not_mutate_candidate: true
  }
  safety: {
    production_checkout_modified: false
    main_branch_advanced: false
    runtime_hot_load: false
    deployment_authority: "none"
    trading_authority: false
  }
  certified_at: string
  manifest_hash: string
}

export async function runStrategySourceAdoption(input: {
  db: Database
  repository_root: string
  adoption_id: string
  release_root?: string
  workspace_slot?: string
  now?: () => Date
  run_suite_check(input: {
    workspace: AgentWorkspace
    suite: AgentWorkspaceSuite
    timeout_ms?: number
    max_output_bytes?: number
  }): Promise<AgentWorkspaceSuiteCheck>
}): Promise<StrategySourceAdoptionRecord & {
  manifest: StrategySourceAdoptionManifest
}> {
  const now = input.now ?? (() => new Date())
  const root = realpathSync(resolve(input.repository_root))
  const releaseRoot = resolveReleaseRoot(
    root,
    input.release_root ?? "data/release-candidates",
  )
  const current = readStrategySourceAdoption(input.db, input.adoption_id)
  if (!current) throw new StrategyAdoptionError(
    "validation_failed",
    "Strategy source adoption is not queued",
  )
  if (current.result) {
    return readCompleted(root, current)
  }
  startStrategySourceAdoption(
    input.db,
    current.adoption_id,
    now().toISOString(),
  )
  const source = loadCandidate(root, current)
  const persisted = findPersistedManifest(
    root,
    releaseRoot,
    current,
    source.manifest,
  )
  if (persisted) {
    const completed = completeStrategySourceAdoption(
      input.db,
      resultProjection(persisted),
    )
    return { ...completed, manifest: persisted }
  }

  let workspace: AgentWorkspace | null = null
  try {
    const slot = input.workspace_slot ?? "candidate"
    cleanupAgentWorkspaceSlot({
      repository_root: root,
      workspace_slot: slot,
    })
    workspace = createAgentWorkspace({
      repository_root: root,
      run_id: `strategy-${current.adoption_id}`,
      workspace_slot: slot,
      source_revision: source.manifest.source_provenance.source_revision,
      allowed_write_prefixes: ["strategies"],
      created_at: now().toISOString(),
    })
    const target = resolve(workspace.workspace_root, current.strategy_source_ref)
    assertInside(workspace.workspace_root, target)
    mkdirSync(dirname(target), { recursive: true, mode: 0o700 })
    if (existsSync(target)) {
      if (!lstatSync(target).isFile()
          || lstatSync(target).isSymbolicLink()
          || !readFileSync(target).equals(source.bytes)) {
        throw new StrategyAdoptionError(
          "validation_failed",
          "Adopted Strategy target already exists with different content",
        )
      }
    } else {
      writeFileSync(target, source.bytes, { flag: "wx", mode: 0o600 })
    }
    const lint = lintStrategyContract(target)
    if (!lint.valid) {
      throw new StrategyAdoptionError(
        "validation_failed",
        `Adopted Strategy contract failed lint: ${lint.errors.join("; ")}`,
      )
    }
    const beforeChecks = captureAgentWorkspacePatch(workspace)
    if (beforeChecks.changed_files.length > 1
        || (beforeChecks.changed_files.length === 1
          && beforeChecks.changed_files[0] !== current.strategy_source_ref)) {
      throw new StrategyAdoptionError(
        "validation_failed",
        "Strategy adoption changed files outside its exact source",
      )
    }
    const checks: AgentWorkspaceSuiteCheck[] = []
    for (const suite of [
      "repository_quality",
      "replay_independent_release_audit",
    ] as const) {
      const check = await input.run_suite_check({
        workspace,
        suite,
        timeout_ms: suite === "repository_quality" ? 7_200_000 : 1_200_000,
        max_output_bytes: 32 * 1024 * 1024,
      })
      assertSuiteCheck(check, suite)
      checks.push(structuredClone(check))
    }
    const afterChecks = captureAgentWorkspacePatch(workspace)
    if (beforeChecks.patch_sha256 !== afterChecks.patch_sha256
        || canonicalJson(beforeChecks.changed_files)
          !== canonicalJson(afterChecks.changed_files)) {
      throw new StrategyAdoptionError(
        "quality_failed",
        "Strategy adoption checks mutated the candidate source",
      )
    }
    const candidateRevision = beforeChecks.changed_files.length === 0
      ? workspace.source_commit
      : commitCandidate(
          workspace,
          source.manifest,
          beforeChecks.patch_sha256,
        )
    const manifest = persistCandidatePackage({
      root,
      release_root: releaseRoot,
      adoption: current,
      source_candidate: source.manifest,
      source_candidate_ref: repoRelative(root, source.source_path),
      source_commit: workspace.source_commit,
      candidate_source_revision: candidateRevision,
      changed_files: beforeChecks.changed_files,
      suite_checks: checks,
      workspace_root: workspace.workspace_root,
      certified_at: now().toISOString(),
    })
    const completed = completeStrategySourceAdoption(
      input.db,
      resultProjection(manifest),
    )
    return { ...completed, manifest }
  } catch (error) {
    const classified = classify(error)
    failStrategySourceAdoption(input.db, {
      adoption_id: current.adoption_id,
      status: classified.failure_class === "validation_failed"
        ? "rejected"
        : "failed",
      failure_class: classified.failure_class,
      failed_at: now().toISOString(),
    })
    throw classified
  } finally {
    if (workspace) {
      const head = gitText(workspace.workspace_root, ["rev-parse", "HEAD"]).trim()
      if (head !== workspace.source_commit) {
        git(workspace.workspace_root, ["reset", "--mixed", workspace.source_commit])
      }
      removeAgentWorkspace(workspace)
    }
  }
}

export function queueStrategySourceCandidate(input: {
  db: Database
  repository_root: string
  manifest_ref: string
  accepted_at?: string
}): StrategySourceAdoptionRecord {
  const root = realpathSync(resolve(input.repository_root))
  const manifestRef = repoPath(input.manifest_ref, "manifest_ref")
  const manifestPath = resolve(root, manifestRef)
  assertInside(resolve(root, "data", "release-candidates"), manifestPath)
  const manifest = readSourceCandidate(manifestPath)
  const strategyPath = resolve(dirname(manifestPath), manifest.strategy_source.ref)
  assertInside(dirname(manifestPath), strategyPath)
  assertCandidateBytes(strategyPath, manifest)
  const adoptionId = `strategy:${manifest.manifest_hash}`
  const existing = readStrategySourceAdoption(input.db, adoptionId)
  return admitStrategySourceAdoption(input.db, {
    adoption_id: adoptionId,
    source_candidate_manifest_ref: manifestRef,
    source_candidate_manifest_hash: manifest.manifest_hash,
    source_revision: manifest.source_provenance.source_revision,
    strategy_source_ref: manifest.strategy_source.ref,
    strategy_source_hash: manifest.strategy_source.sha256,
    accepted_at: existing?.accepted_at
      ?? canonicalTime(input.accepted_at ?? new Date().toISOString()),
  })
}

export function discoverAndQueueStrategySourceCandidates(input: {
  db: Database
  repository_root: string
  limit?: number
  observed_at?: string
}): StrategySourceAdoptionRecord[] {
  const root = realpathSync(resolve(input.repository_root))
  const candidateRoot = resolve(
    root,
    "data",
    "release-candidates",
    "strategy-drafts",
  )
  if (!existsSync(candidateRoot)) return []
  const rootStat = lstatSync(candidateRoot)
  if (!rootStat.isDirectory() || rootStat.isSymbolicLink()) {
    throw new StrategyAdoptionError(
      "validation_failed",
      "Strategy candidate discovery root is not a regular directory",
    )
  }
  const limit = input.limit ?? 100
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 1_000) {
    throw new StrategyAdoptionError(
      "validation_failed",
      "Strategy candidate discovery limit is invalid",
    )
  }
  const directories = readdirSync(candidateRoot, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && !entry.isSymbolicLink())
    .sort((left, right) => left.name.localeCompare(right.name))
  if (directories.length > 10_000) {
    throw new StrategyAdoptionError(
      "runtime_failed",
      "Strategy candidate discovery root exceeds its bounded scan",
    )
  }
  const records: StrategySourceAdoptionRecord[] = []
  let firstError: StrategyAdoptionError | null = null
  for (const entry of directories) {
    if (records.length >= limit) break
    try {
      const manifestPath = resolve(candidateRoot, entry.name, "candidate.json")
      if (!existsSync(manifestPath)) continue
      const stat = lstatSync(manifestPath)
      if (!stat.isFile() || stat.isSymbolicLink()) {
        throw new StrategyAdoptionError(
          "validation_failed",
          "Discovered Strategy candidate manifest is not a regular file",
        )
      }
      records.push(queueStrategySourceCandidate({
        db: input.db,
        repository_root: root,
        manifest_ref: repoRelative(root, manifestPath),
        accepted_at: input.observed_at,
      }))
    } catch (error) {
      if (!firstError) firstError = classify(error)
    }
  }
  if (firstError) throw firstError
  return records
}

function loadCandidate(
  root: string,
  adoption: StrategySourceAdoptionRecord,
): {
  manifest: StrategySourceCandidate
  source_path: string
  bytes: Buffer
} {
  const path = resolve(root, adoption.source_candidate_manifest_ref)
  assertInside(resolve(root, "data", "release-candidates"), path)
  const manifest = readSourceCandidate(path)
  if (manifest.manifest_hash !== adoption.source_candidate_manifest_hash
      || manifest.source_provenance.source_revision
        !== adoption.source_revision
      || manifest.strategy_source.ref !== adoption.strategy_source_ref
      || manifest.strategy_source.sha256 !== adoption.strategy_source_hash) {
    throw new StrategyAdoptionError(
      "validation_failed",
      "Queued Strategy source candidate identity drifted",
    )
  }
  const sourcePath = resolve(dirname(path), manifest.strategy_source.ref)
  assertInside(dirname(path), sourcePath)
  assertCandidateBytes(sourcePath, manifest)
  return {
    manifest,
    source_path: sourcePath,
    bytes: readFileSync(sourcePath),
  }
}

function readSourceCandidate(path: string): StrategySourceCandidate {
  if (!existsSync(path) || !lstatSync(path).isFile()
      || lstatSync(path).isSymbolicLink()) {
    throw new StrategyAdoptionError(
      "validation_failed",
      "Strategy source candidate manifest is not a regular file",
    )
  }
  const manifest = JSON.parse(
    readFileSync(path, "utf8"),
  ) as StrategySourceCandidate
  try {
    assertStrategySourceCandidate(manifest)
  } catch (error) {
    throw new StrategyAdoptionError(
      "validation_failed",
      error instanceof Error ? error.message : String(error),
    )
  }
  return manifest
}

function assertCandidateBytes(
  path: string,
  manifest: StrategySourceCandidate,
): void {
  if (!existsSync(path) || !lstatSync(path).isFile()
      || lstatSync(path).isSymbolicLink()) {
    throw new StrategyAdoptionError(
      "validation_failed",
      "Strategy source candidate is not a regular file",
    )
  }
  const bytes = readFileSync(path)
  if (bytes.byteLength !== manifest.strategy_source.bytes
      || sha256(bytes) !== manifest.strategy_source.sha256) {
    throw new StrategyAdoptionError(
      "validation_failed",
      "Strategy source candidate bytes drifted",
    )
  }
}

function commitCandidate(
  workspace: AgentWorkspace,
  source: StrategySourceCandidate,
  patchHash: string,
): string {
  git(workspace.workspace_root, ["add", "-A"])
  git(workspace.workspace_root, ["diff", "--cached", "--check"])
  const environment = {
    ...process.env,
    GIT_AUTHOR_NAME: "Trade R&D Strategy Candidate",
    GIT_AUTHOR_EMAIL: "rd-strategy-candidate@example.invalid",
    GIT_COMMITTER_NAME: "Trade R&D Strategy Candidate",
    GIT_COMMITTER_EMAIL: "rd-strategy-candidate@example.invalid",
    GIT_AUTHOR_DATE: source.created_at,
    GIT_COMMITTER_DATE: source.created_at,
  }
  git(workspace.workspace_root, [
    "-c",
    "commit.gpgsign=false",
    "-c",
    "core.hooksPath=/dev/null",
    "commit",
    "--no-verify",
    "--no-gpg-sign",
    "-m",
    `rd-strategy-candidate:${source.decision.decision_id}:${patchHash.slice(0, 12)}`,
  ], environment)
  const revision = gitText(workspace.workspace_root, ["rev-parse", "HEAD"]).trim()
  if (!/^[a-f0-9]{40,64}$/.test(revision)
      || gitText(workspace.workspace_root, ["rev-parse", "HEAD^"]).trim()
        !== workspace.source_commit
      || gitText(workspace.workspace_root, ["status", "--porcelain"]).trim()) {
    throw new StrategyAdoptionError(
      "runtime_failed",
      "Strategy candidate commit identity or cleanliness is invalid",
    )
  }
  return revision
}

function persistCandidatePackage(input: {
  root: string
  release_root: string
  adoption: StrategySourceAdoptionRecord
  source_candidate: StrategySourceCandidate
  source_candidate_ref: string
  source_commit: string
  candidate_source_revision: string
  changed_files: string[]
  suite_checks: AgentWorkspaceSuiteCheck[]
  workspace_root: string
  certified_at: string
}): StrategySourceAdoptionManifest {
  const target = resolve(
    input.release_root,
    "strategy-adoptions",
    input.source_candidate.manifest_hash,
  )
  assertInside(input.release_root, target)
  const partial = `${target}.partial-${process.pid}`
  if (existsSync(partial)) rmSync(partial, { recursive: true, force: true })
  mkdirSync(dirname(target), { recursive: true, mode: 0o700 })
  mkdirSync(partial, { recursive: false, mode: 0o700 })
  try {
    const archivePath = resolve(partial, "source.tar")
    git(input.workspace_root, [
      "archive",
      "--format=tar",
      `--output=${archivePath}`,
      input.candidate_source_revision,
    ])
    const archive = {
      ref: repoRelative(input.root, resolve(target, "source.tar")),
      sha256: fileHash(archivePath),
      bytes: statSync(archivePath).size,
    }
    const body = {
      schema_version: "trade.rd-strategy-source-adoption-manifest.v1" as const,
      status: "candidate_certified" as const,
      adoption_id: input.adoption.adoption_id,
      source_candidate: {
        manifest_ref: input.adoption.source_candidate_manifest_ref,
        manifest_hash: input.source_candidate.manifest_hash,
        source_revision: input.source_candidate.source_provenance.source_revision,
        source_commit: input.source_commit,
        replay_build_artifact_hash: input.source_candidate.replay_code_evidence
          .decision_harness_build_artifact_hash,
        replay_runtime_executable_hash: input.source_candidate
          .replay_code_evidence.decision_harness_runtime_executable_hash,
      },
      adopted_strategy: {
        ref: input.source_candidate.strategy_source.ref,
        sha256: input.source_candidate.strategy_source.sha256,
        bytes: input.source_candidate.strategy_source.bytes,
        source_candidate_ref: input.source_candidate_ref,
      },
      candidate_source_revision: input.candidate_source_revision,
      changed_files: [...input.changed_files].sort(),
      suite_checks: structuredClone(input.suite_checks),
      source_archive: archive,
      review_policy: {
        exact_candidate_bytes: true as const,
        repository_quality_required: true as const,
        independent_replay_release_audit_required: true as const,
        checks_must_not_mutate_candidate: true as const,
      },
      safety: {
        production_checkout_modified: false as const,
        main_branch_advanced: false as const,
        runtime_hot_load: false as const,
        deployment_authority: "none" as const,
        trading_authority: false as const,
      },
      certified_at: canonicalTime(input.certified_at),
    }
    const manifest: StrategySourceAdoptionManifest = {
      ...body,
      manifest_hash: canonicalHash(body),
    }
    writeFileSync(
      resolve(partial, "manifest.json"),
      `${canonicalJson(manifest)}\n`,
      { flag: "wx", mode: 0o600 },
    )
    if (existsSync(target)) {
      const existing = readCertifiedManifest(resolve(target, "manifest.json"))
      assertCertifiedPackage(input.root, existing)
      rmSync(partial, { recursive: true, force: true })
      if (canonicalJson(existing) !== canonicalJson(manifest)) {
        throw new StrategyAdoptionError(
          "validation_failed",
          "Persisted Strategy adoption manifest identity drifted",
        )
      }
      return existing
    }
    renameSync(partial, target)
    return manifest
  } catch (error) {
    if (existsSync(partial)) rmSync(partial, { recursive: true, force: true })
    throw error
  }
}

function findPersistedManifest(
  root: string,
  releaseRoot: string,
  adoption: StrategySourceAdoptionRecord,
  source: StrategySourceCandidate,
): StrategySourceAdoptionManifest | null {
  const path = resolve(
    releaseRoot,
    "strategy-adoptions",
    source.manifest_hash,
    "manifest.json",
  )
  if (!existsSync(path)) return null
  const manifest = readCertifiedManifest(path)
  assertCertifiedPackage(root, manifest)
  if (manifest.adoption_id !== adoption.adoption_id
      || manifest.source_candidate.manifest_hash !== source.manifest_hash) {
    throw new StrategyAdoptionError(
      "validation_failed",
      "Persisted Strategy adoption manifest identity drifted",
    )
  }
  return manifest
}

function readCompleted(
  root: string,
  record: StrategySourceAdoptionRecord,
): StrategySourceAdoptionRecord & { manifest: StrategySourceAdoptionManifest } {
  const result = record.result!
  const path = resolve(root, result.certified_manifest_ref)
  assertInside(root, path)
  const manifest = readCertifiedManifest(path)
  assertCertifiedPackage(root, manifest)
  if (canonicalJson(resultProjection(manifest)) !== canonicalJson(result)) {
    throw new StrategyAdoptionError(
      "validation_failed",
      "Completed Strategy adoption manifest drifted from Ops result",
    )
  }
  return { ...record, manifest }
}

function readCertifiedManifest(path: string): StrategySourceAdoptionManifest {
  return JSON.parse(readFileSync(path, "utf8")) as StrategySourceAdoptionManifest
}

function assertCertifiedPackage(
  root: string,
  manifest: StrategySourceAdoptionManifest,
): void {
  if (!manifest
      || manifest.schema_version
        !== "trade.rd-strategy-source-adoption-manifest.v1"
      || manifest.status !== "candidate_certified"
      || manifest.safety?.production_checkout_modified !== false
      || manifest.safety?.main_branch_advanced !== false
      || manifest.safety?.runtime_hot_load !== false
      || manifest.safety?.deployment_authority !== "none"
      || manifest.safety?.trading_authority !== false
      || manifest.review_policy?.exact_candidate_bytes !== true
      || manifest.review_policy?.repository_quality_required !== true
      || manifest.review_policy
        ?.independent_replay_release_audit_required !== true
      || manifest.review_policy?.checks_must_not_mutate_candidate !== true) {
    throw new StrategyAdoptionError(
      "validation_failed",
      "Certified Strategy adoption manifest is unsupported",
    )
  }
  const { manifest_hash: _hash, ...body } = manifest
  if (canonicalHash(body) !== manifest.manifest_hash) {
    throw new StrategyAdoptionError(
      "validation_failed",
      "Certified Strategy adoption manifest hash drifted",
    )
  }
  if (manifest.suite_checks.length !== 2
      || manifest.suite_checks[0]?.suite !== "repository_quality"
      || manifest.suite_checks[1]?.suite
        !== "replay_independent_release_audit") {
    throw new StrategyAdoptionError(
      "validation_failed",
      "Certified Strategy adoption checks are incomplete",
    )
  }
  manifest.suite_checks.forEach((check) => assertSuiteCheck(check, check.suite))
  const archivePath = resolve(root, manifest.source_archive.ref)
  assertInside(root, archivePath)
  if (!existsSync(archivePath)
      || statSync(archivePath).size !== manifest.source_archive.bytes
      || fileHash(archivePath) !== manifest.source_archive.sha256) {
    throw new StrategyAdoptionError(
      "validation_failed",
      "Certified Strategy source archive drifted",
    )
  }
}

function resultProjection(
  manifest: StrategySourceAdoptionManifest,
) {
  const manifestRef = manifest.source_archive.ref.replace(
    /source\.tar$/,
    "manifest.json",
  )
  return {
    schema_version: "trade.strategy-source-adoption-result.v1" as const,
    adoption_id: manifest.adoption_id,
    source_candidate_manifest_hash: manifest.source_candidate.manifest_hash,
    base_source_revision: manifest.source_candidate.source_revision,
    base_source_commit: manifest.source_candidate.source_commit,
    candidate_source_revision: manifest.candidate_source_revision,
    adopted_strategy_ref: manifest.adopted_strategy.ref,
    certified_manifest_ref: manifestRef,
    certified_manifest_hash: manifest.manifest_hash,
    source_archive_ref: manifest.source_archive.ref,
    source_archive_hash: manifest.source_archive.sha256,
    certified_at: manifest.certified_at,
    deployment_authority: "none" as const,
    trading_authority: false as const,
  }
}

function assertSuiteCheck(
  value: AgentWorkspaceSuiteCheck,
  suite: AgentWorkspaceSuite,
): void {
  if (value.schema_version !== "trade.agent-workspace-suite-check.v1"
      || value.suite !== suite
      || value.exit_code !== 0
      || value.timed_out
      || !/^[a-f0-9]{64}$/.test(value.output_sha256)
      || !Number.isSafeInteger(value.output_bytes)
      || value.output_bytes < 0
      || value.output_bytes > 32 * 1024 * 1024) {
    throw new StrategyAdoptionError(
      suite === "repository_quality"
        ? "quality_failed"
        : "replay_audit_failed",
      `Strategy candidate suite check failed: ${suite}`,
    )
  }
}

function resolveReleaseRoot(root: string, value: string): string {
  const releaseRoot = resolve(root, value)
  const base = resolve(root, "data", "release-candidates")
  if (releaseRoot !== base && !releaseRoot.startsWith(`${base}${sep}`)) {
    throw new StrategyAdoptionError(
      "validation_failed",
      "Strategy adoption release root escaped release candidates",
    )
  }
  mkdirSync(releaseRoot, { recursive: true, mode: 0o700 })
  return releaseRoot
}

function repoRelative(root: string, path: string): string {
  assertInside(root, path)
  const value = path.slice(root.length + 1).split(sep).join("/")
  return repoPath(value, "repository relative path")
}

function repoPath(value: unknown, field: string): string {
  if (typeof value !== "string" || !value || value.startsWith("/")
      || value.includes("\0") || value.split("/").includes("..")) {
    throw new StrategyAdoptionError(
      "validation_failed",
      `${field} is invalid`,
    )
  }
  return value
}

function assertInside(root: string, path: string): void {
  const resolvedRoot = resolve(root)
  const resolvedPath = resolve(path)
  if (resolvedPath === resolvedRoot
      || !resolvedPath.startsWith(`${resolvedRoot}${sep}`)) {
    throw new StrategyAdoptionError(
      "validation_failed",
      "Strategy adoption path escaped its owner root",
    )
  }
}

function canonicalTime(value: string): string {
  const date = new Date(value)
  if (!Number.isFinite(date.getTime()) || date.toISOString() !== value) {
    throw new StrategyAdoptionError(
      "validation_failed",
      "Strategy adoption timestamp must be canonical UTC",
    )
  }
  return value
}

function fileHash(path: string): string {
  return sha256(readFileSync(path))
}

function sha256(value: Buffer | string): string {
  return createHash("sha256").update(value).digest("hex")
}

function git(
  cwd: string,
  args: string[],
  env: NodeJS.ProcessEnv = process.env,
): void {
  const result = spawnSync("git", args, {
    cwd,
    env,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  })
  if (result.status !== 0) {
    throw new StrategyAdoptionError(
      "runtime_failed",
      `git ${args[0]} failed`,
    )
  }
}

function gitText(cwd: string, args: string[]): string {
  const result = spawnSync("git", args, {
    cwd,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  })
  if (result.status !== 0) {
    throw new StrategyAdoptionError(
      "runtime_failed",
      `git ${args[0]} failed`,
    )
  }
  return result.stdout
}

function classify(error: unknown): StrategyAdoptionError {
  if (error instanceof StrategyAdoptionError) return error
  return new StrategyAdoptionError(
    "runtime_failed",
    error instanceof Error ? error.message : String(error),
  )
}

export class StrategyAdoptionError extends Error {
  constructor(
    readonly failure_class: StrategySourceAdoptionFailureClass,
    message: string,
  ) {
    super(message)
    this.name = "StrategyAdoptionError"
  }
}
