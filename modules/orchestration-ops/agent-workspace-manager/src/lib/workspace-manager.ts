import { createHash } from "node:crypto"
import { lstatSync, mkdirSync, readdirSync, readlinkSync, realpathSync, rmSync, statSync } from "node:fs"
import { dirname, join, resolve, sep } from "node:path"
import type { AgentArtifactRef } from "../../../../contracts/agent-run-contract/src/agent-run-contract"
import { canonicalJson } from "../../../../contracts/runtime-core/src/canonical-json"

export interface AgentWorkspace {
  schema_version: "trade.agent-workspace.v1"
  run_id: string
  source_revision: string
  source_commit: string
  repository_root: string
  workspace_root: string
  allowed_write_prefixes: string[]
  created_at: string
}

export interface AgentWorkspacePatch {
  schema_version: "trade.agent-workspace-patch.v1"
  run_id: string
  source_commit: string
  changed_files: string[]
  patch_ref: string
  patch_sha256: string
  patch_bytes: number
  patch_text: string
  domain_authority: "none"
}

export interface AgentWorkspaceMountPlan {
  schema_version: "trade.agent-workspace-mount-plan.v1"
  mounts: Array<{ source: string; target: string; read_only: boolean }>
  network: "none"
  secrets: []
  docker_socket: false
  production_repository: false
}

export interface StaleAgentWorkspace {
  run_id: string
  workspace_root: string
  registered_worktree: boolean
  last_modified_at: string
}

export interface FinalizedAgentWorkspaceEvidence {
  schema_version: "trade.agent-workspace-finalized-evidence.v1"
  run_id: string
  source_commit: string
  patch_ref: AgentArtifactRef
  quality_check_refs: AgentArtifactRef[]
  changed_files: string[]
  package_path: string
  patch_sha256: string
  checked_at: string
  domain_authority: "none"
}

export function createAgentWorkspace(input: {
  repository_root: string
  run_id: string
  source_revision: string
  allowed_write_prefixes: string[]
  created_at?: string
}): AgentWorkspace {
  const repositoryRoot = realpathSync(resolve(input.repository_root))
  const runId = identifier(input.run_id, "run_id")
  const sourceRevision = revision(input.source_revision)
  const prefixes = writePrefixes(input.allowed_write_prefixes)
  const workspaceRoot = resolve(repositoryRoot, "tmp", "agent-workspaces", runId)
  assertWorkspacePath(repositoryRoot, workspaceRoot, runId)
  if (exists(workspaceRoot)) throw new Error("Agent workspace already exists")
  const commit = git(repositoryRoot, ["rev-parse", "--verify", `${sourceRevision}^{commit}`]).trim()
  if (!/^[a-f0-9]{40,64}$/.test(commit)) throw new Error("Agent workspace source commit is invalid")
  mkdirSync(dirname(workspaceRoot), { recursive: true, mode: 0o700 })
  git(repositoryRoot, ["worktree", "add", "--detach", workspaceRoot, commit])
  try {
    if (git(workspaceRoot, ["rev-parse", "HEAD"]).trim() !== commit) throw new Error("Agent workspace revision drifted")
    assertWorkspaceFilesystem(workspaceRoot)
    return {
      schema_version: "trade.agent-workspace.v1",
      run_id: runId,
      source_revision: sourceRevision,
      source_commit: commit,
      repository_root: repositoryRoot,
      workspace_root: workspaceRoot,
      allowed_write_prefixes: prefixes,
      created_at: canonicalTime(input.created_at ?? new Date().toISOString()),
    }
  } catch (error) {
    git(repositoryRoot, ["worktree", "remove", "--force", workspaceRoot], true)
    throw error
  }
}

