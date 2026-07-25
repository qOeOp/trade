import { createHash } from "node:crypto"
import {
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  realpathSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs"
import { relative, resolve, sep } from "node:path"
import type { Database } from "bun:sqlite"
import type {
  AgentArtifactRef,
  AgentRunRequest,
} from "../../modules/contracts/agent-run-contract/src/agent-run-contract"
import {
  canonicalHash,
  canonicalJson,
} from "../../modules/contracts/runtime-core/src/canonical-json"
import {
  parseAgentJsonArtifact,
  readAgentArtifact,
} from "../../modules/orchestration-ops/agent-artifact-store/src/lib/agent-artifact-store"
import type {
  AgentWorkspaceSuite,
  AgentWorkspaceSuiteCheck,
} from "../../modules/orchestration-ops/agent-workspace-manager/src/lib/isolated-package-checker"
import {
  assertAgentWorkspaceExecutionScope,
  captureAgentWorkspacePatch,
  cleanupAgentWorkspaceSlot,
  createAgentWorkspace,
  removeAgentWorkspace,
  seedAgentWorkspacePatch,
  type AgentWorkspace,
  type AgentWorkspaceExecutionScope,
  type AgentWorkspacePackageCheck,
} from "../../modules/orchestration-ops/agent-workspace-manager/src/lib/workspace-manager"
import {
  admitAgentPatchAdoption,
  completeAgentPatchAdoption,
  failAgentPatchAdoption,
  readAgentPatchAdoption,
  startAgentPatchAdoption,
  type AgentPatchAdoptionFailureClass,
  type AgentPatchAdoptionResultProjection,
} from "../../modules/orchestration-ops/ops-runtime-store/src/lib/agent-patch-adoption-store"
import {
  readAgentRun,
} from "../../modules/orchestration-ops/ops-runtime-store/src/lib/agent-run-store"
import {
  readAgentWorkspaceExecutionScope,
} from "../../modules/orchestration-ops/ops-runtime-store/src/lib/agent-workspace-scope-store"
import {
  assertDeveloperAgentSubmission,
  type DeveloperAgentSubmission,
} from "../../modules/research-strategy-development/research-control-plane/contracts/src/lib/developer-agent-submission"

export interface DeveloperPatchAdoptionManifest {
  schema_version: "trade.rd-developer-patch-adoption-manifest.v1"
  status: "candidate_certified"
  adoption_id: string
  run_id: string
  request_hash: string
  scope_hash: string
  base_source_revision: string
  base_source_commit: string
  candidate_source_revision: string
  patch: AgentArtifactRef
  changed_files: string[]
  prior_quality_check_refs: AgentArtifactRef[]
  candidate_package_checks: AgentWorkspacePackageCheck[]
  suite_checks: AgentWorkspaceSuiteCheck[]
  source_archive: {
    ref: string
    sha256: string
    bytes: number
  }
  review_policy: {
    exact_cumulative_patch: true
    dependency_manifest_changes: false
    binary_or_special_file_changes: false
    repository_quality_required: true
    independent_replay_release_audit_required: true
  }
  safety: {
    production_checkout_modified: false
    main_branch_advanced: false
    deployment_authority: "none"
    trading_authority: false
  }
  certified_at: string
  manifest_sha256: string
}

export interface DeveloperPatchAdoptionResult
  extends AgentPatchAdoptionResultProjection {
  manifest: DeveloperPatchAdoptionManifest
}

export function readCertifiedDeveloperPatchAdoption(
  repositoryRoot: string,
  result: AgentPatchAdoptionResultProjection,
): DeveloperPatchAdoptionResult {
  const root = realpathSync(resolve(repositoryRoot))
  return readCompletedAdoption(root, result)
}

export async function runDeveloperPatchAdoption(input: {
  db: Database
  repository_root: string
  release_root?: string
  adoption_id: string
  run_id: string
  workspace_slot?: string
  now?: () => Date
  run_package_check(input: {
    workspace: AgentWorkspace
    package_path: string
    timeout_ms?: number
    max_output_bytes?: number
  }): Promise<AgentWorkspacePackageCheck>
  run_suite_check(input: {
    workspace: AgentWorkspace
    suite: AgentWorkspaceSuite
    timeout_ms?: number
    max_output_bytes?: number
  }): Promise<AgentWorkspaceSuiteCheck>
}): Promise<DeveloperPatchAdoptionResult> {
  const now = input.now ?? (() => new Date())
  const root = realpathSync(resolve(input.repository_root))
  const releaseRoot = resolveReleaseRoot(
    root,
    input.release_root ?? "data/release-candidates",
  )
  const existing = readAgentPatchAdoption(input.db, input.adoption_id)
  let evidence: ReturnType<typeof loadAdoptionEvidence>
  try {
    evidence = loadAdoptionEvidence(input.db, root, input.run_id)
  } catch (error) {
    const classified = classifyAdoptionError(error)
    if (existing && !existing.result) {
      failAgentPatchAdoption(input.db, {
        adoption_id: existing.adoption_id,
        status: classified.failure_class === "validation_failed"
          ? "rejected"
          : "failed",
        failure_class: classified.failure_class,
        failed_at: now().toISOString(),
      })
    }
    throw classified
  }
  const accepted = admitAgentPatchAdoption(input.db, {
    adoption_id: input.adoption_id,
    run_id: evidence.request.run_id,
    request_hash: evidence.request.request_hash,
    scope_hash: evidence.scope_hash,
    patch: evidence.submission.workspace_patch!,
    accepted_at: existing?.accepted_at ?? now().toISOString(),
  })
  if (accepted.result) {
    return readCompletedAdoption(root, accepted.result)
  }
  startAgentPatchAdoption(input.db, accepted.adoption_id, now().toISOString())
  const resumed = findPersistedManifest(
    root,
    releaseRoot,
    accepted.adoption_id,
    evidence,
  )
  if (resumed) {
    const projection = completeAgentPatchAdoption(
      input.db,
      resultProjection(resumed, root),
    ).result!
    return { ...projection, manifest: resumed }
  }

  const workspaceSlot = input.workspace_slot ?? "candidate"
  let workspace: AgentWorkspace | null = null
  try {
    cleanupAgentWorkspaceSlot({
      repository_root: root,
      workspace_slot: workspaceSlot,
    })
    workspace = createAgentWorkspace({
      repository_root: root,
      run_id: `adopt-${accepted.adoption_id}`,
      workspace_slot: workspaceSlot,
      source_revision: evidence.request.source_revision,
      allowed_write_prefixes: evidence.allowed_write_prefixes,
      created_at: now().toISOString(),
    })
    const patchText = readAgentArtifact(
      root,
      evidence.submission.workspace_patch!,
    ).text
    assertPatchReviewable(patchText)
    const applied = seedAgentWorkspacePatch({
      workspace,
      artifact: evidence.submission.workspace_patch!,
      patch_text: patchText,
    })
    assertChangedFilesReviewable(workspace, applied.changed_files)
    assertPriorQualityEvidence(evidence, workspace.source_commit, root)

    const packageChecks: AgentWorkspacePackageCheck[] = []
    for (const packagePath of evidence.package_paths) {
      const check = await input.run_package_check({
        workspace,
        package_path: packagePath,
        timeout_ms: 600_000,
        max_output_bytes: 8 * 1024 * 1024,
      })
      assertPackageCheck(check, packagePath)
      packageChecks.push(structuredClone(check))
    }
    const suiteChecks: AgentWorkspaceSuiteCheck[] = []
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
      suiteChecks.push(structuredClone(check))
    }
    const afterChecks = captureAgentWorkspacePatch(workspace)
    if (afterChecks.patch_sha256 !== applied.patch_sha256
      || canonicalJson(afterChecks.changed_files)
        !== canonicalJson(applied.changed_files)) {
      throw new AdoptionError(
        "quality_failed",
        "Candidate checks mutated the reviewed patch",
      )
    }
    const candidateRevision = commitCandidate(
      workspace,
      evidence.request,
      evidence.submission.workspace_patch!,
      evidence.result_finished_at,
    )
    const manifest = persistCandidatePackage({
      root,
      release_root: releaseRoot,
      adoption_id: accepted.adoption_id,
      request: evidence.request,
      scope_hash: evidence.scope_hash,
      base_source_commit: workspace.source_commit,
      candidate_source_revision: candidateRevision,
      patch: evidence.submission.workspace_patch!,
      changed_files: applied.changed_files,
      prior_quality_check_refs: evidence.submission.quality_check_refs,
      candidate_package_checks: packageChecks,
      suite_checks: suiteChecks,
      workspace_root: workspace.workspace_root,
      certified_at: now().toISOString(),
    })
    const projection = completeAgentPatchAdoption(
      input.db,
      resultProjection(manifest, root),
    ).result!
    return { ...projection, manifest }
  } catch (error) {
    const classified = classifyAdoptionError(error)
    failAgentPatchAdoption(input.db, {
      adoption_id: accepted.adoption_id,
      status: classified.failure_class === "validation_failed"
        ? "rejected"
        : "failed",
      failure_class: classified.failure_class,
      failed_at: now().toISOString(),
    })
    throw classified
  } finally {
    if (workspace) {
      const currentHead = gitText(
        workspace.workspace_root,
        ["rev-parse", "HEAD"],
      ).trim()
      if (currentHead !== workspace.source_commit) {
        git(
          workspace.workspace_root,
          ["reset", "--mixed", workspace.source_commit],
        )
      }
      removeAgentWorkspace(workspace)
    }
  }
}

