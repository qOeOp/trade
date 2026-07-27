import {
  existsSync,
  type Dirent,
  lstatSync,
  readdirSync,
  readFileSync,
  realpathSync,
  writeFileSync,
} from "node:fs"
import { basename, dirname, join, relative, resolve } from "node:path"
import { randomBytes } from "node:crypto"

const OWNER_FILE = "trade-cleanup-owner.json"
const OWNER_SOURCE =
  "modules/orchestration-ops/agent-workspace-manager/src/scripts/worktree-cleanup.ts"

interface OwnerMarker {
  schema_version: "trade.worktree-cleanup-owner.v1"
  generation: string
  owned_ref: string
  owner_commit: string
}

export interface WorktreeIdentity {
  schema_version: "trade.worktree-cleanup-identity.v1"
  operation: "create-linked-worktree" | "refresh-linked-worktree"
  worktree_id: string
  generation: string
  owner_commit: string
  head: string
  ref: string
  status: "completed"
}

export interface CleanupReceipt {
  schema_version: "trade.worktree-cleanup-execution.v1"
  operation: "remove-linked-worktree"
  owner_commit: string
  worktree_id: string
  expected_generation: string
  expected_head: string
  expected_ref: string | null
  observed_generation: string | null
  observed_head: string | null
  observed_ref: string | null
  worktree_removed: boolean
  local_branch_deleted: boolean
  status: "completed" | "failed" | "partial"
  reason_code: string | null
}

export interface CreateOptions {
  repositoryCwd: string
  worktreePath: string
  branchRef: string
  startPoint: string
  ownerCommit: string
}

export interface RemoveOptions {
  repositoryCwd: string
  ownerCommit: string
  worktreeId: string
  expectedGeneration: string
  expectedHead: string
  expectedRef: string
}

interface ResolvedTarget {
  commonDir: string
  adminDir: string
  worktreePath: string
  marker: OwnerMarker
  identity: WorktreeIdentity
}

interface CommandResult {
  exitCode: number
  stdout: Buffer
  stderr: Buffer
}

class CleanupError extends Error {
  constructor(readonly code: string) {
    super(code)
  }
}

export function createOwnedWorktree(options: CreateOptions): WorktreeIdentity {
  assertOid(options.startPoint)
  assertOid(options.ownerCommit)
  assertBranchRef(options.repositoryCwd, options.branchRef)
  if (existsSync(options.worktreePath)) throw new CleanupError("worktree_path_exists")
  if (
    gitResult(options.repositoryCwd, [
      "show-ref",
      "--verify",
      "--quiet",
      options.branchRef,
    ]).exitCode !== 1
  ) {
    throw new CleanupError("branch_already_exists")
  }
  const startPoint = resolveCommit(options.repositoryCwd, options.startPoint)
  const ownerCommit = resolveCommit(options.repositoryCwd, options.ownerCommit)
  assertOwnerSource(options.repositoryCwd, ownerCommit)
  const branchName = options.branchRef.slice("refs/heads/".length)
  const created = gitResult(options.repositoryCwd, [
    "worktree",
    "add",
    "-q",
    "--no-track",
    "-b",
    branchName,
    "--",
    options.worktreePath,
    startPoint,
  ])
  if (created.exitCode !== 0) {
    const partialPath = existsSync(options.worktreePath)
    const partialRef = gitResult(options.repositoryCwd, [
      "show-ref",
      "--verify",
      "--quiet",
      options.branchRef,
    ]).exitCode === 0
    throw new CleanupError(
      partialPath || partialRef
        ? "worktree_creation_incomplete_preserved"
        : "worktree_creation_failed",
    )
  }

  const location = resolveLinkedWorktree(options.worktreePath)
  const marker: OwnerMarker = {
    schema_version: "trade.worktree-cleanup-owner.v1",
    generation: randomBytes(32).toString("hex"),
    owned_ref: options.branchRef,
    owner_commit: ownerCommit,
  }
  writeFileSync(join(location.adminDir, OWNER_FILE), `${JSON.stringify(marker)}\n`, {
    flag: "wx",
    mode: 0o600,
  })
  return readOwnedWorktree(options.worktreePath, "create-linked-worktree")
}

export function refreshOwnedWorktree(worktreeCwd: string): WorktreeIdentity {
  return readOwnedWorktree(worktreeCwd, "refresh-linked-worktree")
}