export function captureAgentWorkspacePatch(
  workspace: AgentWorkspace,
  maxBytes = 4 * 1024 * 1024,
): AgentWorkspacePatch {
  validateWorkspaceRecord(workspace)
  const changed = changedFiles(workspace.workspace_root)
  for (const path of changed) {
    if (!workspace.allowed_write_prefixes.some((prefix) => path === prefix || path.startsWith(`${prefix}/`))) {
      throw new Error(`Agent workspace change is outside allowed prefixes: ${path}`)
    }
    assertContainedPath(workspace.workspace_root, path)
  }
  const untracked = statusEntries(workspace.workspace_root).filter((entry) => entry.code === "??").map((entry) => entry.path)
  if (untracked.length > 0) git(workspace.workspace_root, ["add", "-N", "--", ...untracked])
  const patchText = git(workspace.workspace_root, ["diff", "--binary", "--no-ext-diff", "--full-index", "HEAD"])
  const bytes = Buffer.byteLength(patchText)
  if (bytes > maxBytes) throw new Error("Agent workspace patch exceeds byte limit")
  const hash = createHash("sha256").update(patchText).digest("hex")
  return {
    schema_version: "trade.agent-workspace-patch.v1",
    run_id: workspace.run_id,
    source_commit: workspace.source_commit,
    changed_files: changed,
    patch_ref: `agent-workspace://${workspace.run_id}/patch/${hash}`,
    patch_sha256: hash,
    patch_bytes: bytes,
    patch_text: patchText,
    domain_authority: "none",
  }
}

export async function runAgentWorkspacePackageCheck(input: {
  workspace: AgentWorkspace
  package_path: string
  timeout_ms?: number
  max_output_bytes?: number
}): Promise<{
  schema_version: "trade.agent-workspace-check.v1"
  package_path: string
  exit_code: number
  timed_out: boolean
  output_sha256: string
  output_bytes: number
}> {
  validateWorkspaceRecord(input.workspace)
  const packagePath = repoPath(input.package_path, "package_path")
  if (!packagePath.startsWith("modules/")) throw new Error("Agent package check is restricted to modules")
  const packageRoot = resolve(input.workspace.workspace_root, packagePath)
  assertInside(input.workspace.workspace_root, packageRoot)
  if (!exists(join(packageRoot, "package.json"))) throw new Error("Agent package check requires package.json")
  const timeoutMs = boundedInteger(input.timeout_ms ?? 120_000, 1_000, 600_000, "timeout_ms")
  const maxOutput = boundedInteger(input.max_output_bytes ?? 2 * 1024 * 1024, 1_024, 8 * 1024 * 1024, "max_output_bytes")
  const child = Bun.spawn({
    cmd: [process.execPath, "--no-install", "run", "check"],
    cwd: packageRoot,
    env: sanitizedEnvironment(),
    stdin: "ignore",
    stdout: "pipe",
    stderr: "pipe",
  })
  let timedOut = false
  const timer = setTimeout(() => {
    timedOut = true
    child.kill("SIGKILL")
  }, timeoutMs)
  const [stdout, stderr, exitCode] = await Promise.all([
    readBounded(child.stdout, maxOutput, () => child.kill("SIGKILL")),
    readBounded(child.stderr, maxOutput, () => child.kill("SIGKILL")),
    child.exited,
  ])
  clearTimeout(timer)
  const output = Buffer.concat([stdout, stderr])
  if (output.byteLength > maxOutput) throw new Error("Agent package check output exceeds byte limit")
  return {
    schema_version: "trade.agent-workspace-check.v1",
    package_path: packagePath,
    exit_code: exitCode,
    timed_out: timedOut,
    output_sha256: createHash("sha256").update(output).digest("hex"),
    output_bytes: output.byteLength,
  }
}