function loadAdoptionEvidence(
  db: Database,
  root: string,
  runId: string,
): {
  request: AgentRunRequest
  result_finished_at: string
  scope_hash: string
  allowed_write_prefixes: string[]
  package_paths: string[]
  submission: DeveloperAgentSubmission
} {
  const run = readAgentRun(db, runId)
  if (!run?.result || run.result.status !== "completed"
    || run.request.task_profile !== "developer"
    || run.host_profile !== "openclaw-workspace-gateway") {
    throw new AdoptionError(
      "validation_failed",
      "Patch adoption requires one completed workspace Developer Run",
    )
  }
  const storedScope = readAgentWorkspaceExecutionScope(db, runId)
  if (!storedScope) {
    throw new AdoptionError(
      "validation_failed",
      "Patch adoption scope is missing",
    )
  }
  const scope = storedScope.scope as unknown as AgentWorkspaceExecutionScope
  try {
    assertAgentWorkspaceExecutionScope(scope)
  } catch {
    throw new AdoptionError(
      "validation_failed",
      "Patch adoption scope is invalid",
    )
  }
  if (storedScope.request_hash !== run.request.request_hash
    || scope.source_revision !== run.request.source_revision) {
    throw new AdoptionError(
      "validation_failed",
      "Patch adoption scope drifted",
    )
  }
  const jsonRefs = run.result.output_refs.filter(
    (ref) => ref.media_type === "application/json",
  )
  const submissions: DeveloperAgentSubmission[] = []
  for (const ref of jsonRefs) {
    const value = parseAgentJsonArtifact(root, ref)
    if ((value as { schema_version?: unknown })?.schema_version
      === "trade.rd-developer-agent-submission.v1") {
      assertDeveloperAgentSubmission(value as DeveloperAgentSubmission)
      submissions.push(value as DeveloperAgentSubmission)
    }
  }
  if (submissions.length !== 1) {
    throw new AdoptionError(
      "validation_failed",
      "Patch adoption requires one exact Developer submission",
    )
  }
  const submission = submissions[0]!
  if (submission.developer_run_id !== run.request.run_id
    || submission.source_revision !== run.request.source_revision
    || submission.capability_assessment.implementation_mode
      !== "code_change_required"
    || !submission.workspace_patch
    || submission.quality_check_refs.length !== scope.package_paths.length) {
    throw new AdoptionError(
      "validation_failed",
      "Developer patch submission drifted from its Run or scope",
    )
  }
  const outputIdentities = new Set(
    run.result.output_refs.map((ref) => artifactIdentity(ref)),
  )
  for (const ref of [
    submission.workspace_patch,
    ...submission.quality_check_refs,
  ]) {
    if (!outputIdentities.has(artifactIdentity(ref))) {
      throw new AdoptionError(
        "validation_failed",
        "Developer patch evidence is absent from the terminal Result",
      )
    }
  }
  return {
    request: run.request,
    result_finished_at: run.result.finished_at,
    scope_hash: storedScope.scope_hash,
    allowed_write_prefixes: scope.allowed_write_prefixes,
    package_paths: scope.package_paths,
    submission,
  }
}