export function removeOwnedWorktree(options: RemoveOptions): CleanupReceipt {
  let ownerCommit = sanitizeOid(options.ownerCommit)
  let expectedRefForReceipt: string | null = null
  let observedGeneration: string | null = null
  let observedHead: string | null = null
  let observedRef: string | null = null
  let worktreeRemoved = false
  let localBranchDeleted = false

  const receipt = (
    status: CleanupReceipt["status"],
    reasonCode: string | null,
  ): CleanupReceipt => ({
    schema_version: "trade.worktree-cleanup-execution.v1",
    operation: "remove-linked-worktree",
    owner_commit: ownerCommit,
    worktree_id: sanitizeWorktreeId(options.worktreeId),
    expected_generation: sanitizeGeneration(options.expectedGeneration),
    expected_head: sanitizeOid(options.expectedHead),
    expected_ref: expectedRefForReceipt,
    observed_generation: observedGeneration,
    observed_head: observedHead,
    observed_ref: observedRef,
    worktree_removed: worktreeRemoved,
    local_branch_deleted: localBranchDeleted,
    status,
    reason_code: reasonCode,
  })

  try {
    assertWorktreeId(options.worktreeId)
    assertGeneration(options.expectedGeneration)
    assertOid(options.ownerCommit)
    assertOid(options.expectedHead)
    assertBranchRef(options.repositoryCwd, options.expectedRef)
    expectedRefForReceipt = options.expectedRef
    ownerCommit = resolveCommit(options.repositoryCwd, options.ownerCommit)

    let target = resolveTarget(options.repositoryCwd, options.worktreeId)
    bindObserved(target.identity)
    assertExpectedIdentity(target, options, ownerCommit)
    assertPristine(target.worktreePath)
    assertUnused(target.worktreePath, target.adminDir)

    target = resolveTarget(target.commonDir, options.worktreeId)
    bindObserved(target.identity)
    assertExpectedIdentity(target, options, ownerCommit)
    assertPristine(target.worktreePath)
    assertUnused(target.worktreePath, target.adminDir)

    const removal = gitResult(target.commonDir, [
      "worktree",
      "remove",
      "--",
      target.worktreePath,
    ])
    worktreeRemoved = !existsSync(target.adminDir) && !existsSync(target.worktreePath)
    if (removal.exitCode !== 0 || !worktreeRemoved) {
      throw new CleanupError(
        worktreeRemoved ? "worktree_removal_partial" : "worktree_removal_refused",
      )
    }

    const deletion = gitResult(target.commonDir, [
      "update-ref",
      "--no-deref",
      "-d",
      options.expectedRef,
      options.expectedHead,
    ])
    const branchRefDeleted = deletion.exitCode === 0
      && gitResult(target.commonDir, [
        "show-ref",
        "--verify",
        "--quiet",
        options.expectedRef,
      ]).exitCode !== 0
    if (!branchRefDeleted) {
      return receipt("partial", "local_branch_preserved")
    }
    const branchName = options.expectedRef.slice("refs/heads/".length)
    const branchConfig = gitResult(target.commonDir, [
      "config",
      "--name-only",
      "--get-regexp",
      `^branch\\.${escapeRegExp(branchName)}\\.`,
    ])
    const configDeletion = branchConfig.exitCode === 0
      ? gitResult(target.commonDir, [
        "config",
        "--remove-section",
        `branch.${branchName}`,
      ])
      : branchConfig
    localBranchDeleted = configDeletion.exitCode === 0 || branchConfig.exitCode === 1
    if (!localBranchDeleted) {
      return receipt("partial", "local_branch_metadata_preserved")
    }
    return receipt("completed", null)
  } catch (error) {
    const reason = error instanceof CleanupError ? error.code : "owner_operation_failed"
    return receipt(worktreeRemoved ? "partial" : "failed", reason)
  }

  function bindObserved(identity: WorktreeIdentity): void {
    observedGeneration = identity.generation
    observedHead = identity.head
    observedRef = identity.ref
  }
}

