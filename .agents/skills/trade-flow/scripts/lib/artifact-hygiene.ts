import { existsSync, readdirSync, rmSync, statSync } from "node:fs"
import { basename, dirname, isAbsolute, relative, resolve } from "node:path"

interface ArtifactGcInput {
  root: string
  retentionHours?: number
  ephemeralRetentionHours?: number
  now?: string | Date
  yes?: boolean
  referencedPaths?: string[]
}

interface ArtifactGcFile {
  path: string
  age_hours: number
  reason: string
}

interface ArtifactGcResult {
  root: string
  retention_hours: number
  ephemeral_retention_hours: number
  mode: "dry-run" | "delete"
  candidates: ArtifactGcFile[]
  deleted: ArtifactGcFile[]
  kept: ArtifactGcFile[]
}

const DEFAULT_RETENTION_HOURS = 168
const DEFAULT_EPHEMERAL_RETENTION_HOURS = 24
const SKIP_DIRS = new Set([".git", "node_modules"])
const NEVER_DELETE_EXTENSIONS = new Set([".db", ".sqlite", ".sqlite3", ".jsonl"])
const DURABLE_DIRS = new Set(["durable", "ledger", "ledgers"])
const EPHEMERAL_DIRS = new Set(["tmp", "temp", "cache", "scratch", "ephemeral"])

function runArtifactGc(input: ArtifactGcInput): ArtifactGcResult {
  const root = resolve(input.root || "")
  assertSafeArtifactRoot(root)

  const retentionHours = input.retentionHours ?? DEFAULT_RETENTION_HOURS
  if (!Number.isFinite(retentionHours) || retentionHours <= 0) {
    throw new Error("retentionHours must be a positive number")
  }
  const ephemeralRetentionHours = input.ephemeralRetentionHours ?? Math.min(DEFAULT_EPHEMERAL_RETENTION_HOURS, retentionHours)
  if (!Number.isFinite(ephemeralRetentionHours) || ephemeralRetentionHours <= 0) {
    throw new Error("ephemeralRetentionHours must be a positive number")
  }

  const now = input.now ? new Date(input.now) : new Date()
  if (!Number.isFinite(now.getTime())) {
    throw new Error("now must be a valid date")
  }

  const referenced = new Set((input.referencedPaths ?? []).map((path) => resolveArtifactPath(root, path)))
  const candidates: ArtifactGcFile[] = []
  const deleted: ArtifactGcFile[] = []
  const kept: ArtifactGcFile[] = []

  for (const path of walkFiles(root)) {
    const stat = statSync(path)
    const ageHours = roundHours((now.getTime() - stat.mtime.getTime()) / 3_600_000)
    const keepReason = keepReasonFor(path, root, referenced)
    if (keepReason) {
      kept.push({ path, age_hours: ageHours, reason: keepReason })
      continue
    }
    const ephemeral = isEphemeral(path, root)
    const effectiveRetentionHours = ephemeral ? ephemeralRetentionHours : retentionHours
    if (ageHours < effectiveRetentionHours) {
      kept.push({ path, age_hours: ageHours, reason: "fresh" })
      continue
    }

    const reason = ephemeral ? "stale_ephemeral_artifact" : "stale_unreferenced_artifact"
    const file = { path, age_hours: ageHours, reason }
    candidates.push(file)
    if (input.yes) {
      rmSync(path)
      deleted.push(file)
    }
  }

  return {
    root,
    retention_hours: retentionHours,
    ephemeral_retention_hours: ephemeralRetentionHours,
    mode: input.yes ? "delete" : "dry-run",
    candidates,
    deleted,
    kept,
  }
}

function keepReasonFor(path: string, root: string, referenced: Set<string>): string {
  if (!path.startsWith(`${root}/`) && path !== root) {
    return "outside_root"
  }
  if (isReferenced(path, referenced)) {
    return "referenced"
  }
  if (isPinned(path, root)) {
    return "pinned"
  }
  for (const extension of NEVER_DELETE_EXTENSIONS) {
    if (path.endsWith(extension)) {
      return "durable_store"
    }
  }
  if (isDurable(path, root)) {
    return "durable_store"
  }
  return ""
}

function resolveArtifactPath(root: string, path: string): string {
  return isAbsolute(path) ? resolve(path) : resolve(root, path)
}

function isReferenced(path: string, referenced: Set<string>): boolean {
  const resolved = resolve(path)
  for (const ref of referenced) {
    if (resolved === ref || resolved.startsWith(`${ref}/`)) {
      return true
    }
  }
  return false
}

function isPinned(path: string, root: string): boolean {
  if (path.endsWith(".pin") || existsSync(`${path}.pin`)) {
    return true
  }
  let current = dirname(path)
  while (current.startsWith(root)) {
    if (existsSync(resolve(current, ".pin"))) {
      return true
    }
    if (current === root) {
      break
    }
    current = dirname(current)
  }
  return false
}

function isDurable(path: string, root: string): boolean {
  return relativeParts(root, path).some((part) => DURABLE_DIRS.has(part))
}

function isEphemeral(path: string, root: string): boolean {
  return relativeParts(root, path).some((part) => EPHEMERAL_DIRS.has(part))
}

function relativeParts(root: string, path: string): string[] {
  const rel = relative(root, path)
  return rel.split("/").filter(Boolean)
}

function assertSafeArtifactRoot(root: string): void {
  if (!root || root === "/" || root.length < 8) {
    throw new Error("--artifact-root is not safe")
  }
  if (!existsSync(root) || !statSync(root).isDirectory()) {
    throw new Error("--artifact-root must be an existing directory")
  }
}

function walkFiles(root: string): string[] {
  const files: string[] = []
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    if (SKIP_DIRS.has(entry.name)) {
      continue
    }
    const path = resolve(root, entry.name)
    if (entry.isSymbolicLink()) {
      continue
    }
    if (entry.isDirectory()) {
      files.push(...walkFiles(path))
      continue
    }
    if (entry.isFile() && basename(path) !== ".DS_Store") {
      files.push(path)
    }
  }
  return files
}

function roundHours(value: number): number {
  return Math.max(0, Math.round(value * 1000) / 1000)
}

export {
  DEFAULT_RETENTION_HOURS,
  DEFAULT_EPHEMERAL_RETENTION_HOURS,
  runArtifactGc,
  type ArtifactGcFile,
  type ArtifactGcInput,
  type ArtifactGcResult,
}
