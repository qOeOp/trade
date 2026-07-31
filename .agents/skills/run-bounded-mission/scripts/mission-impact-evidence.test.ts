import { afterEach, expect, test } from "bun:test"
import { createHash } from "node:crypto"
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"

interface EvidenceReport {
  analysis_status: string
  range: {
    commit_count: number
    head_reachable_refs: string[]
    source_ref: string
    source_ref_tip: string
    head_matches_source_ref_tip: boolean
  }
  workspace: {
    clean: boolean
  }
  facts: {
    changed_paths: Array<{ path: string; owner: { id: string } | null }>
    owners: Array<{ id: string }>
    unowned_paths: string[]
    direct_dependents: Array<{
      source_path: string
      source_owner: { id: string }
      target_owner: { id: string }
      specifier: string
      import_kind: string
      evidence: string
    }>
  }
  reasons: Array<{ kind: string }>
  refactor_decision: null
}

const helper = resolve(import.meta.dir, "mission-impact-evidence.ts")
const roots: string[] = []

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

test("single-owner diff maps the canonical owner without inferring structural pressure", () => {
  const fixture = repositoryFixture(true)
  writeFileSync(join(fixture.root, "workspace/alpha/src/index.ts"), "export const value = 2\n")
  const head = commit(fixture.root, "mission a")
  const report = runHelper(fixture.root, fixture.base, head)

  expect(report.facts.owners.map((owner) => owner.id)).toEqual(["workspace/alpha"])
  expect(report.facts.direct_dependents).toEqual([{
    source_path: "workspace/beta/src/index.ts",
    source_owner: expect.any(Object),
    target_owner: expect.objectContaining({ id: "workspace/alpha" }),
    specifier: "../../alpha/src/index",
    import_kind: "import-statement",
    evidence: "static-relative-production-import",
  }])
  expect(report.reasons).toEqual([])
  expect(report.refactor_decision).toBeNull()
})

test("help and repository failures remain portable outside a Git checkout", () => {
  const root = mkdtempSync(join(tmpdir(), "mission-impact-help-"))
  roots.push(root)
  const help = Bun.spawnSync(["bun", helper, "--help"], {
    cwd: root,
    stdout: "pipe",
    stderr: "pipe",
  })
  expect(help.exitCode).toBe(0)
  expect(help.stdout.toString()).toContain("Usage: mission-impact-evidence.ts")

  const failure = Bun.spawnSync([
    "bun",
    helper,
    "--base",
    "1".repeat(40),
    "--head",
    "2".repeat(40),
    "--source-ref",
    "refs/heads/main",
    "--owner-root",
    "workspace/alpha",
  ], {
    cwd: root,
    stdout: "pipe",
    stderr: "pipe",
  })
  expect(failure.exitCode).not.toBe(0)
  expect(failure.stderr.toString()).not.toContain(root)
  expect(failure.stderr.toString()).not.toContain(helper)
})

test("an explicit base-head range spans accepted changes and reports an evidenced owner relation", () => {
  const fixture = repositoryFixture(true)
  writeFileSync(join(fixture.root, "workspace/alpha/src/index.ts"), "export const value = 2\n")
  commit(fixture.root, "mission a")
  writeFileSync(
    join(fixture.root, "workspace/beta/src/index.ts"),
    'import { value } from "../../alpha/src/index"\nexport const result = value + 1\n',
  )
  const head = commit(fixture.root, "mission b")
  const report = runHelper(fixture.root, fixture.base, head)

  expect(report.range.commit_count).toBe(2)
  expect(report.facts.owners.map((owner) => owner.id)).toEqual([
    "workspace/alpha",
    "workspace/beta",
  ])
  expect(report.reasons.map((reason) => reason.kind)).toEqual(["changed-owner-direct-dependency"])
})

test("unassigned paths are reported instead of being forced into an owner", () => {
  const fixture = repositoryFixture(false)
  writeFileSync(join(fixture.root, "unowned.txt"), "outside canonical owner data\n")
  const head = commit(fixture.root, "unowned path")
  const report = runHelper(fixture.root, fixture.base, head)

  expect(report.facts.unowned_paths).toEqual(["unowned.txt"])
  expect(report.facts.changed_paths[0]).toMatchObject({ path: "unowned.txt", owner: null })
})

test("paths absent from caller-provided owner roots remain unowned", () => {
  const fixture = repositoryFixture(false)
  mkdirSync(join(fixture.root, "vendor/ghost"), { recursive: true })
  writeFileSync(join(fixture.root, "vendor/ghost/package.json"), '{"name":"ghost"}\n')
  const head = commit(fixture.root, "unregistered path")
  const report = runHelper(fixture.root, fixture.base, head)

  expect(report.facts.unowned_paths).toEqual(["vendor/ghost/package.json"])
  expect(report.facts.changed_paths[0]).toMatchObject({
    path: "vendor/ghost/package.json",
    owner: null,
  })

  const invalid = helperProcess(fixture.root, fixture.base, head, ["../escape"])
  expect(invalid.exitCode).not.toBe(0)
  expect(invalid.stderr).toContain("normalized repository-relative path")

  const missing = helperProcess(fixture.root, fixture.base, head, ["workspace/missing"])
  expect(missing.exitCode).not.toBe(0)
  expect(missing.stderr).toContain("does not exist at base or head")
})