function resolveTarget(repositoryCwd: string, worktreeId: string): ResolvedTarget {
  const commonDir = realpathSync(git(repositoryCwd, [
    "rev-parse",
    "--path-format=absolute",
    "--git-common-dir",
  ]))
  const adminDir = join(commonDir, "worktrees", worktreeId)
  if (!existsSync(adminDir)) throw new CleanupError("worktree_identity_missing")
  const gitdirPointer = readFileSync(join(adminDir, "gitdir"), "utf8").trim()
  if (!gitdirPointer) throw new CleanupError("worktree_identity_missing")
  const worktreePath = dirname(resolve(adminDir, gitdirPointer))
  if (!existsSync(worktreePath)) throw new CleanupError("worktree_identity_missing")
  const observedAdminDir = realpathSync(git(worktreePath, [
    "rev-parse",
    "--path-format=absolute",
    "--git-dir",
  ]))
  if (observedAdminDir !== realpathSync(adminDir)) {
    throw new CleanupError("worktree_identity_drift")
  }
  const marker = readMarker(adminDir)
  return {
    commonDir,
    adminDir,
    worktreePath,
    marker,
    identity: readOwnedWorktree(worktreePath, "refresh-linked-worktree"),
  }
}

function resolveLinkedWorktree(worktreeCwd: string): {
  adminDir: string
  commonDir: string
  worktreeId: string
} {
  const adminDir = realpathSync(git(worktreeCwd, [
    "rev-parse",
    "--path-format=absolute",
    "--git-dir",
  ]))
  const commonDir = realpathSync(git(worktreeCwd, [
    "rev-parse",
    "--path-format=absolute",
    "--git-common-dir",
  ]))
  if (dirname(adminDir) !== join(commonDir, "worktrees")) {
    throw new CleanupError("linked_worktree_required")
  }
  const worktreeId = basename(adminDir)
  assertWorktreeId(worktreeId)
  return { adminDir, commonDir, worktreeId }
}

function readOwnedWorktree(
  worktreeCwd: string,
  operation: WorktreeIdentity["operation"],
): WorktreeIdentity {
  const location = resolveLinkedWorktree(worktreeCwd)
  const marker = readMarker(location.adminDir)
  const ref = readHeadRef(worktreeCwd)
  if (ref !== marker.owned_ref) throw new CleanupError("worktree_ref_drift")
  return {
    schema_version: "trade.worktree-cleanup-identity.v1",
    operation,
    worktree_id: location.worktreeId,
    generation: marker.generation,
    owner_commit: marker.owner_commit,
    head: git(worktreeCwd, ["rev-parse", "--verify", "HEAD"]),
    ref,
    status: "completed",
  }
}

function readMarker(adminDir: string): OwnerMarker {
  let parsed: unknown
  try {
    parsed = JSON.parse(readFileSync(join(adminDir, OWNER_FILE), "utf8"))
  } catch {
    throw new CleanupError("cleanup_ownership_missing")
  }
  if (
    typeof parsed !== "object"
    || parsed === null
    || !("schema_version" in parsed)
    || parsed.schema_version !== "trade.worktree-cleanup-owner.v1"
    || !("generation" in parsed)
    || typeof parsed.generation !== "string"
    || !("owned_ref" in parsed)
    || typeof parsed.owned_ref !== "string"
    || !("owner_commit" in parsed)
    || typeof parsed.owner_commit !== "string"
  ) {
    throw new CleanupError("cleanup_ownership_invalid")
  }
  assertGeneration(parsed.generation)
  assertOid(parsed.owner_commit)
  return parsed as OwnerMarker
}

function assertExpectedIdentity(
  target: ResolvedTarget,
  options: RemoveOptions,
  ownerCommit: string,
): void {
  if (target.marker.generation !== options.expectedGeneration) {
    throw new CleanupError("worktree_generation_drift")
  }
  if (target.marker.owned_ref !== options.expectedRef) {
    throw new CleanupError("worktree_ref_not_owned")
  }
  if (target.marker.owner_commit !== ownerCommit) {
    throw new CleanupError("owner_commit_drift")
  }
  if (target.identity.head !== options.expectedHead) {
    throw new CleanupError("worktree_head_drift")
  }
  if (target.identity.ref !== options.expectedRef) {
    throw new CleanupError("worktree_ref_drift")
  }
}

