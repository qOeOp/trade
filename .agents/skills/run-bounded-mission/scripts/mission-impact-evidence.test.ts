import { afterEach, expect, test } from "bun:test"
import { createHash } from "node:crypto"
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"

interface EvidenceReport {
  schema_version: string
  analysis_status: string
  range: {
    commit_count: number
    head_reachable_refs: string[]
    source_ref: string
    source_ref_tip: string
    head_matches_source_ref_tip: boolean
  }
  workspace: {
    head: string
    head_matches_range: boolean
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
  limits: string[]
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

test("unreachable heads remain explicit immutable deferral facts", () => {
  const fixture = repositoryFixture(false)
  writeFileSync(join(fixture.root, "workspace/alpha/src/index.ts"), "export const value = 2\n")
  const head = commit(fixture.root, "reachable head")

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

test("overrides hostile caller Git settings for bootstrap and every Git wrapper", () => {
  const fixture = repositoryFixture(true)
  writeFileSync(join(fixture.root, "workspace/alpha/src/index.ts"), "export const value = 2\n")
  const head = commit(fixture.root, "candidate")
  const fakeRoot = mkdtempSync(join(tmpdir(), "mission-impact-fake-git-"))
  roots.push(fakeRoot)
  const fakeGit = join(fakeRoot, "git")
  const observed = join(fakeRoot, "observed.txt")
  writeFileSync(fakeGit, [
    "#!/bin/sh",
    `printf '%s\\t%s\\t%s\\t' "$GIT_NO_LAZY_FETCH" "$GIT_TERMINAL_PROMPT" "$GIT_OPTIONAL_LOCKS" >> ${shellQuote(observed)}`,
    `printf '%s ' "$@" >> ${shellQuote(observed)}`,
    `printf '\\n' >> ${shellQuote(observed)}`,
    'exec "$REAL_GIT" "$@"',
    "",
  ].join("\n"))
  chmodSync(fakeGit, 0o755)

  const result = helperProcess(fixture.root, fixture.base, head, ["workspace/alpha", "workspace/beta"], {
    PATH: `${fakeRoot}:${process.env.PATH ?? ""}`,
    REAL_GIT: Bun.which("git")!,
    GIT_NO_LAZY_FETCH: "0",
    GIT_TERMINAL_PROMPT: "1",
    GIT_OPTIONAL_LOCKS: "1",
  })
  expect(result.exitCode).toBe(0)
  const observations = readFileSync(observed, "utf8").trim().split("\n")
  expect(observations.length).toBeGreaterThan(10)
  for (const observation of observations) expect(observation).toStartWith("1\t0\t0\t")
  const commands = observations.map((observation) => observation.split("\t")[3].trim())
  expect(commands[0]).toBe("rev-parse --show-toplevel")
  for (const command of ["check-ref-format", "merge-base", "cat-file -e", "diff", "ls-tree", "show", "for-each-ref", "rev-list"]) {
    expect(commands.some((observedCommand) => observedCommand.includes(command))).toBe(true)
  }
  for (const command of commands) {
    expect(command).not.toMatch(/(^| )(?:status|diff-files|diff-index|ls-files)(?: |$)/)
    if (command.startsWith("diff ")) {
      expect(command).toContain(fixture.base)
      expect(command).toContain(head)
    }
  }
})

test("does not inspect worktree cleanliness or activate a configured fsmonitor", () => {
  const oracleRoot = mkdtempSync(join(tmpdir(), "mission-impact-fsmonitor-oracle-"))
  roots.push(oracleRoot)
  const repository = join(oracleRoot, "repository")
  const marker = join(oracleRoot, "fsmonitor.marker")
  const hook = join(oracleRoot, "fsmonitor-hook.sh")
  mkdirSync(repository)
  const fixture = repositoryFixture(false, repository)
  writeFileSync(hook, [
    "#!/bin/sh",
    `printf invoked > ${shellQuote(marker)}`,
    "exit 0",
    "",
  ].join("\n"))
  chmodSync(hook, 0o755)
  git(repository, ["config", "core.fsmonitor", hook])

  expect(existsSync(marker)).toBe(false)
  gitWithEnvironment(repository, ["status", "--porcelain=v1"], hardenedGitEnvironment())
  expect(existsSync(marker)).toBe(true)
  rmSync(marker, { force: true })

  const original = "export const value = 1\n"
  const outputs: string[] = []
  const runState = () => {
    const before = indexHash(repository)
    const result = helperProcess(repository, fixture.base, fixture.base, ["workspace/alpha", "workspace/beta"])
    expect(result.exitCode).toBe(0)
    const report = JSON.parse(result.stdout) as EvidenceReport
    expect(report).toMatchObject({
      schema_version: "bounded-mission.impact-evidence.v2",
      workspace: { head: fixture.base, head_matches_range: true },
    })
    expect(report.workspace).not.toHaveProperty("clean")
    expect(report.reasons.map((reason) => reason.kind)).not.toContain("head-worktree-dirty")
    expect(report.limits).toContain(
      "Working-tree files and cleanliness are intentionally not inspected; the caller must bind the immutable range to the canonical source tip.",
    )
    expect(existsSync(marker)).toBe(false)
    expect(indexHash(repository)).toBe(before)
    outputs.push(result.stdout)
  }

  runState()
  writeFileSync(join(repository, "workspace/alpha/src/index.ts"), "export const value = 20000\n")
  runState()
  writeFileSync(join(repository, "workspace/alpha/src/index.ts"), original)
  runState()
  writeFileSync(join(repository, "untracked.txt"), "untracked\n")
  runState()
  expect(new Set(outputs).size).toBe(1)
})

test("does not inspect worktree cleanliness or activate a configured clean filter", () => {
  const oracleRoot = mkdtempSync(join(tmpdir(), "mission-impact-clean-filter-oracle-"))
  roots.push(oracleRoot)
  const repository = join(oracleRoot, "repository")
  const marker = join(oracleRoot, "clean-filter.marker")
  const filter = join(oracleRoot, "clean-filter.sh")
  mkdirSync(repository)
  git(repository, ["init", "-b", "main"])
  git(repository, ["config", "user.name", "Fixture"])
  git(repository, ["config", "user.email", "fixture@example.com"])
  mkdirSync(join(repository, "workspace/alpha/src"), { recursive: true })
  writeFileSync(join(repository, ".gitattributes"), "workspace/alpha/src/danger.txt filter=danger\n")
  writeFileSync(join(repository, "workspace/alpha/src/danger.txt"), "safe\n")
  const base = commit(repository, "base")
  writeFileSync(filter, [
    "#!/bin/sh",
    `printf invoked > ${shellQuote(marker)}`,
    "cat",
    "",
  ].join("\n"))
  chmodSync(filter, 0o755)
  git(repository, ["config", "filter.danger.clean", filter])
  const indexedObject = git(repository, ["rev-parse", `${base}:workspace/alpha/src/danger.txt`]).trim()
  git(repository, [
    "update-index",
    "--cacheinfo",
    `100644,${indexedObject},workspace/alpha/src/danger.txt`,
  ])
  writeFileSync(join(repository, "workspace/alpha/src/danger.txt"), "dangerously different and longer\n")
  expect(readFileSync(join(repository, "workspace/alpha/src/danger.txt")).length).not.toBe("safe\n".length)

  expect(existsSync(marker)).toBe(false)
  gitWithEnvironment(
    repository,
    ["-c", "core.fsmonitor=false", "status", "--porcelain=v1"],
    hardenedGitEnvironment(),
  )
  expect(existsSync(marker)).toBe(true)
  rmSync(marker, { force: true })

  const before = indexHash(repository)
  const result = helperProcess(repository, base, base, ["workspace/alpha"])
  expect(result.exitCode).toBe(0)
  const report = JSON.parse(result.stdout) as EvidenceReport
  expect(report).toMatchObject({
    schema_version: "bounded-mission.impact-evidence.v2",
    workspace: { head: base, head_matches_range: true },
  })
  expect(report.workspace).not.toHaveProperty("clean")
  expect(report.reasons.map((reason) => reason.kind)).not.toContain("head-worktree-dirty")
  expect(existsSync(marker)).toBe(false)
  expect(indexHash(repository)).toBe(before)
})

function repositoryFixture(withDependent: boolean, existingRoot?: string): { root: string; base: string } {
  const root = existingRoot ?? mkdtempSync(join(tmpdir(), "mission-impact-evidence-"))
  if (!existingRoot) roots.push(root)
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
  environment: Record<string, string> = {},
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
    env: { ...process.env, ...environment },
    stdout: "pipe",
    stderr: "pipe",
  })
  return {
    exitCode: result.exitCode,
    stdout: result.stdout.toString(),
    stderr: result.stderr.toString(),
  }
}

function indexHash(root: string): string {
  return createHash("sha256").update(readFileSync(join(root, ".git/index"))).digest("hex")
}

function hardenedGitEnvironment(): Record<string, string> {
  return {
    GIT_NO_LAZY_FETCH: "1",
    GIT_TERMINAL_PROMPT: "0",
    GIT_OPTIONAL_LOCKS: "0",
  }
}

function gitWithEnvironment(root: string, args: string[], environment: Record<string, string>): string {
  const result = Bun.spawnSync(["git", ...args], {
    cwd: root,
    env: { ...process.env, ...environment },
    stdout: "pipe",
    stderr: "pipe",
  })
  if (result.exitCode !== 0) throw new Error(result.stderr.toString())
  return result.stdout.toString()
}

function shellQuote(value: string): string {
  return `'${value.replaceAll("'", `'\\''`)}'`
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
