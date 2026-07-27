import { afterEach, expect, setDefaultTimeout, test } from "bun:test"
import {
  chmodSync,
  copyFileSync,
  existsSync,
  linkSync,
  lstatSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmdirSync,
  rmSync,
  statSync,
  writeFileSync,
  watch,
} from "node:fs"
import { tmpdir } from "node:os"
import { createServer } from "node:net"
import { basename, dirname, join } from "node:path"
import {
  identifyLinkedWorktree,
  linuxKernelDeviceInodeIdentity,
  removeOwnedWorktree,
  WorktreeCleanupError,
} from "./worktree-cleanup"

const fixtures: string[] = []

interface PipedCommandResult {
  exitCode: number
  stdout: Buffer
  stderr: Buffer
}

setDefaultTimeout(30_000)

test("Linux kernel device identities normalize to userspace stat identities", () => {
  expect(linuxKernelDeviceInodeIdentity("fe00000", "2a")).toBe("fe00:2a")
})

afterEach(() => {
  for (const fixture of fixtures.splice(0)) rmSync(fixture, { recursive: true, force: true })
})

test("owner cleanup removes only the exact clean linked worktree and local branch", () => {
  const fixture = createFixture()
  const identity = identifyLinkedWorktree(fixture.worktree)
  const serializedIdentity = JSON.stringify(identity)
  expect(serializedIdentity).not.toContain(fixture.root)
  expect(identity.ref).toBe("refs/heads/mission-branch")

  const ownerCommit = installOwnerTool(fixture.root)
  const cleanup = runPipeline(fixture.root, [
    "git",
    "--no-replace-objects",
    "show",
    `${ownerCommit}:modules/orchestration-ops/agent-workspace-manager/scripts/worktree-cleanup.ts`,
  ], [
    "bun",
    "run",
    "-",
    "remove",
    "--owner-commit",
    ownerCommit,
    "--worktree-id",
    identity.worktree_id,
    "--expected-generation",
    identity.generation,
    "--expected-head",
    identity.head,
    "--expected-ref",
    identity.ref!,
  ])
  if (cleanup.exitCode !== 0) {
    throw new Error(`${cleanup.stdout.toString()}\n${cleanup.stderr.toString()}`)
  }
  const receipt = JSON.parse(cleanup.stdout.toString())

  expect(receipt.status).toBe("completed")
  expect(receipt.worktree_removed).toBe(true)
  expect(receipt.local_branch_deleted).toBe(true)
  expect(receipt.owner_commit).toBe(ownerCommit)
  expect(receipt.rollback_attempted).toBe(false)
  expect(receipt.rollback_completed).toBe(false)
  expect(receipt.preserved_ref).toBeNull()
  expect(receipt).not.toHaveProperty("invocation")
  expect(JSON.stringify(receipt)).not.toContain(fixture.root)
  expect(existsSync(fixture.worktree)).toBe(false)
  expect(runResult(fixture.root, ["git", "show-ref", "--verify", identity.ref!]).exitCode).not.toBe(0)
  expect(run(fixture.root, ["git", "rev-parse", "HEAD"])).toBe(ownerCommit)
})

test("owner cleanup reports branch deletion in a SHA-256 repository", () => {
  const fixture = createFixture("sha256")
  const identity = identifyLinkedWorktree(fixture.worktree)
  const ownerCommit = installOwnerTool(fixture.root)

  const receipt = removeOwnedWorktree({
    repositoryCwd: fixture.root,
    ownerCommit,
    worktreeId: identity.worktree_id,
    expectedGeneration: identity.generation,
    expectedHead: identity.head,
    expectedRef: identity.ref,
    removeIgnored: false,
  })

  expect(identity.head).toHaveLength(64)
  expect(receipt.status).toBe("completed")
  expect(receipt.local_branch_deleted).toBe(true)
  expect(existsSync(fixture.worktree)).toBe(false)
})

test("owner cleanup avoids conflicts with an existing worktree-cleanup branch", () => {
  const fixture = createFixture()
  const identity = identifyLinkedWorktree(fixture.worktree)
  run(fixture.root, ["git", "branch", "worktree-cleanup"])
  const ownerCommit = installOwnerTool(fixture.root)

  const receipt = removeOwnedWorktree({
    repositoryCwd: fixture.root,
    ownerCommit,
    worktreeId: identity.worktree_id,
    expectedGeneration: identity.generation,
    expectedHead: identity.head,
    expectedRef: identity.ref,
    removeIgnored: false,
  })

  expect(receipt.status).toBe("completed")
  expect(runResult(fixture.root, [
    "git",
    "show-ref",
    "--verify",
    "refs/heads/worktree-cleanup",
  ]).exitCode).toBe(0)
})

test("owner cleanup removes the deleted branch configuration without creating guard metadata", () => {
  const fixture = createFixture()
  const identity = identifyLinkedWorktree(fixture.worktree)
  run(fixture.root, ["git", "config", "branch.mission-branch.remote", "origin"])
  run(fixture.root, ["git", "config", "branch.mission-branch.merge", "refs/heads/main"])
  const ownerCommit = installOwnerTool(fixture.root)

  const receipt = removeOwnedWorktree({
    repositoryCwd: fixture.root,
    ownerCommit,
    worktreeId: identity.worktree_id,
    expectedGeneration: identity.generation,
    expectedHead: identity.head,
    expectedRef: identity.ref,
    removeIgnored: false,
  })

  expect(receipt.status).toBe("completed")
  expect(runResult(fixture.root, [
    "git",
    "config",
    "--get-regexp",
    "^branch\\.mission-branch\\.",
  ]).exitCode).not.toBe(0)
  expect(runResult(fixture.root, [
    "git",
    "config",
    "--get-regexp",
    "^branch\\.worktree-cleanup-",
  ]).exitCode).not.toBe(0)
})

test("owner cleanup reports a deleted branch when its metadata cleanup fails", () => {
  const fixture = createFixture()
  const identity = identifyLinkedWorktree(fixture.worktree)
  run(fixture.root, ["git", "config", "branch.mission-branch.remote", "origin"])
  const ownerCommit = installOwnerTool(fixture.root)
  const realGit = Bun.which("git")
  if (!realGit) throw new Error("git unavailable")
  const bin = join(fixture.root, "bin")
  run(fixture.root, ["/bin/mkdir", "-p", bin])
  const wrapper = join(bin, "git")
  writeFileSync(
    wrapper,
    `#!/bin/sh
case " $* " in
  *" --unset-all branch.mission-branch.remote "*) exit 72 ;;
esac
exec "${realGit}" "$@"
`,
  )
  chmodSync(wrapper, 0o755)
  const cleanup = runCleanupCli(fixture.root, identity, ownerCommit, bin)

  expect(cleanup.exitCode).toBe(1)
  const receipt = JSON.parse(cleanup.stdout.toString())
  expect(receipt.reason_code).toBe("guard_branch_config_cleanup_failed")
  expect(receipt.status).toBe("partial")
  expect(receipt.worktree_removed).toBe(true)
  expect(receipt.local_branch_deleted).toBe(true)
  expect(existsSync(fixture.worktree)).toBe(false)
  expect(runResult(fixture.root, ["git", "show-ref", "--verify", identity.ref!]).exitCode)
    .not.toBe(0)
  expect(run(fixture.root, ["git", "show-ref"])).not.toContain("refs/heads/worktree-cleanup-")
})

test("owner cleanup preserves a concurrent metadata lock it does not own", () => {
  const fixture = createFixture()
  const identity = identifyLinkedWorktree(fixture.worktree)
  const ownerCommit = installOwnerTool(fixture.root)
  const externalLock = join(fixture.root, ".git", `${identity.ref!}.lock`)
  const realGit = Bun.which("git")
  if (!realGit) throw new Error("git unavailable")
  const bin = join(fixture.root, "bin")
  run(fixture.root, ["/bin/mkdir", "-p", bin])
  const wrapper = join(bin, "git")
  writeFileSync(
    wrapper,
    `#!/bin/sh
case " $* " in
  *" worktree remove "*)
    "${realGit}" "$@" || exit $?
    printf 'external owner\\n' > "${externalLock}"
    exit 0
    ;;
esac
exec "${realGit}" "$@"
`,
  )
  chmodSync(wrapper, 0o755)
  const cleanup = runCleanupCli(fixture.root, identity, ownerCommit, bin)

  expect(cleanup.exitCode).toBe(1)
  const receipt = JSON.parse(cleanup.stdout.toString())
  expect(receipt.reason_code).toBe("owner_operation_failed")
  expect(receipt.status).toBe("partial")
  expect(receipt.worktree_removed).toBe(true)
  expect(receipt.local_branch_deleted).toBe(false)
  expect(readFileSync(externalLock, "utf8")).toBe("external owner\n")
})

test("owner cleanup locks packed and loose refs while deleting branch metadata", () => {
  const fixture = createFixture()
  const identity = identifyLinkedWorktree(fixture.worktree)
  const ownerCommit = installOwnerTool(fixture.root)
  run(fixture.root, ["git", "config", "branch.mission-branch.remote", "origin"])
  const realGit = Bun.which("git")
  if (!realGit) throw new Error("git unavailable")
  const bin = join(fixture.root, "bin")
  const recreationResult = join(bin, "recreation-result")
  run(fixture.root, ["/bin/mkdir", "-p", bin])
  const wrapper = join(bin, "git")
  writeFileSync(
    wrapper,
    `#!/bin/sh
case " $* " in
  *" --name-only --get-regexp "*)
    "${realGit}" -C "${fixture.root}" -c core.filesRefLockTimeout=0 update-ref "${identity.ref!}" "${identity.head}" >/dev/null 2>&1
    printf '%s\\n' "$?" > "${recreationResult}"
    ;;
esac
exec "${realGit}" "$@"
`,
  )
  chmodSync(wrapper, 0o755)

  const cleanup = runCleanupCli(fixture.root, identity, ownerCommit, bin)

  expect(cleanup.exitCode).toBe(0)
  const receipt = JSON.parse(cleanup.stdout.toString())
  expect(receipt.status).toBe("completed")
  expect(receipt.local_branch_deleted).toBe(true)
  expect(readFileSync(recreationResult, "utf8").trim()).not.toBe("0")
  expect(runResult(fixture.root, ["git", "config", "--get", "branch.mission-branch.remote"]).exitCode)
    .not.toBe(0)
})

test("owner cleanup holds the repository config lock while deleting branch metadata", () => {
  const fixture = createFixture()
  const identity = identifyLinkedWorktree(fixture.worktree)
  const ownerCommit = installOwnerTool(fixture.root)
  run(fixture.root, ["git", "config", "branch.mission-branch.remote", "old-owner"])
  const realGit = Bun.which("git")
  if (!realGit) throw new Error("git unavailable")
  const bin = join(fixture.root, "bin")
  const replacementResult = join(bin, "replacement-result")
  run(fixture.root, ["/bin/mkdir", "-p", bin])
  const wrapper = join(bin, "git")
  writeFileSync(
    wrapper,
    `#!/bin/sh
case " $* " in
  *" --name-only --get-regexp "*)
    "${realGit}" -C "${fixture.root}" config branch.mission-branch.remote new-owner >/dev/null 2>&1
    printf '%s\\n' "$?" > "${replacementResult}"
    ;;
esac
exec "${realGit}" "$@"
`,
  )
  chmodSync(wrapper, 0o755)

  const cleanup = runCleanupCli(fixture.root, identity, ownerCommit, bin)

  expect(cleanup.exitCode).toBe(0)
  const receipt = JSON.parse(cleanup.stdout.toString())
  expect(receipt.status).toBe("completed")
  expect(receipt.local_branch_deleted).toBe(true)
  expect(readFileSync(replacementResult, "utf8").trim()).not.toBe("0")
  expect(runResult(fixture.root, ["git", "config", "--get", "branch.mission-branch.remote"]).exitCode)
    .not.toBe(0)
})

test("owner cleanup preserves a repository config lock that replaces its own lock", () => {
  const fixture = createFixture()
  const identity = identifyLinkedWorktree(fixture.worktree)
  const ownerCommit = installOwnerTool(fixture.root)
  run(fixture.root, ["git", "config", "branch.mission-branch.remote", "old-owner"])
  const realGit = Bun.which("git")
  if (!realGit) throw new Error("git unavailable")
  const bin = join(fixture.root, "bin")
  const configLock = join(fixture.root, ".git", "config.lock")
  run(fixture.root, ["/bin/mkdir", "-p", bin])
  const wrapper = join(bin, "git")
  writeFileSync(
    wrapper,
    `#!/bin/sh
case " $* " in
  *" --name-only --get-regexp "*)
    /bin/rm -f "${configLock}"
    printf 'replacement owner\\n' > "${configLock}"
    ;;
esac
exec "${realGit}" "$@"
`,
  )
  chmodSync(wrapper, 0o755)

  const cleanup = runCleanupCli(fixture.root, identity, ownerCommit, bin)

  expect(cleanup.exitCode).toBe(1)
  const receipt = JSON.parse(cleanup.stdout.toString())
  expect(receipt.reason_code).toBe("guard_branch_config_cleanup_failed")
  expect(receipt.status).toBe("partial")
  expect(receipt.worktree_removed).toBe(true)
  expect(receipt.local_branch_deleted).toBe(true)
  expect(readFileSync(configLock, "utf8")).toBe("replacement owner\n")
  expect(run(fixture.root, ["git", "config", "--get", "branch.mission-branch.remote"]))
    .toBe("old-owner")
})

test("owner cleanup removes configuration for a branch name containing a closing bracket", () => {
  const fixture = createFixture()
  run(fixture.worktree, ["git", "branch", "-m", "mission]branch"])
  const identity = identifyLinkedWorktree(fixture.worktree)
  run(fixture.root, ["git", "config", "branch.mission]branch.remote", "origin"])
  run(fixture.root, ["git", "config", "branch.mission]branch.merge", "refs/heads/main"])
  const ownerCommit = installOwnerTool(fixture.root)

  const receipt = removeOwnedWorktree({
    repositoryCwd: fixture.root,
    ownerCommit,
    worktreeId: identity.worktree_id,
    expectedGeneration: identity.generation,
    expectedHead: identity.head,
    expectedRef: identity.ref,
    removeIgnored: false,
  })

  expect(receipt.status).toBe("completed")
  expect(runResult(fixture.root, [
    "git",
    "config",
    "--get-regexp",
    "^branch\\.mission\\]branch\\.",
  ]).exitCode).not.toBe(0)
})

test("owner cleanup does not unlink a metadata lock that replaces its own lock", () => {
  const fixture = createFixture()
  const identity = identifyLinkedWorktree(fixture.worktree)
  const ownerCommit = installOwnerTool(fixture.root)
  const replacementLock = join(fixture.root, ".git", `${identity.ref!}.lock`)
  const realGit = Bun.which("git")
  if (!realGit) throw new Error("git unavailable")
  const bin = join(fixture.root, "bin")
  run(fixture.root, ["/bin/mkdir", "-p", bin])
  const wrapper = join(bin, "git")
  writeFileSync(
    wrapper,
    `#!/bin/sh
case " $* " in
  *" --name-only --get-regexp "*)
    /bin/rm -f "${replacementLock}"
    printf 'replacement owner\\n' > "${replacementLock}"
    ;;
esac
exec "${realGit}" "$@"
`,
  )
  chmodSync(wrapper, 0o755)
  const cleanup = runCleanupCli(fixture.root, identity, ownerCommit, bin)

  expect(cleanup.exitCode).toBe(0)
  const receipt = JSON.parse(cleanup.stdout.toString())
  expect(receipt.status).toBe("completed")
  expect(receipt.worktree_removed).toBe(true)
  expect(receipt.local_branch_deleted).toBe(false)
  expect(readFileSync(replacementLock, "utf8")).toBe("replacement owner\n")
})

test("owner cleanup rejects a branch checked out by another worktree", () => {
  const fixture = createFixture()
  const identity = identifyLinkedWorktree(fixture.worktree)
  const otherWorktree = `${fixture.root}-shared`
  fixtures.push(otherWorktree)
  run(fixture.root, [
    "git",
    "worktree",
    "add",
    "--force",
    "-q",
    otherWorktree,
    "mission-branch",
  ])
  const ownerCommit = installOwnerTool(fixture.root)

  const failure = captureCleanupError(() => removeOwnedWorktree({
    repositoryCwd: fixture.root,
    ownerCommit,
    worktreeId: identity.worktree_id,
    expectedGeneration: identity.generation,
    expectedHead: identity.head,
    expectedRef: identity.ref,
    removeIgnored: false,
  }))

  expect(failure.code).toBe("target_ref_shared_with_other_worktree")
  expect(failure.receipt?.worktree_claimed).toBe(true)
  expect(failure.receipt?.rollback_attempted).toBe(true)
  expect(failure.receipt?.rollback_completed).toBe(true)
  expect(existsSync(fixture.worktree)).toBe(true)
  expect(existsSync(otherWorktree)).toBe(true)
  expect(run(fixture.worktree, ["git", "symbolic-ref", "-q", "HEAD"])).toBe(identity.ref!)
  expect(run(otherWorktree, ["git", "symbolic-ref", "-q", "HEAD"])).toBe(identity.ref!)
})

