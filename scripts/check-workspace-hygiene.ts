#!/usr/bin/env bun

import { readdirSync } from "node:fs"
import { dirname, relative, resolve, sep } from "node:path"
import { fileURLToPath } from "node:url"

interface WorkspaceSnapshot {
  trackedPaths: string[]
  moduleRuntimePaths: string[]
}

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..")
const sqliteRuntimePattern = /\.(?:db|duckdb|sqlite|sqlite3)(?:-(?:shm|wal))?$/
const sqliteSidecarPattern = /\.(?:db|duckdb|sqlite|sqlite3)-(?:shm|wal)$/

// Ratchet only: these historical files predate the workspace hygiene gate.
// Remove each exception in the same change that converts or untracks the file.
export const legacyTrackedRuntimePaths = [
  "data/market_data.db-shm",
  "data/market_data.db-wal",
  "data/trade.db-shm",
  "data/trade.db-wal",
  "modules/market-data-products/market-data-store/data/ohlcv.db",
  "modules/market-data-products/ohlcv-fetch/data/market_data.db",
  "modules/market-data-products/ohlcv-fetch/data/market_data.db-shm",
  "modules/market-data-products/ohlcv-fetch/data/market_data.db-wal",
  "modules/market-data-products/ohlcv-fetch/data/ohlcv.db",
  "modules/market-data-products/ohlcv-fetch/data/ohlcv.db-shm",
  "modules/market-data-products/ohlcv-fetch/data/ohlcv.db-wal",
  "modules/research-strategy-development/research-control-plane/certification/legacy-integration-suite/data/rd_state.db",
]

export function findWorkspaceHygieneIssues(
  snapshot: WorkspaceSnapshot,
  legacyPaths: string[] = legacyTrackedRuntimePaths,
): string[] {
  const tracked = new Set(snapshot.trackedPaths.map(normalizePath))
  const moduleRuntime = new Set(snapshot.moduleRuntimePaths.map(normalizePath))
  const legacy = new Set(legacyPaths.map(normalizePath))
  const issues: string[] = []

  for (const path of tracked) {
    if (isTrackedRuntimePath(path) && !legacy.has(path)) {
      issues.push(`tracked runtime SQLite file is forbidden: ${path}`)
    }
  }
  for (const path of moduleRuntime) {
    if (!legacy.has(path)) {
      issues.push(`module-local runtime SQLite file is forbidden: ${path}`)
    }
  }
  for (const path of legacy) {
    if (!tracked.has(path)) {
      issues.push(`remove stale legacy tracked-runtime exception: ${path}`)
    }
  }

  return issues.sort()
}

function isTrackedRuntimePath(path: string): boolean {
  if (sqliteSidecarPattern.test(path)) return true
  if (!sqliteRuntimePattern.test(path)) return false
  return path.startsWith("data/") || path.includes("/data/")
}

function normalizePath(path: string): string {
  return path.split(sep).join("/").replace(/^\.\//, "")
}

function trackedPaths(): string[] {
  const result = Bun.spawnSync(["git", "ls-files", "-z"], { cwd: root, stdout: "pipe", stderr: "pipe" })
  if (result.exitCode !== 0) {
    throw new Error(new TextDecoder().decode(result.stderr).trim() || "git ls-files failed")
  }
  return new TextDecoder().decode(result.stdout).split("\0").filter(Boolean)
}

function moduleRuntimePaths(): string[] {
  const paths: string[] = []
  walkModules(resolve(root, "modules"), paths)
  return paths
}

function walkModules(directory: string, paths: string[]): void {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    if (entry.isSymbolicLink()) continue
    const absolute = resolve(directory, entry.name)
    if (entry.isDirectory()) {
      if (["node_modules", "target", "tmp"].includes(entry.name)) continue
      if (entry.name === "data") {
        collectRuntimeFiles(absolute, paths)
      } else {
        walkModules(absolute, paths)
      }
      continue
    }
  }
}

function collectRuntimeFiles(directory: string, paths: string[]): void {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    if (entry.isSymbolicLink()) continue
    const absolute = resolve(directory, entry.name)
    if (entry.isDirectory()) {
      collectRuntimeFiles(absolute, paths)
    } else if (sqliteRuntimePattern.test(entry.name)) {
      paths.push(normalizePath(relative(root, absolute)))
    }
  }
}

function main(): void {
  const issues = findWorkspaceHygieneIssues({
    trackedPaths: trackedPaths(),
    moduleRuntimePaths: moduleRuntimePaths(),
  })
  if (issues.length > 0) {
    console.error(`workspace hygiene violations:\n${issues.join("\n")}`)
    process.exit(1)
  }
  console.log(`workspace hygiene ok; legacy tracked runtime ratchet: ${legacyTrackedRuntimePaths.length}`)
}

if (import.meta.main) main()
