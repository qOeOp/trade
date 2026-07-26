#!/usr/bin/env bun

import {
  existsSync,
  lstatSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  readlinkSync,
  realpathSync,
  rmdirSync,
  writeFileSync,
} from "node:fs"
import { randomBytes } from "node:crypto"
import { basename, dirname, join, resolve } from "node:path"

const IDENTITY_SCHEMA = "trade.worktree-cleanup-identity.v3"
const EXECUTION_SCHEMA = "trade.worktree-cleanup-execution.v3"
const GENERATION_FILE = "trade-cleanup-generation"

export interface WorktreeIdentity {
  schema_version: typeof IDENTITY_SCHEMA
  worktree_id: string
  generation: string
  head: string
  ref: string | null
}

export interface CleanupExecutionReceipt {
  schema_version: typeof EXECUTION_SCHEMA
  operation: "remove-linked-worktree"
  owner_commit: string
  worktree_id: string
  expected_generation: string
  expected_head: string
  expected_ref: string | null
  observed_generation: string | null
  observed_head: string | null
  observed_ref: string | null
  worktree_claimed: boolean
  ignored_residue_removed: boolean
  worktree_removed: boolean
  local_branch_deleted: boolean
  rollback_attempted: boolean
  rollback_completed: boolean
  status: "completed" | "partial" | "failed"
  reason_code?: string
}

export class WorktreeCleanupError extends Error {
  constructor(
    readonly code: string,
    readonly receipt?: CleanupExecutionReceipt,
  ) {
    super(code)
  }
}

interface RemoveOptions {
  repositoryCwd: string
  ownerCommit: string
  worktreeId: string
  expectedGeneration: string
  expectedHead: string
  expectedRef: string | null
  removeIgnored: boolean
}

interface ResolvedTarget {
  commonDir: string
  adminDir: string
  worktreePath: string
  identity: WorktreeIdentity
}

type RefSnapshot = {
  kind: "direct"
} | {
  kind: "symbolic"
  target: string
}

export function identifyLinkedWorktree(cwd: string): WorktreeIdentity {
  const commonDir = git(cwd, ["rev-parse", "--path-format=absolute", "--git-common-dir"])
  const gitDir = git(cwd, ["rev-parse", "--path-format=absolute", "--git-dir"])
  if (realpathSync(commonDir) === realpathSync(gitDir)) {
    throw new WorktreeCleanupError("primary_worktree_not_supported")
  }
  const worktreesDir = realpathSync(join(commonDir, "worktrees"))
  const adminDir = realpathSync(gitDir)
  if (dirname(adminDir) !== worktreesDir) {
    throw new WorktreeCleanupError("unrecognized_worktree_admin")
  }
  const worktreeId = basename(adminDir)
  assertWorktreeId(worktreeId)
  return {
    schema_version: IDENTITY_SCHEMA,
    worktree_id: worktreeId,
    generation: identifyGeneration(adminDir),
    head: git(cwd, ["rev-parse", "HEAD"]),
    ref: symbolicRef(cwd),
  }
}