test("owner cleanup preserves a branch recreated and adopted after its direct claim", () => {
  const fixture = createFixture()
  const identity = identifyLinkedWorktree(fixture.worktree)
  const ownerCommit = installOwnerTool(fixture.root)
  const otherWorktree = `${fixture.root}-claim-race`
  fixtures.push(otherWorktree)
  const realGit = Bun.which("git")
  if (!realGit) throw new Error("git unavailable")
  const bin = join(fixture.root, "bin")
  run(fixture.root, ["/bin/mkdir", "-p", bin])
  const wrapper = join(bin, "git")
  writeFileSync(
    wrapper,
    `#!/bin/sh
case " $* " in
  *" symbolic-ref HEAD refs/heads/worktree-cleanup-"*)
    "${realGit}" -C "${fixture.root}" update-ref "${identity.ref!}" "${identity.head}"
    "${realGit}" -C "${fixture.root}" worktree add --force -q "${otherWorktree}" mission-branch
    ;;
esac
exec "${realGit}" "$@"
`,
  )
  chmodSync(wrapper, 0o755)

  const cleanup = runCleanupCli(fixture.root, identity, ownerCommit, bin)

  expect(cleanup.exitCode).toBe(1)
  const receipt = JSON.parse(cleanup.stdout.toString())
  expect(receipt.reason_code).toBe("rollback_failed")
  expect(receipt.worktree_claimed).toBe(true)
  expect(receipt.rollback_attempted).toBe(true)
  expect(receipt.rollback_completed).toBe(false)
  expect(receipt.status).toBe("partial")
  expect(receipt.worktree_removed).toBe(false)
  expect(receipt.local_branch_deleted).toBe(false)
  expect(existsSync(fixture.worktree)).toBe(false)
  expect(existsSync(otherWorktree)).toBe(true)
  expect(run(otherWorktree, ["git", "symbolic-ref", "-q", "HEAD"])).toBe(identity.ref!)
  expect(run(fixture.root, ["git", "rev-parse", identity.ref!])).toBe(identity.head)
})

test("owner cleanup rejects a concurrently locked direct ref without deleting it", () => {
  const fixture = createFixture()
  const identity = identifyLinkedWorktree(fixture.worktree)
  const ownerCommit = installOwnerTool(fixture.root)
  const sourceLock = join(fixture.root, ".git", `${identity.ref!}.lock`)
  writeFileSync(sourceLock, `${identity.head}\n`)

  const failure = captureCleanupError(() => removeOwnedWorktree({
    repositoryCwd: fixture.root,
    ownerCommit,
    worktreeId: identity.worktree_id,
    expectedGeneration: identity.generation,
    expectedHead: identity.head,
    expectedRef: identity.ref,
    removeIgnored: false,
  }))
  rmSync(sourceLock)

  expect(failure.code).toBe("branch_identity_drift_before_worktree_removal")
  expect(failure.receipt?.worktree_claimed).toBe(true)
  expect(failure.receipt?.rollback_attempted).toBe(true)
  expect(failure.receipt?.rollback_completed).toBe(true)
  expect(failure.receipt?.status).toBe("failed")
  expect(existsSync(fixture.worktree)).toBe(true)
  expect(run(fixture.worktree, ["git", "symbolic-ref", "-q", "HEAD"])).toBe(identity.ref!)
  expect(run(fixture.root, ["git", "rev-parse", identity.ref!])).toBe(identity.head)
})

test("owner cleanup deletes a loose branch without exposing its stale packed value", () => {
  const fixture = createFixture()
  run(fixture.root, ["git", "pack-refs", "--all"])
  writeFileSync(join(fixture.worktree, "advance.txt"), "new head\n")
  run(fixture.worktree, ["git", "add", "advance.txt"])
  run(fixture.worktree, ["git", "commit", "-qm", "advance mission branch"])
  const identity = identifyLinkedWorktree(fixture.worktree)
  const ownerCommit = installOwnerTool(fixture.root)

  const receipt = removeOwnedWorktree({
    repositoryCwd: fixture.root,
    ownerCommit,
    worktreeId: identity.worktree_id,
    expectedGeneration: identity.generation,
    expectedHead: identity.head,
    expectedRef: identity.ref,
    removeIgnored: false,
  })

  expect(receipt.status).toBe("completed")
  expect(receipt.local_branch_deleted).toBe(true)
  expect(existsSync(fixture.worktree)).toBe(false)
  expect(runResult(fixture.root, ["git", "show-ref", "--verify", identity.ref!]).exitCode)
    .not.toBe(0)
})

test("owner cleanup removes a packed-only nested branch without leaving lock residue", () => {
  const fixture = createFixture()
  run(fixture.worktree, ["git", "branch", "-m", "nested/mission"])
  const identity = identifyLinkedWorktree(fixture.worktree)
  run(fixture.root, ["git", "config", "branch.nested/mission.remote", "origin"])
  run(fixture.root, ["git", "pack-refs", "--all", "--prune"])
  const looseParent = join(fixture.root, ".git", "refs", "heads", "nested")
  if (existsSync(looseParent)) rmdirSync(looseParent)
  const ownerCommit = installOwnerTool(fixture.root)

  const receipt = removeOwnedWorktree({
    repositoryCwd: fixture.root,
    ownerCommit,
    worktreeId: identity.worktree_id,
    expectedGeneration: identity.generation,
    expectedHead: identity.head,
    expectedRef: identity.ref,
    removeIgnored: false,
  })

  expect(receipt.status).toBe("completed")
  expect(receipt.local_branch_deleted).toBe(true)
  expect(existsSync(fixture.worktree)).toBe(false)
  expect(existsSync(looseParent) ? readdirSync(looseParent) : [])
    .not.toContain("mission.lock")
  expect(runResult(fixture.root, ["git", "show-ref", "--verify", identity.ref!]).exitCode)
    .not.toBe(0)
  expect(runResult(fixture.root, [
    "git",
    "config",
    "--get-regexp",
    "^branch\\.nested/mission\\.",
  ]).exitCode).not.toBe(0)
})

test("owner cleanup ignores an unrelated stale worktree registration", () => {
  const fixture = createFixture()
  const identity = identifyLinkedWorktree(fixture.worktree)
  const staleWorktree = join(fixture.root, "stale linked worktree")
  run(fixture.root, ["git", "worktree", "add", "-qb", "stale-branch", staleWorktree])
  rmSync(staleWorktree, { recursive: true, force: true })
  const ownerCommit = installOwnerTool(fixture.root)

  const receipt = removeOwnedWorktree({
    repositoryCwd: fixture.root,
    ownerCommit,
    worktreeId: identity.worktree_id,
    expectedGeneration: identity.generation,
    expectedHead: identity.head,
    expectedRef: identity.ref,
    removeIgnored: false,
  })

  expect(receipt.status).toBe("completed")
  expect(existsSync(fixture.worktree)).toBe(false)
  const registrations = run(fixture.root, ["git", "worktree", "list", "--porcelain"])
  expect(registrations).toContain("branch refs/heads/stale-branch")
  expect(registrations).toContain("prunable ")
  expect(runResult(fixture.root, [
    "git",
    "show-ref",
    "--verify",
    "refs/heads/stale-branch",
  ]).exitCode).toBe(0)
})

test("owner cleanup rejects head drift without moving or deleting the target", () => {
  const fixture = createFixture()
  const identity = identifyLinkedWorktree(fixture.worktree)
  const ownerCommit = installOwnerTool(fixture.root)
  writeFileSync(join(fixture.worktree, "drift.txt"), "drift\n")
  run(fixture.worktree, ["git", "add", "drift.txt"])
  run(fixture.worktree, ["git", "commit", "-qm", "drift"])

  expect(() => removeOwnedWorktree({
    repositoryCwd: fixture.root,
    ownerCommit,
    worktreeId: identity.worktree_id,
    expectedGeneration: identity.generation,
    expectedHead: identity.head,
    expectedRef: identity.ref,
    removeIgnored: false,
  })).toThrow(new WorktreeCleanupError("target_head_mismatch"))

  expect(existsSync(fixture.worktree)).toBe(true)
  expect(run(fixture.worktree, ["git", "symbolic-ref", "-q", "HEAD"])).toBe(identity.ref!)
  expect(runResult(fixture.root, ["git", "show-ref", "--verify", identity.ref!]).exitCode).toBe(0)
})

test("owner cleanup rejects dirty targets and path-free CLI receipts stay auditable", () => {
  const fixture = createFixture()
  const identity = identifyLinkedWorktree(fixture.worktree)
  const ownerCommit = installOwnerTool(fixture.root)
  writeFileSync(join(fixture.worktree, "untracked.txt"), "preserve\n")

  const failure = captureCleanupError(() => removeOwnedWorktree({
    repositoryCwd: fixture.root,
    ownerCommit,
    worktreeId: identity.worktree_id,
    expectedGeneration: identity.generation,
    expectedHead: identity.head,
    expectedRef: identity.ref,
    removeIgnored: false,
  }))
  expect(failure.code).toBe("worktree_not_clean")
  expect(failure.receipt?.worktree_id).toBe(identity.worktree_id)
  expect(failure.receipt?.expected_head).toBe(identity.head)
  expect(failure.receipt?.expected_ref).toBe(identity.ref)
  expect(failure.receipt?.status).toBe("failed")
  expect(failure.receipt?.worktree_claimed).toBe(false)
  expect(JSON.stringify(failure.receipt)).not.toContain(fixture.root)

  const cli = runResult(fixture.worktree, ["bun", join(import.meta.dir, "worktree-cleanup.ts"), "identify"])
  expect(cli.exitCode).toBe(0)
  expect(cli.stdout.toString()).not.toContain(fixture.root)
  expect(JSON.parse(cli.stdout.toString())).toEqual(identity)
  expect(existsSync(join(fixture.worktree, "untracked.txt"))).toBe(true)
})

for (const [flag, marker] of [
  ["--assume-unchanged", "h"],
  ["--skip-worktree", "S"],
] as const) {
  test(`owner cleanup detects tracked changes hidden by ${flag} without changing the user index`, () => {
    const fixture = createFixture()
    const identity = identifyLinkedWorktree(fixture.worktree)
    const ownerCommit = installOwnerTool(fixture.root)
    run(fixture.worktree, ["git", "update-index", flag, "tracked.txt"])
    writeFileSync(join(fixture.worktree, "tracked.txt"), "hidden change\n")
    expect(run(fixture.worktree, ["git", "status", "--porcelain=v1"])).toBe("")

    const failure = captureCleanupError(() => removeOwnedWorktree({
      repositoryCwd: fixture.root,
      ownerCommit,
      worktreeId: identity.worktree_id,
      expectedGeneration: identity.generation,
      expectedHead: identity.head,
      expectedRef: identity.ref,
      removeIgnored: false,
    }))

    expect(failure.code).toBe("worktree_not_clean")
    expect(failure.receipt?.worktree_claimed).toBe(false)
    expect(run(fixture.worktree, ["git", "ls-files", "-v", "tracked.txt"]).charAt(0)).toBe(marker)
    expect(readFileSync(join(fixture.worktree, "tracked.txt"), "utf8")).toBe("hidden change\n")
  })
}

test("owner cleanup rejects ignored residue until the deletion owner removes it", () => {
  const fixture = createFixture()
  const identity = identifyLinkedWorktree(fixture.worktree)
  const ownerCommit = installOwnerTool(fixture.root)
  writeFileSync(join(fixture.worktree, "ignored.tmp"), "rebuildable\n")
  const options = {
    repositoryCwd: fixture.root,
    ownerCommit,
    worktreeId: identity.worktree_id,
    expectedGeneration: identity.generation,
    expectedHead: identity.head,
    expectedRef: identity.ref,
    removeIgnored: false,
  }

  expect(captureCleanupError(() => removeOwnedWorktree(options)).code)
    .toBe("worktree_has_ignored_files")
  expect(run(fixture.worktree, ["git", "clean", "-ndX"])).toContain("ignored.tmp")
  const receipt = removeOwnedWorktree({ ...options, removeIgnored: true })
  expect(receipt.status).toBe("completed")
  expect(receipt.ignored_residue_removed).toBe(true)
  expect(existsSync(fixture.worktree)).toBe(false)
})

test("owner cleanup requires the ignored-residue grant for a nested repository", () => {
  const fixture = createFixture()
  const identity = identifyLinkedWorktree(fixture.worktree)
  const ownerCommit = installOwnerTool(fixture.root)
  const nested = join(fixture.worktree, "ignored.tmp")
  run(fixture.worktree, ["git", "init", "-q", nested])
  writeFileSync(join(nested, "preserved"), "nested repository\n")
  const options = {
    repositoryCwd: fixture.root,
    ownerCommit,
    worktreeId: identity.worktree_id,
    expectedGeneration: identity.generation,
    expectedHead: identity.head,
    expectedRef: identity.ref,
    removeIgnored: false,
  }

  const failure = captureCleanupError(() => removeOwnedWorktree(options))
  expect(failure.code).toBe("worktree_has_ignored_files")
  expect(failure.receipt?.worktree_claimed).toBe(true)
  expect(failure.receipt?.rollback_completed).toBe(true)
  expect(existsSync(join(nested, "preserved"))).toBe(true)

  const receipt = removeOwnedWorktree({ ...options, removeIgnored: true })
  expect(receipt.status).toBe("completed")
  expect(receipt.ignored_residue_removed).toBe(true)
  expect(existsSync(fixture.worktree)).toBe(false)
})

test("owner cleanup records an ignored-residue removal attempt that fails partway", () => {
  const fixture = createFixture()
  const identity = identifyLinkedWorktree(fixture.worktree)
  const ownerCommit = installOwnerTool(fixture.root)
  const ignoredDirectory = join(fixture.worktree, "ignored.tmp")
  run(fixture.worktree, ["mkdir", "-p", ignoredDirectory])
  writeFileSync(join(ignoredDirectory, "removed"), "remove\n")
  writeFileSync(join(ignoredDirectory, "preserved"), "preserve\n")
  const realGit = Bun.which("git")
  if (!realGit) throw new Error("git unavailable")
  const bin = join(fixture.root, "bin")
  run(fixture.root, ["/bin/mkdir", "-p", bin])
  const wrapper = join(bin, "git")
  writeFileSync(
    wrapper,
    `#!/bin/sh
case " $* " in
  *" clean -fdffX "*)
    /bin/rm "$2/ignored.tmp/removed"
    exit 72
    ;;
esac
exec "${realGit}" "$@"
`,
  )
  chmodSync(wrapper, 0o755)
  const cleanup = runCleanupCli(fixture.root, identity, ownerCommit, bin, true)

  expect(cleanup.exitCode).toBe(1)
  const receipt = JSON.parse(cleanup.stdout.toString())
  expect(receipt.reason_code).toBe("git_operation_failed")
  expect(receipt.ignored_residue_removed).toBe(true)
  expect(receipt.status).toBe("partial")
  expect(receipt.worktree_claimed).toBe(true)
  expect(receipt.rollback_attempted).toBe(true)
  expect(receipt.rollback_completed).toBe(true)
  expect(existsSync(join(ignoredDirectory, "removed"))).toBe(false)
  expect(existsSync(join(ignoredDirectory, "preserved"))).toBe(true)
})

test("owner cleanup reports a failed ignored cleanup with zero deletions as failed", () => {
  const fixture = createFixture()
  const identity = identifyLinkedWorktree(fixture.worktree)
  const ownerCommit = installOwnerTool(fixture.root)
  const ignoredFile = join(fixture.worktree, "ignored.tmp")
  writeFileSync(ignoredFile, "preserve\n")
  const realGit = Bun.which("git")
  if (!realGit) throw new Error("git unavailable")
  const bin = join(fixture.root, "bin")
  run(fixture.root, ["/bin/mkdir", "-p", bin])
  const wrapper = join(bin, "git")
  writeFileSync(
    wrapper,
    `#!/bin/sh
case " $* " in
  *" clean -fdffX "*) exit 72 ;;
esac
exec "${realGit}" "$@"
`,
  )
  chmodSync(wrapper, 0o755)
  const cleanup = runCleanupCli(fixture.root, identity, ownerCommit, bin, true)

  expect(cleanup.exitCode).toBe(1)
  const receipt = JSON.parse(cleanup.stdout.toString())
  expect(receipt.reason_code).toBe("git_operation_failed")
  expect(receipt.ignored_residue_removed).toBe(false)
  expect(receipt.status).toBe("failed")
  expect(receipt.worktree_claimed).toBe(true)
  expect(receipt.rollback_attempted).toBe(true)
  expect(receipt.rollback_completed).toBe(true)
  expect(existsSync(ignoredFile)).toBe(true)
})

