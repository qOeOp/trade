#!/usr/bin/env bun

import { execFileSync } from "node:child_process"
import { posix } from "node:path"

interface Owner {
  id: string
}

interface OwnerRegistry {
  roots: Array<{ path: string; owner: Owner }>
}

interface Arguments {
  base: string
  head: string
  sourceRef: string
  ownerRoots: string[]
}

interface ChangedPath {
  status: string
  path: string
  owner: Owner | null
}

interface DirectDependent {
  source_path: string
  source_owner: Owner
  target_owner: Owner
  specifier: string
  import_kind: string
  evidence: "static-relative-production-import"
}

interface Reason {
  kind: "changed-owner-direct-dependency" | "head-not-reachable" | "head-not-source-ref-tip" | "head-worktree-dirty"
  detail: string
  evidence: string[]
}

const invocationDirectory = process.cwd()
let root = invocationDirectory
const gitEnvironment = Object.freeze({
  ...process.env,
  GIT_NO_LAZY_FETCH: "1",
  GIT_TERMINAL_PROMPT: "0",
  GIT_OPTIONAL_LOCKS: "0",
})

function main(): void {
  const args = parseArguments(process.argv.slice(2))
  root = execFileSync("git", ["rev-parse", "--show-toplevel"], {
    cwd: invocationDirectory,
    encoding: "utf8",
    env: gitEnvironment,
    stdio: ["ignore", "pipe", "pipe"],
  }).trim()
  const base = immutableCommit(args.base)
  const head = immutableCommit(args.head)
  const sourceRef = repositoryRef(args.sourceRef)
  const baseIsAncestor = gitStatus(["merge-base", "--is-ancestor", base, head]) === 0
  if (!baseIsAncestor) throw new Error("--base must be an ancestor of --head")
  for (const ownerRoot of args.ownerRoots) {
    const existsAtBase = gitStatus(["cat-file", "-e", `${base}:${ownerRoot}`]) === 0
    const existsAtHead = gitStatus(["cat-file", "-e", `${head}:${ownerRoot}`]) === 0
    if (!existsAtBase && !existsAtHead) {
      throw new Error(`--owner-root does not exist at base or head: ${ownerRoot}`)
    }
  }

  const registry = ownerRegistry(args.ownerRoots)
  const changedPaths = readChangedPaths(base, head, registry)
  const changedOwners = uniqueOwners(changedPaths.flatMap((item) => item.owner ? [item.owner] : []))
  const changedOwnerIds = new Set(changedOwners.map(ownerKey))
  const directDependents = readDirectDependents(head, registry, changedOwnerIds)
  const reachableRefs = lines(git([
    "for-each-ref",
    `--contains=${head}`,
    "--format=%(refname)",
    "refs/heads",
    "refs/remotes",
    "refs/tags",
  ]))
  const workspaceHead = immutableCommit(git(["rev-parse", "HEAD"]).trim())
  const workspaceStatus = git(["status", "--porcelain=v1", "--untracked-files=all"])
  const reasons = buildReasons(
    head,
    sourceRef,
    workspaceHead,
    workspaceStatus,
    reachableRefs,
    directDependents,
    changedOwnerIds,
  )

  const report = {
    schema_version: "bounded-mission.impact-evidence.v1",
    analysis_status: "facts-only",
    inputs: {
      owner_roots: registry.roots.map((item) => item.path),
    },
    range: {
      base,
      head,
      base_is_ancestor_of_head: baseIsAncestor,
      commit_count: Number(git(["rev-list", "--count", `${base}..${head}`]).trim()),
      head_reachable_refs: reachableRefs,
      source_ref: sourceRef.name,
      source_ref_tip: sourceRef.tip,
      head_matches_source_ref_tip: head === sourceRef.tip,
    },
    workspace: {
      head: workspaceHead,
      head_matches_range: workspaceHead === head,
      clean: workspaceStatus.length === 0,
    },
    facts: {
      changed_paths: changedPaths,
      owners: changedOwners,
      unowned_paths: changedPaths.filter((item) => !item.owner).map((item) => item.path),
      direct_dependents: directDependents,
    },
    reasons,
    refactor_decision: null,
    limits: [
      "Mission identity is not stored in Git; the caller must bind accepted Missions to the explicit range.",
      "Direct dependents cover static relative JavaScript/TypeScript production imports at head only.",
      "Owner mapping is limited to the repository-relative roots supplied by the caller.",
      "The helper does not establish a runtime consumer, preserved behavior, or a refactor decision.",
      "Churn, co-change frequency, file count, line count, and complexity scores are intentionally not calculated.",
    ],
  }
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`)
}

function parseArguments(values: string[]): Arguments {
  if (values.includes("--help")) {
    process.stdout.write([
      "Usage: mission-impact-evidence.ts --base <full-commit> --head <full-commit>",
      "  --source-ref <full-ref> --owner-root <repository-relative-path>",
      "  [--owner-root <repository-relative-path> ...]",
      "",
    ].join("\n"))
    process.exit(0)
  }
  const singles = new Map<string, string>()
  const ownerRoots: string[] = []
  for (let index = 0; index < values.length; index += 2) {
    const key = values[index]
    const value = values[index + 1]
    if (!key?.startsWith("--") || value == null || value.startsWith("--")) {
      throw new Error(`invalid arguments near ${key ?? "<end>"}`)
    }
    if (key === "--owner-root") {
      const normalized = normalizePath(value)
      if (!isRepositoryRelative(normalized)) {
        throw new Error("--owner-root must be a normalized repository-relative path")
      }
      if (!ownerRoots.includes(normalized)) ownerRoots.push(normalized)
      continue
    }
    if (!["--base", "--head", "--source-ref"].includes(key)) {
      throw new Error(`unsupported argument: ${key}`)
    }
    if (singles.has(key)) throw new Error(`duplicate argument: ${key}`)
    singles.set(key, value)
  }
  const base = singles.get("--base")
  const head = singles.get("--head")
  const sourceRef = singles.get("--source-ref")
  if (!base || !head || !sourceRef || ownerRoots.length === 0) {
    throw new Error("--base, --head, --source-ref, and at least one --owner-root are required")
  }
  return { base, head, sourceRef, ownerRoots }
}

function immutableCommit(value: string): string {
  if (!/^[0-9a-f]{40}(?:[0-9a-f]{24})?$/i.test(value)) {
    throw new Error("base and head must be full immutable commit hashes")
  }
  const resolved = git(["rev-parse", "--verify", `${value}^{commit}`]).trim().toLowerCase()
  if (resolved !== value.toLowerCase()) throw new Error(`not an immutable commit: ${value}`)
  return resolved
}

function repositoryRef(value: string): { name: string; tip: string } {
  if (!/^refs\/(?:heads|remotes|tags)\//.test(value) || gitStatus(["check-ref-format", value]) !== 0) {
    throw new Error("--source-ref must be a full heads, remotes, or tags ref")
  }
  return {
    name: value,
    tip: immutableCommit(git(["rev-parse", "--verify", `${value}^{commit}`]).trim()),
  }
}

function ownerRegistry(ownerRoots: string[]): OwnerRegistry {
  return {
    roots: ownerRoots
      .map((path) => ({ path, owner: { id: path } }))
      .sort((left, right) => right.path.length - left.path.length || left.path.localeCompare(right.path)),
  }
}

function readChangedPaths(
  base: string,
  head: string,
  registry: OwnerRegistry,
): ChangedPath[] {
  const fields = git(["diff", "--name-status", "-z", "--no-renames", base, head]).split("\0")
  const changed: ChangedPath[] = []
  for (let index = 0; index < fields.length - 1; index += 2) {
    const status = fields[index]
    const path = normalizePath(fields[index + 1])
    if (!status || !path) continue
    const owner = resolveOwner(registry, path)
    changed.push({
      status,
      path,
      owner,
    })
  }
  return changed.sort((left, right) => left.path.localeCompare(right.path))
}

function readDirectDependents(
  head: string,
  registry: OwnerRegistry,
  changedOwnerIds: Set<string>,
): DirectDependent[] {
  const dependents: DirectDependent[] = []
  const sourceFiles = treeFiles(head)
    .filter(isJavaScriptOrTypeScript)
    .filter((path) => !isTestSource(path))
  for (const path of sourceFiles) {
    const sourceOwner = resolveOwner(registry, path)
    if (!sourceOwner) continue
    const source = readFileAt(head, path).replace(/^#![^\n]*(?:\n|$)/, "")
    const imports = new Bun.Transpiler({ loader: loaderForPath(path) }).scanImports(source)
    for (const item of imports) {
      if (!item.path.startsWith(".")) continue
      const targetPath = normalizePath(posix.normalize(posix.join(posix.dirname(path), item.path)))
      const targetOwner = resolveOwner(registry, targetPath)
      if (!targetOwner) continue
      if (ownerKey(sourceOwner) === ownerKey(targetOwner)) continue
      if (!changedOwnerIds.has(ownerKey(targetOwner))) continue
      dependents.push({
        source_path: path,
        source_owner: sourceOwner,
        target_owner: targetOwner,
        specifier: item.path,
        import_kind: item.kind,
        evidence: "static-relative-production-import",
      })
    }
  }
  return dependents.sort((left, right) =>
    `${left.source_path}:${left.specifier}`.localeCompare(`${right.source_path}:${right.specifier}`))
}

function buildReasons(
  head: string,
  sourceRef: { name: string; tip: string },
  workspaceHead: string,
  workspaceStatus: string,
  reachableRefs: string[],
  directDependents: DirectDependent[],
  changedOwnerIds: Set<string>,
): Reason[] {
  const reasons: Reason[] = []
  if (reachableRefs.length === 0) {
    reasons.push({
      kind: "head-not-reachable",
      detail: "head is not reachable from a local or remote repository ref",
      evidence: [head],
    })
  }
  if (head !== sourceRef.tip) {
    reasons.push({
      kind: "head-not-source-ref-tip",
      detail: "head does not equal the declared source ref tip",
      evidence: [`${sourceRef.name} -> ${sourceRef.tip}`, `head -> ${head}`],
    })
  }
  if (workspaceHead === head && workspaceStatus.length > 0) {
    reasons.push({
      kind: "head-worktree-dirty",
      detail: "the current worktree contains material outside the immutable head",
      evidence: ["git status --porcelain=v1 --untracked-files=all returned entries"],
    })
  }
  const relations = new Map<string, string[]>()
  for (const dependent of directDependents) {
    if (!changedOwnerIds.has(ownerKey(dependent.source_owner))) continue
    const key = `${dependent.source_owner.id} -> ${dependent.target_owner.id}`
    const evidence = relations.get(key) ?? []
    evidence.push(`${dependent.source_path}: ${dependent.specifier}`)
    relations.set(key, evidence)
  }
  for (const [relation, evidence] of [...relations].sort(([left], [right]) => left.localeCompare(right))) {
    reasons.push({
      kind: "changed-owner-direct-dependency",
      detail: `changed canonical owners have a direct production dependency: ${relation}`,
      evidence: evidence.sort(),
    })
  }
  return reasons
}

function resolveOwner(registry: OwnerRegistry, path: string): Owner | null {
  const normalized = normalizePath(path)
  return registry.roots.find((item) =>
    normalized === item.path || normalized.startsWith(`${item.path}/`))?.owner ?? null
}

function uniqueOwners(owners: Owner[]): Owner[] {
  const unique = new Map<string, Owner>()
  for (const owner of owners) unique.set(ownerKey(owner), owner)
  return [...unique.values()].sort((left, right) => ownerKey(left).localeCompare(ownerKey(right)))
}

function ownerKey(owner: Owner): string {
  return owner.id
}

function treeFiles(revision: string): string[] {
  return git(["ls-tree", "-r", "--name-only", "-z", revision]).split("\0").filter(Boolean).sort()
}

function readFileAt(revision: string, path: string): string {
  return git(["show", `${revision}:${path}`])
}

function git(args: string[]): string {
  return execFileSync("git", args, {
    cwd: root || process.cwd(),
    encoding: "utf8",
    env: gitEnvironment,
    stdio: ["ignore", "pipe", "pipe"],
  })
}

function gitStatus(args: string[]): number {
  try {
    git(args)
    return 0
  } catch (error) {
    const status = (error as { status?: number }).status
    return typeof status === "number" ? status : 1
  }
}

function lines(value: string): string[] {
  return value.split("\n").map((item) => item.trim()).filter(Boolean).sort()
}

function normalizePath(value: string): string {
  return value.replaceAll("\\", "/").replace(/\/$/, "")
}

function isRepositoryRelative(value: string): boolean {
  return value.length > 0
    && value !== "."
    && !value.startsWith("/")
    && !value.includes("\\")
    && posix.normalize(value) === value
    && value !== ".."
    && !value.startsWith("../")
}

function isJavaScriptOrTypeScript(path: string): boolean {
  return /\.(?:ts|tsx|mts|cts|js|jsx|mjs|cjs)$/.test(path)
}

function isTestSource(path: string): boolean {
  return /(?:^|\/)(?:test|tests|test-support)(?:\/|$)/.test(path)
    || /\.(?:test|spec)\.[^.]+$/.test(path)
}

function loaderForPath(path: string): "tsx" | "jsx" | "js" | "ts" {
  if (path.endsWith(".tsx")) return "tsx"
  if (path.endsWith(".jsx")) return "jsx"
  if (/\.(?:js|mjs|cjs)$/.test(path)) return "js"
  return "ts"
}

try {
  main()
} catch (error) {
  console.error(portableMessage(error instanceof Error ? error.message : String(error)))
  process.exit(1)
}

function portableMessage(message: string): string {
  return message
    .replaceAll(root.replaceAll("\\", "/"), ".")
    .replaceAll(invocationDirectory.replaceAll("\\", "/"), ".")
    .replaceAll("\\", "/")
}