export function removeOwnedWorktree(options: RemoveOptions): CleanupExecutionReceipt {
  let observed: WorktreeIdentity | undefined
  let initial: ResolvedTarget | undefined
  let ownerCwd = options.repositoryCwd
  let quarantineParent: string | undefined
  let quarantinePath: string | undefined
  let moved = false
  let everClaimed = false
  let ignoredRemoved = false
  let removed = false
  let refDeleted = false
  let refSnapshot: RefSnapshot | undefined
  let guardRef: string | undefined
  let rollbackAttempted = false
  let rollbackCompleted = false
  try {
    assertHead(options.ownerCommit)
    assertWorktreeId(options.worktreeId)
    assertHead(options.expectedHead)
    if (options.expectedRef !== null) assertRef(options.repositoryCwd, options.expectedRef)
    assertOwnerTool(options)
    initial = resolveTarget(options)
    observed = initial.identity
    assertExpectedIdentity(initial.identity, options)
    assertClean(initial.worktreePath)
    assertNoTargetUsers(initial.worktreePath)
    ownerCwd = initial.commonDir
    const claimedOptions = { ...options, repositoryCwd: ownerCwd }

    quarantineParent = mkdtempSync(join(dirname(initial.worktreePath), ".worktree-cleanup-"))
    quarantinePath = join(quarantineParent, "target")
    git(ownerCwd, ["worktree", "move", "--", initial.worktreePath, quarantinePath])
    moved = true
    everClaimed = true

    const claimed = resolveTarget(claimedOptions)
    observed = claimed.identity
    if (resolve(claimed.worktreePath) !== resolve(quarantinePath)) {
      throw new WorktreeCleanupError("claimed_path_mismatch")
    }
    assertExpectedIdentity(claimed.identity, options)
    assertClean(claimed.worktreePath)
    assertNoTargetUsers(claimed.worktreePath)
    if (git(claimed.worktreePath, ["clean", "-ndX"])) {
      if (!options.removeIgnored) throw new WorktreeCleanupError("worktree_has_ignored_files")
      git(claimed.worktreePath, ["clean", "-fdX"])
      ignoredRemoved = true
      assertNoIgnoredFiles(claimed.worktreePath)
      assertNoTargetUsers(claimed.worktreePath)
    }

    if (options.expectedRef !== null) {
      refSnapshot = snapshotRef(ownerCwd, options.expectedRef, options.expectedHead)
      guardRef = claimRef(ownerCwd, options.expectedRef, options.expectedHead, refSnapshot)
      refDeleted = true
      git(claimed.worktreePath, ["symbolic-ref", "HEAD", guardRef])
    }

    git(ownerCwd, ["worktree", "remove", "--", quarantinePath])
    removed = true
    if (guardRef) {
      const deleteGuard = gitResult(ownerCwd, ["update-ref", "-d", guardRef, options.expectedHead])
      if (deleteGuard.exitCode !== 0) {
        throw new WorktreeCleanupError("guard_ref_cleanup_failed")
      }
    }

    return {
      schema_version: EXECUTION_SCHEMA,
      operation: "remove-linked-worktree",
      owner_commit: options.ownerCommit,
      worktree_id: options.worktreeId,
      expected_generation: options.expectedGeneration,
      expected_head: options.expectedHead,
      expected_ref: options.expectedRef,
      observed_generation: claimed.identity.generation,
      observed_head: claimed.identity.head,
      observed_ref: claimed.identity.ref,
      worktree_claimed: true,
      ignored_residue_removed: ignoredRemoved,
      worktree_removed: true,
      local_branch_deleted: options.expectedRef !== null
        && gitResult(ownerCwd, ["show-ref", "--verify", "--quiet", options.expectedRef]).exitCode !== 0,
      rollback_attempted: false,
      rollback_completed: false,
      status: "completed",
    }
  } catch (error) {
    if (error instanceof WorktreeCleanupError && error.receipt) throw error
    const reason = error instanceof WorktreeCleanupError ? error.code : "owner_operation_failed"
    if ((refDeleted || moved) && !removed && quarantinePath && initial) {
      rollbackAttempted = true
      try {
        if (refDeleted && options.expectedRef !== null && refSnapshot) {
          restoreRef(ownerCwd, options.expectedRef, options.expectedHead, refSnapshot)
          git(quarantinePath, ["symbolic-ref", "HEAD", options.expectedRef])
          refDeleted = false
          if (!guardRef) throw new WorktreeCleanupError("guard_ref_missing")
          const deleteGuard = gitResult(ownerCwd, ["update-ref", "-d", guardRef, options.expectedHead])
          if (deleteGuard.exitCode !== 0) {
            throw new WorktreeCleanupError("guard_ref_cleanup_failed")
          }
        }
        rollbackMove(ownerCwd, quarantinePath, initial.worktreePath)
        moved = false
        rollbackCompleted = true
      } catch {
        const localBranchDeleted = refDeleted
          && options.expectedRef !== null
          && gitResult(ownerCwd, [
            "show-ref",
            "--verify",
            "--quiet",
            options.expectedRef,
          ]).exitCode !== 0
        throw new WorktreeCleanupError("rollback_failed", failureReceipt(
          options,
          "rollback_failed",
          observed,
          everClaimed,
          ignoredRemoved,
          false,
          localBranchDeleted,
          true,
          false,
        ))
      }
    }
    throw new WorktreeCleanupError(reason, failureReceipt(
      options,
      reason,
      observed,
      everClaimed,
      ignoredRemoved,
      removed,
      refDeleted,
      rollbackAttempted,
      rollbackCompleted,
    ))
  } finally {
    if (quarantineParent && existsSync(quarantineParent)) {
      try {
        rmdirSync(quarantineParent)
      } catch {
        // Preserve any non-empty quarantine for owner recovery through its opaque worktree id.
      }
    }
  }
}