test("owner cleanup preserves ignored residue held by another process", async () => {
  const fixture = createFixture()
  const identity = identifyLinkedWorktree(fixture.worktree)
  const ownerCommit = installOwnerTool(fixture.root)
  const ignoredDirectory = join(fixture.worktree, "ignored.tmp")
  run(fixture.worktree, ["mkdir", "-p", ignoredDirectory])
  writeFileSync(join(ignoredDirectory, "artifact"), "rebuildable\n")
  const user = Bun.spawn(["sleep", "30"], {
    cwd: ignoredDirectory,
    stdout: "ignore",
    stderr: "ignore",
  })

  try {
    await Bun.sleep(200)
    const failure = captureCleanupError(() => removeOwnedWorktree({
      repositoryCwd: fixture.root,
      ownerCommit,
      worktreeId: identity.worktree_id,
      expectedGeneration: identity.generation,
      expectedHead: identity.head,
      expectedRef: identity.ref,
      removeIgnored: true,
    }))
    expect(failure.code).toBe("target_in_use")
    expect(failure.receipt?.ignored_residue_removed).toBe(false)
    expect(existsSync(ignoredDirectory)).toBe(true)
  } finally {
    user.kill()
    await user.exited
  }
})

test("owner cleanup rejects a target retained by another process before claiming it", async () => {
  const fixture = createFixture()
  const identity = identifyLinkedWorktree(fixture.worktree)
  const ownerCommit = installOwnerTool(fixture.root)
  const user = Bun.spawn(["sleep", "30"], {
    cwd: fixture.worktree,
    stdout: "ignore",
    stderr: "ignore",
  })

  try {
    await Bun.sleep(200)
    const failure = captureCleanupError(() => removeOwnedWorktree({
      repositoryCwd: fixture.root,
      ownerCommit,
      worktreeId: identity.worktree_id,
      expectedGeneration: identity.generation,
      expectedHead: identity.head,
      expectedRef: identity.ref,
      removeIgnored: false,
    }))
    expect(failure.code).toBe("target_in_use")
    expect(failure.receipt?.status).toBe("failed")
    expect(failure.receipt?.worktree_claimed).toBe(false)
    expect(failure.receipt?.worktree_removed).toBe(false)
    expect(failure.receipt?.rollback_attempted).toBe(false)
    expect(failure.receipt?.rollback_completed).toBe(false)
    expect(existsSync(fixture.worktree)).toBe(true)
    expect(run(fixture.worktree, ["git", "rev-parse", "HEAD"])).toBe(identity.head)
  } finally {
    user.kill()
    await user.exited
  }
})

test("owner cleanup rejects a target file retained by another process", async () => {
  const fixture = createFixture()
  await expectRetainedFilePreservesTarget(fixture, join(fixture.worktree, "tracked.txt"))
})

test("owner cleanup rejects a linked-worktree admin file retained by another process", async () => {
  const fixture = createFixture()
  const adminDir = run(fixture.worktree, [
    "git",
    "rev-parse",
    "--path-format=absolute",
    "--git-dir",
  ])
  await expectRetainedFilePreservesTarget(fixture, join(adminDir, "HEAD"))
})

async function expectRetainedFilePreservesTarget(
  fixture: ReturnType<typeof createFixture>,
  retainedPath: string,
): Promise<void> {
  const identity = identifyLinkedWorktree(fixture.worktree)
  const ownerCommit = installOwnerTool(fixture.root)
  const user = Bun.spawn([
    "sh",
    "-c",
    "exec 3<\"$1\"; exec sleep 30",
    "sh",
    retainedPath,
  ], {
    cwd: fixture.root,
    stdout: "ignore",
    stderr: "ignore",
  })

  try {
    await Bun.sleep(200)
    const failure = captureCleanupError(() => removeOwnedWorktree({
      repositoryCwd: fixture.root,
      ownerCommit,
      worktreeId: identity.worktree_id,
      expectedGeneration: identity.generation,
      expectedHead: identity.head,
      expectedRef: identity.ref,
      removeIgnored: false,
    }))
    expect(failure.code).toBe("target_in_use")
    expect(failure.receipt?.worktree_claimed).toBe(false)
    expect(failure.receipt?.worktree_removed).toBe(false)
    expect(existsSync(fixture.worktree)).toBe(true)
  } finally {
    user.kill()
    await user.exited
  }
}

test("owner cleanup preserves a worktree with an initialized or deinitialized submodule", () => {
  const fixture = createFixture()
  const submodule = mkdtempSync(join(tmpdir(), "trade-worktree-cleanup-submodule-"))
  fixtures.push(submodule)
  run(submodule, ["git", "init", "-q"])
  run(submodule, ["git", "config", "user.name", "test"])
  run(submodule, ["git", "config", "user.email", "test@example.com"])
  writeFileSync(join(submodule, "tracked.txt"), "submodule\n")
  run(submodule, ["git", "add", "tracked.txt"])
  run(submodule, ["git", "commit", "-qm", "submodule"])
  run(fixture.worktree, [
    "git",
    "-c",
    "protocol.file.allow=always",
    "submodule",
    "add",
    "-q",
    submodule,
    "nested",
  ])
  run(fixture.worktree, ["git", "commit", "-qam", "add submodule"])
  const identity = identifyLinkedWorktree(fixture.worktree)
  const ownerCommit = installOwnerTool(fixture.root)
  const failure = captureCleanupError(() => removeOwnedWorktree({
    repositoryCwd: fixture.root,
    ownerCommit,
    worktreeId: identity.worktree_id,
    expectedGeneration: identity.generation,
    expectedHead: identity.head,
    expectedRef: identity.ref,
    removeIgnored: false,
  }))

  expect(failure.code).toBe("worktree_has_registered_submodules")
  expect(failure.receipt?.worktree_claimed).toBe(false)
  expect(failure.receipt?.worktree_removed).toBe(false)
  expect(existsSync(join(fixture.worktree, "nested", "tracked.txt"))).toBe(true)
  expect(existsSync(fixture.worktree)).toBe(true)

  run(fixture.worktree, ["git", "submodule", "deinit", "-f", "--", "nested"])
  const deinitializedFailure = captureCleanupError(() => removeOwnedWorktree({
    repositoryCwd: fixture.root,
    ownerCommit,
    worktreeId: identity.worktree_id,
    expectedGeneration: identity.generation,
    expectedHead: identity.head,
    expectedRef: identity.ref,
    removeIgnored: false,
  }))

  expect(deinitializedFailure.code).toBe("worktree_has_registered_submodules")
  expect(deinitializedFailure.receipt?.worktree_claimed).toBe(false)
  expect(deinitializedFailure.receipt?.worktree_removed).toBe(false)
  expect(existsSync(fixture.worktree)).toBe(true)
})