test("churn-only evidence produces facts and no refactor conclusion", () => {
  const fixture = repositoryFixture(false)
  writeFileSync(
    join(fixture.root, "workspace/alpha/src/index.ts"),
    Array.from({ length: 80 }, (_, index) => `export const value${index} = ${index}`).join("\n") + "\n",
  )
  const head = commit(fixture.root, "large local edit")
  const report = runHelper(fixture.root, fixture.base, head)

  expect(report.analysis_status).toBe("facts-only")
  expect(report.reasons).toEqual([])
  expect(report.refactor_decision).toBeNull()
})

test("dirty and unreachable heads are explicit deferral facts", () => {
  const fixture = repositoryFixture(false)
  writeFileSync(join(fixture.root, "workspace/alpha/src/index.ts"), "export const value = 2\n")
  const head = commit(fixture.root, "reachable head")
  writeFileSync(join(fixture.root, "scratch.tmp"), "untracked evidence\n")
  const before = workspaceSnapshot(fixture.root)
  const dirty = runHelper(fixture.root, fixture.base, head)
  const after = workspaceSnapshot(fixture.root)

  expect(dirty.workspace.clean).toBe(false)
  expect(dirty.reasons.map((reason) => reason.kind)).toContain("head-worktree-dirty")
  expect(after).toEqual(before)

  const tree = git(fixture.root, ["rev-parse", `${head}^{tree}`]).trim()
  const unreachable = git(fixture.root, ["commit-tree", tree, "-p", head, "-m", "detached candidate"]).trim()
  const detached = runHelper(fixture.root, head, unreachable)
  expect(detached.range.head_reachable_refs).toEqual([])
  expect(detached.reasons.map((reason) => reason.kind)).toContain("head-not-reachable")
  expect(detached.reasons.map((reason) => reason.kind)).toContain("head-not-source-ref-tip")
})

test("a reachable old head is stale after its declared source ref advances", () => {
  const fixture = repositoryFixture(false)
  writeFileSync(join(fixture.root, "workspace/alpha/src/index.ts"), "export const value = 2\n")
  const integratedHead = commit(fixture.root, "integrated missions")
  writeFileSync(join(fixture.root, "later.txt"), "later integration\n")
  const currentTip = commit(fixture.root, "later integration")
  const report = runHelper(fixture.root, fixture.base, integratedHead)

  expect(report.range.head_reachable_refs).toContain("refs/heads/main")
  expect(report.range.source_ref).toBe("refs/heads/main")
  expect(report.range.source_ref_tip).toBe(currentTip)
  expect(report.range.head_matches_source_ref_tip).toBe(false)
  expect(report.reasons.map((reason) => reason.kind)).toContain("head-not-source-ref-tip")
})

function repositoryFixture(withDependent: boolean): { root: string; base: string } {
  const root = mkdtempSync(join(tmpdir(), "mission-impact-evidence-"))
  roots.push(root)
  git(root, ["init", "-b", "main"])
  git(root, ["config", "user.name", "Fixture"])
  git(root, ["config", "user.email", "fixture@example.com"])
  mkdirSync(join(root, "workspace/alpha/src"), { recursive: true })
  mkdirSync(join(root, "workspace/beta/src"), { recursive: true })
  writeFileSync(join(root, "workspace/alpha/src/index.ts"), "export const value = 1\n")
  writeFileSync(
    join(root, "workspace/beta/src/index.ts"),
    withDependent
      ? '#!/usr/bin/env bun\nimport { value } from "../../alpha/src/index"\nexport const result = value\n'
      : "export const result = 1\n",
  )
  return { root, base: commit(root, "base") }
}

function commit(root: string, message: string): string {
  git(root, ["add", "."])
  git(root, ["commit", "-m", message])
  return git(root, ["rev-parse", "HEAD"]).trim()
}

function runHelper(root: string, base: string, head: string): EvidenceReport {
  const result = helperProcess(root, base, head, ["workspace/alpha", "workspace/beta"])
  if (result.exitCode !== 0) {
    throw new Error(`helper failed (${result.exitCode}): ${result.stderr}`)
  }
  return JSON.parse(result.stdout) as EvidenceReport
}

function helperProcess(
  root: string,
  base: string,
  head: string,
  ownerRoots: string[],
): { exitCode: number; stdout: string; stderr: string } {
  const result = Bun.spawnSync([
    "bun",
    helper,
    "--base",
    base,
    "--head",
    head,
    "--source-ref",
    "refs/heads/main",
    ...ownerRoots.flatMap((ownerRoot) => ["--owner-root", ownerRoot]),
  ], {
    cwd: root,
    stdout: "pipe",
    stderr: "pipe",
  })
  return {
    exitCode: result.exitCode,
    stdout: result.stdout.toString(),
    stderr: result.stderr.toString(),
  }
}

function workspaceSnapshot(root: string): { status: string; files: Record<string, string> } {
  const tracked = git(root, ["ls-files", "-z"]).split("\0").filter(Boolean)
  const untracked = git(root, ["ls-files", "--others", "--exclude-standard", "-z"]).split("\0").filter(Boolean)
  const files: Record<string, string> = {}
  for (const path of [...new Set([...tracked, ...untracked])].sort()) {
    files[path] = createHash("sha256").update(readFileSync(join(root, path))).digest("hex")
  }
  return {
    status: git(root, ["status", "--porcelain=v1", "--untracked-files=all"]),
    files,
  }
}

function git(root: string, args: string[]): string {
  const result = Bun.spawnSync(["git", ...args], {
    cwd: root,
    stdout: "pipe",
    stderr: "pipe",
  })
  if (result.exitCode !== 0) {
    throw new Error(`git ${args.join(" ")} failed (${result.exitCode}): ${result.stderr.toString()}`)
  }
  return result.stdout.toString()
}