function assertPriorQualityEvidence(
  evidence: ReturnType<typeof loadAdoptionEvidence>,
  sourceCommit: string,
  root: string,
): void {
  const packages = evidence.submission.quality_check_refs.map((ref) => {
    const value = parseAgentJsonArtifact(root, ref) as Record<string, unknown>
    if (value.schema_version !== "trade.agent-workspace-quality-evidence.v1"
      || value.run_id !== evidence.request.run_id
      || value.source_commit !== sourceCommit
      || value.patch_sha256 !== evidence.submission.workspace_patch!.sha256
      || value.exit_code !== 0
      || value.timed_out !== false
      || value.domain_authority !== "none"
      || typeof value.package_path !== "string") {
      throw new AdoptionError(
        "validation_failed",
        "Prior workspace quality evidence is invalid",
      )
    }
    return value.package_path
  }).sort()
  if (canonicalJson(packages) !== canonicalJson(evidence.package_paths)) {
    throw new AdoptionError(
      "validation_failed",
      "Prior workspace quality coverage drifted from scope",
    )
  }
}

function assertPatchReviewable(patch: string): void {
  if (!patch || patch.includes("\0")
    || /(?:^|\n)(?:GIT binary patch|Binary files )/.test(patch)
    || /(?:^|\n)(?:new file mode|old mode|new mode) 160000/.test(patch)
    || /(?:^|\n)(?:new file mode|old mode|new mode) 120000/.test(patch)) {
    throw new AdoptionError(
      "validation_failed",
      "Candidate patch contains binary or special-file changes",
    )
  }
}