if (process.platform === "linux") {
  test("owner cleanup matches retained mappings by file identity", async () => {
    const fixture = createFixture()
    const executable = join(fixture.worktree, "mapped-sleep")
    const alias = join(fixture.root, "mapped-alias")
    copyFileSync("/bin/sleep", executable)
    chmodSync(executable, 0o755)
    run(fixture.worktree, ["git", "add", "mapped-sleep"])
    run(fixture.worktree, ["git", "commit", "-qm", "add mapped executable"])
    linkSync(executable, alias)
    const user = Bun.spawn([alias, "30"], {
      cwd: fixture.root,
      stdout: "ignore",
      stderr: "ignore",
    })
    try {
      await Bun.sleep(200)
      expectCleanupInUse(fixture)
    } finally {
      user.kill()
      await user.exited
    }
  }, 15_000)

  test("owner cleanup rejects a Unix socket bound inside the target worktree", async () => {
    const fixture = createFixture()
    const socketPath = join(fixture.worktree, "live.sock")
    writeFileSync(join(fixture.root, ".git", "info", "exclude"), "live.sock\n")
    const identity = identifyLinkedWorktree(fixture.worktree)
    const ownerCommit = installOwnerTool(fixture.root)
    const server = createServer()

    await new Promise<void>((resolve, reject) => {
      server.once("error", reject)
      server.listen(socketPath, resolve)
    })
    try {
      const failure = captureCleanupError(() => removeOwnedWorktree({
        repositoryCwd: fixture.root,
        ownerCommit,
        worktreeId: identity.worktree_id,
        expectedGeneration: identity.generation,
        expectedHead: identity.head,
        expectedRef: identity.ref,
        removeIgnored: false,
      }))
      expect(failure.code).toBe("target_in_use")
      expect(failure.receipt?.worktree_claimed).toBe(false)
      expect(failure.receipt?.worktree_removed).toBe(false)
      expect(existsSync(socketPath)).toBe(true)
      expect(existsSync(fixture.worktree)).toBe(true)
    } finally {
      await new Promise<void>((resolve, reject) => {
        server.close((error) => error ? reject(error) : resolve())
      })
    }
  })

  test("owner cleanup rejects a Unix socket bound inside the linked-worktree admin directory", async () => {
    const fixture = createFixture()
    const adminDirectory = run(fixture.worktree, [
      "git",
      "rev-parse",
      "--path-format=absolute",
      "--git-dir",
    ])
    const socketPath = join(adminDirectory, "live.sock")
    const identity = identifyLinkedWorktree(fixture.worktree)
    const ownerCommit = installOwnerTool(fixture.root)
    const server = createServer()

    await new Promise<void>((resolve, reject) => {
      server.once("error", reject)
      server.listen(socketPath, resolve)
    })
    try {
      const failure = captureCleanupError(() => removeOwnedWorktree({
        repositoryCwd: fixture.root,
        ownerCommit,
        worktreeId: identity.worktree_id,
        expectedGeneration: identity.generation,
        expectedHead: identity.head,
        expectedRef: identity.ref,
        removeIgnored: false,
      }))
      expect(failure.code).toBe("target_in_use")
      expect(failure.receipt?.worktree_claimed).toBe(false)
      expect(existsSync(socketPath)).toBe(true)
      expect(existsSync(fixture.worktree)).toBe(true)
    } finally {
      await new Promise<void>((resolve, reject) => {
        server.close((error) => error ? reject(error) : resolve())
      })
    }
  })

  test("owner cleanup inspects descriptors owned only by a non-leader thread", async () => {
    const fixture = createFixture()
    const readyPath = join(fixture.root, "thread-private-state.ready")
    const scriptPath = join(fixture.root, "thread-private-state.ts")
    const workerPath = join(fixture.root, "thread-private-worker.ts")
    writeFileSync(
      workerPath,
      `import { dlopen, FFIType } from "bun:ffi"
import { fstatSync, openSync, writeFileSync } from "node:fs"

self.onmessage = (event) => {
  const libc = dlopen("libc.so.6", {
    unshare: { args: [FFIType.i32], returns: FFIType.i32 },
    gettid: { args: [], returns: FFIType.i32 },
  })
  if (libc.symbols.unshare(0x00000400) !== 0) {
    writeFileSync(event.data.readyPath, "unshare-error")
    return
  }
  const retained = openSync(event.data.targetPath, "r")
  writeFileSync(event.data.readyPath, JSON.stringify({
    processId: process.pid,
    threadId: libc.symbols.gettid(),
    fileDescriptor: retained,
  }))
  setInterval(() => fstatSync(retained), 1000)
}
`,
    )
    writeFileSync(
      scriptPath,
      `const worker = new Worker(process.argv[2]!)
worker.postMessage({
  targetPath: process.argv[3]!,
  readyPath: process.argv[4]!,
})
setInterval(() => {}, 1000)
`,
    )
    const user = Bun.spawn([
      Bun.which("bun")!,
      scriptPath,
      workerPath,
      join(fixture.worktree, "tracked.txt"),
      readyPath,
    ], { cwd: fixture.root, stdout: "ignore", stderr: "ignore" })
    try {
      await waitForPath(readyPath)
      const ready = readFileSync(readyPath, "utf8")
      if (ready === "unshare-error") return
      const retained = JSON.parse(ready)
      const descriptor = statSync(
        `/proc/${retained.processId}/task/${retained.threadId}/fd/${retained.fileDescriptor}`,
        { bigint: true },
      )
      const target = lstatSync(join(fixture.worktree, "tracked.txt"), { bigint: true })
      expect(descriptor.dev).toBe(target.dev)
      expect(descriptor.ino).toBe(target.ino)
      expectCleanupInUse(fixture)
    } finally {
      user.kill()
      await user.exited
    }
  }, 15_000)

  test("owner cleanup rejects a relative Unix socket after its server leaves the target cwd", async () => {
    const fixture = createFixture()
    const socketPath = join(fixture.worktree, "relative.sock")
    const readyPath = join(fixture.root, "relative-socket.ready")
    writeFileSync(join(fixture.root, ".git", "info", "exclude"), "relative.sock\n")
    const identity = identifyLinkedWorktree(fixture.worktree)
    const ownerCommit = installOwnerTool(fixture.root)
    const serverScript = join(fixture.root, "relative-socket-server.ts")
    writeFileSync(
      serverScript,
      `import { writeFileSync } from "node:fs"
import { createServer } from "node:net"
const server = createServer()
server.listen("relative.sock", () => {
  process.chdir(process.argv[2]!)
  writeFileSync(process.argv[3]!, "ready\\n")
})
process.on("SIGTERM", () => server.close())
`,
    )
    const server = Bun.spawn(
      [Bun.which("bun")!, serverScript, fixture.root, readyPath],
      { cwd: fixture.worktree, stdout: "ignore", stderr: "ignore" },
    )
    try {
      for (let count = 0; count < 100 && !existsSync(readyPath); count += 1) {
        await Bun.sleep(10)
      }
      expect(existsSync(readyPath)).toBe(true)
      expect(existsSync(socketPath)).toBe(true)
      const failure = captureCleanupError(() => removeOwnedWorktree({
        repositoryCwd: fixture.root,
        ownerCommit,
        worktreeId: identity.worktree_id,
        expectedGeneration: identity.generation,
        expectedHead: identity.head,
        expectedRef: identity.ref,
        removeIgnored: false,
      }))
      expect(failure.code).toBe("target_in_use")
      expect(failure.receipt?.worktree_removed).toBe(false)
      expect(existsSync(fixture.worktree)).toBe(true)
      expect(server.exitCode).toBe(null)
    } finally {
      server.kill()
      await server.exited
    }
  })

  test("owner cleanup removes an ignored stale Unix socket", () => {
    const fixture = createFixture()
    const socketPath = join(fixture.worktree, "stale.sock")
    writeFileSync(join(fixture.root, ".git", "info", "exclude"), "stale.sock\n")
    const staleSocket = Bun.spawnSync([
      Bun.which("bun")!,
      "-e",
      `import { createServer } from "node:net"; createServer().listen(${JSON.stringify(socketPath)}, () => process.exit(0))`,
    ])
    expect(staleSocket.exitCode).toBe(0)
    expect(existsSync(socketPath)).toBe(true)
    const identity = identifyLinkedWorktree(fixture.worktree)
    const ownerCommit = installOwnerTool(fixture.root)
    const receipt = removeOwnedWorktree({
      repositoryCwd: fixture.root,
      ownerCommit,
      worktreeId: identity.worktree_id,
      expectedGeneration: identity.generation,
      expectedHead: identity.head,
      expectedRef: identity.ref,
      removeIgnored: true,
    })

    expect(receipt.status).toBe("completed")
    expect(receipt.ignored_residue_removed).toBe(true)
    expect(existsSync(fixture.worktree)).toBe(false)
  })

  test("owner cleanup ignores an unrelated live relative socket with the same name", async () => {
    const fixture = createFixture()
    const targetSocket = join(fixture.worktree, "same.sock")
    const unrelatedDirectory = join(fixture.root, "unrelated-socket")
    const unrelatedSocket = join(unrelatedDirectory, "same.sock")
    const readyPath = join(fixture.root, "unrelated-relative-socket.ready")
    writeFileSync(join(fixture.root, ".git", "info", "exclude"), "same.sock\n")
    run(fixture.root, ["/bin/mkdir", "-p", unrelatedDirectory])
    const staleSocket = Bun.spawnSync([
      Bun.which("bun")!,
      "-e",
      `import { createServer } from "node:net"; createServer().listen(${JSON.stringify(targetSocket)}, () => process.exit(0))`,
    ])
    expect(staleSocket.exitCode).toBe(0)
    const server = Bun.spawn([
      Bun.which("bun")!,
      "-e",
      `import { writeFileSync } from "node:fs";
import { createServer } from "node:net";
const server = createServer();
server.listen("same.sock", () => {
  process.chdir(process.argv[1]);
  writeFileSync(process.argv[2], "ready");
});
process.on("SIGTERM", () => server.close());`,
      fixture.root,
      readyPath,
    ], { cwd: unrelatedDirectory, stdout: "ignore", stderr: "ignore" })
    try {
      await waitForPath(readyPath)
      expect(server.exitCode).toBeNull()
      expect(existsSync(unrelatedSocket)).toBe(true)
      const identity = identifyLinkedWorktree(fixture.worktree)
      const ownerCommit = installOwnerTool(fixture.root)
      const receipt = removeOwnedWorktree({
        repositoryCwd: fixture.root,
        ownerCommit,
        worktreeId: identity.worktree_id,
        expectedGeneration: identity.generation,
        expectedHead: identity.head,
        expectedRef: identity.ref,
        removeIgnored: true,
      })
      expect(receipt.status).toBe("completed")
      expect(receipt.ignored_residue_removed).toBe(true)
      expect(existsSync(fixture.worktree)).toBe(false)
      expect(existsSync(unrelatedSocket)).toBe(true)
    } finally {
      server.kill()
      await server.exited
    }
  })

  test("owner cleanup rejects an inotify watch on the target", async () => {
    const fixture = createFixture()
    const identity = identifyLinkedWorktree(fixture.worktree)
    const ownerCommit = installOwnerTool(fixture.root)
    const targetPath = join(fixture.worktree, "tracked.txt")
    const watcher = watch(targetPath)
    try {
      await Bun.sleep(100)
      const target = lstatSync(targetPath, { bigint: true })
      const watchedIdentity = readdirSync("/proc/self/fdinfo").flatMap((fileDescriptor) => {
        try {
          return readFileSync(join("/proc/self/fdinfo", fileDescriptor), "utf8")
            .split("\n")
            .flatMap((line) => {
              const match = line.match(/\bino:([0-9a-f]+)\s+sdev:([0-9a-f]+)\b/)
              return match && BigInt(`0x${match[1]}`) === target.ino ? [`${match[2]}:${match[1]}`] : []
            })
        } catch {
          return []
        }
      })[0]
      expect(watchedIdentity).toBeDefined()
      const failure = captureCleanupError(() => removeOwnedWorktree({
        repositoryCwd: fixture.root,
        ownerCommit,
        worktreeId: identity.worktree_id,
        expectedGeneration: identity.generation,
        expectedHead: identity.head,
        expectedRef: identity.ref,
        removeIgnored: false,
      }))
      expect(failure.code).toBe("target_in_use")
      expect(failure.receipt?.worktree_removed).toBe(false)
      expect(existsSync(fixture.worktree)).toBe(true)
    } finally {
      watcher.close()
    }
  })

  test("owner cleanup rejects a Unix socket bound between the pre-probe and claim", async () => {
    const fixture = createFixture()
    const socketPath = join(fixture.worktree, "late.sock")
    writeFileSync(join(fixture.root, ".git", "info", "exclude"), "late.sock\n")
    const identity = identifyLinkedWorktree(fixture.worktree)
    const ownerCommit = installOwnerTool(fixture.root)
    const realGit = Bun.which("git")
    const bun = Bun.which("bun")
    if (!realGit || !bun) throw new Error("required executable unavailable")
    const bin = join(fixture.root, "bin")
    run(fixture.root, ["/bin/mkdir", "-p", bin])
    const socketServer = join(bin, "socket-server.ts")
    const socketPid = join(bin, "socket-server.pid")
    const socketStarted = join(bin, "socket-server.started")
    writeFileSync(
      socketServer,
      `import { createServer } from "node:net"
const server = createServer()
server.listen(process.argv[2]!)
process.on("SIGTERM", () => server.close())
`,
    )
    const wrapper = join(bin, "git")
    writeFileSync(
      wrapper,
      `#!/bin/sh
case " $* " in
  *" worktree move "*)
    if [ ! -f "${socketStarted}" ]; then
      : > "${socketStarted}"
      "${bun}" "${socketServer}" "${socketPath}" &
      printf '%s\\n' "$!" > "${socketPid}"
      count=0
      while [ ! -S "${socketPath}" ]; do
        count=$((count + 1))
        [ "$count" -lt 100 ] || exit 73
        sleep 0.01
      done
    fi
    ;;
esac
exec "${realGit}" "$@"
`,
    )
    chmodSync(wrapper, 0o755)

    try {
      const cleanup = runCleanupCli(fixture.root, identity, ownerCommit, bin)
      expect(cleanup.exitCode).toBe(1)
      const receipt = JSON.parse(cleanup.stdout.toString())
      expect(receipt.reason_code).toBe("target_in_use")
      expect(receipt.worktree_claimed).toBe(true)
      expect(receipt.rollback_attempted).toBe(true)
      expect(receipt.rollback_completed).toBe(true)
      expect(receipt.worktree_removed).toBe(false)
      expect(existsSync(fixture.worktree)).toBe(true)
      expect(run(fixture.root, ["git", "rev-parse", identity.ref!])).toBe(identity.head)
    } finally {
      if (existsSync(socketPid)) {
        try {
          process.kill(Number(readFileSync(socketPid, "utf8").trim()), "SIGTERM")
        } catch {
          // The wrapper's background server may already have exited with its parent shell.
        }
        await Bun.sleep(100)
      }
    }
  })

  test("owner cleanup rejects an executable retained from the target worktree", async () => {
    const fixture = createFixture()
    const executable = join(fixture.worktree, "tracked-sleep")
    copyFileSync("/bin/sleep", executable)
    chmodSync(executable, 0o755)
    run(fixture.worktree, ["git", "add", "tracked-sleep"])
    run(fixture.worktree, ["git", "commit", "-qm", "add executable"])
    const identity = identifyLinkedWorktree(fixture.worktree)
    const ownerCommit = installOwnerTool(fixture.root)
    const user = Bun.spawn([executable, "30"], {
      cwd: fixture.root,
      stdout: "ignore",
      stderr: "ignore",
    })

    try {
      await Bun.sleep(200)
      const failure = captureCleanupError(() => removeOwnedWorktree({
        repositoryCwd: fixture.root,
        ownerCommit,
        worktreeId: identity.worktree_id,
        expectedGeneration: identity.generation,
        expectedHead: identity.head,
        expectedRef: identity.ref,
        removeIgnored: false,
      }))
      expect(failure.code).toBe("target_in_use")
      expect(failure.receipt?.worktree_claimed).toBe(false)
      expect(existsSync(fixture.worktree)).toBe(true)
    } finally {
      user.kill()
      await user.exited
    }
  }, 15_000)

  const mountNamespaceArgs = process.geteuid?.() === 0 ? ["-m"] : ["-Urm"]
  if (canUnshare(mountNamespaceArgs)) {
    test("owner cleanup matches open files by identity across mount namespaces", async () => {
      const fixture = createFixture()
      const alias = join(fixture.root, "mount-alias")
      const ready = join(fixture.root, "mount-namespace.ready")
      run(fixture.root, ["/bin/mkdir", "-p", alias])
      const user = Bun.spawn([
        "unshare",
        ...mountNamespaceArgs,
        "/bin/sh",
        "-c",
        "mount --bind \"$1\" \"$2\" && exec 3<\"$2/tracked.txt\"; : > \"$3\"; exec sleep 30",
        "sh",
        fixture.worktree,
        alias,
        ready,
      ], { cwd: fixture.root, stdout: "ignore", stderr: "ignore" })
      try {
        await waitForPath(ready)
        expectCleanupInUse(fixture)
      } finally {
        user.kill()
        await user.exited
      }
    }, 15_000)

    test("owner cleanup matches cwd by identity across mount namespaces", async () => {
      const fixture = createFixture()
      const alias = join(fixture.root, "cwd-mount-alias")
      const ready = join(fixture.root, "cwd-mount-namespace.ready")
      run(fixture.root, ["/bin/mkdir", "-p", alias])
      const user = Bun.spawn([
        "unshare",
        ...mountNamespaceArgs,
        "/bin/sh",
        "-c",
        "mount --bind \"$1\" \"$2\" && cd \"$2\"; : > \"$3\"; exec sleep 30",
        "sh",
        fixture.worktree,
        alias,
        ready,
      ], { cwd: fixture.root, stdout: "ignore", stderr: "ignore" })
      try {
        await waitForPath(ready)
        expectCleanupInUse(fixture)
      } finally {
        user.kill()
        await user.exited
      }
    }, 15_000)
  }

  const networkNamespaceArgs = process.geteuid?.() === 0 ? ["-n"] : ["-Urn"]
  if (canUnshare(networkNamespaceArgs)) {
    test("owner cleanup inspects live sockets in other network namespaces", async () => {
      const fixture = createFixture()
      const socketPath = join(fixture.worktree, "network-namespace.sock")
      const ready = join(fixture.root, "network-namespace.ready")
      writeFileSync(join(fixture.root, ".git", "info", "exclude"), "*.sock\n")
      const server = Bun.spawn([
        "unshare",
        ...networkNamespaceArgs,
        Bun.which("bun")!,
        "-e",
        `import { writeFileSync } from "node:fs";
import { createServer } from "node:net";
createServer().listen(process.argv[1], () => writeFileSync(process.argv[2], "ready"));`,
        socketPath,
        ready,
      ], { cwd: fixture.root, stdout: "ignore", stderr: "ignore" })
      try {
        await waitForPath(ready)
        expectCleanupInUse(fixture)
      } finally {
        server.kill()
        await server.exited
      }
    }, 15_000)

    test("owner cleanup probes relative sockets in their network namespace", async () => {
      const fixture = createFixture()
      const ready = join(fixture.root, "relative-network-namespace.ready")
      writeFileSync(join(fixture.root, ".git", "info", "exclude"), "*.sock\n")
      const server = Bun.spawn([
        "unshare",
        ...networkNamespaceArgs,
        Bun.which("bun")!,
        "-e",
        `import { writeFileSync } from "node:fs";
import { createServer } from "node:net";
createServer().listen("relative-network.sock", () => {
  process.chdir(process.argv[1]);
  writeFileSync(process.argv[2], "ready");
});`,
        fixture.root,
        ready,
      ], { cwd: fixture.worktree, stdout: "ignore", stderr: "ignore" })
      try {
        await waitForPath(ready)
        expectCleanupInUse(fixture, true)
      } finally {
        server.kill()
        await server.exited
      }
    }, 15_000)
  }
}

if (process.platform === "linux") {
  test("owner cleanup rejects cross-uid cwd and open-file users", async () => {
    const cwdFixture = createFixture()
    chmodSync(cwdFixture.root, 0o755)
    const cwdReady = join(cwdFixture.root, "cross-uid-cwd.ready")
    writeFileSync(cwdReady, "")
    chmodSync(cwdReady, 0o666)
    const cwdUser = spawnOtherUid([
      "/bin/sh",
      "-c",
      "cd \"$1\" || exit 71; printf 'uid=%s pid=%s\\n' \"$(id -u)\" \"$$\" > \"$2\" || exit 72; exec sleep 30",
      "sh",
      cwdFixture.worktree,
      cwdReady,
    ], cwdFixture.root)
    try {
      if (!(await waitForOtherUidFixture(cwdUser, cwdReady))) {
        expect(hasEffectiveCapability(7)).toBe(false)
        return
      }
      expectCleanupInUse(cwdFixture, true, true)
    } finally {
      cwdUser.kill()
      await cwdUser.exited
    }

    const fileFixture = createFixture()
    chmodSync(fileFixture.root, 0o755)
    const fileReady = join(fileFixture.root, "cross-uid-file.ready")
    writeFileSync(fileReady, "")
    chmodSync(fileReady, 0o666)
    const fileUser = spawnOtherUid([
      "/bin/sh",
      "-c",
      "exec 3<\"$1\" || exit 71; printf 'uid=%s pid=%s\\n' \"$(id -u)\" \"$$\" > \"$2\" || exit 72; exec sleep 30",
      "sh",
      join(fileFixture.worktree, "tracked.txt"),
      fileReady,
    ], fileFixture.root)
    try {
      if (!(await waitForOtherUidFixture(fileUser, fileReady))) {
        expect(hasEffectiveCapability(7)).toBe(false)
        return
      }
      expectCleanupInUse(fileFixture, true, true)
    } finally {
      fileUser.kill()
      await fileUser.exited
    }
  }, 15_000)
}

test("parsed validation failures retain the attempted target and operation state", () => {
  const fixture = createFixture()
  const identity = identifyLinkedWorktree(fixture.worktree)
  const ownerCommit = installOwnerTool(fixture.root)
  const cleanup = runPipeline(fixture.root, [
    "git",
    "--no-replace-objects",
    "show",
    `${ownerCommit}:modules/orchestration-ops/agent-workspace-manager/scripts/worktree-cleanup.ts`,
  ], [
    "bun",
    "run",
    "-",
    "remove",
    "--owner-commit",
    ownerCommit,
    "--worktree-id",
    "/home/alice/secret",
    "--expected-generation",
    identity.generation,
    "--expected-head",
    identity.head,
    "--expected-ref",
    identity.ref!,
  ])
  expect(cleanup.exitCode).toBe(1)
  const receipt = JSON.parse(cleanup.stdout.toString())
  expect(receipt.reason_code).toBe("invalid_worktree_id")
  expect(receipt.owner_commit).toBe(ownerCommit)
  expect(receipt.worktree_id).toBe("[invalid]")
  expect(cleanup.stdout.toString()).not.toContain("/home/alice/secret")
  expect(receipt.expected_generation).toBe(identity.generation)
  expect(receipt.expected_head).toBe(identity.head)
  expect(receipt.expected_ref).toBe(identity.ref)
  expect(receipt.observed_head).toBeNull()
  expect(receipt.worktree_claimed).toBe(false)
  expect(receipt.worktree_removed).toBe(false)
  expect(receipt.rollback_attempted).toBe(false)
  expect(receipt.rollback_completed).toBe(false)
})

test("CLI parse failures retain sanitized recognized identity fields", () => {
  const fixture = createFixture()
  const identity = identifyLinkedWorktree(fixture.worktree)
  const ownerCommit = installOwnerTool(fixture.root)
  const cleanup = runResult(fixture.root, [
    "bun",
    join(import.meta.dir, "worktree-cleanup.ts"),
    "remove",
    "--owner-commit",
    ownerCommit,
    "--worktree-id",
    identity.worktree_id,
    "--expected-generation",
    identity.generation,
    "--expected-head",
    identity.head,
    "--expected-ref",
    identity.ref!,
    "--unknown",
    "value",
  ])

  expect(cleanup.exitCode).toBe(1)
  const receipt = JSON.parse(cleanup.stdout.toString())
  expect(receipt.reason_code).toBe("unknown_argument")
  expect(receipt.owner_commit).toBe(ownerCommit)
  expect(receipt.worktree_id).toBe(identity.worktree_id)
  expect(receipt.expected_generation).toBe(identity.generation)
  expect(receipt.expected_head).toBe(identity.head)
  expect(receipt.expected_ref).toBe(identity.ref)
  expect(receipt.worktree_claimed).toBe(false)
  expect(existsSync(fixture.worktree)).toBe(true)
})

test("identify failures report the identify operation", () => {
  const fixture = createFixture()
  const result = runResult(fixture.root, [
    "bun",
    join(import.meta.dir, "worktree-cleanup.ts"),
    "identify",
  ])

  expect(result.exitCode).toBe(1)
  expect(JSON.parse(result.stdout.toString())).toEqual({
    schema_version: "trade.worktree-cleanup-identity.v3",
    operation: "identify-linked-worktree",
    status: "failed",
    reason_code: "primary_worktree_not_supported",
  })
})

test("identify parse failures report the identify operation", () => {
  const fixture = createFixture()
  const result = runResult(fixture.root, [
    "bun",
    join(import.meta.dir, "worktree-cleanup.ts"),
    "identify",
    "unexpected-argument",
  ])

  expect(result.exitCode).toBe(1)
  expect(JSON.parse(result.stdout.toString())).toEqual({
    schema_version: "trade.worktree-cleanup-identity.v3",
    operation: "identify-linked-worktree",
    status: "failed",
    reason_code: "unexpected_argument",
  })
})

test("owner cleanup rejects a tree object as owner commit", () => {
  const fixture = createFixture()
  const identity = identifyLinkedWorktree(fixture.worktree)
  installOwnerTool(fixture.root)
  const tree = run(fixture.root, ["git", "rev-parse", "HEAD^{tree}"])

  const failure = captureCleanupError(() => removeOwnedWorktree({
    repositoryCwd: fixture.root,
    ownerCommit: tree,
    worktreeId: identity.worktree_id,
    expectedGeneration: identity.generation,
    expectedHead: identity.head,
    expectedRef: identity.ref,
    removeIgnored: false,
  }))

  expect(failure.code).toBe("owner_tool_identity_missing")
  expect(failure.receipt?.owner_commit).toBe(tree)
  expect(failure.receipt?.worktree_claimed).toBe(false)
  expect(existsSync(fixture.worktree)).toBe(true)
})

