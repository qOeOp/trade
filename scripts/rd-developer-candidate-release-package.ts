#!/usr/bin/env bun

import { realpathSync } from "node:fs"
import { resolve, sep } from "node:path"
import { Database } from "bun:sqlite"
import {
  createDeveloperCandidateServerPackage,
} from "./lib/rd-developer-candidate-release-package"

function main(): void {
  const input = parseArgs(Bun.argv.slice(2))
  const root = realpathSync(resolve(input.repository_root))
  const dbPath = resolve(root, input.ops_db)
  const dataRoot = resolve(root, "data")
  if (dbPath !== dataRoot && !dbPath.startsWith(`${dataRoot}${sep}`)) {
    throw new Error("Candidate package Ops DB escaped data root")
  }
  const db = new Database(dbPath, { readonly: true })
  try {
    db.exec("PRAGMA query_only=ON")
    db.exec("PRAGMA busy_timeout=5000")
    const result = createDeveloperCandidateServerPackage({
      db,
      repository_root: root,
      adoption_id: input.adoption_id,
      target_root: input.target_root,
    })
    console.log(JSON.stringify({ ok: true, result }))
  } finally {
    db.close()
  }
}

function parseArgs(argv: string[]): {
  repository_root: string
  ops_db: string
  adoption_id: string
  target_root: string
} {
  if (argv.length !== 2 || argv[0] !== "--json") {
    throw new Error("Candidate release package requires --json '<payload>'")
  }
  const value = JSON.parse(argv[1]!) as Record<string, unknown>
  return {
    repository_root: text(value.repository_root)
      || process.env.TRADE_REPO_ROOT
      || process.cwd(),
    ops_db: repoPath(
      text(value.ops_db)
        || process.env.TRADE_AGENT_OPS_DB
        || "data/ops/ops_runtime.db",
    ),
    adoption_id: identifier(value.adoption_id, "adoption_id"),
    target_root: absolutePath(value.target_root, "target_root"),
  }
}

function text(value: unknown): string {
  return typeof value === "string" ? value : ""
}

function identifier(value: unknown, field: string): string {
  const candidate = text(value)
  if (!/^[A-Za-z0-9][A-Za-z0-9._:-]{0,159}$/.test(candidate)) {
    throw new Error(`${field} is invalid`)
  }
  return candidate
}

function repoPath(value: string): string {
  if (!value || value.startsWith("/") || value.includes("\0")
    || value.split("/").includes("..")) {
    throw new Error("ops_db is invalid")
  }
  return value
}

function absolutePath(value: unknown, field: string): string {
  const candidate = text(value)
  if (!candidate.startsWith("/") || candidate.includes("\0")
    || candidate.length > 1024) {
    throw new Error(`${field} is invalid`)
  }
  return candidate
}

if (import.meta.main) {
  try {
    main()
  } catch (error) {
    console.error(JSON.stringify({
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    }))
    process.exit(1)
  }
}
