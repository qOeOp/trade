import { afterEach, expect, test } from "bun:test"
import {
  chmodSync,
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs"
import { tmpdir } from "node:os"
import { basename, dirname, join } from "node:path"
import {
  identifyLinkedWorktree,
  removeOwnedWorktree,
  WorktreeCleanupError,
} from "./worktree-cleanup"

const fixtures: string[] = []

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
    "show",
    `${ownerCommit}:scripts/worktree-cleanup.ts`,
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
    identity.ref,
  ])
  if (cleanup.exitCode !== 0) throw new Error(cleanup.stdout.toString() || cleanup.stderr.toString())
  const receipt = JSON.parse(cleanup.stdout.toString())

  expect(receipt.status).toBe("completed")
  expect(receipt.worktree_removed).toBe(true)
  expect(receipt.local_branch_deleted).toBe(true)
  expect(receipt.owner_commit).toBe(ownerCommit)
  expect(receipt.rollback_attempted).toBe(false)
  expect(receipt.rollback_completed).toBe(false)
  expect(receipt).not.toHaveProperty("invocation")
  expect(JSON.stringify(receipt)).not.toContain(fixture.root)
  expect(existsSync(fixture.worktree)).toBe(false)
  expect(runResult(fixture.root, ["git", "show-ref", "--verify", identity.ref]).exitCode).not.toBe(0)
  expect(run(fixture.root, ["git", "rev-parse", "HEAD"])).toBe(ownerCommit)
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
  expect(run(fixture.worktree, ["git", "symbolic-ref", "-q", "HEAD"])).toBe(identity.ref)
  expect(runResult(fixture.root, ["git", "show-ref", "--verify", identity.ref]).exitCode).toBe(0)
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
  const identity = identifyLinkedWorktree(fixture.worktree)
  const ownerCommit = installOwnerTool(fixture.root)
  const user = Bun.spawn([
    "sh",
    "-c",
    "exec 3<\"$1\"; exec sleep 30",
    "sh",
    join(fixture.worktree, "tracked.txt"),
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
})

if (process.platform === "linux") {
  test("owner cleanup rejects cross-uid cwd and open-file users", async () => {
    const cwdFixture = createFixture()
    chmodSync(cwdFixture.root, 0o755)
    const cwdUser = spawnOtherUid([
      "/bin/sh",
      "-c",
      "cd \"$1\"; exec sleep 30",
      "sh",
      cwdFixture.worktree,
    ], cwdFixture.root)
    try {
      await Bun.sleep(200)
      expectCleanupInUse(cwdFixture)
    } finally {
      cwdUser.kill()
      await cwdUser.exited
    }

    const fileFixture = createFixture()
    chmodSync(fileFixture.root, 0o755)
    const fileUser = spawnOtherUid([
      "/bin/sh",
      "-c",
      "exec 3<\"$1\"; exec sleep 30",
      "sh",
      join(fileFixture.worktree, "tracked.txt"),
    ], fileFixture.root)
    try {
      await Bun.sleep(200)
      expectCleanupInUse(fileFixture)
    } finally {
      fileUser.kill()
      await fileUser.exited
    }
  })
}

