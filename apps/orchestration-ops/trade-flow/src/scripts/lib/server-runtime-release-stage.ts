import { spawnSync } from "node:child_process"
import {
  chmodSync, copyFileSync, cpSync, existsSync, mkdirSync, readFileSync, renameSync,
  readdirSync, rmSync, statSync, writeFileSync,
} from "node:fs"
import { createHash } from "node:crypto"
import { dirname, isAbsolute, relative, resolve } from "node:path"
import { homedir } from "node:os"
import { isMacOsProtectedUserPath } from "./macos-protected-path"

type JSONRecord = Record<string, unknown>

export const SERVER_RUNTIME_RELEASE_MANIFEST_SCHEMA = "trade.server-runtime-release-manifest.v1" as const
const BINARY_REFS = [
  "apps/market-data-products/l2-order-book-service/target/release/l2-order-book-service",
  "apps/market-data-products/l2-order-book-service/target/release/l2-order-book-query",
] as const

export interface StageServerRuntimeReleaseInput {
  repository_root: string
  target_root: string
  created_at?: string
}

export function stageServerRuntimeRelease(input: StageServerRuntimeReleaseInput): JSONRecord {
  const repositoryRoot = normalizedAbsolute(input.repository_root, "repository_root")
  const targetRoot = assertServerRuntimeReleaseTarget(repositoryRoot, input.target_root)
  const commit = command(["git", "rev-parse", "HEAD"], repositoryRoot).trim()
  if (!/^[a-f0-9]{40}$/.test(commit)) throw new Error("git HEAD is not a full commit hash")
  const createdAt = canonicalTime(input.created_at ?? new Date().toISOString())
  const partialRoot = `${targetRoot}.partial-${process.pid}`
  const archivePath = `${partialRoot}.tar`
  if (existsSync(partialRoot) || existsSync(archivePath)) throw new Error("release staging temporary path already exists")
  mkdirSync(dirname(targetRoot), { recursive: true, mode: 0o700 })
  mkdirSync(partialRoot, { recursive: false, mode: 0o700 })
  try {
    command(["git", "archive", "--format=tar", `--output=${archivePath}`, commit], repositoryRoot)
    command(["tar", "-xf", archivePath, "-C", partialRoot], repositoryRoot)
    rmSync(archivePath)
    const removedRuntimeStateFileCount = purgeArchivedRuntimeState(partialRoot)
    const nodeModules = resolve(repositoryRoot, "node_modules")
    if (!existsSync(nodeModules)) throw new Error("node_modules is missing from the build workspace")
    cpSync(nodeModules, resolve(partialRoot, "node_modules"), { recursive: true, errorOnExist: true })
    const binaries = BINARY_REFS.map((ref) => copyExecutable(repositoryRoot, partialRoot, ref))
    mkdirSync(resolve(partialRoot, "data/l2"), { recursive: true, mode: 0o700 })
    mkdirSync(resolve(partialRoot, "tmp/server-runtime/logs"), { recursive: true, mode: 0o700 })
    const manifest = {
      schema_version: SERVER_RUNTIME_RELEASE_MANIFEST_SCHEMA,
      release_id: commit.slice(0, 12),
      source_commit: commit,
      created_at: createdAt,
      profile_ref: "profile/server-runtime-macos.json",
      dependency_lock: { ref: "bun.lock", sha256: fileHash(resolve(partialRoot, "bun.lock")) },
      dependencies: "copied_from_build_workspace_and_bound_to_bun_lock",
      binaries,
      data_seed: "empty_runtime_roots_only",
      removed_runtime_state_file_count: removedRuntimeStateFileCount,
      safety: { domain_jobs_enabled: false, live_writes_allowed: false, notify_dry_run: true },
    }
    writeFileSync(resolve(partialRoot, "release-manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`, { mode: 0o600 })
    renameSync(partialRoot, targetRoot)
    return {
      schema_version: "trade.server-runtime-release-stage-result.v1",
      status: "staged",
      release_id: manifest.release_id,
      source_commit: commit,
      manifest_hash: fileHash(resolve(targetRoot, "release-manifest.json")),
      profile_ref: manifest.profile_ref,
      data_seed: manifest.data_seed,
      installed: false,
      started: false,
      live_writes_allowed: false,
    }
  } catch (error) {
    if (existsSync(archivePath)) rmSync(archivePath)
    if (existsSync(partialRoot)) rmSync(partialRoot, { recursive: true })
    throw error
  }
}

export function assertServerRuntimeReleaseTarget(repositoryRootValue: string, targetRootValue: string): string {
  const repositoryRoot = normalizedAbsolute(repositoryRootValue, "repository_root")
  const targetRoot = normalizedAbsolute(targetRootValue, "target_root")
  const userHome = resolve(homedir())
  if (targetRoot === "/" || targetRoot === userHome) throw new Error("target_root is too broad")
  if (contains(repositoryRoot, targetRoot) || contains(targetRoot, repositoryRoot)) {
    throw new Error("target_root and repository_root must not contain each other")
  }
  if (isMacOsProtectedUserPath(targetRoot, userHome)) throw new Error("target_root must not use a macOS protected user path")
  if (existsSync(targetRoot)) throw new Error("target_root already exists; releases are immutable")
  return targetRoot
}

export function isArchivedRuntimeStateRef(ref: string): boolean {
  const normalized = ref.replaceAll("\\", "/")
  return normalized.split("/").includes("data") && /\.db(?:-(?:wal|shm))?$/.test(normalized)
}

function purgeArchivedRuntimeState(root: string): number {
  let removed = 0
  const topLevelData = resolve(root, "data")
  if (existsSync(topLevelData)) {
    removed += countFiles(topLevelData)
    rmSync(topLevelData, { recursive: true })
  }
  const visit = (directory: string): void => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const path = resolve(directory, entry.name)
      if (entry.isDirectory()) visit(path)
      else if (entry.isFile() && isArchivedRuntimeStateRef(relative(root, path))) {
        rmSync(path)
        removed += 1
      }
    }
  }
  visit(root)
  return removed
}