function assertChangedFilesReviewable(
  workspace: AgentWorkspace,
  changedFiles: string[],
): void {
  const dependencyFile = changedFiles.find((path) =>
    /(?:^|\/)(?:package\.json|bun\.lock|go\.(?:mod|sum)|Cargo\.(?:toml|lock)|requirements[^/]*\.txt)$/
      .test(path))
  if (dependencyFile) {
    throw new AdoptionError(
      "validation_failed",
      `Candidate patch changes a dependency manifest: ${dependencyFile}`,
    )
  }
  const trackedModes = gitText(
    workspace.workspace_root,
    ["ls-files", "-s", "--", ...changedFiles],
  ).trim().split(/\r?\n/).filter(Boolean)
  for (const line of trackedModes) {
    const mode = line.split(/\s+/, 1)[0]
    if (mode !== "100644" && mode !== "100755") {
      throw new AdoptionError(
        "validation_failed",
        "Candidate patch contains a special Git file mode",
      )
    }
  }
}

function assertPackageCheck(
  value: AgentWorkspacePackageCheck,
  packagePath: string,
): void {
  if (value.schema_version !== "trade.agent-workspace-check.v1"
    || value.package_path !== packagePath
    || value.exit_code !== 0
    || value.timed_out
    || !/^[a-f0-9]{64}$/.test(value.output_sha256)
    || !Number.isSafeInteger(value.output_bytes)
    || value.output_bytes < 0
    || value.output_bytes > 8 * 1024 * 1024) {
    throw new AdoptionError(
      "quality_failed",
      `Candidate package check failed: ${packagePath}`,
    )
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
    throw new AdoptionError(
      suite === "repository_quality"
        ? "quality_failed"
        : "replay_audit_failed",
      `Candidate suite check failed: ${suite}`,
    )
  }
}

