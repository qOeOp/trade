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
    direct_dependents: Array<{ source_path: string; target_owner: { id: string } }>
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
  writeFileSync(join(fixture.root, "modules/domain-a/owner-a/src/index.ts"), "export const value = 2\n")
  const head = commit(fixture.root, "mission a")
  const report = runHelper(fixture.root, fixture.base, head)

  expect(report.facts.owners.map((owner) => owner.id)).toEqual(["modules/domain-a/owner-a"])
  expect(report.facts.direct_dependents).toEqual([{
    source_path: "modules/domain-b/owner-b/src/index.ts",
    source_owner: expect.any(Object),
    target_owner: expect.objectContaining({ id: "modules/domain-a/owner-a" }),
    specifier: "../../../domain-a/owner-a/src/index",
    import_kind: "import-statement",
    evidence: "static-relative-production-import",
  }])
  expect(report.reasons).toEqual([])
  expect(report.refactor_decision).toBeNull()
})

test("an explicit base-head range spans accepted changes and reports an evidenced owner relation", () => {
  const fixture = repositoryFixture(true)
  writeFileSync(join(fixture.root, "modules/domain-a/owner-a/src/index.ts"), "export const value = 2\n")
  commit(fixture.root, "mission a")
  writeFileSync(
    join(fixture.root, "modules/domain-b/owner-b/src/index.ts"),
    'import { value } from "../../../domain-a/owner-a/src/index"\nexport const result = value + 1\n',
  )
  const head = commit(fixture.root, "mission b")
  const report = runHelper(fixture.root, fixture.base, head)

  expect(report.range.commit_count).toBe(2)
  expect(report.facts.owners.map((owner) => owner.id)).toEqual([
    "modules/domain-a/owner-a",
    "modules/domain-b/owner-b",
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

test("contract packages absent from canonical owner data remain unowned", () => {
  const fixture = repositoryFixture(false)
  mkdirSync(join(fixture.root, "modules/contracts/ghost"), { recursive: true })
  writeFileSync(join(fixture.root, "modules/contracts/ghost/package.json"), '{"name":"ghost"}\n')
  const head = commit(fixture.root, "unregistered contract package")
  const report = runHelper(fixture.root, fixture.base, head)

  expect(report.facts.unowned_paths).toEqual(["modules/contracts/ghost/package.json"])
  expect(report.facts.changed_paths[0]).toMatchObject({
    path: "modules/contracts/ghost/package.json",
    owner: null,
  })
})

test("churn-only evidence produces facts and no refactor conclusion", () => {
  const fixture = repositoryFixture(false)
  writeFileSync(
    join(fixture.root, "modules/domain-a/owner-a/src/index.ts"),
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
  writeFileSync(join(fixture.root, "modules/domain-a/owner-a/src/index.ts"), "export const value = 2\n")
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
  writeFileSync(join(fixture.root, "modules/domain-a/owner-a/src/index.ts"), "export const value = 2\n")
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
  mkdirSync(join(root, "docs/architecture"), { recursive: true })
  mkdirSync(join(root, "docs/engineering"), { recursive: true })
  mkdirSync(join(root, "modules/domain-a/owner-a/src"), { recursive: true })
  mkdirSync(join(root, "modules/domain-b/owner-b/src"), { recursive: true })
  writeFileSync(join(root, "docs/architecture/architecture-manifest.json"), JSON.stringify({
    schema_version: "trade.architecture-manifest.v1",
    domains: [
      { id: "domain-a", modules: ["modules/domain-a/owner-a"] },
      { id: "domain-b", modules: ["modules/domain-b/owner-b"] },
    ],
    jobs: [],
    stores: [],
    rails: [],
  }))
  writeFileSync(join(root, "docs/engineering/doc-contract-index.json"), JSON.stringify({
    schema_version: "trade.doc-contract-index.v1",
    documents: [],
  }))
  writeFileSync(join(root, "modules/domain-a/owner-a/src/index.ts"), "export const value = 1\n")
  writeFileSync(
    join(root, "modules/domain-b/owner-b/src/index.ts"),
    withDependent
      ? '#!/usr/bin/env bun\nimport { value } from "../../../domain-a/owner-a/src/index"\nexport const result = value\n'
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
  const result = Bun.spawnSync([
    "bun",
    helper,
    "--base",
    base,
    "--head",
    head,
    "--source-ref",
    "refs/heads/main",
  ], {
    cwd: root,
    stdout: "pipe",
    stderr: "pipe",
  })
  if (result.exitCode !== 0) {
    throw new Error(`helper failed (${result.exitCode}): ${result.stderr.toString()}`)
  }
  return JSON.parse(result.stdout.toString()) as EvidenceReport
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