test("parsed validation failures retain the attempted target and operation state", () => {
  const fixture = createFixture()
  const identity = identifyLinkedWorktree(fixture.worktree)
  const ownerCommit = installOwnerTool(fixture.root)
  const cleanup = runPipeline(fixture.root, [
    "git",
    "show",
    `${ownerCommit}:scripts/worktree-cleanup.ts`,
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
    identity.ref,
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

test("failure receipts redact a path-like malformed expected ref", () => {
  const fixture = createFixture()
  const identity = identifyLinkedWorktree(fixture.worktree)
  const ownerCommit = installOwnerTool(fixture.root)
  const malformedRef = "refs/heads//Users/alice/private-worktree"
  const cleanup = runPipeline(fixture.root, [
    "git",
    "show",
    `${ownerCommit}:scripts/worktree-cleanup.ts`,
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
})

test("owner cleanup rejects symbolic target head drift inside the claim transaction", () => {
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
  *" update-ref --stdin "*)
    "${realGit}" -C "${fixture.root}" update-ref refs/heads/victim "${ownerCommit}"
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
  expect(existsSync(fixture.worktree)).toBe(true)
  expect(run(fixture.root, ["git", "rev-parse", identity.ref!])).toBe(ownerCommit)
})

test("owner cleanup restores the branch and public path when worktree removal fails", () => {
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
  expect(existsSync(fixture.worktree)).toBe(true)
  expect(run(fixture.worktree, ["git", "symbolic-ref", "-q", "HEAD"])).toBe(identity.ref)
  expect(run(fixture.root, ["git", "rev-parse", identity.ref!])).toBe(identity.head)
})

test("owner cleanup reports a concurrently recreated symbolic ref as preserved", () => {
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
    "${realGit}" -C "${fixture.root}" symbolic-ref "${identity.ref!}" refs/heads/victim
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
  expect(receipt.local_branch_deleted).toBe(false)
  expect(run(fixture.root, ["git", "symbolic-ref", identity.ref!])).toBe("refs/heads/victim")
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
  expect(run(adopter, ["git", "symbolic-ref", "-q", "HEAD"])).toBe(identity.ref)
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
  expect(runResult(fixture.root, ["git", "show-ref", "--verify", identity.ref]).exitCode).toBe(0)
})

function createFixture(): { root: string; worktree: string } {
  const root = mkdtempSync(join(tmpdir(), "trade-worktree-cleanup-"))
  fixtures.push(root)
  run(root, ["git", "init", "-q"])
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
  const scripts = join(root, "scripts")
  run(root, ["mkdir", "-p", scripts])
  writeFileSync(
    join(scripts, "worktree-cleanup.ts"),
    readFileSync(join(import.meta.dir, "worktree-cleanup.ts")),
  )
  run(root, ["git", "add", "scripts/worktree-cleanup.ts"])
  run(root, ["git", "commit", "-qm", "install owner tool"])
  return run(root, ["git", "rev-parse", "HEAD"])
}

function spawnOtherUid(command: string[], cwd: string): ReturnType<typeof Bun.spawn> {
  const invocation = process.geteuid?.() === 0
    ? ["/usr/sbin/runuser", "-u", "nobody", "--", ...command]
    : ["/usr/bin/sudo", "-n", "--", ...command]
  return Bun.spawn(invocation, { cwd, stdout: "ignore", stderr: "ignore" })
}

function expectCleanupInUse(fixture: { root: string; worktree: string }): void {
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
  expect(failure.code).toBe("target_in_use")
  expect(failure.receipt?.worktree_removed).toBe(false)
  expect(existsSync(fixture.worktree)).toBe(true)
}

function run(cwd: string, command: string[]): string {
  const result = runResult(cwd, command)
  if (result.exitCode !== 0) throw new Error(result.stderr.toString())
  return result.stdout.toString().trim()
}

function runResult(cwd: string, command: string[]): ReturnType<typeof Bun.spawnSync> {
  return Bun.spawnSync(command, { cwd, stdout: "pipe", stderr: "pipe" })
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
): ReturnType<typeof Bun.spawnSync> {
  const producer = Bun.spawnSync(producerCommand, { cwd, stdout: "pipe", stderr: "pipe" })
  if (producer.exitCode !== 0) return producer
  return Bun.spawnSync(consumerCommand, {
    cwd,
    stdin: producer.stdout,
    stdout: "pipe",
    stderr: "pipe",
  })
}

function runCleanupCli(
  cwd: string,
  identity: ReturnType<typeof identifyLinkedWorktree>,
  ownerCommit: string,
  bin: string,
): ReturnType<typeof Bun.spawnSync> {
  return Bun.spawnSync([
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
    cwd,
    env: { ...process.env, PATH: `${bin}:${process.env.PATH ?? ""}` },
    stdout: "pipe",
    stderr: "pipe",
  })
}
