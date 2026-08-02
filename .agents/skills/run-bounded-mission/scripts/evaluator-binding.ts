#!/usr/bin/env bun

import { createHash } from "node:crypto"

const SCHEMA = "mission-evaluator-binding/v1"
const SCRIPT_PATH = ".agents/skills/run-bounded-mission/scripts/evaluator-binding.ts"
const ENFORCEMENT_MODES = new Set(["sandbox-enforced", "integrity-checked"])

interface Inputs {
  repository: string
  origin: string
  candidate: string
  enforcement: string
  requiredFiles: string[]
}

interface GitResult {
  exitCode: number
  stdout: Uint8Array
  stderr: Uint8Array
}

function sha256(bytes: Uint8Array | string): string {
  return createHash("sha256").update(bytes).digest("hex")
}

function emit(value: unknown, exitCode: number): never {
  process.stdout.write(`${JSON.stringify(value)}\n`)
  process.exit(exitCode)
}

function reject(reason: string): never {
  emit({ schema: SCHEMA, status: "rejected", reason }, 1)
}

function parseInputs(argv: string[]): Inputs {
  const values = new Map<string, string>()
  const requiredFiles: string[] = []
  const singleValueFlags = new Set(["--repository", "--origin", "--candidate", "--enforcement"])

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
  if (!repository || !origin || !candidate || !enforcement) {
    reject("required arguments: --repository --origin --candidate --enforcement --required-file")
  }
  if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repository)) {
    reject("repository must be owner/name")
  }
  if (!ENFORCEMENT_MODES.has(enforcement)) reject("unsupported enforcement mode")
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
  return { repository, origin, candidate, enforcement, requiredFiles: normalizedFiles }
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

const inputs = parseInputs(Bun.argv.slice(2))
const initialCwd = process.cwd()
const repositoryRoot = gitText(initialCwd, ["rev-parse", "--show-toplevel"])
const observedRepository = normalizeRemoteRepository(gitText(repositoryRoot, ["remote", "get-url", "origin"]))
if (observedRepository !== inputs.repository) {
  reject(`repository mismatch: expected ${inputs.repository}, observed ${observedRepository ?? "unresolved"}`)
}

const origin = resolveCommit(repositoryRoot, inputs.origin, "Origin")
const candidate = resolveCommit(repositoryRoot, inputs.candidate, "candidate")
if (origin === candidate) reject("candidate must differ from Origin")

const controlHead = resolveCommit(repositoryRoot, "HEAD", "control-plane HEAD")
if (controlHead !== origin) reject(`control-plane HEAD ${controlHead} does not equal Origin ${origin}`)
const controlStatus = gitBytes(repositoryRoot, ["status", "--porcelain=v2", "-z", "--untracked-files=all", "--ignored=no"])
if (controlStatus.length !== 0) {
  reject(`control-plane worktree has tracked or untracked material; status_sha256=${sha256(controlStatus)}`)
}

const ancestry = runGit(repositoryRoot, ["merge-base", "--is-ancestor", origin, candidate])
if (ancestry.exitCode === 1) reject("candidate does not descend from Origin")
if (ancestry.exitCode !== 0) reject("candidate ancestry could not be resolved")

const originTree = gitText(repositoryRoot, ["rev-parse", "--verify", `${origin}^{tree}`])
const candidateTree = gitText(repositoryRoot, ["rev-parse", "--verify", `${candidate}^{tree}`])
const originParents = commitParents(repositoryRoot, origin)
const candidateParents = commitParents(repositoryRoot, candidate)
const originDistance = Number(gitText(repositoryRoot, ["rev-list", "--count", `${origin}..${candidate}`]))
if (!Number.isSafeInteger(originDistance) || originDistance < 1) reject("candidate ancestry distance is invalid")

const diffArgs = [
  "diff", "--binary", "--full-index", "--no-color", "--no-ext-diff", "--no-textconv", "--no-renames",
  origin, candidate, "--",
]
const diffBytes = gitBytes(repositoryRoot, diffArgs)
const changedPaths = splitNulPaths(gitBytes(repositoryRoot, ["diff", "--name-only", "-z", "--no-renames", origin, candidate, "--"]))
if (changedPaths.length === 0 || diffBytes.length === 0) reject("candidate has no complete committed diff from Origin")

const requiredFiles = inputs.requiredFiles.map((path) => ({
  path,
  origin: blobFingerprint(repositoryRoot, origin, path, true),
  candidate: blobFingerprint(repositoryRoot, candidate, path, false),
}))

const replayArgv = [
  "bun", SCRIPT_PATH,
  "--repository", inputs.repository,
  "--origin", origin,
  "--candidate", candidate,
  "--enforcement", inputs.enforcement,
  ...inputs.requiredFiles.flatMap((path) => ["--required-file", path]),
]
const binding = {
  schema: SCHEMA,
  status: "bound",
  repository: inputs.repository,
  enforcement: inputs.enforcement,
  control_plane: {
    head: controlHead,
    tree: originTree,
    parents: originParents,
    candidate_material_status_sha256: sha256(controlStatus),
    worktree_candidate_material_fingerprint_sha256: sha256(`${controlHead}\0${originTree}\0${sha256(controlStatus)}`),
    ignored_material_policy: "excluded_non_candidate",
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
emit({ ...binding, binding_fingerprint_sha256: bindingFingerprint }, 0)
