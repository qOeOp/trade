#!/usr/bin/env bun

import { createHash } from "node:crypto"
import { realpathSync } from "node:fs"
import { isAbsolute, resolve } from "node:path"

const SCHEMA = "mission-evaluator-binding/v2"
const SCRIPT_PATH = ".agents/skills/run-bounded-mission/scripts/evaluator-binding.ts"
const ENFORCEMENT_MODES = new Set(["sandbox-enforced", "integrity-checked"])

interface Inputs {
  repository: string
  origin: string
  candidate: string
  enforcement: string
  requiredFiles: string[]
  controlRepository?: string
  controlOrigin?: string
  targetRoot?: string
}

interface GitResult {
  exitCode: number
  stdout: Uint8Array
  stderr: Uint8Array
}

class BindingRejected extends Error {}

function sha256(bytes: Uint8Array | string): string {
  return createHash("sha256").update(bytes).digest("hex")
}

async function emit(value: unknown, exitCode: number): Promise<void> {
  await Bun.write(Bun.stdout, `${JSON.stringify(value)}\n`)
  process.exitCode = exitCode
}

function reject(reason: string): never {
  throw new BindingRejected(reason)
}

function parseInputs(argv: string[]): Inputs {
  const values = new Map<string, string>()
  const requiredFiles: string[] = []
  const singleValueFlags = new Set([
    "--repository",
    "--origin",
    "--candidate",
    "--enforcement",
    "--control-repository",
    "--control-origin",
    "--target-root",
  ])

  for (let index = 0; index < argv.length; index += 2) {
    const flag = argv[index]
    const value = argv[index + 1]
    if (value === undefined) reject(`missing value for ${flag ?? "argument"}`)
    if (flag === "--required-file") {
      requiredFiles.push(value)
      continue
    }
    if (!singleValueFlags.has(flag)) reject(`unsupported argument: ${flag}`)
    if (values.has(flag)) reject(`duplicate argument: ${flag}`)
    values.set(flag, value)
  }

  const repository = values.get("--repository")
  const origin = values.get("--origin")
  const candidate = values.get("--candidate")
  const enforcement = values.get("--enforcement")
  const controlRepository = values.get("--control-repository")
  const controlOrigin = values.get("--control-origin")
  const targetRoot = values.get("--target-root")
  if (!repository || !origin || !candidate || !enforcement) {
    reject("required arguments: --repository --origin --candidate --enforcement --required-file")
  }
  if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repository)) {
    reject("repository must be owner/name")
  }
  if (!ENFORCEMENT_MODES.has(enforcement)) reject("unsupported enforcement mode")
  const externalValues = [controlRepository, controlOrigin, targetRoot].filter(Boolean).length
  if (externalValues !== 0 && externalValues !== 3) {
    reject("external binding requires --control-repository --control-origin --target-root together")
  }
  if (controlRepository && !/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(controlRepository)) {
    reject("control repository must be owner/name")
  }
  if (targetRoot && (!isAbsolute(targetRoot) || resolve(targetRoot) !== targetRoot || /[\0\n\r]/.test(targetRoot))) {
    reject("target root must be a canonical absolute path without control characters")
  }
  if (requiredFiles.length === 0) reject("at least one --required-file is required")
  for (const value of [origin, candidate, ...requiredFiles]) {
    if (value.includes("\0") || value.includes("\n") || value.includes("\r")) {
      reject("refs and paths must not contain control characters")
    }
  }

  const normalizedFiles = [...new Set(requiredFiles)].sort(compareUtf8)
  for (const path of normalizedFiles) {
    if (path.startsWith("/") || path === "." || path === ".." || path.split("/").includes("..")) {
      reject(`required file must be repository-relative: ${path}`)
    }
  }
  return {
    repository,
    origin,
    candidate,
    enforcement,
    requiredFiles: normalizedFiles,
    controlRepository,
    controlOrigin,
    targetRoot,
  }
}

function compareUtf8(left: string, right: string): number {
  return Buffer.compare(Buffer.from(left), Buffer.from(right))
}

function runGit(cwd: string, args: string[]): GitResult {
  const result = Bun.spawnSync(["git", ...args], {
    cwd,
    env: {
      ...process.env,
      GIT_NO_LAZY_FETCH: "1",
      GIT_OPTIONAL_LOCKS: "0",
      GIT_TERMINAL_PROMPT: "0",
    },
    stderr: "pipe",
    stdout: "pipe",
  })
  return { exitCode: result.exitCode, stdout: result.stdout, stderr: result.stderr }
}