test("owner cleanup binds owner inspection and streaming despite replacement refs", () => {
  const fixture = createFixture()
  const identity = identifyLinkedWorktree(fixture.worktree)
  const ownerCommit = installOwnerTool(fixture.root)
  const ownerToolPath = join(
    fixture.root,
    "modules",
    "orchestration-ops",
    "agent-workspace-manager",
    "scripts",
    "worktree-cleanup.ts",
  )
  writeFileSync(
    ownerToolPath,
    'throw new Error("replacement owner executed")\n',
  )
  run(fixture.root, ["git", "add", "modules/orchestration-ops/agent-workspace-manager/scripts/worktree-cleanup.ts"])
  run(fixture.root, ["git", "commit", "-qm", "replacement owner"])
  const replacementCommit = run(fixture.root, ["git", "rev-parse", "HEAD"])
  run(fixture.root, ["git", "replace", ownerCommit, replacementCommit])
  expect(run(fixture.root, ["git", "show", `${ownerCommit}:modules/orchestration-ops/agent-workspace-manager/scripts/worktree-cleanup.ts`]))
    .toContain("replacement owner executed")

  const cleanup = runPipeline(fixture.root, [
    "git",
    "--no-replace-objects",
    "show",
    `${ownerCommit}:modules/orchestration-ops/agent-workspace-manager/scripts/worktree-cleanup.ts`,
  ], [
    "bun",
    "run",
    "-",
    "remove",
    "--owner-commit",
    ownerCommit,
    "--worktree-id",
    identity.worktree_id,
    "--expected-generation",
    identity.generation,
    "--expected-head",
    identity.head,
    "--expected-ref",
    identity.ref!,
  ])

  expect(cleanup.exitCode).toBe(0)
  expect(JSON.parse(cleanup.stdout.toString()).status).toBe("completed")
  expect(existsSync(fixture.worktree)).toBe(false)
})

test("failure receipts redact a path-like malformed expected ref", () => {
  const fixture = createFixture()
  const identity = identifyLinkedWorktree(fixture.worktree)
  const ownerCommit = installOwnerTool(fixture.root)
  const malformedRef = "refs/heads//Users/alice/private-worktree"
  const cleanup = runPipeline(fixture.root, [
    "git",
    "--no-replace-objects",
    "show",
    `${ownerCommit}:modules/orchestration-ops/agent-workspace-manager/scripts/worktree-cleanup.ts`,
  ], [
    "bun",
    "run",
    "-",
    "remove",
    "--owner-commit",
    ownerCommit,
    "--worktree-id",
    identity.worktree_id,
    "--expected-generation",
    identity.generation,
    "--expected-head",
    identity.head,
    "--expected-ref",
    malformedRef,
  ])

  expect(cleanup.exitCode).toBe(1)
  const receipt = JSON.parse(cleanup.stdout.toString())
  expect(receipt.reason_code).toBe("invalid_expected_ref")
  expect(receipt.expected_ref).toBeNull()
  expect(cleanup.stdout.toString()).not.toContain("/Users/alice/private-worktree")
  expect(existsSync(fixture.worktree)).toBe(true)
})

test("owner cleanup deletes an exact symbolic ref without dereferencing its target", () => {
  const fixture = createFixture()
  const identity = identifyLinkedWorktree(fixture.worktree)
  const ownerCommit = installOwnerTool(fixture.root)
  run(fixture.root, ["git", "config", "branch.mission-branch.remote", "origin"])
  const reflogPath = join(fixture.root, ".git", "logs", identity.ref!)
  expect(existsSync(reflogPath)).toBe(true)
  run(fixture.root, ["git", "pack-refs", "--all", "--prune"])
  run(fixture.root, ["git", "update-ref", "refs/heads/victim", identity.head])
  run(fixture.root, ["git", "symbolic-ref", identity.ref!, "refs/heads/victim"])

  const receipt = removeOwnedWorktree({
    repositoryCwd: fixture.root,
    ownerCommit,
    worktreeId: identity.worktree_id,
    expectedGeneration: identity.generation,
    expectedHead: identity.head,
    expectedRef: identity.ref,
    removeIgnored: false,
  })

  expect(receipt.status).toBe("completed")
  expect(runResult(fixture.root, ["git", "show-ref", "--verify", identity.ref!]).exitCode).not.toBe(0)
  expect(run(fixture.root, ["git", "rev-parse", "refs/heads/victim"])).toBe(identity.head)
  expect(runResult(fixture.root, [
    "git",
    "config",
    "--get-regexp",
    "^branch\\.mission-branch\\.",
  ]).exitCode).not.toBe(0)
  expect(existsSync(reflogPath)).toBe(false)
})

test("owner cleanup accepts a worktree whose branch resolves through multiple symbolic refs", () => {
  const fixture = createFixture()
  const identity = identifyLinkedWorktree(fixture.worktree)
  run(fixture.root, ["git", "update-ref", "refs/heads/base", identity.head])
  run(fixture.root, ["git", "symbolic-ref", "refs/heads/middle", "refs/heads/base"])
  run(fixture.root, ["git", "symbolic-ref", identity.ref!, "refs/heads/middle"])
  const ownerCommit = installOwnerTool(fixture.root)

  const receipt = removeOwnedWorktree({
    repositoryCwd: fixture.root,
    ownerCommit,
    worktreeId: identity.worktree_id,
    expectedGeneration: identity.generation,
    expectedHead: identity.head,
    expectedRef: identity.ref,
    removeIgnored: false,
  })

  expect(receipt.status).toBe("completed")
  expect(runResult(fixture.root, ["git", "symbolic-ref", "-q", identity.ref!]).exitCode).not.toBe(0)
  expect(run(fixture.root, ["git", "symbolic-ref", "refs/heads/middle"]))
    .toBe("refs/heads/base")
  expect(run(fixture.root, ["git", "rev-parse", "refs/heads/base"])).toBe(identity.head)
})

test("owner cleanup locks every ref in a multi-level symbolic chain", () => {
  const fixture = createFixture()
  const identity = identifyLinkedWorktree(fixture.worktree)
  const concurrentHead = run(fixture.root, [
    "git",
    "commit-tree",
    `${identity.head}^{tree}`,
    "-m",
    "concurrent terminal update",
  ])
  run(fixture.root, ["git", "update-ref", "refs/heads/base", identity.head])
  run(fixture.root, ["git", "symbolic-ref", "refs/heads/middle", "refs/heads/base"])
  run(fixture.root, ["git", "symbolic-ref", identity.ref!, "refs/heads/middle"])
  const ownerCommit = installOwnerTool(fixture.root)
  const realGit = Bun.which("git")
  if (!realGit) throw new Error("git unavailable")
  const bin = join(fixture.root, "bin")
  const updateResult = join(bin, "terminal-update-result")
  run(fixture.root, ["/bin/mkdir", "-p", bin])
  const wrapper = join(bin, "git")
  writeFileSync(
    wrapper,
    `#!/bin/sh
case " $* " in
  *" rev-parse --verify refs/heads/middle "*)
    "${realGit}" -C "${fixture.root}" -c core.filesRefLockTimeout=0 update-ref refs/heads/base "${concurrentHead}" >/dev/null 2>&1
    printf '%s\\n' "$?" > "${updateResult}"
    ;;
esac
exec "${realGit}" "$@"
`,
  )
  chmodSync(wrapper, 0o755)

  const cleanup = runCleanupCli(fixture.root, identity, ownerCommit, bin)

  expect(cleanup.exitCode).toBe(0)
  const receipt = JSON.parse(cleanup.stdout.toString())
  expect(receipt.status).toBe("completed")
  expect(receipt.local_branch_deleted).toBe(true)
  expect(readFileSync(updateResult, "utf8").trim()).not.toBe("0")
  expect(run(fixture.root, ["git", "rev-parse", "refs/heads/base"])).toBe(identity.head)
  expect(run(fixture.root, ["git", "symbolic-ref", "refs/heads/middle"]))
    .toBe("refs/heads/base")
})

test("owner cleanup rejects a symbolic ref whose target is concurrently locked", () => {
  const fixture = createFixture()
  const identity = identifyLinkedWorktree(fixture.worktree)
  const ownerCommit = installOwnerTool(fixture.root)
  run(fixture.root, ["git", "update-ref", "refs/heads/victim", identity.head])
  run(fixture.root, ["git", "symbolic-ref", identity.ref!, "refs/heads/victim"])
  const targetLock = join(fixture.root, ".git", "refs", "heads", "victim.lock")
  writeFileSync(targetLock, `${identity.head}\n`)
  const cleanup = runCleanupCli(fixture.root, identity, ownerCommit)

  expect(cleanup.exitCode).toBe(1)
  const receipt = JSON.parse(cleanup.stdout.toString())
  expect(receipt.reason_code).toBe("branch_identity_drift_before_worktree_removal")
  expect(receipt.worktree_claimed).toBe(true)
  expect(receipt.rollback_attempted).toBe(true)
  expect(receipt.rollback_completed).toBe(true)
  expect(receipt.local_branch_deleted).toBe(false)
  expect(existsSync(fixture.worktree)).toBe(true)
  expect(run(fixture.root, ["git", "symbolic-ref", identity.ref!])).toBe("refs/heads/victim")
  expect(run(fixture.root, ["git", "rev-parse", identity.ref!])).toBe(identity.head)
})

test("owner cleanup reports a symbolic guard that survives a failed claim", () => {
  const fixture = createFixture()
  const identity = identifyLinkedWorktree(fixture.worktree)
  const ownerCommit = installOwnerTool(fixture.root)
  run(fixture.root, ["git", "update-ref", "refs/heads/victim", identity.head])
  run(fixture.root, ["git", "symbolic-ref", identity.ref!, "refs/heads/victim"])
  const targetLock = join(fixture.root, ".git", "refs", "heads", "victim.lock")
  writeFileSync(targetLock, `${identity.head}\n`)
  const realGit = Bun.which("git")
  if (!realGit) throw new Error("git unavailable")
  const bin = join(fixture.root, "bin")
  run(fixture.root, ["/bin/mkdir", "-p", bin])
  const wrapper = join(bin, "git")
  writeFileSync(
    wrapper,
    `#!/bin/sh
case " $* " in
  *" update-ref -d refs/worktree-cleanup/"*)
    exit 72
    ;;
esac
exec "${realGit}" "$@"
`,
  )
  chmodSync(wrapper, 0o755)
  const cleanup = runCleanupCli(fixture.root, identity, ownerCommit, bin)

  expect(cleanup.exitCode).toBe(1)
  const receipt = JSON.parse(cleanup.stdout.toString())
  expect(receipt.reason_code).toBe("branch_identity_drift_before_worktree_removal")
  expect(receipt.worktree_claimed).toBe(true)
  expect(receipt.rollback_attempted).toBe(true)
  expect(receipt.rollback_completed).toBe(true)
  expect(receipt.local_branch_deleted).toBe(false)
  expect(receipt.preserved_ref).toMatch(/^refs\/worktree-cleanup\/[0-9a-f]{64}$/)
  expect(run(fixture.root, ["git", "rev-parse", receipt.preserved_ref])).toBe(identity.head)
  expect(existsSync(fixture.worktree)).toBe(true)
  expect(run(fixture.root, ["git", "symbolic-ref", identity.ref!])).toBe("refs/heads/victim")
})

test("owner cleanup reconciles a symbolic guard committed before nonzero exit", () => {
  const fixture = createFixture()
  const identity = identifyLinkedWorktree(fixture.worktree)
  const ownerCommit = installOwnerTool(fixture.root)
  run(fixture.root, ["git", "update-ref", "refs/heads/victim", identity.head])
  run(fixture.root, ["git", "symbolic-ref", identity.ref!, "refs/heads/victim"])
  const realGit = Bun.which("git")
  if (!realGit) throw new Error("git unavailable")
  const bin = join(fixture.root, "bin")
  run(fixture.root, ["/bin/mkdir", "-p", bin])
  const wrapper = join(bin, "git")
  writeFileSync(
    wrapper,
    `#!/bin/sh
case " $* " in
  *" update-ref refs/worktree-cleanup/"*)
    "${realGit}" "$@" || exit $?
    exit 71
    ;;
esac
exec "${realGit}" "$@"
`,
  )
  chmodSync(wrapper, 0o755)
  const cleanup = runCleanupCli(fixture.root, identity, ownerCommit, bin)

  expect(cleanup.exitCode).toBe(0)
  const receipt = JSON.parse(cleanup.stdout.toString())
  expect(receipt.status).toBe("completed")
  expect(receipt.preserved_ref).toBeNull()
  expect(receipt.local_branch_deleted).toBe(true)
  expect(run(fixture.root, ["git", "rev-parse", "refs/heads/victim"])).toBe(identity.head)
  expect(existsSync(fixture.worktree)).toBe(false)
})

test("owner cleanup preserves a concurrent packed-refs writer lock", () => {
  const fixture = createFixture()
  const identity = identifyLinkedWorktree(fixture.worktree)
  const ownerCommit = installOwnerTool(fixture.root)
  run(fixture.root, ["git", "pack-refs", "--all", "--prune"])
  run(fixture.root, ["git", "update-ref", "refs/heads/victim", identity.head])
  run(fixture.root, ["git", "symbolic-ref", identity.ref!, "refs/heads/victim"])
  const packedLock = join(fixture.root, ".git", "packed-refs.lock")
  writeFileSync(packedLock, "concurrent writer\n")
  const cleanup = runCleanupCli(fixture.root, identity, ownerCommit)

  expect(cleanup.exitCode).toBe(1)
  const receipt = JSON.parse(cleanup.stdout.toString())
  expect(receipt.reason_code).toBe("branch_identity_drift_before_worktree_removal")
  expect(receipt.rollback_attempted).toBe(true)
  expect(receipt.rollback_completed).toBe(true)
  expect(readFileSync(packedLock, "utf8")).toBe("concurrent writer\n")
  expect(existsSync(fixture.worktree)).toBe(true)
  expect(run(fixture.root, ["git", "symbolic-ref", identity.ref!])).toBe("refs/heads/victim")
  expect(run(fixture.root, ["git", "rev-parse", identity.ref!])).toBe(identity.head)
})

test("owner cleanup preserves a same-OID packed entry created after a symbolic snapshot", () => {
  const fixture = createFixture()
  const identity = identifyLinkedWorktree(fixture.worktree)
  const ownerCommit = installOwnerTool(fixture.root)
  const targetRef = "refs/heads/symbolic-target"
  run(fixture.root, ["git", "update-ref", targetRef, identity.head])
  run(fixture.root, ["git", "symbolic-ref", identity.ref!, targetRef])
  const packedRefs = join(fixture.root, ".git", "packed-refs")
  const realGit = Bun.which("git")
  if (!realGit) throw new Error("git unavailable")
  const bin = join(fixture.root, "bin")
  const changed = join(bin, "changed")
  run(fixture.root, ["/bin/mkdir", "-p", bin])
  const wrapper = join(bin, "git")
  writeFileSync(
    wrapper,
    `#!/bin/sh
case " $* " in
  *" update-ref refs/worktree-cleanup/"*)
    "${realGit}" "$@" || exit $?
    if [ ! -f "${changed}" ]; then
      printf '%s %s\\n' "${identity.head}" "${identity.ref!}" >> "${packedRefs}"
      : > "${changed}"
    fi
    exit 0
    ;;
esac
exec "${realGit}" "$@"
`,
  )
  chmodSync(wrapper, 0o755)

  const cleanup = runCleanupCli(fixture.root, identity, ownerCommit, bin)

  expect(cleanup.exitCode).toBe(1)
  const receipt = JSON.parse(cleanup.stdout.toString())
  expect(receipt.reason_code).toBe("branch_identity_drift_before_worktree_removal")
  expect(receipt.rollback_completed).toBe(true)
  expect(readFileSync(packedRefs, "utf8")).toContain(`${identity.head} ${identity.ref!}`)
  expect(run(fixture.root, ["git", "symbolic-ref", identity.ref!])).toBe(targetRef)
  expect(existsSync(fixture.worktree)).toBe(true)
})

