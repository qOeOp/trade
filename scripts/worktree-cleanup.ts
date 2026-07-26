#!/usr/bin/env bun

import {
  closeSync,
  existsSync,
  fchmodSync,
  fstatSync,
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
  rmdirSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from "node:fs"
import { randomBytes } from "node:crypto"
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
  dev: number
  ino: number
}

type RefSnapshot = {
  kind: "direct"
  reflog: FileSnapshot | null
} | {
  kind: "symbolic"
  target: string
  mode: number
  packedEntry: PackedRefSnapshot | null
}

interface FileSnapshot {
  contents: Buffer
  mode: number
}

interface PackedRefSnapshot {
  line: string
  index: number
  previousLine: string | null
  nextLine: string | null
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
    if (options.expectedRef !== null) assertFilesRefStorage(ownerCwd)
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
    if (process.platform === "linux") assertNoUnixSockets(initial.worktreePath, false)
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
    if (git(claimed.worktreePath, ["clean", "-ndX"])) {
      if (!options.removeIgnored) throw new WorktreeCleanupError("worktree_has_ignored_files")
      const entriesBefore = targetEntries(claimed.worktreePath)
      try {
        git(claimed.worktreePath, ["clean", "-fdX"])
        ignoredRemoved = true
      } catch (error) {
        const entriesAfter = targetEntries(claimed.worktreePath)
        ignoredRemoved = [...entriesBefore].some((entry) => !entriesAfter.has(entry))
        throw error
      }
      assertNoIgnoredFiles(claimed.worktreePath)
      assertNoTargetUsers(claimed.worktreePath)
      if (process.platform === "linux") assertNoUnixSockets(initial.worktreePath, false)
    }

    if (options.expectedRef !== null) {
      assertRefOwnedByWorktree(ownerCwd, options.expectedRef, claimed.worktreePath)
      refSnapshot = snapshotRef(ownerCwd, options.expectedRef, options.expectedHead)
      guardRef = claimRef(ownerCwd, options.expectedRef, options.expectedHead, refSnapshot)
      refDeleted = true
      git(claimed.worktreePath, ["symbolic-ref", "HEAD", guardRef])
      if (git(ownerCwd, ["rev-parse", "--verify", guardRef]) !== options.expectedHead) {
        throw new WorktreeCleanupError("branch_identity_drift_before_worktree_removal")
      }
      assertRefOwnedByWorktree(ownerCwd, guardRef, claimed.worktreePath)
      assertRefNotCheckedOut(ownerCwd, options.expectedRef)
    }