function resolveTarget(options: RemoveOptions): ResolvedTarget {
  const commonDir = git(options.repositoryCwd, [
    "rev-parse",
    "--path-format=absolute",
    "--git-common-dir",
  ])
  const worktreesDir = realpathSync(join(commonDir, "worktrees"))
  const adminCandidate = join(worktreesDir, options.worktreeId)
  if (!existsSync(adminCandidate) || lstatSync(adminCandidate).isSymbolicLink()) {
    throw new WorktreeCleanupError("worktree_identity_not_found")
  }
  const adminDir = realpathSync(adminCandidate)
  if (dirname(adminDir) !== worktreesDir || basename(adminDir) !== options.worktreeId) {
    throw new WorktreeCleanupError("worktree_identity_escape")
  }
  const gitdirFile = join(adminDir, "gitdir")
  if (!lstatSync(gitdirFile).isFile()) throw new WorktreeCleanupError("invalid_gitdir_pointer")
  const gitFilePath = readFileSync(gitdirFile, "utf8").trim()
  if (basename(gitFilePath) !== ".git") throw new WorktreeCleanupError("invalid_gitdir_pointer")
  const worktreePath = dirname(gitFilePath)
  if (!existsSync(worktreePath)) throw new WorktreeCleanupError("worktree_path_missing")
  const worktreeStat = lstatSync(worktreePath)
  if (!worktreeStat.isDirectory() || worktreeStat.isSymbolicLink()) {
    throw new WorktreeCleanupError("invalid_worktree_path")
  }
  const resolvedAdmin = realpathSync(
    git(worktreePath, ["rev-parse", "--path-format=absolute", "--git-dir"]),
  )
  if (resolvedAdmin !== adminDir) throw new WorktreeCleanupError("worktree_admin_mismatch")
  return {
    commonDir,
    adminDir,
    worktreePath,
    identity: {
      schema_version: IDENTITY_SCHEMA,
      worktree_id: options.worktreeId,
      generation: readGeneration(adminDir),
      head: git(worktreePath, ["rev-parse", "HEAD"]),
      ref: symbolicRef(worktreePath),
    },
  }
}

function assertExpectedIdentity(identity: WorktreeIdentity, options: RemoveOptions): void {
  if (identity.generation !== options.expectedGeneration) {
    throw new WorktreeCleanupError("target_generation_mismatch")
  }
  if (identity.head !== options.expectedHead) {
    throw new WorktreeCleanupError("target_head_mismatch")
  }
  if (identity.ref !== options.expectedRef) {
    throw new WorktreeCleanupError("target_ref_mismatch")
  }
}

function assertClean(worktreePath: string): void {
  if (git(worktreePath, ["status", "--porcelain=v1", "--untracked-files=all"])) {
    throw new WorktreeCleanupError("worktree_not_clean")
  }
}

function assertNoIgnoredFiles(worktreePath: string): void {
  if (git(worktreePath, ["clean", "-ndX"])) {
    throw new WorktreeCleanupError("worktree_has_ignored_files")
  }
}