function gitBytes(cwd: string, args: string[]): Uint8Array {
  const result = runGit(cwd, args)
  if (result.exitCode !== 0) {
    const detail = new TextDecoder().decode(result.stderr).trim()
    reject(`git ${args[0]} failed${detail ? `: ${detail}` : ""}`)
  }
  return result.stdout
}

function gitText(cwd: string, args: string[]): string {
  return new TextDecoder().decode(gitBytes(cwd, args)).trim()
}

function resolveCommit(cwd: string, locator: string, label: string): string {
  const result = runGit(cwd, ["rev-parse", "--verify", "--end-of-options", `${locator}^{commit}`])
  if (result.exitCode !== 0) reject(`${label} does not resolve to a commit`)
  const oid = new TextDecoder().decode(result.stdout).trim()
  if (!/^[0-9a-f]{40}$/.test(oid)) reject(`${label} did not resolve to a full commit OID`)
  return oid
}

function normalizeRemoteRepository(remote: string): string | null {
  const scpMatch = /^[^@\s]+@[^:]+:(.+)$/.exec(remote)
  let path = scpMatch?.[1]
  if (!path) {
    try {
      path = new URL(remote).pathname
    } catch {
      path = remote
    }
  }
  const segments = path.replace(/^\/+/, "").replace(/\.git$/, "").split("/").filter(Boolean)
  if (segments.length < 2) return null
  return `${segments.at(-2)}/${segments.at(-1)}`
}

function commitParents(cwd: string, commit: string): string[] {
  const value = gitText(cwd, ["show", "--no-patch", "--format=%P", commit])
  return value ? value.split(" ") : []
}

function splitNulPaths(bytes: Uint8Array): string[] {
  const decoder = new TextDecoder("utf-8", { fatal: true })
  const paths: string[] = []
  let start = 0
  for (let index = 0; index < bytes.length; index += 1) {
    if (bytes[index] !== 0) continue
    if (index > start) paths.push(decoder.decode(bytes.slice(start, index)))
    start = index + 1
  }
  if (start !== bytes.length) reject("changed-path output was not NUL terminated")
  return paths.sort(compareUtf8)
}

function blobFingerprint(cwd: string, commit: string, path: string, required: boolean) {
  const object = runGit(cwd, ["rev-parse", "--verify", "--end-of-options", `${commit}:${path}`])
  if (object.exitCode !== 0) {
    if (required) reject(`required control-plane file is missing: ${path}`)
    return { present: false as const }
  }
  const oid = new TextDecoder().decode(object.stdout).trim()
  const type = gitText(cwd, ["cat-file", "-t", oid])
  if (type !== "blob") reject(`unsupported control-plane object type for ${path}: ${type}`)
  const bytes = gitBytes(cwd, ["cat-file", "blob", oid])
  return { present: true as const, oid, sha256: sha256(bytes), size: bytes.length }
}