function commitCandidate(
  workspace: AgentWorkspace,
  request: AgentRunRequest,
  patch: AgentArtifactRef,
  committedAt: string,
): string {
  git(workspace.workspace_root, ["add", "-A"])
  git(workspace.workspace_root, ["diff", "--cached", "--check"])
  const environment = {
    ...process.env,
    GIT_AUTHOR_NAME: "Trade R&D Candidate",
    GIT_AUTHOR_EMAIL: "rd-candidate@example.invalid",
    GIT_COMMITTER_NAME: "Trade R&D Candidate",
    GIT_COMMITTER_EMAIL: "rd-candidate@example.invalid",
    GIT_AUTHOR_DATE: committedAt,
    GIT_COMMITTER_DATE: committedAt,
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
    `rd-candidate:${request.run_id}:${patch.sha256.slice(0, 12)}`,
  ], environment)
  const revision = gitText(workspace.workspace_root, ["rev-parse", "HEAD"]).trim()
  if (!/^[a-f0-9]{40,64}$/.test(revision)
    || gitText(workspace.workspace_root, ["rev-parse", "HEAD^"]).trim()
      !== workspace.source_commit
    || gitText(workspace.workspace_root, ["status", "--porcelain"]).trim()) {
    throw new AdoptionError(
      "runtime_failed",
      "Candidate commit identity or cleanliness is invalid",
    )
  }
  return revision
}

function persistCandidatePackage(input: {
  root: string
  release_root: string
  adoption_id: string
  request: AgentRunRequest
  scope_hash: string
  base_source_commit: string
  candidate_source_revision: string
  patch: AgentArtifactRef
  changed_files: string[]
  prior_quality_check_refs: AgentArtifactRef[]
  candidate_package_checks: AgentWorkspacePackageCheck[]
  suite_checks: AgentWorkspaceSuiteCheck[]
  workspace_root: string
  certified_at: string
}): DeveloperPatchAdoptionManifest {
  const target = adoptionPackageRoot(input.release_root, input.adoption_id)
  const partial = `${target}.partial-${process.pid}`
  if (existsSync(partial)) rmSync(partial, { recursive: true, force: true })
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
      schema_version: "trade.rd-developer-patch-adoption-manifest.v1" as const,
      status: "candidate_certified" as const,
      adoption_id: input.adoption_id,
      run_id: input.request.run_id,
      request_hash: input.request.request_hash,
      scope_hash: input.scope_hash,
      base_source_revision: input.request.source_revision,
      base_source_commit: input.base_source_commit,
      candidate_source_revision: input.candidate_source_revision,
      patch: structuredClone(input.patch),
      changed_files: [...input.changed_files],
      prior_quality_check_refs: structuredClone(input.prior_quality_check_refs),
      candidate_package_checks: structuredClone(input.candidate_package_checks),
      suite_checks: structuredClone(input.suite_checks),
      source_archive: archive,
      review_policy: {
        exact_cumulative_patch: true as const,
        dependency_manifest_changes: false as const,
        binary_or_special_file_changes: false as const,
        repository_quality_required: true as const,
        independent_replay_release_audit_required: true as const,
      },
      safety: {
        production_checkout_modified: false as const,
        main_branch_advanced: false as const,
        deployment_authority: "none" as const,
        trading_authority: false as const,
      },
      certified_at: canonicalTime(input.certified_at),
    }
    const manifest: DeveloperPatchAdoptionManifest = {
      ...body,
      manifest_sha256: canonicalHash(body),
    }
    writeFileSync(
      resolve(partial, "manifest.json"),
      `${canonicalJson(manifest)}\n`,
      { flag: "wx", mode: 0o600 },
    )
    if (existsSync(target)) {
      const existing = readManifest(resolve(target, "manifest.json"))
      assertManifestPackage(input.root, existing)
      rmSync(partial, { recursive: true, force: true })
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
  adoptionId: string,
  evidence: ReturnType<typeof loadAdoptionEvidence>,
): DeveloperPatchAdoptionManifest | null {
  const path = resolve(adoptionPackageRoot(releaseRoot, adoptionId), "manifest.json")
  if (!existsSync(path)) return null
  const manifest = readManifest(path)
  assertManifestPackage(root, manifest)
  if (manifest.adoption_id !== adoptionId
    || manifest.run_id !== evidence.request.run_id
    || manifest.request_hash !== evidence.request.request_hash
    || manifest.scope_hash !== evidence.scope_hash
    || artifactIdentity(manifest.patch)
      !== artifactIdentity(evidence.submission.workspace_patch!)) {
    throw new AdoptionError(
      "validation_failed",
      "Persisted candidate manifest identity drifted",
    )
  }
  return manifest
}