function countFiles(directory: string): number {
  let count = 0
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    count += entry.isDirectory() ? countFiles(resolve(directory, entry.name)) : entry.isFile() ? 1 : 0
  }
  return count
}

function copyExecutable(repositoryRoot: string, targetRoot: string, ref: typeof BINARY_REFS[number]): JSONRecord {
  const source = resolve(repositoryRoot, ref)
  if (!existsSync(source) || !statSync(source).isFile()) throw new Error(`required release binary is missing: ${ref}`)
  const target = resolve(targetRoot, ref)
  mkdirSync(dirname(target), { recursive: true, mode: 0o700 })
  copyFileSync(source, target)
  chmodSync(target, 0o755)
  return { ref, sha256: fileHash(target), size_bytes: statSync(target).size }
}

function command(argv: string[], cwd: string): string {
  const result = spawnSync(argv[0], argv.slice(1), { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] })
  if (result.status !== 0) throw new Error(`${argv[0]} ${argv[1] ?? ""} failed with exit ${result.status ?? -1}`)
  return result.stdout
}

function fileHash(path: string): string {
  return createHash("sha256").update(readFileSync(path)).digest("hex")
}

function normalizedAbsolute(value: string, field: string): string {
  if (!isAbsolute(value) || /[\n\r\0]/.test(value)) throw new Error(`${field} must be an absolute path without control characters`)
  return resolve(value)
}

function contains(parent: string, child: string): boolean {
  const ref = relative(parent, child)
  return ref === "" || (!ref.startsWith("..") && !isAbsolute(ref))
}

function canonicalTime(value: string): string {
  const date = new Date(value)
  if (!Number.isFinite(date.getTime()) || date.toISOString() !== value) throw new Error("created_at must be canonical UTC")
  return value
}
