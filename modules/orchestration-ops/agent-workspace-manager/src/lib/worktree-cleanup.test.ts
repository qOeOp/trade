import { afterEach, expect, test } from "bun:test"
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import {
  identifyLinkedWorktree,
  removeOwnedWorktree,
} from "../scripts/worktree-cleanup"

const fixtures: string[] = []

interface CommandResult {
  exitCode: number
  stdout: Buffer
  stderr: Buffer
}

afterEach(() => {
  for (const fixture of fixtures.splice(0)) {
    rmSync(fixture, { recursive: true, force: true })
  }
})

test("identify returns a stable path-free linked-worktree identity", () => {
  const fixture = createFixture()
  const first = identifyLinkedWorktree(fixture.worktree)
  const second = identifyLinkedWorktree(fixture.worktree)

  expect(first).toEqual(second)
  expect(first.worktree_id).toBe("linked-worktree")
  expect(first.ref).toBe("refs/heads/mission-branch")
  expect(first.generation).toMatch(/^[0-9a-f]{64}$/)
  expect(JSON.stringify(first)).not.toContain(fixture.root)
})

test("immutable owner removes only the exact pristine worktree and direct branch", () => {
  const fixture = createFixture()
  const identity = identifyLinkedWorktree(fixture.worktree)
  const ownerCommit = installOwnerTool(fixture.root)
  const producer = gitResult(fixture.root, [
    "show",
    `${ownerCommit}:modules/orchestration-ops/agent-workspace-manager/src/scripts/worktree-cleanup.ts`,
  ])
  expect(producer.exitCode).toBe(0)
  const cleanup = Bun.spawnSync([
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
  ], {
    cwd: fixture.root,
    stdin: producer.stdout,
    stdout: "pipe",
    stderr: "pipe",
  })
  const receipt = JSON.parse(cleanup.stdout.toString())

  expect(cleanup.exitCode).toBe(0)
  expect(receipt.status).toBe("completed")
  expect(receipt.worktree_removed).toBe(true)
  expect(receipt.local_branch_deleted).toBe(true)
  expect(JSON.stringify(receipt)).not.toContain(fixture.root)
  expect(existsSync(fixture.worktree)).toBe(false)
  expect(gitResult(fixture.root, ["show-ref", "--verify", identity.ref!]).exitCode).not.toBe(0)
})

test("generation, head, and ref drift all preserve the target", () => {
  for (const drift of ["generation", "head", "ref"] as const) {
    const fixture = createFixture()
    const identity = identifyLinkedWorktree(fixture.worktree)
    const ownerCommit = git(fixture.root, ["rev-parse", "HEAD"])
    if (drift === "head") {
      writeFileSync(join(fixture.worktree, "tracked.txt"), "changed\n")
      git(fixture.worktree, ["commit", "-qam", "drift"])
    }
    if (drift === "ref") {
      git(fixture.worktree, ["switch", "-q", "-c", "different-branch"])
    }
    const receipt = removeOwnedWorktree({
      repositoryCwd: fixture.root,
      ownerCommit,
      worktreeId: identity.worktree_id,
      expectedGeneration: drift === "generation" ? "0".repeat(64) : identity.generation,
      expectedHead: identity.head,
      expectedRef: identity.ref,
    })

    expect(receipt.status).toBe("failed")
    expect(receipt.worktree_removed).toBe(false)
    expect(existsSync(fixture.worktree)).toBe(true)
  }
})

test("tracked, untracked, and ignored residue all preserve the target", () => {
  for (const residue of ["tracked", "untracked", "ignored"] as const) {
    const fixture = createFixture()
    const identity = identifyLinkedWorktree(fixture.worktree)
    const ownerCommit = git(fixture.root, ["rev-parse", "HEAD"])
    if (residue === "tracked") {
      writeFileSync(join(fixture.worktree, "tracked.txt"), "dirty\n")
    } else if (residue === "untracked") {
      writeFileSync(join(fixture.worktree, "untracked.txt"), "preserve\n")
    } else {
      writeFileSync(join(fixture.root, ".git", "info", "exclude"), "ignored.tmp\n")
      writeFileSync(join(fixture.worktree, "ignored.tmp"), "preserve\n")
    }
    const receipt = removeOwnedWorktree({
      repositoryCwd: fixture.root,
      ownerCommit,
      worktreeId: identity.worktree_id,
      expectedGeneration: identity.generation,
      expectedHead: identity.head,
      expectedRef: identity.ref,
    })

    expect(receipt.status).toBe("failed")
    expect(receipt.reason_code).toBe("worktree_not_pristine")
    expect(receipt.worktree_removed).toBe(false)
    expect(existsSync(fixture.worktree)).toBe(true)
  }
})

