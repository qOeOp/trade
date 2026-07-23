#!/usr/bin/env bun

import { readdirSync } from "node:fs"
import { execFileSync } from "node:child_process"
import { dirname, relative, resolve, sep } from "node:path"
import { fileURLToPath } from "node:url"

interface WorkspaceSnapshot {
  trackedPaths: string[]
  moduleRuntimePaths: string[]
}

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..")
const sqliteRuntimePattern = /\.(?:db|duckdb|sqlite|sqlite3)(?:-(?:shm|wal))?$/
const sqliteSidecarPattern = /\.(?:db|duckdb|sqlite|sqlite3)-(?:shm|wal)$/

export function findWorkspaceHygieneIssues(
  snapshot: WorkspaceSnapshot,
): string[] {
  const tracked = new Set(snapshot.trackedPaths.map(normalizePath))
  const moduleRuntime = new Set(snapshot.moduleRuntimePaths.map(normalizePath))
  const issues: string[] = []

  for (const path of tracked) {
    if (isTrackedRuntimePath(path)) {
      issues.push(`tracked runtime SQLite file is forbidden: ${path}`)
    }
  }
  for (const path of moduleRuntime) {
    issues.push(`module-local runtime SQLite file is forbidden: ${path}`)
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
  return execFileSync("git", ["ls-files", "-z"], { cwd: root, encoding: "utf8" }).split("\0").filter(Boolean)
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
  console.log("workspace hygiene ok; runtime SQLite exceptions: 0")
}

if (import.meta.main) main()