export async function finalizeAgentWorkspaceEvidence(input: {
  workspace: AgentWorkspace
  package_path: string
  checked_at?: string
  write_artifact(
    mediaType: AgentArtifactRef["media_type"],
    text: string,
  ): AgentArtifactRef
  timeout_ms?: number
  max_output_bytes?: number
}): Promise<FinalizedAgentWorkspaceEvidence> {
  const before = captureAgentWorkspacePatch(input.workspace)
  if (before.changed_files.length < 1 || before.patch_bytes < 1) {
    throw new Error("Agent workspace produced no reviewable patch")
  }
  const check = await runAgentWorkspacePackageCheck({
    workspace: input.workspace,
    package_path: input.package_path,
    ...(input.timeout_ms == null ? {} : { timeout_ms: input.timeout_ms }),
    ...(input.max_output_bytes == null
      ? {}
      : { max_output_bytes: input.max_output_bytes }),
  })
  if (check.timed_out || check.exit_code !== 0) {
    throw new Error("Agent workspace package check did not pass")
  }
  const after = captureAgentWorkspacePatch(input.workspace)
  if (after.patch_sha256 !== before.patch_sha256
    || JSON.stringify(after.changed_files) !== JSON.stringify(before.changed_files)) {
    throw new Error("Agent workspace package check mutated the captured patch")
  }
  const checkedAt = canonicalTime(input.checked_at ?? new Date().toISOString())
  const patchRef = input.write_artifact("text/x-diff", before.patch_text)
  assertWrittenArtifact(patchRef, before.patch_text, "text/x-diff")
  const checkText = canonicalJson({
    schema_version: "trade.agent-workspace-quality-evidence.v1",
    run_id: input.workspace.run_id,
    source_commit: input.workspace.source_commit,
    package_path: check.package_path,
    patch_sha256: before.patch_sha256,
    exit_code: check.exit_code,
    timed_out: check.timed_out,
    output_sha256: check.output_sha256,
    output_bytes: check.output_bytes,
    checked_at: checkedAt,
    domain_authority: "none",
  })
  const checkRef = input.write_artifact("application/json", checkText)
  assertWrittenArtifact(checkRef, checkText, "application/json")
  return {
    schema_version: "trade.agent-workspace-finalized-evidence.v1",
    run_id: input.workspace.run_id,
    source_commit: input.workspace.source_commit,
    patch_ref: patchRef,
    quality_check_refs: [checkRef],
    changed_files: before.changed_files,
    package_path: check.package_path,
    patch_sha256: before.patch_sha256,
    checked_at: checkedAt,
    domain_authority: "none",
  }
}

export function buildAgentWorkspaceMountPlan(workspace: AgentWorkspace, outputRoot: string): AgentWorkspaceMountPlan {
  validateWorkspaceRecord(workspace)
  const output = realpathSync(resolve(outputRoot))
  assertInside(resolve(workspace.repository_root, "tmp"), output)
  if (output.startsWith(`${workspace.workspace_root}${sep}`) || output === workspace.workspace_root) {
    throw new Error("Agent output root must be separate from the source worktree")
  }
  return {
    schema_version: "trade.agent-workspace-mount-plan.v1",
    mounts: [
      { source: workspace.workspace_root, target: "/workspace", read_only: false },
      { source: output, target: "/output", read_only: false },
    ],
    network: "none",
    secrets: [],
    docker_socket: false,
    production_repository: false,
  }
}

export function removeAgentWorkspace(workspace: AgentWorkspace): void {
  validateWorkspaceRecord(workspace)
  git(workspace.repository_root, ["worktree", "remove", "--force", workspace.workspace_root])
  git(workspace.repository_root, ["worktree", "prune"])
}

export function listStaleAgentWorkspaces(input: {
  repository_root: string
  active_run_ids: string[]
  older_than: string
}): StaleAgentWorkspace[] {
  const root = realpathSync(resolve(input.repository_root))
  const parent = resolve(root, "tmp", "agent-workspaces")
  const cutoff = Date.parse(canonicalTime(input.older_than))
  const active = new Set(input.active_run_ids.map((id) => identifier(id, "active_run_id")))
  if (!exists(parent)) return []
  const registered = registeredWorktreePaths(root)
  return readdirSync(parent, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && /^[A-Za-z0-9][A-Za-z0-9._:-]{0,159}$/.test(entry.name))
    .flatMap((entry): StaleAgentWorkspace[] => {
      if (active.has(entry.name)) return []
      const path = resolve(parent, entry.name)
      assertWorkspacePath(root, path, entry.name)
      const modified = statSync(path).mtime
      if (modified.getTime() >= cutoff) return []
      return [{
        run_id: entry.name,
        workspace_root: path,
        registered_worktree: registered.has(path),
        last_modified_at: modified.toISOString(),
      }]
    })
    .sort((left, right) => left.run_id.localeCompare(right.run_id))
}

