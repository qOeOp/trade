import {
  existsSync,
  readFileSync,
  realpathSync,
  writeFileSync,
} from "node:fs"
import { basename, dirname, join, resolve } from "node:path"
import { randomBytes } from "node:crypto"

const GENERATION_FILE = "trade-cleanup-generation"

export interface WorktreeIdentity {
  schema_version: "trade.worktree-cleanup-identity.v1"
  operation: "identify-linked-worktree"
  worktree_id: string
  generation: string
  head: string
  ref: string | null
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

export interface RemoveOptions {
  repositoryCwd: string
  ownerCommit: string
  worktreeId: string
  expectedGeneration: string
  expectedHead: string
  expectedRef: string | null
}

interface ResolvedTarget {
  commonDir: string
  adminDir: string
  worktreePath: string
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

export function identifyLinkedWorktree(worktreeCwd: string): WorktreeIdentity {
  const worktreePath = realpathSync(git(worktreeCwd, [
    "rev-parse",
    "--path-format=absolute",
    "--show-toplevel",
  ]))
  const adminDir = realpathSync(git(worktreePath, [
    "rev-parse",
    "--path-format=absolute",
    "--git-dir",
  ]))
  const commonDir = realpathSync(git(worktreePath, [
    "rev-parse",
    "--path-format=absolute",
    "--git-common-dir",
  ]))
  if (dirname(adminDir) !== join(commonDir, "worktrees")) {
    throw new CleanupError("linked_worktree_required")
  }
  const worktreeId = basename(adminDir)
  assertWorktreeId(worktreeId)
  const generationPath = join(adminDir, GENERATION_FILE)
  if (!existsSync(generationPath)) {
    writeFileSync(generationPath, `${randomBytes(32).toString("hex")}\n`, {
      flag: "wx",
      mode: 0o600,
    })
  }
  const generation = readGeneration(generationPath)
  return {
    schema_version: "trade.worktree-cleanup-identity.v1",
    operation: "identify-linked-worktree",
    worktree_id: worktreeId,
    generation,
    head: git(worktreePath, ["rev-parse", "--verify", "HEAD"]),
    ref: readHeadRef(worktreePath),
    status: "completed",
  }
}

export function removeOwnedWorktree(options: RemoveOptions): CleanupReceipt {
  let ownerCommit = sanitizeOid(options.ownerCommit)
  let observedGeneration: string | null = null
  let observedHead: string | null = null
  let observedRef: string | null = null
  let expectedRefForReceipt: string | null = null
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
    if (options.expectedRef !== null) {
      assertBranchRef(options.repositoryCwd, options.expectedRef)
      expectedRefForReceipt = options.expectedRef
    }
    ownerCommit = resolveCommit(options.repositoryCwd, options.ownerCommit)

    let target = resolveTarget(options.repositoryCwd, options.worktreeId)
    observedGeneration = target.identity.generation
    observedHead = target.identity.head
    observedRef = target.identity.ref
    assertExpectedIdentity(target.identity, options)
    assertPristine(target.worktreePath)

    target = resolveTarget(target.commonDir, options.worktreeId)
    observedGeneration = target.identity.generation
    observedHead = target.identity.head
    observedRef = target.identity.ref
    assertExpectedIdentity(target.identity, options)
    assertPristine(target.worktreePath)

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

    if (options.expectedRef !== null) {
      const deletion = gitResult(target.commonDir, [
        "update-ref",
        "--no-deref",
        "-d",
        options.expectedRef,
        options.expectedHead,
      ])
      localBranchDeleted = deletion.exitCode === 0
        && gitResult(target.commonDir, [
          "show-ref",
          "--verify",
          "--quiet",
          options.expectedRef,
        ]).exitCode === 1
      if (!localBranchDeleted) {
        return receipt("partial", "local_branch_preserved")
      }
    }
    return receipt("completed", null)
  } catch (error) {
    const reason = error instanceof CleanupError ? error.code : "owner_operation_failed"
    return receipt(worktreeRemoved ? "partial" : "failed", reason)
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
  const gitdirPath = resolve(adminDir, gitdirPointer)
  const worktreePath = dirname(gitdirPath)
  if (!existsSync(worktreePath)) throw new CleanupError("worktree_identity_missing")
  const observedAdminDir = realpathSync(git(worktreePath, [
    "rev-parse",
    "--path-format=absolute",
    "--git-dir",
  ]))
  if (observedAdminDir !== realpathSync(adminDir)) {
    throw new CleanupError("worktree_identity_drift")
  }
  return {
    commonDir,
    adminDir,
    worktreePath,
    identity: identifyLinkedWorktree(worktreePath),
  }
}

function assertExpectedIdentity(identity: WorktreeIdentity, options: RemoveOptions): void {
  if (identity.generation !== options.expectedGeneration) {
    throw new CleanupError("worktree_generation_drift")
  }
  if (identity.head !== options.expectedHead) {
    throw new CleanupError("worktree_head_drift")
  }
  if (identity.ref !== options.expectedRef) {
    throw new CleanupError("worktree_ref_drift")
  }
}

function assertPristine(worktreePath: string): void {
  const index = gitResult(worktreePath, ["ls-files", "-v", "-z"])
  if (index.exitCode !== 0) throw new CleanupError("worktree_inspection_failed")
  if (
    index.stdout.toString().split("\0")
      .some((entry) => entry !== "" && (/^[a-z]/.test(entry) || entry.startsWith("S ")))
  ) {
    throw new CleanupError("worktree_index_hints_present")
  }
  const status = gitResult(worktreePath, [
    "-c",
    "core.fsmonitor=false",
    "status",
    "--porcelain=v1",
    "--untracked-files=all",
    "--ignored=matching",
  ])
  if (status.exitCode !== 0) throw new CleanupError("worktree_inspection_failed")
  if (status.stdout.length > 0) throw new CleanupError("worktree_not_pristine")
  const submodules = gitResult(worktreePath, ["submodule", "status", "--recursive"])
  if (submodules.exitCode !== 0) throw new CleanupError("worktree_inspection_failed")
  if (submodules.stdout.length > 0) {
    throw new CleanupError("worktree_has_registered_submodules")
  }
}

function readHeadRef(cwd: string): string | null {
  const result = gitResult(cwd, ["symbolic-ref", "-q", "HEAD"])
  if (result.exitCode === 0) return result.stdout.toString().trim()
  if (result.exitCode === 1 && result.stderr.length === 0) return null
  throw new CleanupError("worktree_inspection_failed")
}

function readGeneration(path: string): string {
  const generation = readFileSync(path, "utf8").trim()
  assertGeneration(generation)
  return generation
}

function resolveCommit(cwd: string, value: string): string {
  const result = gitResult(cwd, ["rev-parse", "--verify", `${value}^{commit}`])
  if (result.exitCode !== 0) throw new CleanupError("owner_commit_missing")
  return result.stdout.toString().trim()
}

function git(cwd: string, arguments_: string[]): string {
  const result = gitResult(cwd, arguments_)
  if (result.exitCode !== 0) throw new CleanupError("git_operation_failed")
  return result.stdout.toString().trim()
}

function gitResult(cwd: string, arguments_: string[]): CommandResult {
  const result = Bun.spawnSync(["git", "--no-replace-objects", "-C", cwd, ...arguments_], {
    env: { ...process.env, GIT_OPTIONAL_LOCKS: "0" },
    stdout: "pipe",
    stderr: "pipe",
  })
  return {
    exitCode: result.exitCode,
    stdout: result.stdout,
    stderr: result.stderr,
  }
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
  const result = gitResult(cwd, ["check-ref-format", value])
  if (result.exitCode !== 0) throw new CleanupError("invalid_expected_ref")
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
    if (command === "identify") {
      process.stdout.write(`${JSON.stringify(identifyLinkedWorktree(required(values, "cwd")))}\n`)
      return 0
    }
    if (command !== "remove") throw new CleanupError("invalid_arguments")
    const expectedRef = required(values, "expected-ref")
    const receipt = removeOwnedWorktree({
      repositoryCwd: process.cwd(),
      ownerCommit: required(values, "owner-commit"),
      worktreeId: required(values, "worktree-id"),
      expectedGeneration: required(values, "expected-generation"),
      expectedHead: required(values, "expected-head"),
      expectedRef: expectedRef === "null" ? null : expectedRef,
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