    const removeResult = gitResult(ownerCwd, ["worktree", "remove", "--", quarantinePath])
    removed = !existsSync(claimed.adminDir) && !existsSync(quarantinePath)
    if (removeResult.exitCode !== 0 && !removed) {
      throw new WorktreeCleanupError("git_operation_failed")
    }
    if (!removed) throw new WorktreeCleanupError("worktree_removal_incomplete")
    if (guardRef) {
      deleteGuardRef(
        ownerCwd,
        guardRef,
        options.expectedHead,
        refSnapshot,
        options.expectedRef,
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
    const reason = error instanceof WorktreeCleanupError ? error.code : "owner_operation_failed"
    if ((refDeleted || moved) && !removed && quarantinePath && initial) {
      rollbackAttempted = true
      try {
        if (refDeleted && options.expectedRef !== null && refSnapshot) {
          if (!guardRef) throw new WorktreeCleanupError("guard_ref_missing")
          restoreRef(ownerCwd, options.expectedRef, options.expectedHead, guardRef, refSnapshot)
          git(quarantinePath, ["symbolic-ref", "HEAD", options.expectedRef])
          refDeleted = false
          if (refSnapshot.kind === "symbolic") {
            deleteGuardRef(
              ownerCwd,
              guardRef,
              options.expectedHead,
              refSnapshot,
              options.expectedRef,
            )
          }
        }
        rollbackMove(ownerCwd, quarantinePath, initial.worktreePath)
        moved = false
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
  assertNoTargetPathUsers(worktreePath)
}

function assertNoTargetPathUsers(worktreePath: string): void {
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
  assertNoUnixSockets(worktreePath)
  const targetFiles = collectTargetFileIdentities(worktreePath)
  const inspectedNetworkNamespaces = new Set<string>()
  let processes
  try {
    processes = readdirSync("/proc", { withFileTypes: true })
      .filter((entry) => entry.isDirectory() && /^\d+$/.test(entry.name))
  } catch {
    throw new WorktreeCleanupError("process_guard_unavailable")
  }

  for (const processEntry of processes) {
    const processPath = join("/proc", processEntry.name)
    if (isZombieProcess(processPath)) continue
    const networkNamespace = readProcessLink(join(processPath, "ns", "net"))
    if (networkNamespace !== null && !inspectedNetworkNamespaces.has(networkNamespace)) {
      assertNoUnixSocketsFrom(
        join(processPath, "net", "unix"),
        worktreePath,
        true,
      )
      inspectedNetworkNamespaces.add(networkNamespace)
    }
    for (const linkName of ["cwd", "root", "exe"]) {
      const usedPath = readProcessLink(join(processPath, linkName))
      if (usedPath !== null && pathUsesTarget(usedPath, worktreePath)) {
        throw new WorktreeCleanupError("target_in_use")
      }
    }
    for (const mappedPath of readProcessMappings(processPath)) {
      if (pathUsesTarget(mappedPath, worktreePath)) {
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
      const descriptorPath = join(processPath, "fd", fileDescriptor)
      const usedPath = readProcessLink(descriptorPath)
      if (usedPath !== null && pathUsesTarget(usedPath, worktreePath)) {
        throw new WorktreeCleanupError("target_in_use")
      }
      let descriptorMetadata
      try {
        descriptorMetadata = statSync(descriptorPath)
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
        assertNoTargetInotifyWatch(processPath, fileDescriptor, targetFiles)
      }
    }
  }
}

function assertNoUnixSockets(worktreePath: string, inspectSocketFiles = true): void {
  assertNoUnixSocketsFrom("/proc/net/unix", worktreePath, inspectSocketFiles)
}

function assertNoUnixSocketsFrom(
  procUnixPath: string,
  worktreePath: string,
  inspectSocketFiles: boolean,
): void {
  const targetSocketFiles = inspectSocketFiles ? collectUnixSocketFiles(worktreePath) : []
  const relativeTargetSockets = new Map(
    targetSocketFiles.map((socketPath) => [socketPath.slice(worktreePath.length + 1), socketPath]),
  )
  let sockets
  try {
    sockets = readFileSync(procUnixPath, "utf8")
  } catch (error) {
    if (isMissingProcessEntry(error) && procUnixPath !== "/proc/net/unix") return
    throw new WorktreeCleanupError("process_guard_unavailable")
  }
  for (const line of sockets.split("\n").slice(1)) {
    if (!line) continue
    const match = line.match(/^\S+\s+\S+\s+\S+\s+\S+\s+\S+\s+\S+\s+\S+(?:\s+(.*))?$/)
    if (!match) throw new WorktreeCleanupError("process_guard_unavailable")
    const socketPath = match[1]
    if (socketPath?.startsWith("/") && pathUsesTarget(socketPath, worktreePath)) {
      throw new WorktreeCleanupError("target_in_use")
    }
    const targetSocket = socketPath ? relativeTargetSockets.get(socketPath) : undefined
    if (targetSocket && probeUnixSocket(targetSocket) !== "stale") {
      throw new WorktreeCleanupError("target_in_use")
    }
  }
}

function probeUnixSocket(socketPath: string): "live" | "stale" | "unavailable" {
  const probe = Bun.spawnSync([
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
  ], {
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
  const lines = readFileSync(packedRefs, "utf8").split("\n")
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
      metadata = lstatSync(path)
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
    if (targetFiles.has(`${match[2]}:${match[1]}`)) {
      throw new WorktreeCleanupError("target_in_use")
    }
  }
}

function readProcessMappings(processPath: string): string[] {
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
      /^[0-9a-f]+-[0-9a-f]+\s+\S+\s+\S+\s+\S+\s+\d+\s*(.*)$/,
    )
    if (!match) throw new WorktreeCleanupError("process_guard_unavailable")
    const path = match[1]
    return path?.startsWith("/") ? [path] : []
  })
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

function targetEntries(directory: string): Set<string> {
  const paths: string[] = []
  collectTargetPaths(directory, paths)
  return new Set(paths)
}

function assertOwnerTool(options: RemoveOptions): void {
  const objectType = gitResult(options.repositoryCwd, ["cat-file", "-t", options.ownerCommit])
  if (objectType.exitCode !== 0 || objectType.stdout.toString().trim() !== "commit") {
    throw new WorktreeCleanupError("owner_tool_identity_missing")
  }
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
        mode: lstatSync(looseRefPath(cwd, ref)).mode,
        packedEntry: snapshotPackedRefEntry(cwd, ref),
      }
    : { kind: "direct" as const, reflog: snapshotFile(looseRefPath(cwd, `logs/${ref}`)) }
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
): string {
  const suffix = randomBytes(32).toString("hex")
  if (snapshot.kind === "direct") {
    const guardRef = `refs/heads/worktree-cleanup-${suffix}`
    try {
      moveLockedDirectRef(cwd, ref, guardRef, expectedHead)
    } catch {
      throw new WorktreeCleanupError("branch_identity_drift_before_worktree_removal")
    }
    return guardRef
  }

  const guardRef = `refs/worktree-cleanup/${suffix}`
  const createGuard = gitResult(cwd, [
    "update-ref",
    guardRef,
    expectedHead,
    nullOid(cwd),
  ])
  if (createGuard.exitCode !== 0) {
    throw new WorktreeCleanupError("branch_identity_drift_before_worktree_removal")
  }
  try {
    deleteLockedSymbolicRef(cwd, ref, snapshot.target, expectedHead)
  } catch {
    gitResult(cwd, ["update-ref", "-d", guardRef, expectedHead])
    throw new WorktreeCleanupError(
      "branch_identity_drift_before_worktree_removal",
      undefined,
      survivingGuardRef(cwd, guardRef) ?? undefined,
    )
  }
  return guardRef
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
      moveLockedDirectRef(cwd, guardRef, ref, expectedHead)
      restoreFile(looseRefPath(cwd, `logs/${ref}`), snapshot.reflog)
    } catch {
      throw new WorktreeCleanupError("ref_restore_failed")
    }
    return
  }
  restoreSymbolicRef(cwd, ref, expectedHead, snapshot.target, snapshot.mode)
  restorePackedRefEntry(cwd, ref, snapshot.packedEntry)
}

function restoreSymbolicRef(
  cwd: string,
  ref: string,
  expectedHead: string,
  target: string,
  mode: number,
): void {
  try {
    createLockedSymbolicRef(cwd, ref, target, expectedHead, mode)
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
    lockIdentity = fstatSync(lockFd)
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
): void {
  const transaction = Bun.spawnSync(["git", "-C", cwd, "update-ref", "--stdin"], {
    stdin: Buffer.from([
      "start",
      "option no-deref",
      `create ${destinationRef} ${expectedHead}`,
      `delete ${sourceRef} ${expectedHead}`,
      "prepare",
      "commit",
      "",
    ].join("\n")),
    stdout: "pipe",
    stderr: "pipe",
  })
  if (transaction.exitCode !== 0) {
    throw new WorktreeCleanupError("branch_identity_drift_before_worktree_removal")
  }
}

function deleteLockedSymbolicRef(
  cwd: string,
  ref: string,
  target: string,
  expectedHead: string,
): void {
  const refPath = looseRefPath(cwd, ref)
  const targetPath = looseRefPath(cwd, target)
  const refLock = `${refPath}.lock`
  const targetLock = `${targetPath}.lock`
  const packedRefs = join(git(cwd, ["rev-parse", "--path-format=absolute", "--git-common-dir"]), "packed-refs")
  const packedRefsLock = `${packedRefs}.lock`
  let refLockIdentity: FileIdentity | undefined
  let targetLockFd: number | undefined
  let targetLockIdentity: FileIdentity | undefined
  let packedLockFd: number | undefined
  let packedLockIdentity: FileIdentity | undefined
  let packedRewritePrepared = false
  let packedLockCommitted = false
  const createdTargetParents = ensureParentDirectories(targetLock)
  try {
    packedLockFd = openSync(packedRefsLock, "wx", 0o600)
    packedLockIdentity = fstatSync(packedLockFd)
    if (existsSync(packedRefs)) {
      const packedContents = readFileSync(packedRefs, "utf8")
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
    refLockIdentity = lstatSync(refLock)
    if (readFileSync(refLock, "utf8") !== `ref: ${target}\n`) {
      throw new WorktreeCleanupError("branch_identity_drift_before_worktree_removal")
    }
    targetLockFd = openSync(targetLock, "wx", 0o600)
    targetLockIdentity = fstatSync(targetLockFd)
    const targetHead = gitResult(cwd, ["rev-parse", "--verify", target])
    if (
      targetHead.exitCode !== 0
      || targetHead.stdout.toString().trim() !== expectedHead
    ) {
      throw new WorktreeCleanupError("branch_identity_drift_before_worktree_removal")
    }
    if (packedRewritePrepared && packedLockFd !== undefined && packedLockIdentity) {
      closeSync(packedLockFd)
      packedLockFd = undefined
      if (!lockMatches(packedRefsLock, packedLockIdentity)) {
        throw new WorktreeCleanupError("branch_identity_drift_before_worktree_removal")
      }
      renameSync(packedRefsLock, packedRefs)
      packedLockCommitted = true
    }
    unlinkSync(refPath)
  } catch {
    throw new WorktreeCleanupError("branch_identity_drift_before_worktree_removal")
  } finally {
    if (packedLockFd !== undefined) closeSync(packedLockFd)
    if (!packedLockCommitted && packedLockIdentity) {
      unlinkOwnedLock(packedRefsLock, packedLockIdentity)
    }
    if (targetLockFd !== undefined) closeSync(targetLockFd)
    if (targetLockIdentity) unlinkOwnedLock(targetLock, targetLockIdentity)
    if (refLockIdentity) unlinkOwnedLock(refLock, refLockIdentity)
    removeCreatedParents(createdTargetParents)
  }
}

function createLockedSymbolicRef(
  cwd: string,
  ref: string,
  target: string,
  expectedHead: string,
  mode: number,
): void {
  const refPath = looseRefPath(cwd, ref)
  const targetPath = looseRefPath(cwd, target)
  const refLock = `${refPath}.lock`
  const targetLock = `${targetPath}.lock`
  const createdTargetParents = ensureParentDirectories(targetLock)
  let targetLockFd: number | undefined
  let targetLockIdentity: FileIdentity | undefined
  let refLockFd: number | undefined
  let refLockIdentity: FileIdentity | undefined
  let refRestored = false
  try {
    targetLockFd = openSync(targetLock, "wx", 0o600)
    targetLockIdentity = fstatSync(targetLockFd)
    const targetHead = gitResult(cwd, ["rev-parse", "--verify", target])
    if (
      targetHead.exitCode !== 0
      || targetHead.stdout.toString().trim() !== expectedHead
    ) {
      throw new WorktreeCleanupError("ref_restore_failed")
    }
    refLockFd = openSync(refLock, "wx", mode)
    refLockIdentity = fstatSync(refLockFd)
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
  } catch {
    throw new WorktreeCleanupError("ref_restore_failed")
  } finally {
    if (refLockFd !== undefined) closeSync(refLockFd)
    if (!refRestored && refLockIdentity) unlinkOwnedLock(refLock, refLockIdentity)
    if (targetLockFd !== undefined) closeSync(targetLockFd)
    if (targetLockIdentity) unlinkOwnedLock(targetLock, targetLockIdentity)
    removeCreatedParents(createdTargetParents)
  }
}

function snapshotFile(path: string): FileSnapshot | null {
  if (!existsSync(path)) return null
  const metadata = lstatSync(path)
  return { contents: readFileSync(path), mode: metadata.mode }
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
    lockIdentity = fstatSync(lockFd)
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

function packedRefExists(cwd: string, ref: string): boolean {
  const commonDir = git(cwd, ["rev-parse", "--path-format=absolute", "--git-common-dir"])
  const packedRefs = join(commonDir, "packed-refs")
  if (!existsSync(packedRefs)) return false
  return readFileSync(packedRefs, "utf8")
    .split("\n")
    .some((line) => line.endsWith(` ${ref}`))
}

function deleteGuardRef(
  cwd: string,
  guardRef: string,
  expectedHead: string,
  snapshot: RefSnapshot | undefined,
  originalRef: string,
): void {
  const deleteGuard = gitResult(cwd, ["update-ref", "-d", guardRef, expectedHead])
  if (deleteGuard.exitCode !== 0) {
    throw new WorktreeCleanupError("guard_ref_cleanup_failed")
  }
  if (!snapshot) return
  cleanupDeletedBranchMetadata(cwd, originalRef)
}

function cleanupDeletedBranchMetadata(cwd: string, ref: string): void {
  const refPath = looseRefPath(cwd, ref)
  const refLock = `${refPath}.lock`
  const createdParents = ensureParentDirectories(refLock)
  let refLockFd: number | undefined
  let refLockIdentity: FileIdentity | undefined
  try {
    refLockFd = openSync(refLock, "wx", 0o600)
    refLockIdentity = fstatSync(refLockFd)
    if (existsSync(refPath) || packedRefExists(cwd, ref)) return
    const branchName = ref.slice("refs/heads/".length)
    const sectionPattern = `^branch\\.${escapeRegExp(branchName)}\\.`
    const existingConfig = gitResult(cwd, ["config", "--get-regexp", sectionPattern])
    if (existingConfig.exitCode !== 1 || existingConfig.stderr.length > 0) {
      if (existingConfig.exitCode !== 0) {
        throw new WorktreeCleanupError("guard_branch_config_cleanup_failed")
      }
      const deleteConfig = gitResult(cwd, ["config", "--remove-section", `branch.${branchName}`])
      if (deleteConfig.exitCode !== 0) {
        throw new WorktreeCleanupError("guard_branch_config_cleanup_failed")
      }
    }
    const reflogPath = looseRefPath(cwd, `logs/${ref}`)
    if (existsSync(reflogPath)) unlinkSync(reflogPath)
  } finally {
    if (refLockFd !== undefined) {
      closeSync(refLockFd)
      if (refLockIdentity) unlinkOwnedLock(refLock, refLockIdentity)
    }
    removeCreatedParents(createdParents)
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
    const current = lstatSync(path)
    return current.dev === identity.dev && current.ino === identity.ino
  } catch {
    return false
  }
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
  const symbolic = gitResult(cwd, ["symbolic-ref", "-q", "--no-recurse", ref])
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