test("owner cleanup restores a symbolic ref whose target is packed", () => {
  const fixture = createFixture()
  const identity = identifyLinkedWorktree(fixture.worktree)
  const ownerCommit = installOwnerTool(fixture.root)
  run(fixture.root, ["git", "update-ref", "refs/heads/victim", identity.head])
  run(fixture.root, ["git", "symbolic-ref", identity.ref!, "refs/heads/victim"])
  const symbolicRefPath = join(fixture.root, ".git", identity.ref!)
  chmodSync(symbolicRefPath, 0o664)
  run(fixture.root, ["git", "pack-refs", "--all", "--prune"])
  const packedRefsPath = join(fixture.root, ".git", "packed-refs")
  const packedEntry = `${identity.head} ${identity.ref!}`
  const packedLines = readFileSync(packedRefsPath, "utf8").split("\n")
  const victimIndex = packedLines.findIndex((line) => line.endsWith(" refs/heads/victim"))
  expect(victimIndex).toBeGreaterThan(0)
  packedLines.splice(victimIndex, 0, packedEntry)
  writeFileSync(
    packedRefsPath,
    packedLines.join("\n"),
  )
  const packedRefsBytesBefore = readFileSync(packedRefsPath)
  const packedRefsModeBefore = lstatSync(packedRefsPath).mode
  const realGit = Bun.which("git")
  if (!realGit) throw new Error("git unavailable")
  const bin = join(fixture.root, "bin")
  run(fixture.root, ["/bin/mkdir", "-p", bin])
  const wrapper = join(bin, "git")
  writeFileSync(
    wrapper,
    `#!/bin/sh
case " $* " in
  *" worktree remove "*) exit 71 ;;
esac
exec "${realGit}" "$@"
`,
  )
  chmodSync(wrapper, 0o755)
  const cleanup = runCleanupCli(fixture.root, identity, ownerCommit, bin)

  expect(cleanup.exitCode).toBe(1)
  const receipt = JSON.parse(cleanup.stdout.toString())
  expect(receipt.reason_code).toBe("git_operation_failed")
  expect(receipt.rollback_attempted).toBe(true)
  expect(receipt.rollback_completed).toBe(true)
  expect(receipt.worktree_removed).toBe(false)
  expect(existsSync(fixture.worktree)).toBe(true)
  expect(run(fixture.root, ["git", "symbolic-ref", identity.ref!])).toBe("refs/heads/victim")
  expect(lstatSync(symbolicRefPath).mode & 0o777).toBe(0o664)
  expect(run(fixture.root, ["git", "rev-parse", identity.ref!])).toBe(identity.head)
  expect(readFileSync(packedRefsPath)).toEqual(packedRefsBytesBefore)
  expect(lstatSync(packedRefsPath).mode).toBe(packedRefsModeBefore)
})

test("owner cleanup does not hide a concurrently packed ref during symbolic rollback", () => {
  const fixture = createFixture()
  const identity = identifyLinkedWorktree(fixture.worktree)
  const ownerCommit = installOwnerTool(fixture.root)
  run(fixture.root, ["git", "update-ref", "refs/heads/victim", identity.head])
  run(fixture.root, ["git", "symbolic-ref", identity.ref!, "refs/heads/victim"])
  run(fixture.root, ["git", "commit", "--allow-empty", "-qm", "concurrent owner"])
  const concurrentHead = run(fixture.root, ["git", "rev-parse", "HEAD"])
  const realGit = Bun.which("git")
  if (!realGit) throw new Error("git unavailable")
  const bin = join(fixture.root, "bin")
  run(fixture.root, ["/bin/mkdir", "-p", bin])
  const wrapper = join(bin, "git")
  writeFileSync(
    wrapper,
    `#!/bin/sh
case " $* " in
  *" worktree remove "*)
    "${realGit}" -C "${fixture.root}" update-ref "${identity.ref!}" "${concurrentHead}" || exit $?
    "${realGit}" -C "${fixture.root}" pack-refs --all --prune || exit $?
    exit 71
    ;;
esac
exec "${realGit}" "$@"
`,
  )
  chmodSync(wrapper, 0o755)
  const cleanup = runCleanupCli(fixture.root, identity, ownerCommit, bin)

  expect(cleanup.exitCode).toBe(1)
  const receipt = JSON.parse(cleanup.stdout.toString())
  expect(receipt.reason_code).toBe("rollback_failed")
  expect(receipt.rollback_attempted).toBe(true)
  expect(receipt.rollback_completed).toBe(false)
  expect(run(fixture.root, ["git", "rev-parse", identity.ref!])).toBe(concurrentHead)
})

test("owner cleanup preserves a same-target symbolic ref recreated during rollback", () => {
  const fixture = createFixture()
  const identity = identifyLinkedWorktree(fixture.worktree)
  const ownerCommit = installOwnerTool(fixture.root)
  const targetRef = "refs/heads/victim"
  run(fixture.root, ["git", "update-ref", targetRef, identity.head])
  run(fixture.root, ["git", "symbolic-ref", identity.ref!, targetRef])
  run(fixture.root, ["git", "pack-refs", "--all"])
  const packedRefsPath = join(fixture.root, ".git", "packed-refs")
  writeFileSync(
    packedRefsPath,
    `${readFileSync(packedRefsPath, "utf8").trimEnd()}\n${identity.head} ${identity.ref!}\n`,
  )
  const symbolicRefPath = join(fixture.root, ".git", identity.ref!)
  const packedRefsLock = `${packedRefsPath}.lock`
  const trigger = join(fixture.root, "rollback-trigger")
  const recreated = join(fixture.root, "rollback-ref-recreated")
  const realGit = Bun.which("git")
  if (!realGit) throw new Error("git unavailable")
  const bin = join(fixture.root, "bin")
  run(fixture.root, ["/bin/mkdir", "-p", bin])
  const wrapper = join(bin, "git")
  writeFileSync(
    wrapper,
    `#!/bin/sh
case " $* " in
  *" worktree remove "*)
    : > "${trigger}"
    exit 71
    ;;
  *" rev-parse --path-format=absolute --git-common-dir "*)
    if [ -f "${trigger}" ] && [ -f "${symbolicRefPath}" ] && [ ! -f "${recreated}" ]; then
      /bin/rm -f "${symbolicRefPath}"
      "${realGit}" -C "${fixture.root}" symbolic-ref "${identity.ref!}" "${targetRef}" || exit $?
      echo "external packed writer" > "${packedRefsLock}"
      : > "${recreated}"
    fi
    ;;
esac
exec "${realGit}" "$@"
`,
  )
  chmodSync(wrapper, 0o755)
  const cleanup = runCleanupCli(fixture.root, identity, ownerCommit, bin)

  expect(cleanup.exitCode).toBe(1)
  const receipt = JSON.parse(cleanup.stdout.toString())
  expect(receipt.reason_code).toBe("rollback_failed")
  expect(receipt.rollback_attempted).toBe(true)
  expect(receipt.rollback_completed).toBe(false)
  expect(run(fixture.root, ["git", "symbolic-ref", identity.ref!])).toBe(targetRef)
  expect(readFileSync(packedRefsLock, "utf8").trim()).toBe("external packed writer")
})

test("owner cleanup restores the branch and public path when worktree removal fails", () => {
  const fixture = createFixture("sha256")
  for (let index = 0; index < 3; index += 1) {
    run(fixture.worktree, ["git", "commit", "--allow-empty", "-qm", `reflog ${index}`])
  }
  const identity = identifyLinkedWorktree(fixture.worktree)
  const ownerCommit = installOwnerTool(fixture.root)
  const reflogPath = join(fixture.root, ".git", "logs", identity.ref!)
  writeFileSync(
    reflogPath,
    Buffer.concat([readFileSync(reflogPath), Buffer.from([0xff, 0x0a])]),
  )
  const reflogBytesBefore = readFileSync(reflogPath)
  const reflogBefore = run(fixture.root, [
    "git",
    "reflog",
    "show",
    "--format=%H",
    identity.ref!,
  ]).split("\n")
  const realGit = Bun.which("git")
  if (!realGit) throw new Error("git unavailable")
  const bin = join(fixture.root, "bin")
  run(fixture.root, ["/bin/mkdir", "-p", bin])
  const wrapper = join(bin, "git")
  writeFileSync(
    wrapper,
    `#!/bin/sh
case " $* " in
  *" worktree remove "*) exit 71 ;;
esac
exec "${realGit}" "$@"
`,
  )
  chmodSync(wrapper, 0o755)
  const cleanup = Bun.spawnSync([
    "bun",
    join(import.meta.dir, "worktree-cleanup.ts"),
    "remove",
    "--owner-commit",
    ownerCommit,
    "--worktree-id",
    identity.worktree_id,
    "--expected-generation",
    identity.generation,
    "--expected-head",
    identity.head,
    "--expected-ref",
    identity.ref!,
  ], {
    cwd: fixture.root,
    env: { ...process.env, PATH: `${bin}:${process.env.PATH ?? ""}` },
    stdout: "pipe",
    stderr: "pipe",
  })

  expect(cleanup.exitCode).toBe(1)
  const receipt = JSON.parse(cleanup.stdout.toString())
  expect(receipt.reason_code).toBe("git_operation_failed")
  expect(receipt.local_branch_deleted).toBe(false)
  expect(receipt.rollback_attempted).toBe(true)
  expect(receipt.rollback_completed).toBe(true)
  expect(identity.head).toHaveLength(64)
  expect(existsSync(fixture.worktree)).toBe(true)
  expect(run(fixture.worktree, ["git", "symbolic-ref", "-q", "HEAD"])).toBe(identity.ref!)
  expect(run(fixture.root, ["git", "rev-parse", identity.ref!])).toBe(identity.head)
  const reflogAfter = run(fixture.root, [
    "git",
    "reflog",
    "show",
    "--format=%H",
    identity.ref!,
  ]).split("\n")
  expect(reflogAfter).toEqual(reflogBefore)
  expect(readFileSync(reflogPath)).toEqual(reflogBytesBefore)
})

test("owner cleanup preserves the guard when the public path is reacquired during rollback", () => {
  const fixture = createFixture()
  const identity = identifyLinkedWorktree(fixture.worktree)
  const ownerCommit = installOwnerTool(fixture.root)
  const realGit = Bun.which("git")
  if (!realGit) throw new Error("git unavailable")
  const bin = join(fixture.root, "bin")
  run(fixture.root, ["/bin/mkdir", "-p", bin])
  const wrapper = join(bin, "git")
  writeFileSync(
    wrapper,
    `#!/bin/sh
case " $* " in
  *" worktree remove "*) exit 71 ;;
  *" symbolic-ref HEAD ${identity.ref!} "*)
    "${realGit}" "$@" || exit $?
    /bin/mkdir -p "${fixture.worktree}"
    printf 'foreign path owner\\n' > "${join(fixture.worktree, "foreign.txt")}"
    exit 0
    ;;
esac
exec "${realGit}" "$@"
`,
  )
  chmodSync(wrapper, 0o755)

  const cleanup = runCleanupCli(fixture.root, identity, ownerCommit, bin)

  expect(cleanup.exitCode).toBe(1)
  const receipt = JSON.parse(cleanup.stdout.toString())
  expect(receipt.reason_code).toBe("rollback_failed")
  expect(receipt.rollback_attempted).toBe(true)
  expect(receipt.rollback_completed).toBe(false)
  expect(receipt.preserved_ref).toMatch(/^refs\/heads\/worktree-cleanup-[0-9a-f]{64}$/)
  expect(run(fixture.root, ["git", "rev-parse", receipt.preserved_ref])).toBe(identity.head)
  expect(readFileSync(join(fixture.worktree, "foreign.txt"), "utf8")).toBe("foreign path owner\n")
  expect(run(fixture.root, ["git", "worktree", "list", "--porcelain"]))
    .toContain(".worktree-cleanup-")
})

test("owner cleanup does not overwrite a reflog after a concurrent ref update", () => {
  const fixture = createFixture()
  const identity = identifyLinkedWorktree(fixture.worktree)
  const ownerCommit = installOwnerTool(fixture.root)
  const concurrentHead = run(fixture.root, [
    "git",
    "commit-tree",
    `${identity.head}^{tree}`,
    "-p",
    identity.head,
    "-m",
    "concurrent",
  ])
  const realGit = Bun.which("git")
  if (!realGit) throw new Error("git unavailable")
  const bin = join(fixture.root, "bin")
  const counter = join(bin, "update-ref-count")
  run(fixture.root, ["/bin/mkdir", "-p", bin])
  const wrapper = join(bin, "git")
  writeFileSync(
    wrapper,
    `#!/bin/sh
case " $* " in
  *" update-ref --stdin "*)
    count=0
    [ ! -f "${counter}" ] || count=$(cat "${counter}")
    count=$((count + 1))
    printf '%s\\n' "$count" > "${counter}"
    "${realGit}" "$@"
    result=$?
    if [ "$count" -eq 2 ]; then
      "${realGit}" -C "${fixture.root}" update-ref "${identity.ref!}" "${concurrentHead}" "${identity.head}"
    fi
    exit "$result"
    ;;
  *" worktree remove "*) exit 71 ;;
esac
exec "${realGit}" "$@"
`,
  )
  chmodSync(wrapper, 0o755)
  const cleanup = runCleanupCli(fixture.root, identity, ownerCommit, bin)

  expect(cleanup.exitCode).toBe(1)
  const receipt = JSON.parse(cleanup.stdout.toString())
  expect(receipt.reason_code).toBe("rollback_failed")
  expect(receipt.rollback_completed).toBe(false)
  expect(receipt.preserved_ref).toMatch(/^refs\/heads\/worktree-cleanup-[0-9a-f]{64}$/)
  expect(run(fixture.root, ["git", "rev-parse", receipt.preserved_ref])).toBe(identity.head)
  expect(run(fixture.root, ["git", "rev-parse", identity.ref!])).toBe(concurrentHead)
  expect(run(fixture.root, ["git", "reflog", "show", "--format=%H", identity.ref!]))
    .toContain(concurrentHead)
})

test("owner cleanup preserves an away-and-back reflog update during rollback", () => {
  const fixture = createFixture()
  const identity = identifyLinkedWorktree(fixture.worktree)
  const ownerCommit = installOwnerTool(fixture.root)
  const concurrentHead = run(fixture.root, [
    "git",
    "commit-tree",
    `${identity.head}^{tree}`,
    "-p",
    identity.head,
    "-m",
    "concurrent away and back",
  ])
  const realGit = Bun.which("git")
  if (!realGit) throw new Error("git unavailable")
  const bin = join(fixture.root, "bin")
  const counter = join(bin, "update-ref-count")
  run(fixture.root, ["/bin/mkdir", "-p", bin])
  const wrapper = join(bin, "git")
  writeFileSync(
    wrapper,
    `#!/bin/sh
case " $* " in
  *" update-ref --stdin "*)
    count=0
    [ ! -f "${counter}" ] || count=$(cat "${counter}")
    count=$((count + 1))
    printf '%s\\n' "$count" > "${counter}"
    "${realGit}" "$@"
    result=$?
    if [ "$count" -eq 2 ] && [ "$result" -eq 0 ]; then
      "${realGit}" -C "${fixture.root}" update-ref "${identity.ref!}" "${concurrentHead}" "${identity.head}" &&
      "${realGit}" -C "${fixture.root}" update-ref "${identity.ref!}" "${identity.head}" "${concurrentHead}"
    fi
    exit "$result"
    ;;
  *" worktree remove "*) exit 71 ;;
esac
exec "${realGit}" "$@"
`,
  )
  chmodSync(wrapper, 0o755)

  const cleanup = runCleanupCli(fixture.root, identity, ownerCommit, bin)

  expect(cleanup.exitCode).toBe(1)
  const receipt = JSON.parse(cleanup.stdout.toString())
  expect(receipt.reason_code).toBe("rollback_failed")
  expect(receipt.rollback_completed).toBe(false)
  expect(receipt.preserved_ref).toMatch(/^refs\/heads\/worktree-cleanup-[0-9a-f]{64}$/)
  expect(run(fixture.root, ["git", "rev-parse", receipt.preserved_ref])).toBe(identity.head)
  expect(run(fixture.root, ["git", "rev-parse", identity.ref!])).toBe(identity.head)
  expect(run(fixture.root, ["git", "reflog", "show", "--format=%H", identity.ref!]))
    .toContain(concurrentHead)
})

test("owner cleanup reconciles a nonzero worktree removal that completed", () => {
  const fixture = createFixture()
  const identity = identifyLinkedWorktree(fixture.worktree)
  const ownerCommit = installOwnerTool(fixture.root)
  const realGit = Bun.which("git")
  if (!realGit) throw new Error("git unavailable")
  const bin = join(fixture.root, "bin")
  run(fixture.root, ["/bin/mkdir", "-p", bin])
  const wrapper = join(bin, "git")
  writeFileSync(
    wrapper,
    `#!/bin/sh
case " $* " in
  *" worktree remove "*)
    "${realGit}" "$@" || exit $?
    exit 71
    ;;
esac
exec "${realGit}" "$@"
`,
  )
  chmodSync(wrapper, 0o755)
  const cleanup = runCleanupCli(fixture.root, identity, ownerCommit, bin)

  expect(cleanup.exitCode).toBe(0)
  const receipt = JSON.parse(cleanup.stdout.toString())
  expect(receipt.status).toBe("completed")
  expect(receipt.worktree_removed).toBe(true)
  expect(receipt.local_branch_deleted).toBe(true)
  expect(existsSync(fixture.worktree)).toBe(false)
})