export function removeStaleAgentWorkspaces(input: {
  repository_root: string
  active_run_ids: string[]
  older_than: string
  apply: boolean
}): { candidates: StaleAgentWorkspace[]; removed: string[] } {
  const candidates = listStaleAgentWorkspaces(input)
  if (!input.apply) return { candidates, removed: [] }
  const root = realpathSync(resolve(input.repository_root))
  const removed: string[] = []
  for (const candidate of candidates) {
    assertWorkspacePath(root, candidate.workspace_root, candidate.run_id)
    if (candidate.registered_worktree) {
      git(root, ["worktree", "remove", "--force", candidate.workspace_root])
    } else {
      rmSync(candidate.workspace_root, { recursive: true, force: true })
    }
    removed.push(candidate.run_id)
  }
  git(root, ["worktree", "prune"])
  return { candidates, removed }
}

function validateWorkspaceRecord(workspace: AgentWorkspace): void {
  if (workspace.schema_version !== "trade.agent-workspace.v1") throw new Error("Agent workspace schema is unsupported")
  assertWorkspacePath(workspace.repository_root, workspace.workspace_root, workspace.run_id)
  if (!exists(workspace.workspace_root)) throw new Error("Agent workspace is missing")
  if (git(workspace.workspace_root, ["rev-parse", "HEAD"]).trim() !== workspace.source_commit) {
    throw new Error("Agent workspace source commit drifted")
  }
}

function changedFiles(root: string): string[] {
  return [...new Set(statusEntries(root).map((entry) => entry.path))].sort()
}

function statusEntries(root: string): Array<{ code: string; path: string }> {
  const output = git(root, ["status", "--porcelain=v1", "-z", "--untracked-files=all"])
  const values = output.split("\0").filter(Boolean)
  const entries: Array<{ code: string; path: string }> = []
  for (let index = 0; index < values.length; index += 1) {
    const value = values[index]!
    const code = value.slice(0, 2)
    const path = repoPath(value.slice(3), "changed_path")
    entries.push({ code, path })
    if (code.includes("R") || code.includes("C")) index += 1
  }
  return entries
}

function assertWorkspaceFilesystem(root: string): void {
  for (const forbidden of [".secrets", "data"]) {
    if (exists(join(root, forbidden))) throw new Error(`Agent workspace exposes forbidden path: ${forbidden}`)
  }
  walk(root, (path) => {
    if (!lstatSync(path).isSymbolicLink()) return
    const target = resolve(dirname(path), readlinkSync(path))
    assertInside(root, target)
  })
}

function assertContainedPath(root: string, path: string): void {
  const absolute = resolve(root, path)
  assertInside(root, absolute)
  if (exists(absolute) && lstatSync(absolute).isSymbolicLink()) {
    assertInside(root, resolve(dirname(absolute), readlinkSync(absolute)))
  }
}

function walk(root: string, visit: (path: string) => void): void {
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    if (entry.name === ".git") continue
    const path = join(root, entry.name)
    visit(path)
    if (entry.isDirectory()) walk(path, visit)
  }
}

function git(cwd: string, args: string[], tolerateFailure = false): string {
  const result = Bun.spawnSync({ cmd: ["git", ...args], cwd, stdout: "pipe", stderr: "pipe" })
  if (result.exitCode !== 0 && !tolerateFailure) {
    throw new Error(`Agent workspace git operation failed: ${args[0]}`)
  }
  return result.stdout.toString()
}