function assertNoTargetUsers(worktreePath: string): void {
  if (process.platform === "linux") {
    assertNoLinuxTargetUsers(worktreePath)
    return
  }
  if (process.platform === "darwin") {
    const openFiles = Bun.spawnSync(["/usr/sbin/lsof", "-t", "+D", worktreePath], {
      stdout: "pipe",
      stderr: "pipe",
    })
    if (openFiles.stdout.length > 0) {
      throw new WorktreeCleanupError("target_in_use")
    }
    if (
      openFiles.exitCode !== 0
      && (openFiles.exitCode !== 1 || openFiles.stderr.length > 0)
    ) {
      throw new WorktreeCleanupError("process_guard_unavailable")
    }
    const workingDirectories = Bun.spawnSync(["/usr/sbin/lsof", "-d", "cwd", "-F", "n"], {
      stdout: "pipe",
      stderr: "pipe",
    })
    if (workingDirectories.exitCode !== 0) {
      throw new WorktreeCleanupError("process_guard_unavailable")
    }
    const used = workingDirectories.stdout.toString().split("\n")
      .filter((line) => line.startsWith("n"))
      .map((line) => line.slice(1))
      .some((path) => path === worktreePath || path.startsWith(`${worktreePath}/`))
    if (used) throw new WorktreeCleanupError("target_in_use")
    return
  }
  throw new WorktreeCleanupError("process_guard_unavailable")
}

function assertNoLinuxTargetUsers(worktreePath: string): void {
  try {
    assertNoProcTargetUsers(worktreePath)
    return
  } catch (error) {
    if (!(error instanceof WorktreeCleanupError) || error.code !== "process_guard_unavailable") {
      throw error
    }
  }

  const paths: string[] = []
  try {
    collectTargetPaths(worktreePath, paths)
  } catch {
    throw new WorktreeCleanupError("process_guard_unavailable")
  }
  for (let index = 0; index < paths.length; index += 128) {
    const batch = paths.slice(index, index + 128)
    const fuser = [
      "/bin/sh",
      "-c",
      "cap=; while read -r key value; do [ \"$key\" = \"CapEff:\" ] && cap=$value; done < /proc/self/status; [ $((0x$cap & 0x80000)) -ne 0 ] || exit 125; exec /usr/bin/fuser -a \"$@\"",
      "fuser",
      ...batch,
    ]
    const command = process.geteuid?.() === 0
      ? fuser
      : ["/usr/bin/sudo", "-n", "--", ...fuser]
    const result = Bun.spawnSync(command, {
      env: { ...process.env, LC_ALL: "C" },
      stdout: "pipe",
      stderr: "pipe",
    })
    if (result.stdout.length > 0) throw new WorktreeCleanupError("target_in_use")
    const expectedStderr = batch.map((path) => `${path}:\n`).join("")
    if (result.exitCode !== 1 || result.stderr.toString() !== expectedStderr) {
      throw new WorktreeCleanupError("process_guard_unavailable")
    }
  }
}

function assertNoProcTargetUsers(worktreePath: string): void {
  let processes
  try {
    processes = readdirSync("/proc", { withFileTypes: true })
      .filter((entry) => entry.isDirectory() && /^\d+$/.test(entry.name))
  } catch {
    throw new WorktreeCleanupError("process_guard_unavailable")
  }

  for (const processEntry of processes) {
    const processPath = join("/proc", processEntry.name)
    for (const linkName of ["cwd", "root"]) {
      const usedPath = readProcessLink(join(processPath, linkName))
      if (usedPath !== null && pathUsesTarget(usedPath, worktreePath)) {
        throw new WorktreeCleanupError("target_in_use")
      }
    }

    let fileDescriptors
    try {
      fileDescriptors = readdirSync(join(processPath, "fd"))
    } catch (error) {
      if (isMissingProcessEntry(error)) continue
      throw new WorktreeCleanupError("process_guard_unavailable")
    }
    for (const fileDescriptor of fileDescriptors) {
      const usedPath = readProcessLink(join(processPath, "fd", fileDescriptor))
      if (usedPath !== null && pathUsesTarget(usedPath, worktreePath)) {
        throw new WorktreeCleanupError("target_in_use")
      }
    }
  }
}

