#!/usr/bin/env bun

import { mkdirSync, realpathSync } from "node:fs"
import { dirname, resolve, sep } from "node:path"
import { Database } from "bun:sqlite"
import {
  runIsolatedAgentWorkspacePackageCheck,
  runIsolatedAgentWorkspaceSuiteCheck,
} from "../modules/orchestration-ops/agent-workspace-manager/src/lib/isolated-package-checker"
import {
  ensureAgentRunStoreSchema,
} from "../modules/orchestration-ops/ops-runtime-store/src/lib/agent-run-store"
import {
  runDeveloperPatchAdoption,
} from "./lib/rd-developer-patch-adoption"

interface AdoptionCliInput {
  repository_root: string
  ops_db: string
  adoption_id: string
  run_id: string
  checker_socket: string
}

async function main(): Promise<void> {
  const input = parseArgs(Bun.argv.slice(2))
  const root = realpathSync(resolve(input.repository_root))
  const dbPath = resolveInsideData(root, input.ops_db)
  mkdirSync(dirname(dbPath), { recursive: true, mode: 0o700 })
  const db = new Database(dbPath, { create: true })
  try {
    db.exec("PRAGMA journal_mode=WAL")
    db.exec("PRAGMA busy_timeout=5000")
    db.exec("PRAGMA foreign_keys=ON")
    ensureAgentRunStoreSchema(db)
    const result = await runDeveloperPatchAdoption({
      db,
      repository_root: root,
      adoption_id: input.adoption_id,
      run_id: input.run_id,
      workspace_slot: "candidate",
      run_package_check: (check) =>
        runIsolatedAgentWorkspacePackageCheck({
          socket_path: input.checker_socket,
          ...check,
        }),
      run_suite_check: (check) =>
        runIsolatedAgentWorkspaceSuiteCheck({
          socket_path: input.checker_socket,
          ...check,
        }),
    })
    console.log(JSON.stringify({ ok: true, result }))
  } finally {
    db.close()
  }
}

function parseArgs(argv: string[]): AdoptionCliInput {
  if (argv.length !== 2 || argv[0] !== "--json") {
    throw new Error("Developer patch adoption requires --json '<payload>'")
  }
  const value = JSON.parse(argv[1]!) as Record<string, unknown>
  return {
    repository_root: stringValue(value.repository_root)
      || process.env.TRADE_REPO_ROOT
      || process.cwd(),
    ops_db: repoPath(
      stringValue(value.ops_db)
        || process.env.TRADE_AGENT_OPS_DB
        || "data/ops/ops_runtime.db",
      "ops_db",
    ),
    adoption_id: identifier(
      stringValue(value.adoption_id)
        || process.env.TRADE_AGENT_ADOPTION_ID,
      "adoption_id",
    ),
    run_id: identifier(
      stringValue(value.run_id)
        || process.env.TRADE_AGENT_ADOPTION_RUN_ID,
      "run_id",
    ),
    checker_socket: absolutePath(
      stringValue(value.checker_socket)
        || process.env.TRADE_AGENT_RELEASE_CHECKER_SOCKET
        || "/app/control/release-checker.sock",
      "checker_socket",
    ),
  }
}

function resolveInsideData(root: string, value: string): string {
  const path = resolve(root, value)
  const dataRoot = resolve(root, "data")
  if (path !== dataRoot && !path.startsWith(`${dataRoot}${sep}`)) {
    throw new Error("Developer patch adoption DB escaped data root")
  }
  return path
}

function stringValue(value: unknown): string {
  return typeof value === "string" ? value : ""
}

function identifier(value: unknown, field: string): string {
  const text = stringValue(value)
  if (!/^[A-Za-z0-9][A-Za-z0-9._:-]{0,159}$/.test(text)) {
    throw new Error(`${field} is invalid`)
  }
  return text
}

function repoPath(value: string, field: string): string {
  if (!value || value.startsWith("/") || value.split("/").includes("..")
    || value.includes("\0")) {
    throw new Error(`${field} is invalid`)
  }
  return value
}

function absolutePath(value: string, field: string): string {
  if (!value.startsWith("/") || value.includes("\0") || value.length > 512) {
    throw new Error(`${field} is invalid`)
  }
  return value
}

if (import.meta.main) {
  main().catch((error) => {
    console.error(JSON.stringify({
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    }))
    process.exit(1)
  })
}
