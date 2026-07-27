import { afterEach, expect, test } from "bun:test"
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  utimesSync,
  writeFileSync,
} from "node:fs"
import { tmpdir } from "node:os"
import { basename, dirname, join } from "node:path"
import {
  createOwnedWorktree,
  refreshOwnedWorktree,
  removeOwnedWorktree,
  type WorktreeIdentity,
} from "../scripts/worktree-cleanup"

const fixtures: string[] = []

interface Fixture {
  root: string
  worktree: string
  ownerCommit: string
  identity: WorktreeIdentity
}

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

test("only the owner create operation mints cleanup provenance", () => {
  const fixture = createFixture()
  expect(fixture.identity.operation).toBe("create-linked-worktree")
  expect(fixture.identity.ref).toBe("refs/heads/mission-branch")
  expect(fixture.identity.generation).toMatch(/^[0-9a-f]{64}$/)
  expect(JSON.stringify(fixture.identity)).not.toContain(fixture.root)

  const unrelated = join(fixture.root, "unrelated")
  git(fixture.root, ["worktree", "add", "-qb", "unrelated-branch", unrelated])
  expect(() => refreshOwnedWorktree(unrelated)).toThrow("cleanup_ownership_missing")
  expect(() => createOwnedWorktree({
    repositoryCwd: fixture.root,
    worktreePath: unrelated,
    branchRef: "refs/heads/unrelated-branch",
    startPoint: fixture.ownerCommit,
  })).toThrow()
  expect(existsSync(unrelated)).toBe(true)
})

test("final refresh closes a writable mission before immutable owner removal", () => {
  const fixture = createFixture()
  writeFileSync(join(fixture.worktree, "tracked.txt"), "candidate\n")
  git(fixture.worktree, ["commit", "-qam", "candidate"])

  const stale = remove(fixture, fixture.identity)
  expect(stale.reason_code).toBe("worktree_head_drift")
  expect(stale.worktree_removed).toBe(false)

  const finalIdentity = refreshOwnedWorktree(fixture.worktree)
  expect(finalIdentity.generation).toBe(fixture.identity.generation)
  expect(finalIdentity.head).not.toBe(fixture.identity.head)
  const cleanup = runStreamedRemoval(fixture, finalIdentity)
  const receipt = JSON.parse(cleanup.stdout.toString())

  expect(cleanup.exitCode).toBe(0)
  expect(receipt.status).toBe("completed")
  expect(receipt.worktree_removed).toBe(true)
  expect(receipt.local_branch_deleted).toBe(true)
  expect(JSON.stringify(receipt)).not.toContain(fixture.root)
  expect(existsSync(fixture.worktree)).toBe(false)
})

test("wrong generation and ref drift preserve the owner-created target", () => {
  const generationFixture = createFixture()
  const wrongGeneration = remove(generationFixture, {
    ...generationFixture.identity,
    generation: "0".repeat(64),
  })
  expect(wrongGeneration.reason_code).toBe("worktree_generation_drift")
  expect(existsSync(generationFixture.worktree)).toBe(true)

  const refFixture = createFixture()
  git(refFixture.worktree, ["switch", "-qc", "different-branch"])
  expect(() => refreshOwnedWorktree(refFixture.worktree)).toThrow("worktree_ref_drift")
  const drift = remove(refFixture, refFixture.identity)
  expect(drift.reason_code).toBe("worktree_ref_drift")
  expect(existsSync(refFixture.worktree)).toBe(true)
})

test("tracked, untracked, and ignored residue all preserve the target", () => {
  for (const residue of ["tracked", "untracked", "ignored"] as const) {
    const fixture = createFixture()
    if (residue === "tracked") {
      writeFileSync(join(fixture.worktree, "tracked.txt"), "dirty\n")
    } else if (residue === "untracked") {
      writeFileSync(join(fixture.worktree, "untracked.txt"), "preserve\n")
    } else {
      writeFileSync(join(fixture.root, ".git", "info", "exclude"), "ignored.tmp\n")
      writeFileSync(join(fixture.worktree, "ignored.tmp"), "preserve\n")
    }
    const receipt = remove(fixture, fixture.identity)
    expect(receipt.reason_code).toBe("worktree_not_pristine")
    expect(receipt.worktree_removed).toBe(false)
    expect(existsSync(fixture.worktree)).toBe(true)
  }
})

test("tracked contents are hashed instead of trusting the index stat cache", () => {
  const fixture = createFixture()
  git(fixture.worktree, ["config", "core.trustctime", "false"])
  git(fixture.worktree, ["config", "core.checkStat", "minimal"])
  const tracked = join(fixture.worktree, "tracked.txt")
  const metadata = statSync(tracked)
  writeFileSync(tracked, "evil\n")
  utimesSync(tracked, metadata.atime, metadata.mtime)

  const receipt = remove(fixture, fixture.identity)
  expect(receipt.reason_code).toBe("worktree_not_pristine")
  expect(receipt.worktree_removed).toBe(false)
  expect(readFileSync(tracked, "utf8")).toBe("evil\n")
})