function readProcessLink(path: string): string | null {
  try {
    return readlinkSync(path)
  } catch (error) {
    if (isMissingProcessEntry(error)) return null
    throw new WorktreeCleanupError("process_guard_unavailable")
  }
}

function isMissingProcessEntry(error: unknown): boolean {
  return error instanceof Error && "code" in error && error.code === "ENOENT"
}

function pathUsesTarget(path: string, worktreePath: string): boolean {
  const normalizedPath = path.endsWith(" (deleted)") ? path.slice(0, -10) : path
  return normalizedPath === worktreePath || normalizedPath.startsWith(`${worktreePath}/`)
}

function collectTargetPaths(directory: string, paths: string[]): void {
  if (directory.includes("\n")) throw new WorktreeCleanupError("process_guard_unavailable")
  paths.push(directory)
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name)
    if (path.includes("\n")) throw new WorktreeCleanupError("process_guard_unavailable")
    if (entry.isSymbolicLink()) continue
    if (entry.isDirectory()) {
      collectTargetPaths(path, paths)
    } else {
      paths.push(path)
    }
  }
}

function assertOwnerTool(options: RemoveOptions): void {
  const result = gitResult(options.repositoryCwd, [
    "cat-file",
    "-e",
    `${options.ownerCommit}:scripts/worktree-cleanup.ts`,
  ])
  if (result.exitCode !== 0) throw new WorktreeCleanupError("owner_tool_identity_missing")
}

function failureReceipt(
  options: RemoveOptions,
  reasonCode: string,
  observed: WorktreeIdentity | undefined,
  worktreeClaimed: boolean,
  ignoredResidueRemoved: boolean,
  worktreeRemoved: boolean,
  localBranchDeleted: boolean,
  rollbackAttempted: boolean,
  rollbackCompleted: boolean,
): CleanupExecutionReceipt {
  return {
    schema_version: EXECUTION_SCHEMA,
    operation: "remove-linked-worktree",
    owner_commit: sanitizeHead(options.ownerCommit),
    worktree_id: sanitizeWorktreeId(options.worktreeId),
    expected_generation: sanitizeGeneration(options.expectedGeneration),
    expected_head: sanitizeHead(options.expectedHead),
    expected_ref: sanitizeRef(options.expectedRef),
    observed_generation: observed ? sanitizeGeneration(observed.generation) : null,
    observed_head: observed ? sanitizeHead(observed.head) : null,
    observed_ref: observed ? sanitizeRef(observed.ref) : null,
    worktree_claimed: worktreeClaimed,
    ignored_residue_removed: ignoredResidueRemoved,
    worktree_removed: worktreeRemoved,
    local_branch_deleted: localBranchDeleted,
    rollback_attempted: rollbackAttempted,
    rollback_completed: rollbackCompleted,
    status: worktreeRemoved || localBranchDeleted ? "partial" : "failed",
    reason_code: reasonCode,
  }
}

function snapshotRef(cwd: string, ref: string, expectedHead: string): RefSnapshot {
  const symbolic = gitResult(cwd, ["symbolic-ref", "-q", "--no-recurse", ref])
  const snapshot = symbolic.exitCode === 0
    ? { kind: "symbolic" as const, target: symbolic.stdout.toString().trim() }
    : { kind: "direct" as const }
  if (
    symbolic.exitCode !== 0
    && (symbolic.exitCode !== 1 || symbolic.stderr.length > 0)
  ) {
    throw new WorktreeCleanupError("branch_identity_drift_before_worktree_removal")
  }
  if (gitResult(cwd, ["rev-parse", "--verify", ref]).stdout.toString().trim() !== expectedHead) {
    throw new WorktreeCleanupError("branch_identity_drift_before_worktree_removal")
  }
  return snapshot
}