test("owner cleanup rolls back a nonzero worktree move that completed", () => {
  const fixture = createFixture()
  const identity = identifyLinkedWorktree(fixture.worktree)
  const ownerCommit = installOwnerTool(fixture.root)
  const realGit = Bun.which("git")
  if (!realGit) throw new Error("git unavailable")
  const bin = join(fixture.root, "bin")
  run(fixture.root, ["/bin/mkdir", "-p", bin])
  const wrapper = join(bin, "git")
  writeFileSync(
    wrapper,
    `#!/bin/sh
case " $* " in
  *" worktree move "*)
    "${realGit}" "$@" || exit $?
    exit 71
    ;;
esac
exec "${realGit}" "$@"
`,
  )
  chmodSync(wrapper, 0o755)
  const cleanup = runCleanupCli(fixture.root, identity, ownerCommit, bin)

  expect(cleanup.exitCode).toBe(1)
  const receipt = JSON.parse(cleanup.stdout.toString())
  expect(receipt.reason_code).toBe("git_operation_failed")
  expect(receipt.worktree_claimed).toBe(true)
  expect(receipt.rollback_attempted).toBe(true)
  expect(receipt.rollback_completed).toBe(true)
  expect(receipt.worktree_removed).toBe(false)
  expect(existsSync(fixture.worktree)).toBe(true)
  expect(run(fixture.root, ["git", "rev-parse", identity.ref!])).toBe(identity.head)
})

test("owner cleanup rolls back a successful move when post-move resolution fails", () => {
  const fixture = createFixture()
  const identity = identifyLinkedWorktree(fixture.worktree)
  const ownerCommit = installOwnerTool(fixture.root)
  const realGit = Bun.which("git")
  if (!realGit) throw new Error("git unavailable")
  const bin = join(fixture.root, "bin")
  run(fixture.root, ["/bin/mkdir", "-p", bin])
  const wrapper = join(bin, "git")
  writeFileSync(
    wrapper,
    `#!/bin/sh
case "$2" in
  *".worktree-cleanup-"*)
    case " $* " in
      *" rev-parse --path-format=absolute --git-dir "*) exit 71 ;;
    esac
    ;;
esac
exec "${realGit}" "$@"
`,
  )
  chmodSync(wrapper, 0o755)

  const cleanup = runCleanupCli(fixture.root, identity, ownerCommit, bin)

  expect(cleanup.exitCode).toBe(1)
  const receipt = JSON.parse(cleanup.stdout.toString())
  expect(receipt.reason_code).toBe("git_operation_failed")
  expect(receipt.worktree_claimed).toBe(true)
  expect(receipt.rollback_attempted).toBe(true)
  expect(receipt.rollback_completed).toBe(true)
  expect(existsSync(fixture.worktree)).toBe(true)
  expect(run(fixture.root, ["git", "rev-parse", identity.ref!])).toBe(identity.head)
})

test("owner cleanup rejects a same-OID reflog change made before the direct claim locks", () => {
  const fixture = createFixture()
  const identity = identifyLinkedWorktree(fixture.worktree)
  const ownerCommit = installOwnerTool(fixture.root)
  const reflogPath = join(fixture.root, ".git", "logs", identity.ref!)
  const realGit = Bun.which("git")
  if (!realGit) throw new Error("git unavailable")
  const bin = join(fixture.root, "bin")
  const changed = join(bin, "changed")
  run(fixture.root, ["/bin/mkdir", "-p", bin])
  const wrapper = join(bin, "git")
  writeFileSync(
    wrapper,
    `#!/bin/sh
case " $* " in
  *" update-ref --stdin "*)
    if [ ! -f "${changed}" ]; then
      printf 'same-oid concurrent reflog metadata\\n' >> "${reflogPath}"
      : > "${changed}"
    fi
    ;;
esac
exec "${realGit}" "$@"
`,
  )
  chmodSync(wrapper, 0o755)

  const cleanup = runCleanupCli(fixture.root, identity, ownerCommit, bin)

  expect(cleanup.exitCode).toBe(1)
  const receipt = JSON.parse(cleanup.stdout.toString())
  expect(receipt.reason_code).toBe("branch_identity_drift_before_worktree_removal")
  expect(receipt.worktree_claimed).toBe(true)
  expect(receipt.rollback_completed).toBe(true)
  expect(readFileSync(reflogPath, "utf8")).toContain("same-oid concurrent reflog metadata")
  expect(existsSync(fixture.worktree)).toBe(true)
})

test("owner cleanup rejects a same-OID direct ref replacement without a reflog", () => {
  const fixture = createFixture()
  const ownerCommit = installOwnerTool(fixture.root)
  run(fixture.root, ["git", "config", "core.logAllRefUpdates", "false"])
  const identity = identifyLinkedWorktree(fixture.worktree)
  const reflogPath = join(fixture.root, ".git", "logs", identity.ref!)
  rmSync(reflogPath, { force: true })
  const realGit = Bun.which("git")
  if (!realGit) throw new Error("git unavailable")
  const bin = join(fixture.root, "bin")
  const changed = join(bin, "changed")
  run(fixture.root, ["/bin/mkdir", "-p", bin])
  const wrapper = join(bin, "git")
  writeFileSync(
    wrapper,
    `#!/bin/sh
case " $* " in
  *" update-ref --stdin "*)
    if [ ! -f "${changed}" ]; then
      "${realGit}" -C "${fixture.root}" update-ref -d "${identity.ref!}" "${identity.head}" || exit $?
      "${realGit}" -C "${fixture.root}" update-ref "${identity.ref!}" "${identity.head}" || exit $?
      : > "${changed}"
    fi
    ;;
esac
exec "${realGit}" "$@"
`,
  )
  chmodSync(wrapper, 0o755)

  const cleanup = runCleanupCli(fixture.root, identity, ownerCommit, bin)

  expect(cleanup.exitCode).toBe(1)
  const receipt = JSON.parse(cleanup.stdout.toString())
  expect(receipt.reason_code).toBe("branch_identity_drift_before_worktree_removal")
  expect(receipt.rollback_completed).toBe(true)
  expect(receipt.preserved_ref).toBeNull()
  expect(run(fixture.root, ["git", "rev-parse", identity.ref!])).toBe(identity.head)
  expect(existsSync(reflogPath)).toBe(false)
  expect(existsSync(fixture.worktree)).toBe(true)
})

test("owner cleanup rejects a same-OID packed ref file replacement", () => {
  const fixture = createFixture()
  run(fixture.root, ["git", "pack-refs", "--all", "--prune"])
  const identity = identifyLinkedWorktree(fixture.worktree)
  const ownerCommit = installOwnerTool(fixture.root)
  const packedRefs = join(fixture.root, ".git", "packed-refs")
  const looseRef = join(fixture.root, ".git", identity.ref!)
  expect(existsSync(looseRef)).toBe(false)
  const realGit = Bun.which("git")
  if (!realGit) throw new Error("git unavailable")
  const bin = join(fixture.root, "bin")
  const changed = join(bin, "changed")
  run(fixture.root, ["/bin/mkdir", "-p", bin])
  const wrapper = join(bin, "git")
  writeFileSync(
    wrapper,
    `#!/bin/sh
case " $* " in
  *" update-ref --stdin "*)
    if [ ! -f "${changed}" ]; then
      cp "${packedRefs}" "${packedRefs}.replacement" || exit $?
      mv "${packedRefs}.replacement" "${packedRefs}" || exit $?
      : > "${changed}"
    fi
    ;;
esac
exec "${realGit}" "$@"
`,
  )
  chmodSync(wrapper, 0o755)

  const cleanup = runCleanupCli(fixture.root, identity, ownerCommit, bin)

  expect(cleanup.exitCode).toBe(1)
  const receipt = JSON.parse(cleanup.stdout.toString())
  expect(receipt.reason_code).toBe("branch_identity_drift_before_worktree_removal")
  expect(receipt.rollback_completed).toBe(true)
  expect(receipt.preserved_ref).toBeNull()
  expect(run(fixture.root, ["git", "rev-parse", identity.ref!])).toBe(identity.head)
  expect(existsSync(fixture.worktree)).toBe(true)
})

test("owner cleanup reconciles a direct-ref transaction committed before nonzero exit", () => {
  const fixture = createFixture()
  const identity = identifyLinkedWorktree(fixture.worktree)
  const ownerCommit = installOwnerTool(fixture.root)
  const realGit = Bun.which("git")
  if (!realGit) throw new Error("git unavailable")
  const bin = join(fixture.root, "bin")
  run(fixture.root, ["/bin/mkdir", "-p", bin])
  const wrapper = join(bin, "git")
  writeFileSync(
    wrapper,
    `#!/bin/sh
case " $* " in
  *" update-ref --stdin "*)
    count=0
    [ ! -f "${bin}/update-ref-count" ] || count=$(cat "${bin}/update-ref-count")
    count=$((count + 1))
    printf '%s\\n' "$count" > "${bin}/update-ref-count"
    "${realGit}" "$@" || exit $?
    [ "$count" -ne 1 ] || exit 71
    exit 0
    ;;
esac
exec "${realGit}" "$@"
`,
  )
  chmodSync(wrapper, 0o755)
  const cleanup = runCleanupCli(fixture.root, identity, ownerCommit, bin)

  expect(cleanup.exitCode).toBe(0)
  const receipt = JSON.parse(cleanup.stdout.toString())
  expect(receipt.status).toBe("completed")
  expect(receipt.preserved_ref).toBeNull()
  expect(receipt.local_branch_deleted).toBe(true)
  expect(existsSync(fixture.worktree)).toBe(false)
})

test("owner cleanup rejects reftable before claiming the worktree", () => {
  const root = mkdtempSync(join(tmpdir(), "trade-worktree-cleanup-reftable-"))
  fixtures.push(root)
  const initialized = runResult(root, ["git", "init", "-q", "--ref-format=reftable"])
  if (initialized.exitCode !== 0) return
  run(root, ["git", "config", "user.name", "test"])
  run(root, ["git", "config", "user.email", "test@example.com"])
  writeFileSync(join(root, "tracked.txt"), "base\n")
  run(root, ["git", "add", "tracked.txt"])
  run(root, ["git", "commit", "-qm", "base"])
  const worktree = join(root, "linked worktree")
  run(root, ["git", "worktree", "add", "-qb", "mission-branch", worktree])
  for (let index = 0; index < 3; index += 1) {
    run(worktree, ["git", "commit", "--allow-empty", "-qm", `reflog ${index}`])
  }
  const identity = identifyLinkedWorktree(worktree)
  const reflogBefore = run(root, [
    "git",
    "reflog",
    "show",
    "--format=%H",
    identity.ref!,
  ])
  const ownerCommit = installOwnerTool(root)
  const failure = captureCleanupError(() => removeOwnedWorktree({
    repositoryCwd: root,
    ownerCommit,
    worktreeId: identity.worktree_id,
    expectedGeneration: identity.generation,
    expectedHead: identity.head,
    expectedRef: identity.ref,
    removeIgnored: false,
  }))

  expect(failure.code).toBe("unsupported_ref_storage")
  expect(failure.receipt?.worktree_claimed).toBe(false)
  expect(failure.receipt?.rollback_attempted).toBe(false)
  expect(existsSync(worktree)).toBe(true)
  expect(run(root, ["git", "rev-parse", identity.ref!])).toBe(identity.head)
  expect(run(root, ["git", "reflog", "show", "--format=%H", identity.ref!])).toBe(reflogBefore)
})

test("owner cleanup reports a concurrently recreated dangling symbolic ref as preserved", () => {
  const fixture = createFixture()
  const identity = identifyLinkedWorktree(fixture.worktree)
  const ownerCommit = installOwnerTool(fixture.root)
  run(fixture.root, ["git", "update-ref", "refs/heads/victim", identity.head])
  run(fixture.root, ["git", "symbolic-ref", identity.ref!, "refs/heads/victim"])
  const realGit = Bun.which("git")
  if (!realGit) throw new Error("git unavailable")
  const bin = join(fixture.root, "bin")
  run(fixture.root, ["/bin/mkdir", "-p", bin])
  const wrapper = join(bin, "git")
  writeFileSync(
    wrapper,
    `#!/bin/sh
case " $* " in
  *" worktree remove "*)
    "${realGit}" -C "${fixture.root}" symbolic-ref "${identity.ref!}" refs/heads/missing
    exit 71
    ;;
esac
exec "${realGit}" "$@"
`,
  )
  chmodSync(wrapper, 0o755)
  const cleanup = runCleanupCli(fixture.root, identity, ownerCommit, bin)

  expect(cleanup.exitCode).toBe(1)
  const receipt = JSON.parse(cleanup.stdout.toString())
  expect(receipt.reason_code).toBe("rollback_failed")
  expect(receipt.worktree_claimed).toBe(true)
  expect(receipt.rollback_attempted).toBe(true)
  expect(receipt.rollback_completed).toBe(false)
  expect(receipt.status).toBe("partial")
  expect(receipt.local_branch_deleted).toBe(false)
  expect(run(fixture.root, ["git", "symbolic-ref", identity.ref!])).toBe("refs/heads/missing")
  const claimedPath = run(fixture.root, ["git", "worktree", "list", "--porcelain"])
    .split("\n")
    .filter((line) => line.startsWith("worktree "))
    .map((line) => line.slice("worktree ".length))
    .find((path) => (
      basename(path) === "target"
      && basename(dirname(path)).startsWith(".worktree-cleanup-")
    ))
  if (!claimedPath) throw new Error("claimed worktree missing")
  expect(existsSync(claimedPath)).toBe(true)
  expect(existsSync(fixture.worktree)).toBe(false)
})

test("owner cleanup reports a branch recreated after worktree removal as preserved", () => {
  const fixture = createFixture()
  const identity = identifyLinkedWorktree(fixture.worktree)
  const ownerCommit = installOwnerTool(fixture.root)
  const realGit = Bun.which("git")
  if (!realGit) throw new Error("git unavailable")
  const bin = join(fixture.root, "bin")
  run(fixture.root, ["/bin/mkdir", "-p", bin])
  const wrapper = join(bin, "git")
  const failGuardCleanup = join(fixture.root, "fail-guard-cleanup")
  writeFileSync(
    wrapper,
    `#!/bin/sh
case " $* " in
  *" worktree remove "*)
    "${realGit}" "$@" || exit $?
    "${realGit}" -C "${fixture.root}" update-ref "${identity.ref!}" "${identity.head}"
    printf 'yes\\n' > "${failGuardCleanup}"
    exit 0
    ;;
  *" update-ref -d refs/heads/worktree-cleanup-"*)
    [ -f "${failGuardCleanup}" ] && exit 72
    ;;
esac
exec "${realGit}" "$@"
`,
  )
  chmodSync(wrapper, 0o755)
  const cleanup = runCleanupCli(fixture.root, identity, ownerCommit, bin)

  expect(cleanup.exitCode).toBe(1)
  const receipt = JSON.parse(cleanup.stdout.toString())
  expect(receipt.reason_code).toBe("guard_ref_cleanup_failed")
  expect(receipt.status).toBe("partial")
  expect(receipt.worktree_removed).toBe(true)
  expect(receipt.local_branch_deleted).toBe(false)
  expect(run(fixture.root, ["git", "rev-parse", identity.ref!])).toBe(identity.head)
  expect(existsSync(fixture.worktree)).toBe(false)
})

test("owner cleanup reports the surviving guard when guard deletion fails", () => {
  const fixture = createFixture()
  const identity = identifyLinkedWorktree(fixture.worktree)
  const ownerCommit = installOwnerTool(fixture.root)
  const realGit = Bun.which("git")
  if (!realGit) throw new Error("git unavailable")
  const bin = join(fixture.root, "bin")
  run(fixture.root, ["/bin/mkdir", "-p", bin])
  const wrapper = join(bin, "git")
  const failGuardCleanup = join(fixture.root, "fail-guard-cleanup")
  writeFileSync(
    wrapper,
    `#!/bin/sh
case " $* " in
  *" worktree remove "*)
    "${realGit}" "$@" || exit $?
    printf 'yes\\n' > "${failGuardCleanup}"
    exit 0
    ;;
  *" update-ref -d refs/heads/worktree-cleanup-"*)
    [ -f "${failGuardCleanup}" ] && exit 72
    ;;
esac
exec "${realGit}" "$@"
`,
  )
  chmodSync(wrapper, 0o755)
  const cleanup = runCleanupCli(fixture.root, identity, ownerCommit, bin)

  expect(cleanup.exitCode).toBe(1)
  const receipt = JSON.parse(cleanup.stdout.toString())
  expect(receipt.reason_code).toBe("guard_ref_cleanup_failed")
  expect(receipt.status).toBe("partial")
  expect(receipt.worktree_removed).toBe(true)
  expect(receipt.local_branch_deleted).toBe(false)
  expect(receipt.preserved_ref).toStartWith("refs/heads/worktree-cleanup-")
  expect(run(fixture.root, ["git", "rev-parse", receipt.preserved_ref])).toBe(identity.head)
  expect(runResult(fixture.root, ["git", "show-ref", "--verify", identity.ref!]).exitCode)
    .not.toBe(0)
  expect(existsSync(fixture.worktree)).toBe(false)
})