function readCompletedAdoption(
  root: string,
  result: AgentPatchAdoptionResultProjection,
): DeveloperPatchAdoptionResult {
  const path = resolve(root, result.manifest_ref)
  assertInside(root, path)
  const manifest = readManifest(path)
  assertManifestPackage(root, manifest)
  const expected = resultProjection(manifest, root)
  if (canonicalJson(result) !== canonicalJson(expected)) {
    throw new AdoptionError(
      "validation_failed",
      "Completed candidate manifest drifted from Ops result",
    )
  }
  return { ...result, manifest }
}

function readManifest(path: string): DeveloperPatchAdoptionManifest {
  return JSON.parse(readFileSync(path, "utf8")) as DeveloperPatchAdoptionManifest
}

function assertManifestPackage(
  root: string,
  manifest: DeveloperPatchAdoptionManifest,
): void {
  if (!manifest
    || manifest.schema_version
      !== "trade.rd-developer-patch-adoption-manifest.v1"
    || manifest.status !== "candidate_certified"
    || !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,159}$/.test(manifest.adoption_id)
    || !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,159}$/.test(manifest.run_id)
    || !/^[a-f0-9]{64}$/.test(manifest.request_hash)
    || !/^[a-f0-9]{64}$/.test(manifest.scope_hash)
    || !/^[A-Za-z0-9][A-Za-z0-9._+-]{0,127}$/
      .test(manifest.base_source_revision)
    || !/^[a-f0-9]{40,64}$/.test(manifest.base_source_commit)
    || !/^[a-f0-9]{40,64}$/.test(manifest.candidate_source_revision)
    || canonicalJson(manifest.review_policy) !== canonicalJson({
      exact_cumulative_patch: true,
      dependency_manifest_changes: false,
      binary_or_special_file_changes: false,
      repository_quality_required: true,
      independent_replay_release_audit_required: true,
    })
    || canonicalJson(manifest.safety) !== canonicalJson({
      production_checkout_modified: false,
      main_branch_advanced: false,
      deployment_authority: "none",
      trading_authority: false,
    })) {
    throw new AdoptionError(
      "validation_failed",
      "Candidate manifest is unsupported",
    )
  }
  canonicalTime(manifest.certified_at)
  if (!Array.isArray(manifest.changed_files)
    || manifest.changed_files.length < 1
    || new Set(manifest.changed_files).size !== manifest.changed_files.length
    || manifest.changed_files.some((path) =>
      !path || path.startsWith("/") || path.split("/").includes(".."))
    || canonicalJson([...manifest.changed_files].sort())
      !== canonicalJson(manifest.changed_files)
    || !Array.isArray(manifest.prior_quality_check_refs)
    || manifest.prior_quality_check_refs.length < 1
    || !Array.isArray(manifest.candidate_package_checks)
    || manifest.candidate_package_checks.length < 1
    || !Array.isArray(manifest.suite_checks)
    || canonicalJson(manifest.suite_checks.map((check) => check.suite))
      !== canonicalJson([
        "repository_quality",
        "replay_independent_release_audit",
      ])) {
    throw new AdoptionError(
      "validation_failed",
      "Candidate manifest evidence is incomplete",
    )
  }
  assertPatchArtifact(manifest.patch)
  readAgentArtifact(root, manifest.patch)
  for (const ref of manifest.prior_quality_check_refs) {
    if (ref.media_type !== "application/json") {
      throw new AdoptionError(
        "validation_failed",
        "Candidate prior quality evidence is invalid",
      )
    }
    readAgentArtifact(root, ref)
  }
  for (const check of manifest.candidate_package_checks) {
    assertPackageCheck(check, check.package_path)
  }
  for (const check of manifest.suite_checks) {
    assertSuiteCheck(check, check.suite)
  }
  const { manifest_sha256: _hash, ...body } = manifest
  if (!/^[a-f0-9]{64}$/.test(manifest.manifest_sha256)
    || manifest.manifest_sha256 !== canonicalHash(body)) {
    throw new AdoptionError(
      "validation_failed",
      "Candidate manifest hash drifted",
    )
  }
  if (!manifest.source_archive
    || !/^[a-f0-9]{64}$/.test(manifest.source_archive.sha256)
    || !Number.isSafeInteger(manifest.source_archive.bytes)
    || manifest.source_archive.bytes < 1) {
    throw new AdoptionError(
      "validation_failed",
      "Candidate source archive identity is invalid",
    )
  }
  const expectedArchiveRef = repoRelative(
    root,
    resolve(
      root,
      "data",
      "release-candidates",
      adoptionPackageName(manifest.adoption_id),
      "source.tar",
    ),
  )
  if (manifest.source_archive.ref !== expectedArchiveRef) {
    throw new AdoptionError(
      "validation_failed",
      "Candidate source archive ref drifted",
    )
  }
  const archivePath = resolve(root, manifest.source_archive.ref)
  assertInside(resolve(root, "data", "release-candidates"), archivePath)
  if (!existsSync(archivePath) || !lstatSync(archivePath).isFile()
    || statSync(archivePath).size !== manifest.source_archive.bytes
    || fileHash(archivePath) !== manifest.source_archive.sha256) {
    throw new AdoptionError(
      "validation_failed",
      "Candidate source archive drifted",
    )
  }
}