test("a live process using the worktree causes conservative refusal", async () => {
  const fixture = createFixture()
  const ready = join(fixture.root, "process.ready")
  const user = Bun.spawn([
    "/bin/sh",
    "-c",
    "cd \"$1\" && : > \"$2\" && exec sleep 30",
    "sh",
    fixture.worktree,
    ready,
  ], {
    cwd: fixture.root,
    stdout: "ignore",
    stderr: "ignore",
  })
  try {
    await waitForPath(ready)
    const receipt = remove(fixture, fixture.identity)
    expect(receipt.reason_code).toBe("target_in_use")
    expect(receipt.worktree_removed).toBe(false)
    expect(existsSync(fixture.worktree)).toBe(true)
  } finally {
    user.kill()
    await user.exited
  }
})

test("ignored nested worktrees and their payload are preserved", () => {
  const fixture = createFixture()
  writeFileSync(join(fixture.root, ".git", "info", "exclude"), "ignored.tmp/\n")
  const nested = join(fixture.worktree, "ignored.tmp")
  git(fixture.root, ["worktree", "add", "-qb", "nested-branch", nested])
  writeFileSync(join(nested, "payload.txt"), "preserve\n")

  const receipt = remove(fixture, fixture.identity)
  expect(receipt.reason_code).toBe("worktree_not_pristine")
  expect(receipt.worktree_removed).toBe(false)
  expect(readFileSync(join(nested, "payload.txt"), "utf8")).toBe("preserve\n")
})

test("registered submodules are preserved even when clean", () => {
  const fixture = createFixture()
  const source = createRepository("trade-cleanup-submodule-")
  git(fixture.worktree, [
    "-c",
    "protocol.file.allow=always",
    "submodule",
    "add",
    "-q",
    source,
    "dependency",
  ])
  git(fixture.worktree, ["commit", "-qam", "submodule"])
  const finalIdentity = refreshOwnedWorktree(fixture.worktree)

  const receipt = remove(fixture, finalIdentity)
  expect(receipt.reason_code).toBe("worktree_has_registered_submodules")
  expect(receipt.worktree_removed).toBe(false)
  expect(existsSync(fixture.worktree)).toBe(true)
})

test("Git-valid ref characters remain bound through create, refresh, and removal", () => {
  const fixture = createFixture("refs/heads/evaluator@target")
  const finalIdentity = refreshOwnedWorktree(fixture.worktree)
  const receipt = remove(fixture, finalIdentity)

  expect(receipt.status).toBe("completed")
  expect(receipt.expected_ref).toBe("refs/heads/evaluator@target")
  expect(receipt.observed_ref).toBe("refs/heads/evaluator@target")
  expect(receipt.local_branch_deleted).toBe(true)
})

function createFixture(branchRef = "refs/heads/mission-branch"): Fixture {
  const root = createRepository("trade-cleanup-")
  const ownerCommit = installOwnerTool(root)
  const worktree = join(root, "linked-worktree")
  const identity = createOwnedWorktree({
    repositoryCwd: root,
    worktreePath: worktree,
    branchRef,
    startPoint: ownerCommit,
  })
  return { root, worktree, ownerCommit, identity }
}

function createRepository(prefix: string): string {
  const root = mkdtempSync(join(tmpdir(), prefix))
  fixtures.push(root)
  git(root, ["init", "-q"])
  git(root, ["config", "user.name", "test"])
  git(root, ["config", "user.email", "test@example.com"])
  writeFileSync(join(root, "tracked.txt"), "base\n")
  git(root, ["add", "tracked.txt"])
  git(root, ["commit", "-qm", "base"])
  return root
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

function remove(fixture: Fixture, identity: WorktreeIdentity) {
  return removeOwnedWorktree({
    repositoryCwd: fixture.root,
    ownerCommit: fixture.ownerCommit,
    worktreeId: identity.worktree_id,
    expectedGeneration: identity.generation,
    expectedHead: identity.head,
    expectedRef: identity.ref,
  })
}

function runStreamedRemoval(fixture: Fixture, identity: WorktreeIdentity): CommandResult {
  const producer = gitResult(fixture.root, [
    "show",
    `${fixture.ownerCommit}:modules/orchestration-ops/agent-workspace-manager/src/scripts/worktree-cleanup.ts`,
  ])
  if (producer.exitCode !== 0) throw new Error(producer.stderr.toString())
  const result = Bun.spawnSync([
    "bun",
    "run",
    "-",
    "remove",
    "--owner-commit",
    fixture.ownerCommit,
    "--worktree-id",
    identity.worktree_id,
    "--expected-generation",
    identity.generation,
    "--expected-head",
    identity.head,
    "--expected-ref",
    identity.ref,
  ], {
    cwd: fixture.root,
    stdin: producer.stdout,
    stdout: "pipe",
    stderr: "pipe",
  })
  return { exitCode: result.exitCode, stdout: result.stdout, stderr: result.stderr }
}

async function waitForPath(path: string): Promise<void> {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    if (existsSync(path)) return
    await Bun.sleep(10)
  }
  throw new Error(`fixture did not become ready: ${basename(path)}`)
}

function git(cwd: string, arguments_: string[]): string {
  const result = gitResult(cwd, arguments_)
  if (result.exitCode !== 0) {
    throw new Error(`${arguments_.join(" ")}\n${result.stderr.toString()}`)
  }
  return result.stdout.toString().trim()
}

function gitResult(cwd: string, arguments_: string[]): CommandResult {
  const result = Bun.spawnSync(["git", "-C", cwd, ...arguments_], {
    cwd,
    stdout: "pipe",
    stderr: "pipe",
  })
  return { exitCode: result.exitCode, stdout: result.stdout, stderr: result.stderr }
}