function assertPristine(worktreePath: string): void {
  const tracked = gitResult(worktreePath, ["ls-files", "--stage", "-z"])
  if (tracked.exitCode !== 0) throw new CleanupError("worktree_inspection_failed")
  const trackedPaths = new Set<string>()
  const trackedDirectories = new Set<string>()
  for (const entry of tracked.stdout.toString().split("\0")) {
    if (entry === "") continue
    const match = /^(\d{6}) ([0-9a-f]{40}|[0-9a-f]{64}) ([0-3])\t(.*)$/s.exec(entry)
    if (!match || match[3] !== "0") throw new CleanupError("worktree_not_pristine")
    if (match[1] === "160000") {
      throw new CleanupError("worktree_has_registered_submodules")
    }
    const path = match[4]!
    trackedPaths.add(path)
    for (let directory = dirname(path); directory !== "."; directory = dirname(directory)) {
      trackedDirectories.add(directory)
    }
    let metadata: ReturnType<typeof lstatSync>
    try {
      metadata = lstatSync(join(worktreePath, path))
    } catch {
      throw new CleanupError("worktree_not_pristine")
    }
    if (match[1] === "120000") {
      if (!metadata.isSymbolicLink()) throw new CleanupError("worktree_not_pristine")
    } else {
      if (!metadata.isFile()) throw new CleanupError("worktree_not_pristine")
      const expectedExecutable = match[1] === "100755"
      const actualExecutable = (metadata.mode & 0o111) !== 0
      if (expectedExecutable !== actualExecutable) {
        throw new CleanupError("worktree_not_pristine")
      }
    }
    const actual = gitResult(worktreePath, [
      "hash-object",
      `--path=${path}`,
      "--",
      path,
    ])
    if (
      actual.exitCode !== 0
      || actual.stdout.toString().trim() !== match[2]
    ) {
      throw new CleanupError("worktree_not_pristine")
    }
  }
  assertNoFilesystemResidue(worktreePath, trackedPaths, trackedDirectories)
  for (const arguments_ of [
    ["ls-files", "--others", "--exclude-standard", "-z"],
    ["ls-files", "--others", "--ignored", "--exclude-standard", "-z"],
  ]) {
    const residue = gitResult(worktreePath, arguments_)
    if (residue.exitCode !== 0) throw new CleanupError("worktree_inspection_failed")
    if (residue.stdout.length > 0) throw new CleanupError("worktree_not_pristine")
  }
}

function assertNoFilesystemResidue(
  worktreePath: string,
  trackedPaths: ReadonlySet<string>,
  trackedDirectories: ReadonlySet<string>,
): void {
  inspect(worktreePath)

  function inspect(directory: string): void {
    let entries: Dirent[]
    try {
      entries = readdirSync(directory, { withFileTypes: true })
    } catch {
      throw new CleanupError("worktree_inspection_failed")
    }
    for (const entry of entries) {
      const absolutePath = join(directory, entry.name)
      const path = relative(worktreePath, absolutePath)
      if (path === ".git") {
        let metadata: ReturnType<typeof lstatSync>
        try {
          metadata = lstatSync(absolutePath)
        } catch {
          throw new CleanupError("worktree_inspection_failed")
        }
        if (!metadata.isFile()) throw new CleanupError("worktree_not_pristine")
        continue
      }
      if (entry.isDirectory()) {
        if (!trackedDirectories.has(path)) {
          throw new CleanupError("worktree_not_pristine")
        }
        inspect(absolutePath)
        continue
      }
      if (!trackedPaths.has(path)) throw new CleanupError("worktree_not_pristine")
    }
  }
}

function assertUnused(worktreePath: string, adminDir: string): void {
  const lsof = process.platform === "darwin" ? "/usr/sbin/lsof" : "/usr/bin/lsof"
  if (!existsSync(lsof)) throw new CleanupError("worktree_usage_inspection_unavailable")
  for (const target of [worktreePath, adminDir]) {
    const result = Bun.spawnSync([lsof, "-n", "-P", "-t", "+D", target], {
      stdout: "pipe",
      stderr: "pipe",
    })
    if (result.stdout.length > 0) throw new CleanupError("target_in_use")
    if (result.exitCode !== 1 || result.stderr.length > 0) {
      throw new CleanupError("worktree_usage_inspection_unavailable")
    }
  }
}

function readHeadRef(cwd: string): string {
  const result = gitResult(cwd, ["symbolic-ref", "-q", "HEAD"])
  if (result.exitCode !== 0) throw new CleanupError("owned_branch_required")
  return result.stdout.toString().trim()
}

function resolveCommit(cwd: string, value: string): string {
  const result = gitResult(cwd, ["rev-parse", "--verify", `${value}^{commit}`])
  if (result.exitCode !== 0) throw new CleanupError("owner_commit_missing")
  return result.stdout.toString().trim()
}

function assertOwnerSource(cwd: string, ownerCommit: string): void {
  const admitted = gitResult(cwd, ["show", `${ownerCommit}:${OWNER_SOURCE}`])
  let running: Buffer
  try {
    running = readFileSync(import.meta.path)
  } catch {
    throw new CleanupError("owner_source_unavailable")
  }
  if (admitted.exitCode !== 0 || !admitted.stdout.equals(running)) {
    throw new CleanupError("owner_source_mismatch")
  }
}