try {
const inputs = parseInputs(Bun.argv.slice(2))
const initialCwd = process.cwd()
const controlRoot = gitText(initialCwd, ["rev-parse", "--show-toplevel"])
const external = inputs.targetRoot !== undefined
const controlRepository = inputs.controlRepository ?? inputs.repository
const observedControlRepository = normalizeRemoteRepository(gitText(controlRoot, ["remote", "get-url", "origin"]))
if (observedControlRepository !== controlRepository) {
  reject(
    `control repository mismatch: expected ${controlRepository}, observed ${observedControlRepository ?? "unresolved"}`,
  )
}

const controlOrigin = resolveCommit(controlRoot, inputs.controlOrigin ?? inputs.origin, "control-plane Origin")
const controlHead = resolveCommit(controlRoot, "HEAD", "control-plane HEAD")
if (controlHead !== controlOrigin) {
  reject(`control-plane HEAD ${controlHead} does not equal Origin ${controlOrigin}`)
}
const controlStatus = gitBytes(controlRoot, ["status", "--porcelain=v2", "-z", "--untracked-files=all", "--ignored=no"])
if (controlStatus.length !== 0) {
  reject(`control-plane worktree has tracked or untracked material; status_sha256=${sha256(controlStatus)}`)
}

const targetRoot = external ? realpathSync(inputs.targetRoot!) : controlRoot
if (external && targetRoot !== inputs.targetRoot) reject("target root must not contain symlink components")
const observedTargetRepository = normalizeRemoteRepository(gitText(targetRoot, ["remote", "get-url", "origin"]))
if (observedTargetRepository !== inputs.repository) {
  reject(`target repository mismatch: expected ${inputs.repository}, observed ${observedTargetRepository ?? "unresolved"}`)
}
const origin = resolveCommit(targetRoot, inputs.origin, "target Origin")
const candidate = resolveCommit(targetRoot, inputs.candidate, "target candidate")
if (origin === candidate) reject("candidate must differ from Origin")
const targetStatusArgs = external
  ? ["status", "--porcelain=v2", "-z", "--untracked-files=all", "--ignored=matching"]
  : ["status", "--porcelain=v2", "-z", "--untracked-files=all", "--ignored=no"]
const targetStatus = gitBytes(targetRoot, targetStatusArgs)
if (external && targetStatus.length !== 0) {
  reject(`target worktree has tracked, untracked, or ignored material; status_sha256=${sha256(targetStatus)}`)
}
const targetHead = resolveCommit(targetRoot, "HEAD", "target HEAD")
if (external && targetHead !== candidate) {
  reject(`target HEAD ${targetHead} does not equal candidate ${candidate}`)
}

const ancestry = runGit(targetRoot, ["merge-base", "--is-ancestor", origin, candidate])
if (ancestry.exitCode === 1) reject("candidate does not descend from Origin")
if (ancestry.exitCode !== 0) reject("candidate ancestry could not be resolved")

const originTree = gitText(targetRoot, ["rev-parse", "--verify", `${origin}^{tree}`])
const candidateTree = gitText(targetRoot, ["rev-parse", "--verify", `${candidate}^{tree}`])
const originParents = commitParents(targetRoot, origin)
const candidateParents = commitParents(targetRoot, candidate)
const originDistance = Number(gitText(targetRoot, ["rev-list", "--count", `${origin}..${candidate}`]))
if (!Number.isSafeInteger(originDistance) || originDistance < 1) reject("candidate ancestry distance is invalid")

const diffArgs = [
  "diff", "--binary", "--full-index", "--no-color", "--no-ext-diff", "--no-textconv", "--no-renames",
  origin, candidate, "--",
]
const diffBytes = gitBytes(targetRoot, diffArgs)
const changedPaths = splitNulPaths(gitBytes(targetRoot, [
  "diff", "--name-only", "-z", "--no-renames", origin, candidate, "--",
]))
if (changedPaths.length === 0 || diffBytes.length === 0) reject("candidate has no complete committed diff from Origin")

const requiredFiles = inputs.requiredFiles.map((path) => ({
  path,
  control_origin: blobFingerprint(controlRoot, controlOrigin, path, true),
}))

const replayArgv = [
  "bun", SCRIPT_PATH,
  "--repository", inputs.repository,
  "--origin", origin,
  "--candidate", candidate,
  "--enforcement", inputs.enforcement,
  ...inputs.requiredFiles.flatMap((path) => ["--required-file", path]),
  ...(external ? [
    "--control-repository", controlRepository,
    "--control-origin", controlOrigin,
    "--target-root", targetRoot,
  ] : []),
]
const controlTree = gitText(controlRoot, ["rev-parse", "--verify", `${controlOrigin}^{tree}`])
const controlParents = commitParents(controlRoot, controlOrigin)
const binding = {
  schema: SCHEMA,
  status: "bound",
  repository: inputs.repository,
  enforcement: inputs.enforcement,
  control_plane: {
    repository: controlRepository,
    head: controlHead,
    tree: controlTree,
    parents: controlParents,
    candidate_material_status_sha256: sha256(controlStatus),
    worktree_candidate_material_fingerprint_sha256: sha256(
      `${controlRepository}\0${controlHead}\0${controlTree}\0${sha256(controlStatus)}`,
    ),
    ignored_material_policy: "excluded_non_candidate",
  },
  target_worktree: {
    root: targetRoot,
    head: targetHead,
    candidate_material_status_sha256: sha256(targetStatus),
    worktree_candidate_material_fingerprint_sha256: sha256(
      `${inputs.repository}\0${targetHead}\0${candidateTree}\0${sha256(targetStatus)}`,
    ),
    ignored_material_policy: external ? "must_be_absent" : "excluded_non_candidate",
  },
  origin: { commit: origin, tree: originTree, parents: originParents },
  candidate: {
    commit: candidate,
    tree: candidateTree,
    parents: candidateParents,
    origin_is_ancestor: true,
    origin_is_direct_parent: candidateParents.includes(origin),
    origin_distance: originDistance,
  },
  diff: {
    sha256: sha256(diffBytes),
    size: diffBytes.length,
    changed_paths: changedPaths,
  },
  required_files: requiredFiles,
  replay: { argv: replayArgv },
}
const bindingFingerprint = sha256(JSON.stringify(binding))
await emit({ ...binding, binding_fingerprint_sha256: bindingFingerprint }, 0)
} catch (error) {
  if (!(error instanceof BindingRejected)) throw error
  await emit({ schema: SCHEMA, status: "rejected", reason: error.message }, 1)
}