test("index hints never hide tracked residue from cleanup", () => {
  const fixture = createFixture()
  const identity = identifyLinkedWorktree(fixture.worktree)
  git(fixture.worktree, ["update-index", "--assume-unchanged", "tracked.txt"])
  writeFileSync(join(fixture.worktree, "tracked.txt"), "hidden change\n")
  const receipt = removeOwnedWorktree({
    repositoryCwd: fixture.root,
    ownerCommit: git(fixture.root, ["rev-parse", "HEAD"]),
    worktreeId: identity.worktree_id,
    expectedGeneration: identity.generation,
    expectedHead: identity.head,
    expectedRef: identity.ref,
  })

  expect(receipt.reason_code).toBe("worktree_index_hints_present")
  expect(receipt.worktree_removed).toBe(false)
  expect(readFileSync(join(fixture.worktree, "tracked.txt"), "utf8")).toBe("hidden change\n")
})

test("an ignored nested worktree is preserved without special ownership discovery", () => {
  const fixture = createFixture()
  writeFileSync(join(fixture.root, ".git", "info", "exclude"), "ignored.tmp/\n")
  const nested = join(fixture.worktree, "ignored.tmp")
  git(fixture.root, ["worktree", "add", "-qb", "nested-branch", nested])
  writeFileSync(join(nested, "payload.txt"), "preserve\n")
  const identity = identifyLinkedWorktree(fixture.worktree)
  const receipt = removeOwnedWorktree({
    repositoryCwd: fixture.root,
    ownerCommit: git(fixture.root, ["rev-parse", "HEAD"]),
    worktreeId: identity.worktree_id,
    expectedGeneration: identity.generation,
    expectedHead: identity.head,
    expectedRef: identity.ref,
  })

  expect(receipt.reason_code).toBe("worktree_not_pristine")
  expect(receipt.worktree_removed).toBe(false)
  expect(readFileSync(join(nested, "payload.txt"), "utf8")).toBe("preserve\n")
})

if (process.platform === "linux" && canBindMount()) {
  test("a bind-aliased ignored nested worktree is preserved", () => {
    const fixture = createFixture()
    const alias = join(fixture.root, "alias")
    const nestedAlias = join(alias, "ignored.tmp")
    const physicalNested = join(fixture.worktree, "ignored.tmp")
    mkdirSync(alias)
    git(fixture.root, ["mount", "--bind", fixture.worktree, alias])
    try {
      writeFileSync(join(fixture.root, ".git", "info", "exclude"), "ignored.tmp/\n")
      git(fixture.root, ["git", "worktree", "add", "-qb", "nested-branch", nestedAlias])
      writeFileSync(join(physicalNested, "payload.txt"), "preserve\n")
      const identity = identifyLinkedWorktree(fixture.worktree)
      const receipt = removeOwnedWorktree({
        repositoryCwd: fixture.root,
        ownerCommit: git(fixture.root, ["rev-parse", "HEAD"]),
        worktreeId: identity.worktree_id,
        expectedGeneration: identity.generation,
        expectedHead: identity.head,
        expectedRef: identity.ref,
      })

      expect(receipt.reason_code).toBe("worktree_not_pristine")
      expect(receipt.worktree_removed).toBe(false)
      expect(readFileSync(join(physicalNested, "payload.txt"), "utf8")).toBe("preserve\n")
    } finally {
      gitResult(fixture.root, ["git", "worktree", "remove", "--force", "--", nestedAlias])
      gitResult(fixture.root, ["umount", alias])
    }
  })
}