function registeredWorktreePaths(repositoryRoot: string): Set<string> {
  const lines = git(repositoryRoot, ["worktree", "list", "--porcelain"]).split("\n")
  return new Set(lines
    .filter((line) => line.startsWith("worktree "))
    .map((line) => resolve(line.slice("worktree ".length))))
}

async function readBounded(
  stream: ReadableStream<Uint8Array>,
  maximum: number,
  overflow: () => void,
): Promise<Buffer> {
  const chunks: Buffer[] = []
  let total = 0
  const reader = stream.getReader()
  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    total += value.byteLength
    if (total > maximum) {
      overflow()
      throw new Error("Agent package check output exceeds byte limit")
    }
    chunks.push(Buffer.from(value))
  }
  return Buffer.concat(chunks)
}

function sanitizedEnvironment(): Record<string, string> {
  const allowed = ["PATH", "TMPDIR", "LANG", "LC_ALL"]
  return Object.fromEntries(allowed.flatMap((name) => process.env[name] ? [[name, process.env[name]!]] : []))
}

function assertWrittenArtifact(
  artifact: AgentArtifactRef,
  text: string,
  mediaType: AgentArtifactRef["media_type"],
): void {
  const bytes = Buffer.from(text)
  const hash = createHash("sha256").update(bytes).digest("hex")
  if (artifact.media_type !== mediaType
    || artifact.bytes !== bytes.byteLength
    || artifact.sha256 !== hash) {
    throw new Error("Agent workspace artifact writer drifted from captured evidence")
  }
}

function writePrefixes(values: string[]): string[] {
  if (!Array.isArray(values) || values.length < 1 || values.length > 32) throw new Error("allowed_write_prefixes are invalid")
  const result = values.map((value) => repoPath(value, "allowed_write_prefix"))
  if (new Set(result).size !== result.length) throw new Error("allowed_write_prefixes contain duplicates")
  if (result.some((path) => path === "data" || path.startsWith("data/") || path === ".secrets" || path.startsWith(".secrets/"))) {
    throw new Error("allowed_write_prefixes expose owner data or secrets")
  }
  return result.sort()
}

function repoPath(value: string, field: string): string {
  const normalized = value.replaceAll("\\", "/").replace(/\/+$/, "")
  if (!normalized || normalized.startsWith("/") || normalized.split("/").includes("..") || normalized.includes("\0")) {
    throw new Error(`${field} is invalid`)
  }
  return normalized
}

function assertWorkspacePath(repositoryRoot: string, workspaceRoot: string, runId: string): void {
  const expected = resolve(repositoryRoot, "tmp", "agent-workspaces", identifier(runId, "run_id"))
  if (resolve(workspaceRoot) !== expected) throw new Error("Agent workspace path is outside its run scope")
}

function assertInside(root: string, target: string): void {
  const base = resolve(root)
  const resolved = resolve(target)
  if (resolved !== base && !resolved.startsWith(`${base}${sep}`)) throw new Error("Agent workspace path escapes its root")
}

function revision(value: string): string {
  if (!/^[A-Za-z0-9][A-Za-z0-9._+-]{0,127}$/.test(value)) throw new Error("source_revision is invalid")
  return value
}

function identifier(value: string, field: string): string {
  if (!/^[A-Za-z0-9][A-Za-z0-9._:-]{0,159}$/.test(value)) throw new Error(`${field} is invalid`)
  return value
}

function canonicalTime(value: string): string {
  if (!Number.isFinite(Date.parse(value)) || new Date(value).toISOString() !== value) throw new Error("created_at is invalid")
  return value
}

function boundedInteger(value: number, minimum: number, maximum: number, field: string): number {
  if (!Number.isSafeInteger(value) || value < minimum || value > maximum) throw new Error(`${field} is invalid`)
  return value
}

function exists(path: string): boolean {
  try {
    statSync(path)
    return true
  } catch {
    return false
  }
}