function assertPatchArtifact(ref: AgentArtifactRef): void {
  if (!ref || ref.media_type !== "text/x-diff"
    || !/^agent-artifact:\/\/durable\/[a-f0-9]{64}$/.test(ref.ref)
    || !/^[a-f0-9]{64}$/.test(ref.sha256)
    || !Number.isSafeInteger(ref.bytes)
    || ref.bytes < 1
    || ref.bytes > 16 * 1024 * 1024) {
    throw new AdoptionError(
      "validation_failed",
      "Candidate patch artifact is invalid",
    )
  }
}

function resultProjection(
  manifest: DeveloperPatchAdoptionManifest,
  root: string,
): AgentPatchAdoptionResultProjection {
  return {
    schema_version: "trade.agent-patch-adoption-result.v1",
    adoption_id: manifest.adoption_id,
    run_id: manifest.run_id,
    request_hash: manifest.request_hash,
    scope_hash: manifest.scope_hash,
    patch_sha256: manifest.patch.sha256,
    base_source_revision: manifest.base_source_revision,
    candidate_source_revision: manifest.candidate_source_revision,
    manifest_ref: repoRelative(
      root,
      resolve(
        root,
        "data",
        "release-candidates",
        adoptionPackageName(manifest.adoption_id),
        "manifest.json",
      ),
    ),
    manifest_sha256: manifest.manifest_sha256,
    certified_at: manifest.certified_at,
    deployment_authority: "none",
  }
}