test("detached pristine worktrees are removed without deleting a branch", () => {
  const fixture = createFixture()
  git(fixture.root, ["worktree", "remove", "--", fixture.worktree])
  git(fixture.root, ["branch", "-D", "mission-branch"])
  git(fixture.root, ["worktree", "add", "-q", "--detach", fixture.worktree, "HEAD"])
  const identity = identifyLinkedWorktree(fixture.worktree)
  const receipt = removeOwnedWorktree({
    repositoryCwd: fixture.root,
    ownerCommit: git(fixture.root, ["rev-parse", "HEAD"]),
    worktreeId: identity.worktree_id,
    expectedGeneration: identity.generation,
    expectedHead: identity.head,
    expectedRef: null,
  })

  expect(receipt.status).toBe("completed")
  expect(receipt.worktree_removed).toBe(true)
  expect(receipt.local_branch_deleted).toBe(false)
})

test("receipts retain Git-valid ref characters after authoritative validation", () => {
  const fixture = createFixture()
  git(fixture.worktree, ["branch", "-m", "evaluator@target"])
  const identity = identifyLinkedWorktree(fixture.worktree)
  const receipt = removeOwnedWorktree({
    repositoryCwd: fixture.root,
    ownerCommit: git(fixture.root, ["rev-parse", "HEAD"]),
    worktreeId: identity.worktree_id,
    expectedGeneration: identity.generation,
    expectedHead: identity.head,
    expectedRef: identity.ref,
  })

  expect(receipt.status).toBe("completed")
  expect(receipt.expected_ref).toBe("refs/heads/evaluator@target")
  expect(receipt.observed_ref).toBe("refs/heads/evaluator@target")
})

function createFixture(): { root: string; worktree: string } {
  const root = mkdtempSync(join(tmpdir(), "trade-cleanup-"))
  fixtures.push(root)
  git(root, ["init", "-q"])
  git(root, ["config", "user.name", "test"])
  git(root, ["config", "user.email", "test@example.com"])
  writeFileSync(join(root, "tracked.txt"), "base\n")
  git(root, ["add", "tracked.txt"])
  git(root, ["commit", "-qm", "base"])
  const worktree = join(root, "linked-worktree")
  git(root, ["worktree", "add", "-qb", "mission-branch", worktree])
  return { root, worktree }
}

function installOwnerTool(root: string): string {
  const target = join(
    root,
    "modules/orchestration-ops/agent-workspace-manager/src/scripts/worktree-cleanup.ts",
  )
  mkdirSync(dirname(target), { recursive: true })
  writeFileSync(target, readFileSync(join(import.meta.dir, "../scripts/worktree-cleanup.ts")))
  git(root, ["add", target])
  git(root, ["commit", "-qm", "owner tool"])
  return git(root, ["rev-parse", "HEAD"])
}

function canBindMount(): boolean {
  if (process.geteuid?.() !== 0) return false
  const root = mkdtempSync(join(tmpdir(), "trade-mount-check-"))
  fixtures.push(root)
  const source = join(root, "source")
  const target = join(root, "target")
  mkdirSync(source)
  mkdirSync(target)
  const mounted = Bun.spawnSync(["mount", "--bind", source, target], {
    stdout: "ignore",
    stderr: "ignore",
  }).exitCode === 0
  if (mounted) Bun.spawnSync(["umount", target])
  return mounted
}

function git(cwd: string, arguments_: string[]): string {
  const result = gitResult(cwd, arguments_)
  if (result.exitCode !== 0) {
    throw new Error(`${arguments_.join(" ")}\n${result.stderr.toString()}`)
  }
  return result.stdout.toString().trim()
}

function gitResult(cwd: string, arguments_: string[]): CommandResult {
  const command = arguments_[0] === "git" || arguments_[0] === "mount" || arguments_[0] === "umount"
    ? arguments_
    : ["git", "-C", cwd, ...arguments_]
  const result = Bun.spawnSync(command, {
    cwd,
    stdout: "pipe",
    stderr: "pipe",
  })
  return {
    exitCode: result.exitCode,
    stdout: result.stdout,
    stderr: result.stderr,
  }
}