function claimRef(
  cwd: string,
  ref: string,
  expectedHead: string,
  snapshot: RefSnapshot,
): string {
  const guardRef = `refs/worktree-cleanup/${randomBytes(32).toString("hex")}`
  const transaction = [
    `create ${guardRef} ${expectedHead}`,
    ...(snapshot.kind === "symbolic" ? [`verify ${snapshot.target} ${expectedHead}`] : []),
    "option no-deref",
    snapshot.kind === "direct"
      ? `delete ${ref} ${expectedHead}`
      : `symref-delete ${ref} ${snapshot.target}`,
    "",
  ].join("\n")
  const result = Bun.spawnSync(["git", "-C", cwd, "update-ref", "--stdin"], {
    stdin: Buffer.from(transaction),
    stdout: "pipe",
    stderr: "pipe",
  })
  if (result.exitCode !== 0) {
    throw new WorktreeCleanupError("branch_identity_drift_before_worktree_removal")
  }
  return guardRef
}

function restoreRef(
  cwd: string,
  ref: string,
  expectedHead: string,
  snapshot: RefSnapshot,
): void {
  const result = snapshot.kind === "direct"
    ? gitResult(cwd, ["update-ref", "--no-deref", ref, expectedHead, "0".repeat(40)])
    : Bun.spawnSync(["git", "-C", cwd, "update-ref", "--stdin"], {
      stdin: Buffer.from([
        `verify ${snapshot.target} ${expectedHead}`,
        "option no-deref",
        `symref-create ${ref} ${snapshot.target}`,
        "",
      ].join("\n")),
      stdout: "pipe",
      stderr: "pipe",
    })
  if (result.exitCode !== 0) throw new WorktreeCleanupError("ref_restore_failed")
}

function rollbackMove(repositoryCwd: string, quarantinePath: string, originalPath: string): void {
  if (!existsSync(quarantinePath) || existsSync(originalPath)) {
    throw new WorktreeCleanupError("rollback_unavailable")
  }
  const result = gitResult(repositoryCwd, ["worktree", "move", "--", quarantinePath, originalPath])
  if (result.exitCode !== 0) throw new WorktreeCleanupError("rollback_failed")
}

function assertWorktreeId(value: string): void {
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(value) || value === "." || value === "..") {
    throw new WorktreeCleanupError("invalid_worktree_id")
  }
}

function identifyGeneration(adminDir: string): string {
  const generationPath = join(adminDir, GENERATION_FILE)
  if (!existsSync(generationPath)) {
    try {
      writeFileSync(generationPath, `${randomBytes(32).toString("hex")}\n`, {
        encoding: "utf8",
        flag: "wx",
        mode: 0o600,
      })
    } catch {
      if (!existsSync(generationPath)) {
        throw new WorktreeCleanupError("worktree_generation_unavailable")
      }
    }
  }
  return readGeneration(adminDir)
}

function readGeneration(adminDir: string): string {
  const generationPath = join(adminDir, GENERATION_FILE)
  if (!existsSync(generationPath)) {
    throw new WorktreeCleanupError("worktree_generation_missing")
  }
  const generationStat = lstatSync(generationPath)
  if (!generationStat.isFile() || generationStat.isSymbolicLink()) {
    throw new WorktreeCleanupError("invalid_worktree_generation")
  }
  const generation = readFileSync(generationPath, "utf8").trim()
  if (!/^[0-9a-f]{64}$/.test(generation)) {
    throw new WorktreeCleanupError("invalid_worktree_generation")
  }
  return generation
}

function assertHead(value: string): void {
  if (!/^[0-9a-f]{40,64}$/.test(value)) throw new WorktreeCleanupError("invalid_expected_head")
}

function assertRef(cwd: string, value: string): void {
  if (!value.startsWith("refs/heads/")) throw new WorktreeCleanupError("invalid_expected_ref")
  if (gitResult(cwd, ["check-ref-format", value]).exitCode !== 0) {
    throw new WorktreeCleanupError("invalid_expected_ref")
  }
}

function symbolicRef(cwd: string): string | null {
  const result = gitResult(cwd, ["symbolic-ref", "-q", "--no-recurse", "HEAD"])
  if (result.exitCode === 0) return result.stdout.toString().trim()
  if (result.exitCode === 1 && result.stderr.length === 0) return null
  throw new WorktreeCleanupError("git_operation_failed")
}

