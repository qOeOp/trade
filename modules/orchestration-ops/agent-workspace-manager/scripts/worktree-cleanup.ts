#!/usr/bin/env bun

import {
  closeSync,
  copyFileSync,
  existsSync,
  fchmodSync,
  fstatSync,
  ftruncateSync,
  fsyncSync,
  linkSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  openSync,
  readdirSync,
  readFileSync,
  readlinkSync,
  realpathSync,
  renameSync,
  rmSync,
  rmdirSync,
  statSync,
  unlinkSync,
  writeFileSync,
  writeSync,
} from "node:fs"
import { createHash, randomBytes } from "node:crypto"
import { basename, dirname, join, resolve } from "node:path"

const IDENTITY_SCHEMA = "trade.worktree-cleanup-identity.v3"
const EXECUTION_SCHEMA = "trade.worktree-cleanup-execution.v4"
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
  preserved_ref: string | null
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
    readonly preservedRef?: string,
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

interface FileIdentity {
  dev: bigint
  ino: bigint
}

interface FileInstanceIdentity extends FileIdentity {
  ctimeNs: bigint
}

type RefSnapshot = {
  kind: "direct"
  reflog: IdentifiedFileSnapshot | null
  looseRef: IdentifiedFileSnapshot | null
  packedRefsIdentity?: FileInstanceIdentity | null
  packedEntry: PackedRefSnapshot | null
} | {
  kind: "symbolic"
  target: string
  chain: SymbolicRefChainEntry[]
  mode: number
  packedEntry: PackedRefSnapshot | null
}

interface FileSnapshot {
  contents: Buffer
  mode: number
}

interface IdentifiedFileSnapshot extends FileSnapshot {
  identity: FileInstanceIdentity
}

interface ClaimedRef {
  ref: string
  snapshot: Extract<RefSnapshot, { kind: "direct" }>
}

interface PackedRefSnapshot {
  line: string
  index: number
  previousLine: string | null
  nextLine: string | null
}

interface SymbolicRefChainEntry {
  ref: string
  target: string | null
}

interface PipedCommandResult {
  exitCode: number
  stdout: Buffer
  stderr: Buffer
}

interface OwnedRefLock {
  path: string
  fd: number
  identity: FileIdentity
  createdParents: string[]
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
  let guardSnapshot: Extract<RefSnapshot, { kind: "direct" }> | undefined
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
    assertNoTargetUsers(initial.worktreePath, initial.adminDir)
    assertNoRegisteredSubmodules(initial.worktreePath)
    ownerCwd = initial.commonDir
    if (options.expectedRef !== null) assertFilesRefStorage(ownerCwd)
    const claimedOptions = { ...options, repositoryCwd: ownerCwd }

    quarantineParent = mkdtempSync(join(dirname(initial.worktreePath), ".worktree-cleanup-"))
    quarantinePath = join(quarantineParent, "target")
    const moveResult = gitResult(ownerCwd, [
      "worktree",
      "move",
      "--",
      initial.worktreePath,
      quarantinePath,
    ])
    if (
      moveResult.exitCode === 0
      || (!existsSync(initial.worktreePath) && existsSync(quarantinePath))
    ) {
      moved = true
      everClaimed = true
    }
    if (!moved) throw new WorktreeCleanupError("git_operation_failed")
    const claimed = resolveTarget(claimedOptions)
    observed = claimed.identity
    if (resolve(claimed.worktreePath) !== resolve(quarantinePath)) {
      throw new WorktreeCleanupError("claimed_path_mismatch")
    }
    if (moveResult.exitCode !== 0) {
      throw new WorktreeCleanupError("git_operation_failed")
    }
    assertExpectedIdentity(claimed.identity, options)
    assertClean(claimed.worktreePath)
    assertNoTargetUsers(claimed.worktreePath, claimed.adminDir)
    if (process.platform === "linux") {
      assertNoUnixSockets([initial.worktreePath, initial.adminDir], false)
    }
    if (process.platform === "linux") {
      const staleSockets = collectUnixSocketFiles(claimed.worktreePath)
      if (staleSockets.length > 0) {
        if (!options.removeIgnored) throw new WorktreeCleanupError("worktree_has_ignored_files")
        for (const socketPath of staleSockets) {
          const ignored = gitResult(claimed.worktreePath, [
            "check-ignore",
            "-q",
            "--",
            socketPath,
          ])
          if (ignored.exitCode !== 0) {
            throw new WorktreeCleanupError("worktree_has_untracked_files")
          }
          unlinkSync(socketPath)
          ignoredRemoved = true
        }
      }
    }
    if (git(claimed.worktreePath, ["clean", "-ndffX"])) {
      if (!options.removeIgnored) throw new WorktreeCleanupError("worktree_has_ignored_files")
      const entriesBefore = targetEntries(claimed.worktreePath)
      try {
        git(claimed.worktreePath, ["clean", "-fdffX"])
        ignoredRemoved = true
      } catch (error) {
        const entriesAfter = targetEntries(claimed.worktreePath)
        ignoredRemoved = [...entriesBefore].some((entry) => !entriesAfter.has(entry))
        throw error
      }
      assertNoIgnoredFiles(claimed.worktreePath)
      assertNoTargetUsers(claimed.worktreePath, claimed.adminDir)
      if (process.platform === "linux") {
        assertNoUnixSockets([initial.worktreePath, initial.adminDir], false)
      }
    }

    if (options.expectedRef !== null) {
      assertRefOwnedByWorktree(ownerCwd, options.expectedRef, claimed.worktreePath)
      refSnapshot = snapshotRef(ownerCwd, options.expectedRef, options.expectedHead)
      const claimedRef = claimRef(ownerCwd, options.expectedRef, options.expectedHead, refSnapshot)
      guardRef = claimedRef.ref
      guardSnapshot = claimedRef.snapshot
      refDeleted = true
      git(claimed.worktreePath, ["symbolic-ref", "HEAD", guardRef])
      if (git(ownerCwd, ["rev-parse", "--verify", guardRef]) !== options.expectedHead) {
        throw new WorktreeCleanupError("branch_identity_drift_before_worktree_removal")
      }
      assertRefOwnedByWorktree(ownerCwd, guardRef, claimed.worktreePath)
      assertRefNotCheckedOut(ownerCwd, options.expectedRef)
    }