test("owner cleanup continues after guard deletion committed before nonzero exit", () => {
  const fixture = createFixture()
  const identity = identifyLinkedWorktree(fixture.worktree)
  const ownerCommit = installOwnerTool(fixture.root)
  run(fixture.root, ["git", "config", "branch.mission-branch.remote", "origin"])
  run(fixture.root, ["git", "config", "branch.mission-branch.merge", "refs/heads/main"])
  const realGit = Bun.which("git")
  if (!realGit) throw new Error("git unavailable")
  const bin = join(fixture.root, "bin")
  const removed = join(bin, "worktree-removed")
  run(fixture.root, ["/bin/mkdir", "-p", bin])
  const wrapper = join(bin, "git")
  writeFileSync(
    wrapper,
    `#!/bin/sh
case " $* " in
  *" worktree remove "*)
    "${realGit}" "$@" || exit $?
    : > "${removed}"
    exit 0
    ;;
  *" update-ref -d refs/heads/worktree-cleanup-"*)
    if [ -f "${removed}" ]; then
      "${realGit}" "$@" || exit $?
      exit 71
    fi
    ;;
esac
exec "${realGit}" "$@"
`,
  )
  chmodSync(wrapper, 0o755)
  const cleanup = runCleanupCli(fixture.root, identity, ownerCommit, bin)

  expect(cleanup.exitCode).toBe(0)
  const receipt = JSON.parse(cleanup.stdout.toString())
  expect(receipt.status).toBe("completed")
  expect(receipt.local_branch_deleted).toBe(true)
  expect(receipt.preserved_ref).toBeNull()
  expect(runResult(fixture.root, [
    "git",
    "config",
    "--get-regexp",
    "^branch\\.mission-branch\\.",
  ]).exitCode).not.toBe(0)
  expect(existsSync(fixture.worktree)).toBe(false)
})

test("owner cleanup reports a surviving symbolic guard without redacting it", () => {
  const fixture = createFixture()
  const identity = identifyLinkedWorktree(fixture.worktree)
  const ownerCommit = installOwnerTool(fixture.root)
  run(fixture.root, ["git", "update-ref", "refs/heads/victim", identity.head])
  run(fixture.root, ["git", "symbolic-ref", identity.ref!, "refs/heads/victim"])
  const realGit = Bun.which("git")
  if (!realGit) throw new Error("git unavailable")
  const bin = join(fixture.root, "bin")
  run(fixture.root, ["/bin/mkdir", "-p", bin])
  const wrapper = join(bin, "git")
  const failGuardCleanup = join(fixture.root, "fail-guard-cleanup")
  writeFileSync(
    wrapper,
    `#!/bin/sh
case " $* " in
  *" worktree remove "*)
    "${realGit}" "$@" || exit $?
    printf 'yes\\n' > "${failGuardCleanup}"
    exit 0
    ;;
  *" update-ref -d refs/worktree-cleanup/"*)
    [ -f "${failGuardCleanup}" ] && exit 72
    ;;
esac
exec "${realGit}" "$@"
`,
  )
  chmodSync(wrapper, 0o755)
  const cleanup = runCleanupCli(fixture.root, identity, ownerCommit, bin)

  expect(cleanup.exitCode).toBe(1)
  const receipt = JSON.parse(cleanup.stdout.toString())
  expect(receipt.reason_code).toBe("guard_ref_cleanup_failed")
  expect(receipt.status).toBe("partial")
  expect(receipt.local_branch_deleted).toBe(false)
  expect(receipt.preserved_ref).toMatch(/^refs\/worktree-cleanup\/[0-9a-f]{64}$/)
  expect(run(fixture.root, ["git", "rev-parse", receipt.preserved_ref])).toBe(identity.head)
  expect(run(fixture.root, ["git", "rev-parse", "refs/heads/victim"])).toBe(identity.head)
  expect(existsSync(fixture.worktree)).toBe(false)
})

test("owner cleanup preserves a concurrently recreated and adopted branch", () => {
  const fixture = createFixture()
  const identity = identifyLinkedWorktree(fixture.worktree)
  const ownerCommit = installOwnerTool(fixture.root)
  const realGit = Bun.which("git")
  if (!realGit) throw new Error("git unavailable")
  const adopter = `${fixture.root}-adopter`
  fixtures.push(adopter)
  const bin = join(fixture.root, "bin")
  run(fixture.root, ["/bin/mkdir", "-p", bin])
  const wrapper = join(bin, "git")
  writeFileSync(
    wrapper,
    `#!/bin/sh
case " $* " in
  *" worktree remove "*)
    "${realGit}" -C "${fixture.root}" update-ref "${identity.ref!}" "${identity.head}"
    "${realGit}" -C "${fixture.root}" worktree add -q "${adopter}" mission-branch
    ;;
esac
exec "${realGit}" "$@"
`,
  )
  chmodSync(wrapper, 0o755)
  const cleanup = Bun.spawnSync([
    "bun",
    join(import.meta.dir, "worktree-cleanup.ts"),
    "remove",
    "--owner-commit",
    ownerCommit,
    "--worktree-id",
    identity.worktree_id,
    "--expected-generation",
    identity.generation,
    "--expected-head",
    identity.head,
    "--expected-ref",
    identity.ref!,
  ], {
    cwd: fixture.root,
    env: { ...process.env, PATH: `${bin}:${process.env.PATH ?? ""}` },
    stdout: "pipe",
    stderr: "pipe",
  })

  expect(cleanup.exitCode).toBe(0)
  const receipt = JSON.parse(cleanup.stdout.toString())
  expect(receipt.status).toBe("completed")
  expect(receipt.worktree_removed).toBe(true)
  expect(receipt.local_branch_deleted).toBe(false)
  expect(existsSync(fixture.worktree)).toBe(false)
  expect(existsSync(adopter)).toBe(true)
  expect(run(adopter, ["git", "symbolic-ref", "-q", "HEAD"])).toBe(identity.ref!)
  expect(run(adopter, ["git", "rev-parse", "HEAD"])).toBe(identity.head)
})

test("owner cleanup removes a detached linked worktree without deleting a branch", () => {
  const fixture = createDetachedFixture()
  const identity = identifyLinkedWorktree(fixture.worktree)
  expect(identity.ref).toBeNull()
  const ownerCommit = installOwnerTool(fixture.root)

  const receipt = removeOwnedWorktree({
    repositoryCwd: fixture.root,
    ownerCommit,
    worktreeId: identity.worktree_id,
    expectedGeneration: identity.generation,
    expectedHead: identity.head,
    expectedRef: null,
    removeIgnored: false,
  })

  expect(receipt.status).toBe("completed")
  expect(receipt.local_branch_deleted).toBe(false)
  expect(existsSync(fixture.worktree)).toBe(false)
  expect(run(fixture.root, ["git", "rev-parse", "HEAD"])).toBe(ownerCommit)
})

test("owner cleanup rejects a replacement that reuses the worktree id, ref, and head", () => {
  const fixture = createFixture()
  const identity = identifyLinkedWorktree(fixture.worktree)
  const ownerCommit = installOwnerTool(fixture.root)
  run(fixture.root, ["git", "worktree", "remove", "--", fixture.worktree])

  const replacementParent = join(fixture.root, "replacement")
  run(fixture.root, ["mkdir", "-p", replacementParent])
  const replacement = join(replacementParent, "linked worktree")
  run(fixture.root, ["git", "worktree", "add", "-q", replacement, "mission-branch"])
  const replacementIdentity = identifyLinkedWorktree(replacement)
  expect(replacementIdentity.worktree_id).toBe(identity.worktree_id)
  expect(replacementIdentity.head).toBe(identity.head)
  expect(replacementIdentity.ref).toBe(identity.ref)
  expect(replacementIdentity.generation).not.toBe(identity.generation)

  const failure = captureCleanupError(() => removeOwnedWorktree({
    repositoryCwd: fixture.root,
    ownerCommit,
    worktreeId: identity.worktree_id,
    expectedGeneration: identity.generation,
    expectedHead: identity.head,
    expectedRef: identity.ref,
    removeIgnored: false,
  }))
  expect(failure.code).toBe("target_generation_mismatch")
  expect(failure.receipt?.observed_generation).toBe(replacementIdentity.generation)
  expect(failure.receipt?.worktree_claimed).toBe(false)
  expect(existsSync(replacement)).toBe(true)
  expect(runResult(fixture.root, ["git", "show-ref", "--verify", identity.ref!]).exitCode).toBe(0)
})

function createFixture(objectFormat: "sha1" | "sha256" = "sha1"): { root: string; worktree: string } {
  const root = mkdtempSync(join(tmpdir(), "trade-worktree-cleanup-"))
  fixtures.push(root)
  run(root, ["git", "init", "-q", `--object-format=${objectFormat}`])
  run(root, ["git", "config", "user.name", "test"])
  run(root, ["git", "config", "user.email", "test@example.com"])
  writeFileSync(join(root, "tracked.txt"), "base\n")
  writeFileSync(join(root, ".gitignore"), "ignored.tmp\n")
  run(root, ["git", "add", "tracked.txt", ".gitignore"])
  run(root, ["git", "commit", "-qm", "base"])
  const worktree = join(root, "linked worktree")
  run(root, ["git", "worktree", "add", "-qb", "mission-branch", worktree])
  return { root, worktree }
}

function createDetachedFixture(): { root: string; worktree: string } {
  const fixture = createFixture()
  run(fixture.root, ["git", "worktree", "remove", "--", fixture.worktree])
  run(fixture.root, ["git", "branch", "-D", "mission-branch"])
  run(fixture.root, ["git", "worktree", "add", "-q", "--detach", fixture.worktree, "HEAD"])
  return fixture
}

function installOwnerTool(root: string): string {
  const ownerDirectory = join(
    root,
    "modules",
    "orchestration-ops",
    "agent-workspace-manager",
    "scripts",
  )
  run(root, ["mkdir", "-p", ownerDirectory])
  writeFileSync(
    join(ownerDirectory, "worktree-cleanup.ts"),
    readFileSync(join(import.meta.dir, "worktree-cleanup.ts")),
  )
  run(root, ["git", "add", "modules/orchestration-ops/agent-workspace-manager/scripts/worktree-cleanup.ts"])
  run(root, ["git", "commit", "-qm", "install owner tool"])
  return run(root, ["git", "rev-parse", "HEAD"])
}

function spawnOtherUid(command: string[], cwd: string): ReturnType<typeof Bun.spawn> {
  const invocation = process.geteuid?.() === 0
    ? ["/usr/sbin/runuser", "-u", "nobody", "--", ...command]
    : ["/usr/bin/sudo", "-n", "--", ...command]
  return Bun.spawn(invocation, { cwd, stdout: "ignore", stderr: "ignore" })
}

function canUnshare(arguments_: string[]): boolean {
  return Bun.spawnSync(["unshare", ...arguments_, "true"], {
    stdout: "ignore",
    stderr: "ignore",
  }).exitCode === 0
}

async function waitForOtherUidFixture(
  process: ReturnType<typeof Bun.spawn>,
  readyPath: string,
): Promise<boolean> {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const ready = readFileSync(readyPath, "utf8")
    if (ready) {
      const match = ready.match(/^uid=(\d+) pid=(\d+)\n$/)
      if (!match) throw new Error("invalid cross-UID fixture handshake")
      const fixtureUid = Number(match[1])
      const fixturePid = Number(match[2])
      const parentUid = globalThis.process.geteuid?.()
      if (parentUid === undefined || fixtureUid === parentUid) {
        throw new Error("cross-UID fixture did not change UID")
      }
      const status = readFileSync(`/proc/${fixturePid}/status`, "utf8")
      const observedUid = status.match(/^Uid:\s*(\d+)/m)
      if (!observedUid || Number(observedUid[1]) !== fixtureUid) {
        throw new Error("cross-UID fixture UID drift")
      }
      try {
        globalThis.process.kill(fixturePid, 0)
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "EPERM") throw error
      }
      return true
    }
    if (process.exitCode !== null) return false
    await Bun.sleep(20)
  }
  throw new Error("timed out waiting for cross-UID fixture")
}

function hasEffectiveCapability(bit: number): boolean {
  const match = readFileSync("/proc/self/status", "utf8").match(/^CapEff:\s*([0-9a-f]+)$/m)
  if (!match) throw new Error("missing CapEff")
  return (BigInt(`0x${match[1]}`) & (1n << BigInt(bit))) !== 0n
}

async function waitForPath(path: string): Promise<void> {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    if (existsSync(path)) return
    await Bun.sleep(20)
  }
  throw new Error("timed out waiting for namespace fixture")
}

function expectCleanupInUse(
  fixture: { root: string; worktree: string },
  allowUnavailable = false,
  verifyCaplessCleanup = false,
): void {
  const identity = identifyLinkedWorktree(fixture.worktree)
  const ownerCommit = installOwnerTool(fixture.root)
  const failure = captureCleanupError(() => removeOwnedWorktree({
    repositoryCwd: fixture.root,
    ownerCommit,
    worktreeId: identity.worktree_id,
    expectedGeneration: identity.generation,
    expectedHead: identity.head,
    expectedRef: identity.ref,
    removeIgnored: false,
  }))
  if (allowUnavailable) {
    expect(["target_in_use", "process_guard_unavailable"]).toContain(failure.code)
  } else {
    expect(failure.code).toBe("target_in_use")
  }
  expect(failure.receipt?.worktree_removed).toBe(false)
  expect(existsSync(fixture.worktree)).toBe(true)
  if (!verifyCaplessCleanup) return
  if (globalThis.process.geteuid?.() !== 0) return
  const setpriv = Bun.which("setpriv")
  if (!setpriv) return

  const caplessCleanup = runPipeline(fixture.root, [
    "git",
    "--no-replace-objects",
    "show",
    `${ownerCommit}:modules/orchestration-ops/agent-workspace-manager/scripts/worktree-cleanup.ts`,
  ], [
    setpriv,
    "--bounding-set=-all",
    "--inh-caps=-all",
    "--ambient-caps=-all",
    "--no-new-privs",
    Bun.which("bun")!,
    "run",
    "-",
    "remove",
    "--owner-commit",
    ownerCommit,
    "--worktree-id",
    identity.worktree_id,
    "--expected-generation",
    identity.generation,
    "--expected-head",
    identity.head,
    "--expected-ref",
    identity.ref!,
  ])
  expect(caplessCleanup.exitCode).toBe(1)
  const receipt = JSON.parse(caplessCleanup.stdout.toString())
  expect(["target_in_use", "process_guard_unavailable"]).toContain(receipt.reason_code)
  expect(receipt.worktree_removed).toBe(false)
  expect(existsSync(fixture.worktree)).toBe(true)
}

function run(cwd: string, command: string[]): string {
  const result = runResult(cwd, command)
  if (result.exitCode !== 0) throw new Error(result.stderr.toString())
  return result.stdout.toString().trim()
}

function runResult(cwd: string, command: string[]): PipedCommandResult {
  return Bun.spawnSync(
    command,
    { cwd, stdout: "pipe", stderr: "pipe" },
  ) as PipedCommandResult
}

function captureCleanupError(action: () => unknown): WorktreeCleanupError {
  try {
    action()
  } catch (error) {
    if (error instanceof WorktreeCleanupError) return error
    throw error
  }
  throw new Error("expected cleanup to fail")
}

function runPipeline(
  cwd: string,
  producerCommand: string[],
  consumerCommand: string[],
): PipedCommandResult {
  const producer = Bun.spawnSync(
    producerCommand,
    { cwd, stdout: "pipe", stderr: "pipe" },
  ) as PipedCommandResult
  if (producer.exitCode !== 0) return producer
  return Bun.spawnSync(consumerCommand, {
    cwd,
    stdin: producer.stdout,
    stdout: "pipe",
    stderr: "pipe",
  }) as PipedCommandResult
}

function runCleanupCli(
  cwd: string,
  identity: ReturnType<typeof identifyLinkedWorktree>,
  ownerCommit: string,
  bin?: string,
  removeIgnored = false,
): PipedCommandResult {
  const command = [
    "bun",
    join(import.meta.dir, "worktree-cleanup.ts"),
    "remove",
    "--owner-commit",
    ownerCommit,
    "--worktree-id",
    identity.worktree_id,
    "--expected-generation",
    identity.generation,
    "--expected-head",
    identity.head,
    "--expected-ref",
    identity.ref!,
  ]
  if (removeIgnored) command.push("--remove-ignored", "true")
  return Bun.spawnSync(command, {
    cwd,
    env: {
      ...process.env,
      PATH: bin ? `${bin}:${process.env.PATH ?? ""}` : process.env.PATH,
    },
    stdout: "pipe",
    stderr: "pipe",
  }) as PipedCommandResult
}
