#!/usr/bin/env bun

import { execFileSync } from "node:child_process"
import { posix } from "node:path"

type JSONRecord = Record<string, unknown>

interface Owner {
  id: string
  kind: "module" | "document"
  domain: string
  registry_revision: string
}

interface OwnerRegistry {
  moduleRoots: Array<{ path: string; owner: Owner }>
  documents: Map<string, Owner>
  jobs: Array<{
    ticket_no: string
    job_id: string
    target_domain: string
    owner_module: string
  }>
}

interface ChangedPath {
  status: string
  path: string
  owner: Owner | null
  owner_source: "base" | "head" | null
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

const root = execFileSync("git", ["rev-parse", "--show-toplevel"], {
  cwd: process.cwd(),
  encoding: "utf8",
  stdio: ["ignore", "pipe", "pipe"],
}).trim()

function main(): void {
  const base = immutableCommit(flag("--base"))
  const head = immutableCommit(flag("--head"))
  const sourceRef = repositoryRef(flag("--source-ref"))
  const baseIsAncestor = gitStatus(["merge-base", "--is-ancestor", base, head]) === 0
  if (!baseIsAncestor) throw new Error("--base must be an ancestor of --head")

  const baseRegistry = ownerRegistry(base)
  const headRegistry = ownerRegistry(head)
  const changedPaths = readChangedPaths(base, head, baseRegistry, headRegistry)
  const changedOwners = uniqueOwners(changedPaths.flatMap((item) => item.owner ? [item.owner] : []))
  const changedOwnerIds = new Set(changedOwners.map(ownerKey))
  const directDependents = readDirectDependents(head, headRegistry, changedOwnerIds)
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
    schema_version: "trade.mission-impact-evidence.v1",
    analysis_status: "facts-only",
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
      declared_jobs: headRegistry.jobs
        .filter((job) => changedOwnerIds.has(moduleOwnerKey(job.owner_module)))
        .sort((left, right) => left.ticket_no.localeCompare(right.ticket_no)),
    },
    reasons,
    refactor_decision: null,
    limits: [
      "Mission identity is not stored in Git; the caller must bind accepted Missions to the explicit range.",
      "Direct dependents cover static relative JavaScript/TypeScript production imports at head only.",
      "Canonical owner mapping is limited to architecture-manifest modules and indexed documents.",
      "The helper does not establish a runtime consumer, preserved behavior, or a refactor decision.",
      "Churn, co-change frequency, file count, line count, and complexity scores are intentionally not calculated.",
    ],
  }
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`)
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

function ownerRegistry(revision: string): OwnerRegistry {
  const manifest = readJsonAt(revision, "docs/architecture/architecture-manifest.json")
  const moduleRoots: Array<{ path: string; owner: Owner }> = []
  for (const domain of records(manifest.domains)) {
    const domainId = text(domain.id)
    for (const modulePath of strings(domain.modules)) {
      moduleRoots.push({
        path: normalizePath(modulePath),
        owner: {
          id: normalizePath(modulePath),
          kind: "module",
          domain: domainId,
          registry_revision: revision,
        },
      })
    }
  }
  moduleRoots.sort((left, right) => right.path.length - left.path.length)

  const documents = new Map<string, Owner>()
  const documentIndex = tryReadJsonAt(revision, "docs/engineering/doc-contract-index.json")
  for (const entry of records(documentIndex?.documents)) {
    const path = normalizePath(text(entry.path))
    if (!path) continue
    documents.set(path, {
      id: text(entry.id),
      kind: "document",
      domain: text(entry.owner),
      registry_revision: revision,
    })
  }

  return {
    moduleRoots,
    documents,
    jobs: records(manifest.jobs).map((job) => ({
      ticket_no: text(job.ticket_no),
      job_id: text(job.job_id),
      target_domain: text(job.target_domain),
      owner_module: normalizePath(text(job.owner_module)),
    })),
  }
}

function readChangedPaths(
  base: string,
  head: string,
  baseRegistry: OwnerRegistry,
  headRegistry: OwnerRegistry,
): ChangedPath[] {
  const fields = git(["diff", "--name-status", "-z", "--no-renames", base, head]).split("\0")
  const changed: ChangedPath[] = []
  for (let index = 0; index < fields.length - 1; index += 2) {
    const status = fields[index]
    const path = normalizePath(fields[index + 1])
    if (!status || !path) continue
    const headOwner = resolveOwner(headRegistry, path)
    const baseOwner = resolveOwner(baseRegistry, path)
    changed.push({
      status,
      path,
      owner: headOwner ?? baseOwner,
      owner_source: headOwner ? "head" : baseOwner ? "base" : null,
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
    .filter((path) => path.startsWith("apps/"))
    .filter(isJavaScriptOrTypeScript)
    .filter((path) => !isTestSource(path))
  for (const path of sourceFiles) {
    const sourceOwner = resolveOwner(registry, path)
    if (!sourceOwner || sourceOwner.kind !== "module") continue
    const source = readFileAt(head, path).replace(/^#![^\n]*(?:\n|$)/, "")
    const imports = new Bun.Transpiler({ loader: loaderForPath(path) }).scanImports(source)
    for (const item of imports) {
      if (!item.path.startsWith(".")) continue
      const targetPath = normalizePath(posix.normalize(posix.join(posix.dirname(path), item.path)))
      const targetOwner = resolveOwner(registry, targetPath)
      if (!targetOwner || targetOwner.kind !== "module") continue
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
  const document = registry.documents.get(normalized)
  if (document) return document
  return registry.moduleRoots.find((item) =>
    normalized === item.path || normalized.startsWith(`${item.path}/`))?.owner ?? null
}

function uniqueOwners(owners: Owner[]): Owner[] {
  const unique = new Map<string, Owner>()
  for (const owner of owners) unique.set(ownerKey(owner), owner)
  return [...unique.values()].sort((left, right) => ownerKey(left).localeCompare(ownerKey(right)))
}

function ownerKey(owner: Owner): string {
  return `${owner.kind}:${owner.id}`
}

function moduleOwnerKey(modulePath: string): string {
  return `module:${modulePath}`
}

function treeFiles(revision: string): string[] {
  return git(["ls-tree", "-r", "--name-only", "-z", revision]).split("\0").filter(Boolean).sort()
}

function readJsonAt(revision: string, path: string): JSONRecord {
  return JSON.parse(readFileAt(revision, path)) as JSONRecord
}

function tryReadJsonAt(revision: string, path: string): JSONRecord | null {
  if (gitStatus(["cat-file", "-e", `${revision}:${path}`]) !== 0) return null
  return readJsonAt(revision, path)
}

function readFileAt(revision: string, path: string): string {
  return git(["show", `${revision}:${path}`])
}

function git(args: string[]): string {
  return execFileSync("git", args, {
    cwd: root || process.cwd(),
    encoding: "utf8",
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

function flag(name: string): string {
  const index = process.argv.indexOf(name)
  const value = index >= 0 ? process.argv[index + 1] : ""
  if (!value || value.startsWith("--")) throw new Error(`${name} requires a value`)
  return value
}

function records(value: unknown): JSONRecord[] {
  return Array.isArray(value)
    ? value.filter((item): item is JSONRecord => Boolean(item) && typeof item === "object" && !Array.isArray(item))
    : []
}

function strings(value: unknown): string[] {
  return Array.isArray(value) ? value.map(String).filter(Boolean) : []
}

function text(value: unknown): string {
  return typeof value === "string" ? value : ""
}

function lines(value: string): string[] {
  return value.split("\n").map((item) => item.trim()).filter(Boolean).sort()
}

function normalizePath(value: string): string {
  return value.replaceAll("\\", "/").replace(/\/$/, "")
}

function isJavaScriptOrTypeScript(path: string): boolean {
  return /\.(?:ts|tsx|mts|cts|js|jsx|mjs|cjs)$/.test(path)
}

function isTestSource(path: string): boolean {
  return /(?:^|\/)(?:test|tests|test-support)(?:\/|$)/.test(path)
    || /\.(?:test|spec)\.[^.]+$/.test(path)
}

function loaderForPath(path: string): Bun.Loader {
  if (path.endsWith(".tsx")) return "tsx"
  if (path.endsWith(".jsx")) return "jsx"
  if (/\.(?:js|mjs|cjs)$/.test(path)) return "js"
  return "ts"
}

try {
  main()
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error))
  process.exit(1)
}