function git(cwd: string, arguments_: string[]): string {
  const result = gitResult(cwd, arguments_)
  if (result.exitCode !== 0) throw new CleanupError("git_operation_failed")
  return result.stdout.toString().trim()
}

function gitResult(
  cwd: string,
  arguments_: string[],
  environment: NodeJS.ProcessEnv = process.env,
): CommandResult {
  const result = Bun.spawnSync(["git", "--no-replace-objects", "-C", cwd, ...arguments_], {
    env: { ...environment, GIT_OPTIONAL_LOCKS: "0" },
    stdout: "pipe",
    stderr: "pipe",
  })
  return { exitCode: result.exitCode, stdout: result.stdout, stderr: result.stderr }
}

function assertWorktreeId(value: string): void {
  if (!/^[A-Za-z0-9][A-Za-z0-9._+-]*$/.test(value) || value === "." || value === "..") {
    throw new CleanupError("invalid_worktree_id")
  }
}

function assertGeneration(value: string): void {
  if (!/^[0-9a-f]{64}$/.test(value)) throw new CleanupError("invalid_generation")
}

function assertOid(value: string): void {
  if (!/^(?:[0-9a-f]{40}|[0-9a-f]{64})$/.test(value)) {
    throw new CleanupError("invalid_oid")
  }
}

function assertBranchRef(cwd: string, value: string): void {
  if (!value.startsWith("refs/heads/")) throw new CleanupError("invalid_expected_ref")
  const branchName = value.slice("refs/heads/".length)
  if (gitResult(cwd, ["check-ref-format", "--branch", branchName]).exitCode !== 0) {
    throw new CleanupError("invalid_expected_ref")
  }
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
}

function sanitizeWorktreeId(value: string): string {
  return /^[A-Za-z0-9][A-Za-z0-9._+-]*$/.test(value) ? value : "invalid"
}

function sanitizeGeneration(value: string): string {
  return /^[0-9a-f]{64}$/.test(value) ? value : "invalid"
}

function sanitizeOid(value: string): string {
  return /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/.test(value) ? value : "invalid"
}

function parseArguments(arguments_: string[]): { command: string; values: Map<string, string> } {
  const [command, ...rest] = arguments_
  const values = new Map<string, string>()
  for (let index = 0; index < rest.length; index += 2) {
    const key = rest[index]
    const value = rest[index + 1]
    if (!key?.startsWith("--") || value === undefined) {
      throw new CleanupError("invalid_arguments")
    }
    values.set(key.slice(2), value)
  }
  return { command: command ?? "", values }
}

function required(values: Map<string, string>, key: string): string {
  const value = values.get(key)
  if (value === undefined) throw new CleanupError("invalid_arguments")
  return value
}

export function main(arguments_: string[]): number {
  try {
    const { command, values } = parseArguments(arguments_)
    if (command === "create") {
      const identity = createOwnedWorktree({
        repositoryCwd: process.cwd(),
        worktreePath: required(values, "worktree-path"),
        branchRef: required(values, "branch-ref"),
        startPoint: required(values, "start-point"),
        ownerCommit: required(values, "owner-commit"),
      })
      process.stdout.write(`${JSON.stringify(identity)}\n`)
      return 0
    }
    if (command === "refresh") {
      process.stdout.write(
        `${JSON.stringify(refreshOwnedWorktree(required(values, "cwd")))}\n`,
      )
      return 0
    }
    if (command !== "remove") throw new CleanupError("invalid_arguments")
    const receipt = removeOwnedWorktree({
      repositoryCwd: process.cwd(),
      ownerCommit: required(values, "owner-commit"),
      worktreeId: required(values, "worktree-id"),
      expectedGeneration: required(values, "expected-generation"),
      expectedHead: required(values, "expected-head"),
      expectedRef: required(values, "expected-ref"),
    })
    process.stdout.write(`${JSON.stringify(receipt)}\n`)
    return receipt.status === "completed" ? 0 : 1
  } catch (error) {
    const reason = error instanceof CleanupError ? error.code : "owner_operation_failed"
    process.stdout.write(`${JSON.stringify({
      schema_version: "trade.worktree-cleanup-execution.v1",
      operation: "invalid",
      status: "failed",
      reason_code: reason,
    })}\n`)
    return 1
  }
}

if (import.meta.main) process.exit(main(process.argv.slice(2)))
