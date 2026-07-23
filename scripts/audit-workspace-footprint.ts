#!/usr/bin/env bun

import { readdirSync, statSync } from "node:fs"
import { relative, resolve } from "node:path"
import { classifyWorkspacePath, type FootprintClass } from "./workspace-footprint"

const root = resolve(process.cwd())
const staleDays = numericFlag("--stale-days", 14)
const cutoffMs = Date.now() - staleDays * 86_400_000
const summary = new Map<FootprintClass, { files: number; bytes: number; stale_files: number; stale_bytes: number }>()

for (const start of ["data", "tmp", "modules", "node_modules"]) walk(resolve(root, start))

console.log(JSON.stringify({
  schema_version: "trade.workspace-footprint-audit.v1",
  dry_run: true,
  stale_days: staleDays,
  deletion_performed: false,
  classes: Object.fromEntries([...summary.entries()].sort(([left], [right]) => left.localeCompare(right))),
  policy: {
    protected_evidence_workspace: "report-only; catalog refs, ledger refs and .pin must be resolved before deletion",
    durable_db: "never a cleanup candidate",
    durable_data: "never a generic cleanup candidate",
    cleanup_candidates: ["test_residue", "build_cache", "dependency_cache", "external_audit_clone"],
  },
}, null, 2))

function walk(directory: string): void {
  let entries
  try {
    entries = readdirSync(directory, { withFileTypes: true })
  } catch {
    return
  }
  for (const entry of entries) {
    if (entry.isSymbolicLink()) continue
    const absolute = resolve(directory, entry.name)
    const path = relative(root, absolute).replaceAll("\\", "/")
    if (entry.isDirectory()) {
      walk(absolute)
      continue
    }
    if (!entry.isFile()) continue
    if (path.startsWith("modules/") && !path.includes("/target/") && !path.includes("/node_modules/")) continue
    const stat = statSync(absolute)
    const kind = classifyWorkspacePath(path)
    const current = summary.get(kind) ?? { files: 0, bytes: 0, stale_files: 0, stale_bytes: 0 }
    current.files += 1
    current.bytes += stat.size
    if (isCleanupClass(kind) && stat.mtimeMs < cutoffMs) {
      current.stale_files += 1
      current.stale_bytes += stat.size
    }
    summary.set(kind, current)
  }
}

function isCleanupClass(kind: FootprintClass): boolean {
  return ["test_residue", "build_cache", "dependency_cache", "external_audit_clone"].includes(kind)
}

function numericFlag(name: string, fallback: number): number {
  const index = process.argv.indexOf(name)
  if (index < 0) return fallback
  const value = Number(process.argv[index + 1])
  if (!Number.isInteger(value) || value < 1 || value > 3650) throw new Error(`${name} must be an integer from 1 to 3650`)
  return value
}