function adoptionPackageRoot(root: string, adoptionId: string): string {
  return resolve(root, adoptionPackageName(adoptionId))
}

function adoptionPackageName(adoptionId: string): string {
  return `adoption-${createHash("sha256")
    .update(adoptionId)
    .digest("hex")
    .slice(0, 24)}`
}

function resolveReleaseRoot(root: string, value: string): string {
  const path = resolve(root, value)
  const expected = resolve(root, "data", "release-candidates")
  if (path !== expected) {
    throw new AdoptionError(
      "validation_failed",
      "Release candidate root must use data/release-candidates",
    )
  }
  mkdirSync(path, { recursive: true, mode: 0o700 })
  const actual = realpathSync(path)
  if (actual !== path) {
    throw new AdoptionError(
      "validation_failed",
      "Release candidate root must not be a symlink",
    )
  }
  return path
}

function repoRelative(root: string, path: string): string {
  assertInside(root, path)
  const value = relative(root, path).replaceAll("\\", "/")
  if (!value || value.startsWith("../")) {
    throw new AdoptionError("runtime_failed", "Candidate ref escaped repository")
  }
  return value
}

function git(
  cwd: string,
  args: string[],
  env: Record<string, string | undefined> = process.env,
): void {
  const result = Bun.spawnSync({
    cmd: ["git", ...args],
    cwd,
    env,
    stdin: "ignore",
    stdout: "pipe",
    stderr: "pipe",
  })
  if (result.exitCode !== 0) {
    throw new AdoptionError(
      "runtime_failed",
      `Candidate Git operation failed: ${args[0] ?? "unknown"}`,
    )
  }
}

function gitText(cwd: string, args: string[]): string {
  const result = Bun.spawnSync({
    cmd: ["git", ...args],
    cwd,
    stdin: "ignore",
    stdout: "pipe",
    stderr: "pipe",
  })
  if (result.exitCode !== 0) {
    throw new AdoptionError(
      "runtime_failed",
      `Candidate Git read failed: ${args[0] ?? "unknown"}`,
    )
  }
  return result.stdout.toString()
}

function artifactIdentity(ref: AgentArtifactRef): string {
  return `${ref.ref}:${ref.sha256}:${ref.bytes}:${ref.media_type}`
}

function fileHash(path: string): string {
  return createHash("sha256").update(readFileSync(path)).digest("hex")
}

function assertInside(root: string, path: string): void {
  const base = resolve(root)
  const target = resolve(path)
  if (target !== base && !target.startsWith(`${base}${sep}`)) {
    throw new AdoptionError("validation_failed", "Candidate path escaped scope")
  }
}

function canonicalTime(value: string): string {
  const date = new Date(value)
  if (!Number.isFinite(date.getTime()) || date.toISOString() !== value) {
    throw new AdoptionError(
      "runtime_failed",
      "Candidate timestamp must be canonical UTC",
    )
  }
  return value
}

function classifyAdoptionError(error: unknown): AdoptionError {
  if (error instanceof AdoptionError) return error
  return new AdoptionError(
    "runtime_failed",
    error instanceof Error ? error.message : String(error),
  )
}

export class AdoptionError extends Error {
  constructor(
    readonly failure_class: AgentPatchAdoptionFailureClass,
    message: string,
  ) {
    super(message)
    this.name = "AdoptionError"
  }
}