    assertClean(claimed.worktreePath)
    assertNoIgnoredFiles(claimed.worktreePath)
    assertNoTargetUsers(claimed.worktreePath, claimed.adminDir)
    if (process.platform === "linux") {
      assertNoUnixSockets([initial.worktreePath, initial.adminDir], false)
    }
    const removeResult = gitResult(ownerCwd, ["worktree", "remove", "--", quarantinePath])
    removed = !existsSync(claimed.adminDir) && !existsSync(quarantinePath)
    if (removeResult.exitCode !== 0 && !removed) {
      throw new WorktreeCleanupError("git_operation_failed")
    }
    if (!removed) throw new WorktreeCleanupError("worktree_removal_incomplete")
    if (guardRef) {
      const originalRef = options.expectedRef
      if (originalRef === null) {
        throw new WorktreeCleanupError("guard_ref_missing")
      }
      deleteGuardRef(
        ownerCwd,
        guardRef,
        options.expectedHead,
        guardSnapshot,
        refSnapshot,
        originalRef,
      )
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
      preserved_ref: null,
      worktree_claimed: true,
      ignored_residue_removed: ignoredRemoved,
      worktree_removed: true,
      local_branch_deleted: options.expectedRef !== null
        && refMissingNoDeref(ownerCwd, options.expectedRef),
      rollback_attempted: false,
      rollback_completed: false,
      status: "completed",
    }
  } catch (error) {
    if (error instanceof WorktreeCleanupError && error.receipt) throw error
    if (error instanceof WorktreeCleanupError && error.preservedRef) {
      guardRef = error.preservedRef
    }
    if (guardRef && !guardSnapshot) {
      try {
        guardSnapshot = snapshotGuardRef(ownerCwd, guardRef, options.expectedHead)
      } catch {
        // Preserve the unverified guard for owner recovery.
      }
    }
    if (
      guardRef
      && refSnapshot
      && options.expectedRef !== null
      && refMissingNoDeref(ownerCwd, options.expectedRef)
    ) {
      refDeleted = true
    }
    const reason = error instanceof WorktreeCleanupError ? error.code : "owner_operation_failed"
    if ((refDeleted || moved) && !removed && quarantinePath && initial) {
      rollbackAttempted = true
      try {
        let restoredClaimedRef = false
        if (refDeleted && options.expectedRef !== null && refSnapshot) {
          if (!guardRef) throw new WorktreeCleanupError("guard_ref_missing")
          restoreRef(ownerCwd, options.expectedRef, options.expectedHead, guardRef, refSnapshot)
          git(quarantinePath, ["symbolic-ref", "HEAD", options.expectedRef])
          refDeleted = false
          restoredClaimedRef = true
        }
        rollbackMove(ownerCwd, quarantinePath, initial.worktreePath)
        moved = false
        if (
          restoredClaimedRef
          && guardRef
          && options.expectedRef !== null
          && refSnapshot
        ) {
          deleteGuardRef(
            ownerCwd,
            guardRef,
            options.expectedHead,
            guardSnapshot,
            refSnapshot,
            options.expectedRef,
          )
        }
        rollbackCompleted = true
      } catch {
        const preservedRef = survivingGuardRef(ownerCwd, guardRef)
        throw new WorktreeCleanupError("rollback_failed", failureReceipt(
          options,
          "rollback_failed",
          observed,
          everClaimed,
          ignoredRemoved,
          false,
          false,
          true,
          false,
          preservedRef,
        ))
      }
    }
    const preservedRef = survivingGuardRef(ownerCwd, guardRef)
    throw new WorktreeCleanupError(reason, failureReceipt(
      options,
      reason,
      observed,
      everClaimed,
      ignoredRemoved,
      removed,
      refDeleted
        && options.expectedRef !== null
        && preservedRef === null
        && refMissingNoDeref(ownerCwd, options.expectedRef),
      rollbackAttempted,
      rollbackCompleted,
      preservedRef,
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
  const indexPath = git(worktreePath, ["rev-parse", "--path-format=absolute", "--git-path", "index"])
  const inspectionDirectory = mkdtempSync(join(dirname(indexPath), ".worktree-cleanup-index-"))
  const inspectionIndex = join(inspectionDirectory, "index")
  try {
    copyFileSync(indexPath, inspectionIndex)
    const inspectionEnvironment = {
      ...process.env,
      GIT_INDEX_FILE: inspectionIndex,
      GIT_OPTIONAL_LOCKS: "0",
    }
    const tracked = gitResultWithEnvironment(
      worktreePath,
      ["ls-files", "-z"],
      inspectionEnvironment,
    )
    if (tracked.exitCode !== 0) throw new WorktreeCleanupError("git_operation_failed")
    const tagged = gitResultWithEnvironment(
      worktreePath,
      ["ls-files", "-t", "-z"],
      inspectionEnvironment,
    )
    if (tagged.exitCode !== 0) throw new WorktreeCleanupError("git_operation_failed")
    const materializedSkipWorktreePaths: Buffer[] = []
    for (let start = 0; start < tagged.stdout.length;) {
      const end = tagged.stdout.indexOf(0, start)
      if (end === -1) throw new WorktreeCleanupError("git_operation_failed")
      const entry = tagged.stdout.subarray(start, end)
      if (entry[0] === 0x53 && entry[1] === 0x20) {
        const path = entry.subarray(2)
        try {
          lstatSync(Buffer.concat([Buffer.from(`${worktreePath}/`), path]))
          materializedSkipWorktreePaths.push(path, Buffer.from([0]))
        } catch {
          // An absent skip-worktree path is a valid sparse-checkout omission.
        }
      }
      start = end + 1
    }
    const materializedSkipWorktree = Buffer.concat(materializedSkipWorktreePaths)
    for (const [flag, paths] of [
      ["--no-assume-unchanged", tracked.stdout],
      ["--no-skip-worktree", materializedSkipWorktree],
    ] as const) {
      if (paths.length === 0) continue
      const clearHints = Bun.spawnSync([
        "git",
        "-C",
        worktreePath,
        "--no-replace-objects",
        "-c",
        "core.fsmonitor=false",
        "update-index",
        "-z",
        flag,
        "--stdin",
      ], {
        env: inspectionEnvironment,
        stdin: paths,
        stdout: "pipe",
        stderr: "pipe",
      })
      if (clearHints.exitCode !== 0) throw new WorktreeCleanupError("git_operation_failed")
    }
    const refresh = gitResultWithEnvironment(
      worktreePath,
      ["-c", "core.fsmonitor=false", "update-index", "--really-refresh"],
      inspectionEnvironment,
    )
    const trackedDiff = gitResultWithEnvironment(
      worktreePath,
      ["-c", "core.fsmonitor=false", "diff-files", "--quiet", "--ignore-submodules", "--"],
      inspectionEnvironment,
    )
    const status = gitResultWithEnvironment(
      worktreePath,
      ["-c", "core.fsmonitor=false", "status", "--porcelain=v1", "--untracked-files=all"],
      inspectionEnvironment,
    )
    if (
      refresh.exitCode !== 0
      || trackedDiff.exitCode !== 0
      || status.exitCode !== 0
      || status.stdout.length > 0
    ) {
      throw new WorktreeCleanupError("worktree_not_clean")
    }
  } finally {
    rmSync(inspectionDirectory, { recursive: true, force: true })
  }
}

function assertNoIgnoredFiles(worktreePath: string): void {
  if (git(worktreePath, ["clean", "-ndffX"])) {
    throw new WorktreeCleanupError("worktree_has_ignored_files")
  }
}

function assertNoTargetUsers(worktreePath: string, adminDir?: string): void {
  assertNoTargetPathUsers(worktreePath, adminDir)
}

function assertNoTargetPathUsers(worktreePath: string, adminDir?: string): void {
  const targetRoots = adminDir ? [worktreePath, adminDir] : [worktreePath]
  if (process.platform === "linux") {
    assertNoLinuxTargetUsers(targetRoots)
    return
  }
  if (process.platform === "darwin") {
    const openFiles = Bun.spawnSync([
      "/usr/sbin/lsof",
      "-t",
      ...targetRoots.flatMap((root) => ["+D", root]),
    ], {
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
      .some((path) => targetRoots.some((root) => pathUsesTarget(path, root)))
    if (used) throw new WorktreeCleanupError("target_in_use")
    return
  }
  throw new WorktreeCleanupError("process_guard_unavailable")
}

function assertNoLinuxTargetUsers(targetRoots: string[]): void {
  try {
    assertNoProcTargetUsers(targetRoots)
    return
  } catch (error) {
    if (!(error instanceof WorktreeCleanupError) || error.code !== "process_guard_unavailable") {
      throw error
    }
  }

  const paths: string[] = []
  try {
    for (const root of targetRoots) collectTargetPaths(root, paths)
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

function assertNoProcTargetUsers(targetRoots: string[]): void {
  assertNoUnixSockets(targetRoots)
  const targetFiles = new Set<string>()
  for (const root of targetRoots) {
    for (const identity of collectTargetFileIdentities(root)) targetFiles.add(identity)
  }
  const inspectedNetworkMountRoots = new Set<string>()
  const ownNetworkNamespace = readProcessLink("/proc/self/ns/net")
  let processes
  try {
    processes = readdirSync("/proc", { withFileTypes: true })
      .filter((entry) => entry.isDirectory() && /^\d+$/.test(entry.name))
  } catch {
    throw new WorktreeCleanupError("process_guard_unavailable")
  }

  let inspectionUnavailable = false
  for (const processEntry of processes) {
    const processPath = join("/proc", processEntry.name)
    let tasks
    try {
      tasks = readdirSync(join(processPath, "task"), { withFileTypes: true })
        .filter((entry) => entry.isDirectory() && /^\d+$/.test(entry.name))
    } catch (error) {
      if (isMissingProcessEntry(error)) continue
      inspectionUnavailable = true
      continue
    }
    for (const taskEntry of tasks) {
      const taskPath = join(processPath, "task", taskEntry.name)
      try {
        inspectProcTask(
          taskPath,
          targetRoots,
          targetFiles,
          inspectedNetworkMountRoots,
          ownNetworkNamespace,
        )
      } catch (error) {
        if (!(error instanceof WorktreeCleanupError)) throw error
        if (error.code === "target_in_use") throw error
        if (error.code !== "process_guard_unavailable") throw error
        inspectionUnavailable = true
      }
    }
  }
  if (inspectionUnavailable) throw new WorktreeCleanupError("process_guard_unavailable")
}

function inspectProcTask(
  taskPath: string,
  targetRoots: string[],
  targetFiles: Set<string>,
  inspectedNetworkMountRoots: Set<string>,
  ownNetworkNamespace: string | null,
): void {
  if (isZombieProcess(taskPath)) return
  const networkNamespace = readProcessLink(join(taskPath, "ns", "net"))
  const mountNamespace = readProcessLink(join(taskPath, "ns", "mnt"))
  const processRootIdentity = readProcessRootIdentity(taskPath)
  const namespacePair = networkNamespace === null
    ? null
    : `${networkNamespace}\0${mountNamespace ?? taskPath}\0${processRootIdentity ?? taskPath}`
  if (
    networkNamespace !== null
    && namespacePair !== null
    && !inspectedNetworkMountRoots.has(namespacePair)
  ) {
    const inspected = assertNoUnixSocketsFrom(
      join(taskPath, "net", "unix"),
      targetRoots,
      true,
      networkNamespace === ownNetworkNamespace ? undefined : taskPath,
      taskPath,
    )
    if (inspected) {
      const currentNetworkNamespace = readProcessLink(join(taskPath, "ns", "net"))
      if (currentNetworkNamespace !== null) {
        const currentMountNamespace = readProcessLink(join(taskPath, "ns", "mnt"))
        const currentProcessRootIdentity = readProcessRootIdentity(taskPath)
        if (
          mountNamespace === null
          || processRootIdentity === null
          || currentNetworkNamespace !== networkNamespace
          || currentMountNamespace !== mountNamespace
          || currentProcessRootIdentity !== processRootIdentity
        ) {
          throw new WorktreeCleanupError("target_in_use")
        }
        inspectedNetworkMountRoots.add(namespacePair)
      }
    }
  }
  for (const linkName of ["cwd", "root", "exe"]) {
    const linkPath = join(taskPath, linkName)
    const usedPath = readProcessLink(linkPath)
    if (usedPath !== null && targetRoots.some((root) => pathUsesTarget(usedPath, root))) {
      throw new WorktreeCleanupError("target_in_use")
    }
    try {
      const metadata = statSync(linkPath, { bigint: true })
      if (targetFiles.has(
        `${metadata.dev.toString(16)}:${metadata.ino.toString(16)}`,
      )) {
        throw new WorktreeCleanupError("target_in_use")
      }
    } catch (error) {
      if (error instanceof WorktreeCleanupError) throw error
      if (!isMissingProcessEntry(error)) {
        throw new WorktreeCleanupError("process_guard_unavailable")
      }
    }
  }
  for (const mapping of readProcessMappings(taskPath)) {
    if (
      targetRoots.some((root) => pathUsesTarget(mapping.path, root))
      || targetFiles.has(mapping.identity)
    ) {
      throw new WorktreeCleanupError("target_in_use")
    }
  }

  let fileDescriptors
  try {
    fileDescriptors = readdirSync(join(taskPath, "fd"))
  } catch (error) {
    if (isMissingProcessEntry(error)) return
    throw new WorktreeCleanupError("process_guard_unavailable")
  }
  for (const fileDescriptor of fileDescriptors) {
    const descriptorPath = join(taskPath, "fd", fileDescriptor)
    const usedPath = readProcessLink(descriptorPath)
    if (usedPath !== null && targetRoots.some((root) => pathUsesTarget(usedPath, root))) {
      throw new WorktreeCleanupError("target_in_use")
    }
    let descriptorMetadata
    try {
      descriptorMetadata = statSync(descriptorPath, { bigint: true })
    } catch (error) {
      if (isMissingProcessEntry(error)) continue
      throw new WorktreeCleanupError("process_guard_unavailable")
    }
    if (
      targetFiles.has(
        `${descriptorMetadata.dev.toString(16)}:${descriptorMetadata.ino.toString(16)}`,
      )
    ) {
      throw new WorktreeCleanupError("target_in_use")
    }
    if (usedPath === "anon_inode:inotify") {
      assertNoTargetInotifyWatch(taskPath, fileDescriptor, targetFiles)
    }
  }
}

function assertNoUnixSockets(targetRoots: string[], inspectSocketFiles = true): void {
  assertNoUnixSocketsFrom("/proc/net/unix", targetRoots, inspectSocketFiles)
}

function readProcessRootIdentity(taskPath: string): string | null {
  const rootPath = readProcessLink(join(taskPath, "root"))
  if (rootPath === null) return null
  try {
    const metadata = statSync(join(taskPath, "root"), { bigint: true })
    return `${rootPath}\0${metadata.dev.toString(16)}:${metadata.ino.toString(16)}`
  } catch (error) {
    if (isMissingProcessEntry(error)) return null
    throw new WorktreeCleanupError("process_guard_unavailable")
  }
}

function assertNoUnixSocketsFrom(
  procUnixPath: string,
  targetRoots: string[],
  inspectSocketFiles: boolean,
  processPath?: string,
  mountViewProcessPath?: string,
): boolean {
  const targetSocketFiles = inspectSocketFiles
    ? targetRoots.flatMap((root) => collectUnixSocketFiles(root).map((path) => ({ root, path })))
    : []
  const targetSocketIdentities = new Set(targetSocketFiles.map(({ path }) => {
    const metadata = statSync(path, { bigint: true })
    return `${metadata.dev.toString(16)}:${metadata.ino.toString(16)}`
  }))
  const relativeTargetSockets = new Map<string, string[]>()
  for (const socket of targetSocketFiles) {
    const relativePath = socket.path.slice(socket.root.length + 1)
    relativeTargetSockets.set(relativePath, [
      ...(relativeTargetSockets.get(relativePath) ?? []),
      socket.path,
    ])
  }
  let sockets
  try {
    sockets = readFileSync(procUnixPath, "utf8")
  } catch (error) {
    if (isMissingProcessEntry(error) && procUnixPath !== "/proc/net/unix") return false
    throw new WorktreeCleanupError("process_guard_unavailable")
  }
  for (const line of sockets.split("\n").slice(1)) {
    if (!line) continue
    const match = line.match(/^\S+\s+\S+\s+\S+\s+\S+\s+\S+\s+\S+\s+\S+(?:\s+(.*))?$/)
    if (!match) throw new WorktreeCleanupError("process_guard_unavailable")
    const socketPath = match[1]
    if (socketPath?.startsWith("/")) {
      if (targetRoots.some((root) => pathUsesTarget(socketPath, root))) {
        throw new WorktreeCleanupError("target_in_use")
      }
      const socketViews = mountViewProcessPath === undefined
        ? [socketPath]
        : [socketPath, join(mountViewProcessPath, "root", socketPath)]
      for (const socketView of socketViews) {
        try {
          const resolvedSocketPath = realpathSync(socketView)
          const metadata = statSync(socketView, { bigint: true })
          if (
            targetRoots.some((root) => pathUsesTarget(resolvedSocketPath, root))
            || targetSocketIdentities.has(
              `${metadata.dev.toString(16)}:${metadata.ino.toString(16)}`,
            )
          ) {
            throw new WorktreeCleanupError("target_in_use")
          }
        } catch (error) {
          if (
            error instanceof WorktreeCleanupError
            || !isMissingProcessEntry(error)
          ) {
            throw error instanceof WorktreeCleanupError
              ? error
              : new WorktreeCleanupError("process_guard_unavailable")
          }
        }
      }
    }
    const targetSockets = socketPath ? relativeTargetSockets.get(socketPath) : undefined
    for (const targetSocket of targetSockets ?? []) {
      if (probeUnixSocket(targetSocket, processPath) !== "stale") {
        throw new WorktreeCleanupError("target_in_use")
      }
    }
  }
  return true
}

function probeUnixSocket(
  socketPath: string,
  processPath?: string,
): "live" | "stale" | "unavailable" {
  const command = [
    process.execPath,
    "-e",
    `import { connect } from "node:net";
const socket = connect(process.argv[1]);
const timer = setTimeout(() => process.exit(3), 500);
socket.once("connect", () => { clearTimeout(timer); socket.destroy(); process.exit(0); });
socket.once("error", (error) => {
  clearTimeout(timer);
  process.exit(error?.code === "ECONNREFUSED" || error?.code === "ENOENT" ? 2 : 3);
});`,
    socketPath,
  ]
  const probe = Bun.spawnSync(processPath
    ? ["/usr/bin/nsenter", `--net=${join(processPath, "ns", "net")}`, "--", ...command]
    : command, {
    stdout: "ignore",
    stderr: "ignore",
  })
  if (probe.exitCode === 0) return "live"
  if (probe.exitCode === 2) return "stale"
  return "unavailable"
}

function snapshotPackedRefEntry(cwd: string, ref: string): PackedRefSnapshot | null {
  const commonDir = git(cwd, ["rev-parse", "--path-format=absolute", "--git-common-dir"])
  const packedRefs = join(commonDir, "packed-refs")
  if (!existsSync(packedRefs)) return null
  return packedRefSnapshotFromContents(readFileSync(packedRefs, "utf8"), ref)
}

function packedRefSnapshotFromContents(
  contents: string,
  ref: string,
): PackedRefSnapshot | null {
  const lines = contents.split("\n")
  const matches = lines.flatMap((line, index) => (
    line.endsWith(` ${ref}`) ? [{ line, index }] : []
  ))
  if (matches.length > 1) {
    throw new WorktreeCleanupError("branch_identity_drift_before_worktree_removal")
  }
  const match = matches[0]
  return match
    ? {
        line: match.line,
        index: match.index,
        previousLine: match.index > 0 ? lines[match.index - 1] : null,
        nextLine: match.index + 1 < lines.length ? lines[match.index + 1] : null,
      }
    : null
}

function packedRefSnapshotsEqual(
  first: PackedRefSnapshot | null,
  second: PackedRefSnapshot | null,
): boolean {
  if (first === null || second === null) return first === second
  return first.line === second.line
    && first.index === second.index
    && first.previousLine === second.previousLine
    && first.nextLine === second.nextLine
}

function collectUnixSocketFiles(root: string): string[] {
  const sockets: string[] = []
  let entries
  try {
    entries = readdirSync(root, { withFileTypes: true })
  } catch {
    throw new WorktreeCleanupError("process_guard_unavailable")
  }
  for (const entry of entries) {
    const entryPath = join(root, entry.name)
    let metadata
    try {
      metadata = lstatSync(entryPath)
    } catch {
      throw new WorktreeCleanupError("process_guard_unavailable")
    }
    if (metadata.isSocket()) {
      sockets.push(entryPath)
    } else if (metadata.isDirectory()) {
      sockets.push(...collectUnixSocketFiles(entryPath))
    }
  }
  return sockets
}

function collectTargetFileIdentities(root: string): Set<string> {
  const identities = new Set<string>()
  const collect = (path: string): void => {
    let metadata
    try {
      metadata = lstatSync(path, { bigint: true })
    } catch {
      throw new WorktreeCleanupError("process_guard_unavailable")
    }
    identities.add(`${metadata.dev.toString(16)}:${metadata.ino.toString(16)}`)
    if (!metadata.isDirectory()) return
    let entries
    try {
      entries = readdirSync(path)
    } catch {
      throw new WorktreeCleanupError("process_guard_unavailable")
    }
    for (const entry of entries) collect(join(path, entry))
  }
  collect(root)
  return identities
}

function assertNoTargetInotifyWatch(
  processPath: string,
  fileDescriptor: string,
  targetFiles: Set<string>,
): void {
  let fdinfo
  try {
    fdinfo = readFileSync(join(processPath, "fdinfo", fileDescriptor), "utf8")
  } catch (error) {
    if (isMissingProcessEntry(error)) return
    throw new WorktreeCleanupError("process_guard_unavailable")
  }
  for (const line of fdinfo.split("\n")) {
    if (!line.startsWith("inotify ")) continue
    const match = line.match(/\bino:([0-9a-f]+)\s+sdev:([0-9a-f]+)\b/)
    if (!match) throw new WorktreeCleanupError("process_guard_unavailable")
    if (targetFiles.has(linuxKernelDeviceInodeIdentity(match[2]!, match[1]!))) {
      throw new WorktreeCleanupError("target_in_use")
    }
  }
}

function readProcessMappings(processPath: string): Array<{ path: string; identity: string }> {
  let mappings
  try {
    mappings = readFileSync(join(processPath, "maps"), "utf8")
  } catch (error) {
    if (isMissingProcessEntry(error)) return []
    throw new WorktreeCleanupError("process_guard_unavailable")
  }
  return mappings.split("\n").flatMap((line) => {
    if (!line) return []
    const match = line.match(
      /^[0-9a-f]+-[0-9a-f]+\s+\S+\s+\S+\s+([0-9a-f]+):([0-9a-f]+)\s+(\d+)\s*(.*)$/,
    )
    if (!match) throw new WorktreeCleanupError("process_guard_unavailable")
    const path = match[4]
    if (!path?.startsWith("/")) return []
    return [{
      path,
      identity: linuxDeviceInodeIdentity(match[1]!, match[2]!, match[3]!),
    }]
  })
}

function linuxDeviceInodeIdentity(
  majorHex: string,
  minorHex: string,
  inodeDecimal: string,
): string {
  const major = BigInt(`0x${majorHex}`)
  const minor = BigInt(`0x${minorHex}`)
  return `${linuxUserspaceDevice(major, minor).toString(16)}:${BigInt(inodeDecimal).toString(16)}`
}

export function linuxKernelDeviceInodeIdentity(
  deviceHex: string,
  inodeHex: string,
): string {
  const device = BigInt(`0x${deviceHex}`)
  const major = (device >> 20n) & 0xfffn
  const minor = device & 0xfffffn
  return `${linuxUserspaceDevice(major, minor).toString(16)}:${BigInt(`0x${inodeHex}`).toString(16)}`
}

function linuxUserspaceDevice(major: bigint, minor: bigint): bigint {
  const device = (minor & 0xffn)
    | ((major & 0xfffn) << 8n)
    | ((minor & ~0xffn) << 12n)
    | ((major & ~0xfffn) << 32n)
  return device
}

function isZombieProcess(processPath: string): boolean {
  let stat
  try {
    stat = readFileSync(join(processPath, "stat"), "utf8")
  } catch (error) {
    if (isMissingProcessEntry(error)) return true
    throw new WorktreeCleanupError("process_guard_unavailable")
  }
  const closingParenthesis = stat.lastIndexOf(")")
  const state = closingParenthesis === -1 ? "" : stat.slice(closingParenthesis + 2, closingParenthesis + 3)
  if (!state) throw new WorktreeCleanupError("process_guard_unavailable")
  return state === "Z" || state === "X"
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
  return error instanceof Error
    && "code" in error
    && (error.code === "ENOENT" || error.code === "ESRCH")
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

function targetEntries(directory: string): Set<string> {
  const paths: string[] = []
  collectTargetPaths(directory, paths)
  return new Set(paths)
}

function assertOwnerTool(options: RemoveOptions): void {
  const objectType = gitResult(options.repositoryCwd, [
    "--no-replace-objects",
    "cat-file",
    "-t",
    options.ownerCommit,
  ])
  if (objectType.exitCode !== 0 || objectType.stdout.toString().trim() !== "commit") {
    throw new WorktreeCleanupError("owner_tool_identity_missing")
  }
  const result = gitResult(options.repositoryCwd, [
    "--no-replace-objects",
    "cat-file",
    "-e",
    `${options.ownerCommit}:modules/orchestration-ops/agent-workspace-manager/scripts/worktree-cleanup.ts`,
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
  preservedRef: string | null = null,
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
    preserved_ref: sanitizeGuardRef(preservedRef),
    worktree_claimed: worktreeClaimed,
    ignored_residue_removed: ignoredResidueRemoved,
    worktree_removed: worktreeRemoved,
    local_branch_deleted: localBranchDeleted,
    rollback_attempted: rollbackAttempted,
    rollback_completed: rollbackCompleted,
    status: ignoredResidueRemoved
      || worktreeRemoved
      || localBranchDeleted
      || (worktreeClaimed && rollbackAttempted && !rollbackCompleted)
      ? "partial"
      : "failed",
    reason_code: reasonCode,
  }
}

function survivingGuardRef(cwd: string, guardRef: string | undefined): string | null {
  if (!guardRef) return null
  return refMissingNoDeref(cwd, guardRef) ? null : guardRef
}

function snapshotRef(cwd: string, ref: string, expectedHead: string): RefSnapshot {
  const symbolic = gitResult(cwd, ["symbolic-ref", "-q", "--no-recurse", ref])
  const snapshot = symbolic.exitCode === 0
    ? {
        kind: "symbolic" as const,
        target: symbolic.stdout.toString().trim(),
        chain: snapshotSymbolicRefChain(cwd, symbolic.stdout.toString().trim()),
        mode: lstatSync(looseRefPath(cwd, ref)).mode,
        packedEntry: snapshotPackedRefEntry(cwd, ref),
      }
    : {
        kind: "direct" as const,
        reflog: snapshotIdentifiedFile(looseRefPath(cwd, `logs/${ref}`)),
        looseRef: snapshotIdentifiedFile(looseRefPath(cwd, ref)),
        packedRefsIdentity: snapshotFileInstance(packedRefsPath(cwd)),
        packedEntry: snapshotPackedRefEntry(cwd, ref),
      }
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

function assertFilesRefStorage(cwd: string): void {
  const storage = gitResult(cwd, ["config", "--get", "extensions.refStorage"])
  if (storage.exitCode === 1 && storage.stderr.length === 0) return
  if (storage.exitCode !== 0 || storage.stdout.toString().trim() !== "files") {
    throw new WorktreeCleanupError("unsupported_ref_storage")
  }
}

function claimRef(
  cwd: string,
  ref: string,
  expectedHead: string,
  snapshot: RefSnapshot,
): ClaimedRef {
  const suffix = randomBytes(32).toString("hex")
  if (snapshot.kind === "direct") {
    const guardRef = `refs/heads/worktree-cleanup-${suffix}`
    try {
      moveLockedDirectRef(cwd, ref, guardRef, expectedHead, snapshot)
    } catch {
      throw new WorktreeCleanupError("branch_identity_drift_before_worktree_removal")
    }
    const guardSnapshot = snapshotGuardRef(cwd, guardRef, expectedHead)
    return { ref: guardRef, snapshot: guardSnapshot }
  }

  const guardRef = `refs/worktree-cleanup/${suffix}`
  const createGuard = gitResult(cwd, [
    "update-ref",
    guardRef,
    expectedHead,
    nullOid(cwd),
  ])
  if (createGuard.exitCode !== 0) {
    const guardHead = gitResult(cwd, ["rev-parse", "--verify", guardRef])
    if (
      guardHead.exitCode !== 0
      || guardHead.stdout.toString().trim() !== expectedHead
    ) {
      throw new WorktreeCleanupError(
        "branch_identity_drift_before_worktree_removal",
        undefined,
        survivingGuardRef(cwd, guardRef) ?? undefined,
      )
    }
  }
  const guardSnapshot = snapshotGuardRef(cwd, guardRef, expectedHead)
  try {
    deleteLockedSymbolicRef(
      cwd,
      ref,
      snapshot.target,
      snapshot.chain,
      expectedHead,
      snapshot.mode,
      snapshot.packedEntry,
    )
  } catch {
    runValidatedDirectRefTransaction(cwd, guardRef, null, expectedHead, guardSnapshot)
    throw new WorktreeCleanupError(
      "branch_identity_drift_before_worktree_removal",
      undefined,
      survivingGuardRef(cwd, guardRef) ?? undefined,
    )
  }
  return { ref: guardRef, snapshot: guardSnapshot }
}

function restoreRef(
  cwd: string,
  ref: string,
  expectedHead: string,
  guardRef: string,
  snapshot: RefSnapshot,
): void {
  if (snapshot.kind === "direct") {
    try {
      copyLockedDirectRef(cwd, guardRef, ref, expectedHead)
      restoreDirectReflogUnderRefLock(cwd, ref, expectedHead, snapshot.reflog)
    } catch {
      throw new WorktreeCleanupError("ref_restore_failed", undefined, guardRef)
    }
    return
  }
  const restoredIdentity = restoreSymbolicRef(
    cwd,
    ref,
    expectedHead,
    snapshot.target,
    snapshot.chain,
    snapshot.mode,
  )
  try {
    restorePackedRefEntry(cwd, ref, snapshot.packedEntry)
  } catch {
    removeRestoredSymbolicRef(cwd, ref, snapshot.target, restoredIdentity)
    throw new WorktreeCleanupError("ref_restore_failed")
  }
}

function removeRestoredSymbolicRef(
  cwd: string,
  ref: string,
  target: string,
  restoredIdentity: FileIdentity,
): void {
  const refPath = looseRefPath(cwd, ref)
  const lockPath = `${refPath}.lock`
  let lockIdentity: FileIdentity | undefined
  try {
    linkSync(refPath, lockPath)
    lockIdentity = fileIdentityForPath(lockPath)
    if (
      !lockMatches(lockPath, restoredIdentity)
      || readFileSync(lockPath, "utf8") !== `ref: ${target}\n`
      || !lockMatches(refPath, restoredIdentity)
    ) {
      throw new WorktreeCleanupError("ref_restore_failed")
    }
    unlinkSync(refPath)
  } catch {
    throw new WorktreeCleanupError("ref_restore_failed")
  } finally {
    if (lockIdentity) unlinkOwnedLock(lockPath, lockIdentity)
  }
}

function restoreDirectReflogUnderRefLock(
  cwd: string,
  ref: string,
  expectedHead: string,
  reflog: FileSnapshot | null,
): void {
  const refPath = looseRefPath(cwd, ref)
  const lockPath = `${refPath}.lock`
  let lockIdentity: FileIdentity | undefined
  try {
    linkSync(refPath, lockPath)
    lockIdentity = fileIdentityForPath(lockPath)
    if (
      !lockMatches(refPath, lockIdentity)
      || readFileSync(lockPath, "utf8").trim() !== expectedHead
      || !hasFreshDirectRefReflog(cwd, ref, expectedHead, reflog)
    ) {
      throw new WorktreeCleanupError("ref_restore_failed")
    }
    restoreFile(looseRefPath(cwd, `logs/${ref}`), reflog)
  } finally {
    if (lockIdentity) unlinkOwnedLock(lockPath, lockIdentity)
  }
}

function hasFreshDirectRefReflog(
  cwd: string,
  ref: string,
  expectedHead: string,
  originalReflog: FileSnapshot | null,
): boolean {
  const reflogPath = looseRefPath(cwd, `logs/${ref}`)
  if (!existsSync(reflogPath)) return originalReflog === null
  const contents = readFileSync(reflogPath, "utf8")
  const fields = contents.endsWith("\n") ? contents.slice(0, -1).split(" ") : []
  return (
    !contents.slice(0, -1).includes("\n")
    && fields.length >= 4
    && fields[0] === nullOid(cwd)
    && fields[1] === expectedHead
  )
}

function restoreSymbolicRef(
  cwd: string,
  ref: string,
  expectedHead: string,
  target: string,
  expectedChain: SymbolicRefChainEntry[],
  mode: number,
): FileIdentity {
  try {
    return createLockedSymbolicRef(cwd, ref, target, expectedChain, expectedHead, mode)
  } catch {
    throw new WorktreeCleanupError("ref_restore_failed")
  }
}

function restorePackedRefEntry(
  cwd: string,
  ref: string,
  packedEntry: PackedRefSnapshot | null,
): void {
  if (packedEntry === null) return
  const commonDir = git(cwd, ["rev-parse", "--path-format=absolute", "--git-common-dir"])
  const packedRefs = join(commonDir, "packed-refs")
  const lockPath = `${packedRefs}.lock`
  let lockFd: number | undefined
  let lockIdentity: FileIdentity | undefined
  let restored = false
  try {
    lockFd = openSync(lockPath, "wx", 0o600)
    lockIdentity = fileIdentityForDescriptor(lockFd)
    const contents = existsSync(packedRefs) ? readFileSync(packedRefs, "utf8") : ""
    const matchingEntries = contents
      .split("\n")
      .filter((line) => line.endsWith(` ${ref}`))
    if (matchingEntries.length > 1) throw new WorktreeCleanupError("ref_restore_failed")
    if (matchingEntries.length === 1) {
      if (matchingEntries[0] !== packedEntry.line) {
        throw new WorktreeCleanupError("ref_restore_failed")
      }
      return
    }
    const lines = contents.split("\n")
    let insertionIndex = Math.min(packedEntry.index, lines.length)
    if (packedEntry.nextLine !== null) {
      const nextIndex = lines.indexOf(packedEntry.nextLine)
      if (nextIndex !== -1) insertionIndex = nextIndex
    }
    if (packedEntry.previousLine !== null) {
      const previousIndex = lines.indexOf(packedEntry.previousLine)
      if (
        previousIndex !== -1
        && (
          packedEntry.nextLine === null
          || lines.indexOf(packedEntry.nextLine) === -1
        )
      ) {
        insertionIndex = previousIndex + 1
      }
    }
    lines.splice(insertionIndex, 0, packedEntry.line)
    const updatedContents = lines.join("\n")
    fchmodSync(lockFd, existsSync(packedRefs) ? lstatSync(packedRefs).mode : 0o644)
    writeFileSync(lockFd, updatedContents)
    fsyncSync(lockFd)
    closeSync(lockFd)
    lockFd = undefined
    if (!lockMatches(lockPath, lockIdentity)) throw new WorktreeCleanupError("ref_restore_failed")
    renameSync(lockPath, packedRefs)
    restored = true
  } catch {
    throw new WorktreeCleanupError("ref_restore_failed")
  } finally {
    if (lockFd !== undefined) closeSync(lockFd)
    if (!restored && lockIdentity) unlinkOwnedLock(lockPath, lockIdentity)
  }
}

function moveLockedDirectRef(
  cwd: string,
  sourceRef: string,
  destinationRef: string,
  expectedHead: string,
  expectedSnapshot?: Extract<RefSnapshot, { kind: "direct" }>,
): void {
  const transaction = expectedSnapshot === undefined
    ? runDirectRefTransaction(cwd, sourceRef, destinationRef, expectedHead, true)
    : runValidatedDirectRefTransaction(
        cwd,
        sourceRef,
        destinationRef,
        expectedHead,
        expectedSnapshot,
      )
  if (transaction.exitCode !== 0) {
    const source = gitResult(cwd, ["rev-parse", "--verify", sourceRef])
    const destination = gitResult(cwd, ["rev-parse", "--verify", destinationRef])
    if (
      source.exitCode !== 0
      && destination.exitCode === 0
      && destination.stdout.toString().trim() === expectedHead
    ) {
      return
    }
    throw new WorktreeCleanupError("branch_identity_drift_before_worktree_removal")
  }
}

function copyLockedDirectRef(
  cwd: string,
  sourceRef: string,
  destinationRef: string,
  expectedHead: string,
): void {
  const transaction = runDirectRefTransaction(
    cwd,
    sourceRef,
    destinationRef,
    expectedHead,
    false,
  )
  if (transaction.exitCode !== 0) {
    throw new WorktreeCleanupError("ref_restore_failed")
  }
}

function runDirectRefTransaction(
  cwd: string,
  sourceRef: string,
  destinationRef: string,
  expectedHead: string,
  deleteSource: boolean,
): PipedCommandResult {
  return Bun.spawnSync(["git", "-C", cwd, "update-ref", "--stdin"], {
    stdin: Buffer.from([
      "start",
      "option no-deref",
      `create ${destinationRef} ${expectedHead}`,
      deleteSource
        ? `delete ${sourceRef} ${expectedHead}`
        : `verify ${sourceRef} ${expectedHead}`,
      "prepare",
      "commit",
      "",
    ].join("\n")),
    stdout: "pipe",
    stderr: "pipe",
  }) as PipedCommandResult
}

function runValidatedDirectRefTransaction(
  cwd: string,
  sourceRef: string,
  destinationRef: string | null,
  expectedHead: string,
  expectedSnapshot: Extract<RefSnapshot, { kind: "direct" }>,
): PipedCommandResult {
  const reflogPath = looseRefPath(cwd, `logs/${sourceRef}`)
  const loosePath = looseRefPath(cwd, sourceRef)
  const packedRefsPath = join(
    git(cwd, ["rev-parse", "--path-format=absolute", "--git-common-dir"]),
    "packed-refs",
  )
  const fileExpectation = (snapshot: IdentifiedFileSnapshot | null) => snapshot && ({
    hash: createHash("sha256").update(snapshot.contents).digest("hex"),
    mode: snapshot.mode.toString(),
    dev: snapshot.identity.dev.toString(),
    ino: snapshot.identity.ino.toString(),
    ctimeNs: snapshot.identity.ctimeNs.toString(),
  })
  const expectation = Buffer.from(JSON.stringify({
    reflog: fileExpectation(expectedSnapshot.reflog),
    looseRef: fileExpectation(expectedSnapshot.looseRef),
    packedRefsIdentity: expectedSnapshot.packedRefsIdentity && ({
      dev: expectedSnapshot.packedRefsIdentity.dev.toString(),
      ino: expectedSnapshot.packedRefsIdentity.ino.toString(),
      ctimeNs: expectedSnapshot.packedRefsIdentity.ctimeNs.toString(),
    }),
    packedEntry: expectedSnapshot.packedEntry,
  })).toString("base64")
  const helper = `
import { createHash } from "node:crypto";
import { existsSync, lstatSync, readFileSync } from "node:fs";
const [cwd, sourceRef, encodedDestinationRef, expectedHead, reflogPath, loosePath, packedRefsPath, encodedExpectation] = process.argv.slice(1);
const destinationRef = encodedDestinationRef === "-" ? null : encodedDestinationRef;
const expected = JSON.parse(Buffer.from(encodedExpectation, "base64").toString());
const fileMatches = (path, value) => {
  if (value === null) return !existsSync(path);
  if (!existsSync(path)) return false;
  const metadata = lstatSync(path, { bigint: true });
  return metadata.mode.toString() === value.mode
    && metadata.dev.toString() === value.dev
    && metadata.ino.toString() === value.ino
    && metadata.ctimeNs.toString() === value.ctimeNs
    && createHash("sha256").update(readFileSync(path)).digest("hex") === value.hash;
};
const instanceMatches = (path, value) => {
  if (value === undefined) return true;
  if (value === null) return !existsSync(path);
  if (!existsSync(path)) return false;
  const metadata = lstatSync(path, { bigint: true });
  return metadata.dev.toString() === value.dev
    && metadata.ino.toString() === value.ino
    && metadata.ctimeNs.toString() === value.ctimeNs;
};
const packedSnapshot = (path, ref) => {
  if (!existsSync(path)) return null;
  const lines = readFileSync(path, "utf8").split("\\n");
  const indexes = [];
  for (let index = 0; index < lines.length; index += 1) {
    if (lines[index].endsWith(" " + ref)) indexes.push(index);
  }
  if (indexes.length === 0) return null;
  if (indexes.length > 1) return { duplicate: true };
  const index = indexes[0];
  return {
    line: lines[index],
    index,
    previousLine: index > 0 ? lines[index - 1] : null,
    nextLine: index + 1 < lines.length ? lines[index + 1] : null,
  };
};
const transaction = Bun.spawn(["git", "-C", cwd, "update-ref", "--stdin"], {
  stdin: "pipe",
  stdout: "pipe",
  stderr: "pipe",
});
transaction.stdin.write([
  "start",
  "option no-deref",
  ...(destinationRef === null ? [] : ["create " + destinationRef + " " + expectedHead]),
  "delete " + sourceRef + " " + expectedHead,
  "prepare",
  "",
].join("\\n"));
await transaction.stdin.flush();
const reader = transaction.stdout.getReader();
const decoder = new TextDecoder();
let output = "";
while (!output.includes("prepare: ok\\n")) {
  const chunk = await reader.read();
  if (chunk.done) break;
  output += decoder.decode(chunk.value);
}
const matches = fileMatches(reflogPath, expected.reflog)
  && fileMatches(loosePath, expected.looseRef)
  && instanceMatches(packedRefsPath, expected.packedRefsIdentity)
  && JSON.stringify(packedSnapshot(packedRefsPath, sourceRef)) === JSON.stringify(expected.packedEntry);
if (!output.includes("prepare: ok\\n") || !matches) {
  if (output.includes("prepare: ok\\n")) {
    transaction.stdin.write("abort\\n");
    await transaction.stdin.flush();
  }
  transaction.stdin.end();
  await transaction.exited;
  process.exit(75);
}
transaction.stdin.write("commit\\n");
await transaction.stdin.flush();
transaction.stdin.end();
process.exit(await transaction.exited);
`
  return Bun.spawnSync([
    process.execPath,
    "-e",
    helper,
    "--",
    cwd,
    sourceRef,
    destinationRef ?? "-",
    expectedHead,
    reflogPath,
    loosePath,
    packedRefsPath,
    expectation,
  ], { stdout: "pipe", stderr: "pipe" }) as PipedCommandResult
}

function snapshotSymbolicRefChain(
  cwd: string,
  firstRef: string,
): SymbolicRefChainEntry[] {
  const chain: SymbolicRefChainEntry[] = []
  const seen = new Set<string>()
  let current = firstRef
  for (let depth = 0; depth < 32; depth += 1) {
    if (seen.has(current)) {
      throw new WorktreeCleanupError("branch_identity_drift_before_worktree_removal")
    }
    seen.add(current)
    const symbolic = gitResult(cwd, ["symbolic-ref", "-q", "--no-recurse", current])
    if (symbolic.exitCode === 0) {
      const target = symbolic.stdout.toString().trim()
      chain.push({ ref: current, target })
      current = target
      continue
    }
    if (symbolic.exitCode === 1 && symbolic.stderr.length === 0) {
      chain.push({ ref: current, target: null })
      return chain
    }
    throw new WorktreeCleanupError("branch_identity_drift_before_worktree_removal")
  }
  throw new WorktreeCleanupError("branch_identity_drift_before_worktree_removal")
}

function lockAndVerifySymbolicRefChain(
  cwd: string,
  expectedChain: SymbolicRefChainEntry[],
  expectedHead: string,
): OwnedRefLock[] {
  if (expectedChain.length === 0) {
    throw new WorktreeCleanupError("branch_identity_drift_before_worktree_removal")
  }
  const locks: OwnedRefLock[] = []
  try {
    for (const entry of expectedChain) {
      const lockPath = `${looseRefPath(cwd, entry.ref)}.lock`
      const createdParents = ensureParentDirectories(lockPath)
      const fd = openSync(lockPath, "wx", 0o600)
      locks.push({
        path: lockPath,
        fd,
        identity: fileIdentityForDescriptor(fd),
        createdParents,
      })
    }
    const currentChain = snapshotSymbolicRefChain(cwd, expectedChain[0]!.ref)
    if (JSON.stringify(currentChain) !== JSON.stringify(expectedChain)) {
      throw new WorktreeCleanupError("branch_identity_drift_before_worktree_removal")
    }
    const resolved = gitResult(cwd, ["rev-parse", "--verify", expectedChain[0]!.ref])
    if (resolved.exitCode !== 0 || resolved.stdout.toString().trim() !== expectedHead) {
      throw new WorktreeCleanupError("branch_identity_drift_before_worktree_removal")
    }
    return locks
  } catch {
    releaseOwnedRefLocks(locks)
    throw new WorktreeCleanupError("branch_identity_drift_before_worktree_removal")
  }
}

function releaseOwnedRefLocks(locks: OwnedRefLock[]): void {
  for (const lock of locks.reverse()) {
    closeSync(lock.fd)
    unlinkOwnedLock(lock.path, lock.identity)
    removeCreatedParents(lock.createdParents)
  }
}

function deleteLockedSymbolicRef(
  cwd: string,
  ref: string,
  target: string,
  expectedChain: SymbolicRefChainEntry[],
  expectedHead: string,
  expectedMode: number,
  expectedPackedEntry: PackedRefSnapshot | null,
): void {
  const refPath = looseRefPath(cwd, ref)
  const refLock = `${refPath}.lock`
  const packedRefs = join(git(cwd, ["rev-parse", "--path-format=absolute", "--git-common-dir"]), "packed-refs")
  const packedRefsLock = `${packedRefs}.lock`
  let refLockIdentity: FileIdentity | undefined
  let chainLocks: OwnedRefLock[] = []
  let packedLockFd: number | undefined
  let packedLockIdentity: FileIdentity | undefined
  let packedRewritePrepared = false
  let packedLockCommitted = false
  let refUnlinked = false
  try {
    packedLockFd = openSync(packedRefsLock, "wx", 0o600)
    packedLockIdentity = fileIdentityForDescriptor(packedLockFd)
    const packedContents = existsSync(packedRefs) ? readFileSync(packedRefs, "utf8") : ""
    const currentPackedEntry = packedRefSnapshotFromContents(packedContents, ref)
    if (!packedRefSnapshotsEqual(currentPackedEntry, expectedPackedEntry)) {
      throw new WorktreeCleanupError("branch_identity_drift_before_worktree_removal")
    }
    if (packedContents !== "") {
      let packedMatches = 0
      const updatedPackedContents = packedContents.split("\n").filter((line) => {
        const separator = line.indexOf(" ")
        if (separator < 0 || line.slice(separator + 1) !== ref) return true
        packedMatches += 1
        if (line.slice(0, separator) !== expectedHead) {
          throw new WorktreeCleanupError("branch_identity_drift_before_worktree_removal")
        }
        return false
      }).join("\n")
      if (packedMatches > 1) {
        throw new WorktreeCleanupError("branch_identity_drift_before_worktree_removal")
      }
      if (packedMatches === 1) {
        fchmodSync(packedLockFd, lstatSync(packedRefs).mode)
        writeFileSync(packedLockFd, updatedPackedContents)
        fsyncSync(packedLockFd)
        packedRewritePrepared = true
      }
    }
    linkSync(refPath, refLock)
    refLockIdentity = fileIdentityForPath(refLock)
    if (
      lstatSync(refLock).mode !== expectedMode
      || readFileSync(refLock, "utf8") !== `ref: ${target}\n`
    ) {
      throw new WorktreeCleanupError("branch_identity_drift_before_worktree_removal")
    }
    chainLocks = lockAndVerifySymbolicRefChain(cwd, expectedChain, expectedHead)
    unlinkSync(refPath)
    refUnlinked = true
    if (packedRewritePrepared && packedLockFd !== undefined && packedLockIdentity) {
      closeSync(packedLockFd)
      packedLockFd = undefined
      if (!lockMatches(packedRefsLock, packedLockIdentity)) {
        throw new WorktreeCleanupError("branch_identity_drift_before_worktree_removal")
      }
      renameSync(packedRefsLock, packedRefs)
      packedLockCommitted = true
    }
  } catch {
    if (refUnlinked && !existsSync(refPath)) {
      try {
        linkSync(refLock, refPath)
      } catch {
        // The caller reports the incomplete symbolic claim through its surviving guard.
      }
    }
    throw new WorktreeCleanupError("branch_identity_drift_before_worktree_removal")
  } finally {
    if (packedLockFd !== undefined) closeSync(packedLockFd)
    if (!packedLockCommitted && packedLockIdentity) {
      unlinkOwnedLock(packedRefsLock, packedLockIdentity)
    }
    releaseOwnedRefLocks(chainLocks)
    if (refLockIdentity) unlinkOwnedLock(refLock, refLockIdentity)
  }
}

function createLockedSymbolicRef(
  cwd: string,
  ref: string,
  target: string,
  expectedChain: SymbolicRefChainEntry[],
  expectedHead: string,
  mode: number,
): FileIdentity {
  const refPath = looseRefPath(cwd, ref)
  const refLock = `${refPath}.lock`
  const packedRefs = join(git(cwd, ["rev-parse", "--path-format=absolute", "--git-common-dir"]), "packed-refs")
  const packedRefsLock = `${packedRefs}.lock`
  let chainLocks: OwnedRefLock[] = []
  let refLockFd: number | undefined
  let refLockIdentity: FileIdentity | undefined
  let packedLockFd: number | undefined
  let packedLockIdentity: FileIdentity | undefined
  let refRestored = false
  try {
    packedLockFd = openSync(packedRefsLock, "wx", 0o600)
    packedLockIdentity = fileIdentityForDescriptor(packedLockFd)
    if (snapshotPackedRefEntry(cwd, ref) !== null) {
      throw new WorktreeCleanupError("ref_restore_failed")
    }
    chainLocks = lockAndVerifySymbolicRefChain(cwd, expectedChain, expectedHead)
    if (!refMissingNoDeref(cwd, ref)) {
      throw new WorktreeCleanupError("ref_restore_failed")
    }
    refLockFd = openSync(refLock, "wx", mode)
    refLockIdentity = fileIdentityForDescriptor(refLockFd)
    fchmodSync(refLockFd, mode)
    if (existsSync(refPath)) throw new WorktreeCleanupError("ref_restore_failed")
    writeFileSync(refLockFd, `ref: ${target}\n`)
    fsyncSync(refLockFd)
    closeSync(refLockFd)
    refLockFd = undefined
    if (!lockMatches(refLock, refLockIdentity)) {
      throw new WorktreeCleanupError("ref_restore_failed")
    }
    renameSync(refLock, refPath)
    refRestored = true
    return refLockIdentity
  } catch {
    throw new WorktreeCleanupError("ref_restore_failed")
  } finally {
    if (refLockFd !== undefined) closeSync(refLockFd)
    if (!refRestored && refLockIdentity) unlinkOwnedLock(refLock, refLockIdentity)
    if (packedLockFd !== undefined) closeSync(packedLockFd)
    if (packedLockIdentity) unlinkOwnedLock(packedRefsLock, packedLockIdentity)
    releaseOwnedRefLocks(chainLocks)
  }
}

function snapshotIdentifiedFile(path: string): IdentifiedFileSnapshot | null {
  if (!existsSync(path)) return null
  const metadata = lstatSync(path, { bigint: true })
  return {
    contents: readFileSync(path),
    mode: Number(metadata.mode),
    identity: {
      dev: metadata.dev,
      ino: metadata.ino,
      ctimeNs: metadata.ctimeNs,
    },
  }
}

function snapshotGuardRef(
  cwd: string,
  ref: string,
  expectedHead: string,
): Extract<RefSnapshot, { kind: "direct" }> {
  const snapshot = snapshotRef(cwd, ref, expectedHead)
  if (snapshot.kind !== "direct" || snapshot.packedEntry !== null) {
    throw new WorktreeCleanupError(
      "branch_identity_drift_before_worktree_removal",
      undefined,
      ref,
    )
  }
  return { ...snapshot, packedRefsIdentity: undefined }
}

function snapshotFileInstance(path: string): FileInstanceIdentity | null {
  if (!existsSync(path)) return null
  const metadata = lstatSync(path, { bigint: true })
  return {
    dev: metadata.dev,
    ino: metadata.ino,
    ctimeNs: metadata.ctimeNs,
  }
}

function restoreFile(path: string, snapshot: FileSnapshot | null): void {
  const lockPath = `${path}.lock`
  const createdParents = ensureParentDirectories(lockPath)
  let lockFd: number | undefined
  let lockIdentity: FileIdentity | undefined
  try {
    if (snapshot === null) {
      if (existsSync(path)) unlinkSync(path)
      return
    }
    lockFd = openSync(lockPath, "wx", snapshot.mode)
    lockIdentity = fileIdentityForDescriptor(lockFd)
    fchmodSync(lockFd, snapshot.mode)
    writeFileSync(lockFd, snapshot.contents)
    fsyncSync(lockFd)
    closeSync(lockFd)
    lockFd = undefined
    if (!lockMatches(lockPath, lockIdentity)) {
      throw new WorktreeCleanupError("ref_restore_failed")
    }
    renameSync(lockPath, path)
  } finally {
    if (lockFd !== undefined) closeSync(lockFd)
    if (lockIdentity) unlinkOwnedLock(lockPath, lockIdentity)
    removeCreatedParents(createdParents)
  }
}

function looseRefPath(cwd: string, ref: string): string {
  const commonDir = git(cwd, ["rev-parse", "--path-format=absolute", "--git-common-dir"])
  const refPath = resolve(commonDir, ref)
  if (!refPath.startsWith(`${resolve(commonDir)}/`)) {
    throw new WorktreeCleanupError("git_operation_failed")
  }
  return refPath
}

function packedRefsPath(cwd: string): string {
  return join(git(cwd, ["rev-parse", "--path-format=absolute", "--git-common-dir"]), "packed-refs")
}

function deleteGuardRef(
  cwd: string,
  guardRef: string,
  expectedHead: string,
  guardSnapshot: Extract<RefSnapshot, { kind: "direct" }> | undefined,
  snapshot: RefSnapshot | undefined,
  originalRef: string,
): void {
  if (!guardSnapshot) throw new WorktreeCleanupError("guard_ref_cleanup_failed")
  const deleteGuard = runValidatedDirectRefTransaction(
    cwd,
    guardRef,
    null,
    expectedHead,
    guardSnapshot,
  )
  if (deleteGuard.exitCode !== 0 && !refMissingNoDeref(cwd, guardRef)) {
    throw new WorktreeCleanupError("guard_ref_cleanup_failed")
  }
  if (!snapshot) return
  cleanupDeletedBranchMetadata(cwd, originalRef)
}

function cleanupDeletedBranchMetadata(cwd: string, ref: string): void {
  const refPath = looseRefPath(cwd, ref)
  const refLock = `${refPath}.lock`
  const commonDir = git(cwd, ["rev-parse", "--path-format=absolute", "--git-common-dir"])
  const packedRefs = join(commonDir, "packed-refs")
  const packedRefsLock = `${packedRefs}.lock`
  const createdParents = ensureParentDirectories(refLock)
  let refLockFd: number | undefined
  let refLockIdentity: FileIdentity | undefined
  let packedLockFd: number | undefined
  let packedLockIdentity: FileIdentity | undefined
  try {
    packedLockFd = openSync(packedRefsLock, "wx", 0o600)
    packedLockIdentity = fileIdentityForDescriptor(packedLockFd)
    refLockFd = openSync(refLock, "wx", 0o600)
    refLockIdentity = fileIdentityForDescriptor(refLockFd)
    const packedRefPresent = existsSync(packedRefs)
      && readFileSync(packedRefs, "utf8")
        .split("\n")
        .some((line) => line.endsWith(` ${ref}`))
    if (existsSync(refPath) || packedRefPresent) return
    const branchName = ref.slice("refs/heads/".length)
    removeBranchConfigUnderLock(cwd, commonDir, branchName)
    const reflogPath = looseRefPath(cwd, `logs/${ref}`)
    if (existsSync(reflogPath)) unlinkSync(reflogPath)
  } finally {
    if (refLockFd !== undefined) {
      closeSync(refLockFd)
      if (refLockIdentity) unlinkOwnedLock(refLock, refLockIdentity)
    }
    if (packedLockFd !== undefined) closeSync(packedLockFd)
    if (packedLockIdentity) unlinkOwnedLock(packedRefsLock, packedLockIdentity)
    removeCreatedParents(createdParents)
  }
}

function removeBranchConfigUnderLock(
  cwd: string,
  commonDir: string,
  branchName: string,
): void {
  const configLinkPath = join(commonDir, "config")
  const configLinkIdentity = fileIdentityForPath(configLinkPath)
  const configPath = realpathSync(configLinkPath)
  const lockPath = `${configPath}.lock`
  const configIdentity = fileIdentityForPath(configPath)
  const configContents = readFileSync(configPath)
  const configMode = lstatSync(configPath).mode
  let lockFd: number | undefined
  let lockIdentity: FileIdentity | undefined
  let editDirectory: string | undefined
  let committed = false
  try {
    lockFd = openSync(lockPath, "wx", 0o600)
    lockIdentity = fileIdentityForDescriptor(lockFd)
    fchmodSync(lockFd, configMode)
    writeFileSync(lockFd, configContents)
    fsyncSync(lockFd)
    if (!lockMatches(lockPath, lockIdentity)) {
      throw new WorktreeCleanupError("guard_branch_config_cleanup_failed")
    }
    editDirectory = mkdtempSync(join(commonDir, "worktree-cleanup-config-"))
    const editPath = join(editDirectory, "config")
    writeFileSync(editPath, configContents, { mode: configMode })
    const sectionPattern = `^branch\\.${escapeRegExp(branchName)}\\.`
    const existingConfig = gitResult(cwd, [
      "config",
      "--file",
      editPath,
      "--no-includes",
      "--name-only",
      "--get-regexp",
      sectionPattern,
    ])
    if (existingConfig.exitCode === 1 && existingConfig.stderr.length === 0) return
    if (existingConfig.exitCode !== 0) {
      throw new WorktreeCleanupError("guard_branch_config_cleanup_failed")
    }
    const configKeys = [...new Set(
      existingConfig.stdout.toString().trim().split("\n").filter(Boolean),
    )]
    for (const key of configKeys) {
      const deleteConfig = gitResult(cwd, [
        "config",
        "--file",
        editPath,
        "--unset-all",
        key,
      ])
      if (deleteConfig.exitCode !== 0) {
        throw new WorktreeCleanupError("guard_branch_config_cleanup_failed")
      }
    }
    let configLinkMatches = false
    try {
      configLinkMatches = lockMatches(configLinkPath, configLinkIdentity)
        && realpathSync(configLinkPath) === configPath
    } catch {
      // A changed or unavailable link target is another config owner.
    }
    if (
      !configLinkMatches
      || !lockMatches(configPath, configIdentity)
      || !readFileSync(configPath).equals(configContents)
      || !lockMatches(lockPath, lockIdentity)
    ) {
      throw new WorktreeCleanupError("guard_branch_config_cleanup_failed")
    }
    const editedContents = readFileSync(editPath)
    ftruncateSync(lockFd, 0)
    if (writeSync(lockFd, editedContents, 0, editedContents.length, 0) !== editedContents.length) {
      throw new WorktreeCleanupError("guard_branch_config_cleanup_failed")
    }
    fsyncSync(lockFd)
    closeSync(lockFd)
    lockFd = undefined
    if (!lockMatches(lockPath, lockIdentity)) {
      throw new WorktreeCleanupError("guard_branch_config_cleanup_failed")
    }
    renameSync(lockPath, configPath)
    committed = true
  } finally {
    if (lockFd !== undefined) closeSync(lockFd)
    if (!committed && lockIdentity) unlinkOwnedLock(lockPath, lockIdentity)
    if (editDirectory) rmSync(editDirectory, { recursive: true, force: true })
  }
}

function ensureParentDirectories(path: string): string[] {
  const created: string[] = []
  let directory = dirname(path)
  while (!existsSync(directory)) {
    created.push(directory)
    directory = dirname(directory)
  }
  mkdirSync(dirname(path), { recursive: true })
  return created
}

function removeCreatedParents(directories: string[]): void {
  for (const directory of directories) {
    try {
      rmdirSync(directory)
    } catch {
      // Preserve directories that acquired another ref or metadata owner.
    }
  }
}

function unlinkOwnedLock(path: string, identity: FileIdentity): void {
  if (lockMatches(path, identity)) unlinkSync(path)
}

function lockMatches(path: string, identity: FileIdentity): boolean {
  try {
    const current = fileIdentityForPath(path)
    return current.dev === identity.dev && current.ino === identity.ino
  } catch {
    return false
  }
}

function fileIdentityForPath(path: string): FileIdentity {
  const metadata = lstatSync(path, { bigint: true })
  return { dev: metadata.dev, ino: metadata.ino }
}

function fileIdentityForDescriptor(fileDescriptor: number): FileIdentity {
  const metadata = fstatSync(fileDescriptor, { bigint: true })
  return { dev: metadata.dev, ino: metadata.ino }
}

function assertRefOwnedByWorktree(cwd: string, ref: string, expectedPath: string): void {
  const matches = worktreePathsForRef(cwd, ref)
  if (matches.length !== 1 || resolve(matches[0]!) !== resolve(expectedPath)) {
    throw new WorktreeCleanupError("target_ref_shared_with_other_worktree")
  }
}

function assertRefNotCheckedOut(cwd: string, ref: string): void {
  if (worktreePathsForRef(cwd, ref).length !== 0) {
    throw new WorktreeCleanupError("target_ref_shared_with_other_worktree")
  }
}

function worktreePathsForRef(cwd: string, ref: string): string[] {
  const result = gitResult(cwd, ["worktree", "list", "--porcelain", "-z"])
  if (result.exitCode !== 0) throw new WorktreeCleanupError("git_operation_failed")
  const symbolic = gitResult(cwd, ["symbolic-ref", "-q", ref])
  if (
    symbolic.exitCode !== 0
    && (symbolic.exitCode !== 1 || symbolic.stderr.length > 0)
  ) {
    throw new WorktreeCleanupError("git_operation_failed")
  }
  const matchingRefs = new Set([
    ref,
    ...(symbolic.exitCode === 0 ? [symbolic.stdout.toString().trim()] : []),
  ])
  const matches: string[] = []
  let worktreePath: string | undefined
  for (const field of result.stdout.toString().split("\0")) {
    if (field === "") {
      worktreePath = undefined
    } else if (field.startsWith("worktree ")) {
      worktreePath = field.slice("worktree ".length)
    } else if (
      worktreePath
      && field.startsWith("branch ")
      && matchingRefs.has(field.slice("branch ".length))
    ) {
      matches.push(worktreePath)
    }
  }
  return matches
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
}

function rollbackMove(repositoryCwd: string, quarantinePath: string, originalPath: string): void {
  if (!existsSync(quarantinePath) || existsSync(originalPath)) {
    throw new WorktreeCleanupError("rollback_unavailable")
  }
  const result = gitResult(repositoryCwd, ["worktree", "move", "--", quarantinePath, originalPath])
  if (
    result.exitCode !== 0
    && (!existsSync(originalPath) || existsSync(quarantinePath))
  ) {
    throw new WorktreeCleanupError("rollback_failed")
  }
}

function assertNoRegisteredSubmodules(worktreePath: string): void {
  const result = gitResult(worktreePath, ["submodule", "status", "--recursive"])
  if (result.exitCode !== 0) {
    throw new WorktreeCleanupError("git_operation_failed")
  }
  if (result.stdout.toString().split("\n").some((line) => line !== "")) {
    throw new WorktreeCleanupError("worktree_has_registered_submodules")
  }
}

function assertWorktreeId(value: string): void {
  if (!isWorktreeId(value)) {
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

function refMissingNoDeref(cwd: string, ref: string): boolean {
  const symbolic = gitResult(cwd, ["symbolic-ref", "-q", "--no-recurse", ref])
  if (symbolic.exitCode === 0) return false
  if (symbolic.exitCode !== 1 || symbolic.stderr.length > 0) return false
  const result = Bun.spawnSync(["git", "-C", cwd, "update-ref", "--stdin"], {
    stdin: Buffer.from([
      "option no-deref",
      `verify ${ref} ${nullOid(cwd)}`,
      "",
    ].join("\n")),
    stdout: "pipe",
    stderr: "pipe",
  })
  return result.exitCode === 0
}

function nullOid(cwd: string): string {
  const objectFormat = git(cwd, ["rev-parse", "--show-object-format"])
  if (objectFormat === "sha1") return "0".repeat(40)
  if (objectFormat === "sha256") return "0".repeat(64)
  throw new WorktreeCleanupError("unsupported_object_format")
}

function sanitizeWorktreeId(value: string): string {
  return isWorktreeId(value) ? value : "[invalid]"
}

function isWorktreeId(value: string): boolean {
  if (value.length === 0 || value === "." || value === "..") return false
  for (const character of value) {
    const codePoint = character.codePointAt(0)
    if (
      character === "/"
      || character === "\\"
      || codePoint === undefined
      || /[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/u.test(character)
    ) {
      return false
    }
  }
  return true
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

function sanitizeGuardRef(value: string | null): string | null {
  if (
    !value
    || !/^refs\/(?:heads\/worktree-cleanup-|worktree-cleanup\/)[0-9a-f]{64}$/.test(value)
  ) {
    return null
  }
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

function gitResult(cwd: string, args: string[]): PipedCommandResult {
  return Bun.spawnSync(
    ["git", "-C", cwd, "--no-replace-objects", ...args],
    { stdout: "pipe", stderr: "pipe" },
  ) as PipedCommandResult
}

function gitResultWithEnvironment(
  cwd: string,
  args: string[],
  environment: Record<string, string | undefined>,
): PipedCommandResult {
  return Bun.spawnSync(["git", "-C", cwd, "--no-replace-objects", ...args], {
    env: environment,
    stdout: "pipe",
    stderr: "pipe",
  }) as PipedCommandResult
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

  const removeArgs = [...args]
  try {
    return parseRemoveArgs(removeArgs)
  } catch (error) {
    if (!(error instanceof WorktreeCleanupError)) throw error
    throw new WorktreeCleanupError(error.code, invocationFailureReceipt(removeArgs, error.code))
  }
}

function parseRemoveArgs(args: string[]): {
  action: "remove"
  options: RemoveOptions
} {
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
    action: "remove",
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

function invocationFailureReceipt(args: string[], reasonCode: string): CleanupExecutionReceipt {
  const recognized = new Set([
    "--owner-commit",
    "--worktree-id",
    "--expected-generation",
    "--expected-head",
    "--expected-ref",
  ])
  const values = new Map<string, string>()
  for (let index = 0; index < args.length; index += 1) {
    const flag = args[index]
    const value = args[index + 1]
    if (recognized.has(flag ?? "") && value && !value.startsWith("--") && !values.has(flag)) {
      values.set(flag, value)
      index += 1
    }
  }
  return failureReceipt({
    repositoryCwd: process.cwd(),
    ownerCommit: values.get("--owner-commit") ?? "[missing]",
    worktreeId: values.get("--worktree-id") ?? "[missing]",
    expectedGeneration: values.get("--expected-generation") ?? "[missing]",
    expectedHead: values.get("--expected-head") ?? "[missing]",
    expectedRef: values.get("--expected-ref") ?? null,
    removeIgnored: false,
  }, reasonCode, undefined, false, false, false, false, false, false)
}

function output(value: unknown): void {
  process.stdout.write(`${JSON.stringify(value)}\n`)
}

if (import.meta.main) {
  const requestedAction = process.argv[2] === "identify"
    ? "identify"
    : process.argv[2] === "remove"
      ? "remove"
      : undefined
  try {
    const parsed = parseArgs(process.argv.slice(2))
    output(parsed.action === "identify"
      ? identifyLinkedWorktree(parsed.cwd)
      : removeOwnedWorktree(parsed.options))
  } catch (error) {
    const failure = error instanceof WorktreeCleanupError ? error : new WorktreeCleanupError("unknown")
    output(failure.receipt ?? (requestedAction === "identify" ? {
      schema_version: IDENTITY_SCHEMA,
      operation: "identify-linked-worktree",
      status: "failed",
      reason_code: failure.code,
    } : {
      schema_version: EXECUTION_SCHEMA,
      operation: "remove-linked-worktree",
      status: "failed",
      reason_code: failure.code,
    }))
    process.exit(1)
  }
}