function sanitizeWorktreeId(value: string): string {
  return /^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(value) && value !== "." && value !== ".."
    ? value
    : "[invalid]"
}

function sanitizeGeneration(value: string): string {
  return /^[0-9a-f]{64}$/.test(value) ? value : "[invalid]"
}

function sanitizeHead(value: string): string {
  return /^[0-9a-f]{40,64}$/.test(value) ? value : "[invalid]"
}

function sanitizeRef(value: string | null): string | null {
  if (!value?.startsWith("refs/heads/")) return null
  const result = Bun.spawnSync(["git", "check-ref-format", value], {
    stdout: "ignore",
    stderr: "ignore",
  })
  return result.exitCode === 0 ? value : null
}

function git(cwd: string, args: string[]): string {
  const result = gitResult(cwd, args)
  if (result.exitCode !== 0) throw new WorktreeCleanupError("git_operation_failed")
  return result.stdout.toString().trim()
}

function gitResult(cwd: string, args: string[]): ReturnType<typeof Bun.spawnSync> {
  return Bun.spawnSync(["git", "-C", cwd, ...args], { stdout: "pipe", stderr: "pipe" })
}

function parseArgs(args: string[]): { action: "identify"; cwd: string } | {
  action: "remove"
  options: RemoveOptions
} {
  const action = args.shift()
  if (action === "identify") {
    if (args.length !== 0) throw new WorktreeCleanupError("unexpected_argument")
    return { action, cwd: process.cwd() }
  }
  if (action !== "remove") throw new WorktreeCleanupError("invalid_action")

  const values = new Map<string, string>()
  for (let index = 0; index < args.length; index += 2) {
    const flag = args[index]
    const value = args[index + 1]
    if (!flag?.startsWith("--") || !value) throw new WorktreeCleanupError("invalid_argument")
    if (values.has(flag)) throw new WorktreeCleanupError("duplicate_argument")
    values.set(flag, value)
  }
  const allowed = new Set([
    "--owner-commit",
    "--worktree-id",
    "--expected-generation",
    "--expected-head",
    "--expected-ref",
    "--remove-ignored",
  ])
  if ([...values.keys()].some((key) => !allowed.has(key))) {
    throw new WorktreeCleanupError("unknown_argument")
  }
  const ownerCommit = values.get("--owner-commit")
  const worktreeId = values.get("--worktree-id")
  const expectedGeneration = values.get("--expected-generation")
  const expectedHead = values.get("--expected-head")
  const expectedRef = values.get("--expected-ref") ?? null
  const removeIgnoredValue = values.get("--remove-ignored") ?? "false"
  if (!ownerCommit || !worktreeId || !expectedGeneration || !expectedHead) {
    throw new WorktreeCleanupError("missing_argument")
  }
  if (removeIgnoredValue !== "true" && removeIgnoredValue !== "false") {
    throw new WorktreeCleanupError("invalid_remove_ignored")
  }
  return {
    action,
    options: {
      repositoryCwd: process.cwd(),
      ownerCommit,
      worktreeId,
      expectedGeneration,
      expectedHead,
      expectedRef,
      removeIgnored: removeIgnoredValue === "true",
    },
  }
}

function output(value: unknown): void {
  process.stdout.write(`${JSON.stringify(value)}\n`)
}

if (import.meta.main) {
  try {
    const parsed = parseArgs(process.argv.slice(2))
    output(parsed.action === "identify"
      ? identifyLinkedWorktree(parsed.cwd)
      : removeOwnedWorktree(parsed.options))
  } catch (error) {
    const failure = error instanceof WorktreeCleanupError ? error : new WorktreeCleanupError("unknown")
    output(failure.receipt ?? {
      schema_version: EXECUTION_SCHEMA,
      operation: "remove-linked-worktree",
      status: "failed",
      reason_code: failure.code,
    })
    process.exit(1)
  }
}
