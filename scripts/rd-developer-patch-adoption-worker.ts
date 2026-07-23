#!/usr/bin/env bun

import { existsSync, mkdirSync, realpathSync, rmSync, writeFileSync } from "node:fs"
import { dirname, resolve, sep } from "node:path"
import { Database } from "bun:sqlite"
import {
  runIsolatedAgentWorkspacePackageCheck,
  runIsolatedAgentWorkspaceSuiteCheck,
} from "../modules/orchestration-ops/agent-workspace-manager/src/lib/isolated-package-checker"
import {
  listRecoverableAgentPatchAdoptions,
} from "../modules/orchestration-ops/ops-runtime-store/src/lib/agent-patch-adoption-store"
import {
  ensureAgentRunStoreSchema,
} from "../modules/orchestration-ops/ops-runtime-store/src/lib/agent-run-store"
import {
  ensureStrategySourceAdoptionStoreSchema,
  listRecoverableStrategySourceAdoptions,
} from "../modules/orchestration-ops/ops-runtime-store/src/lib/strategy-source-adoption-store"
import {
  runDeveloperPatchAdoption,
} from "./lib/rd-developer-patch-adoption"
import {
  discoverAndQueueStrategySourceCandidates,
  runStrategySourceAdoption,
} from "./lib/rd-strategy-source-adoption"

async function main(): Promise<void> {
  const input = parseArgs(Bun.argv.slice(2))
  const root = realpathSync(resolve(input.repository_root))
  const dbPath = resolveInsideData(root, input.ops_db)
  mkdirSync(dirname(dbPath), { recursive: true, mode: 0o700 })
  const db = new Database(dbPath, { create: true })
  db.exec("PRAGMA journal_mode=WAL")
  db.exec("PRAGMA busy_timeout=5000")
  db.exec("PRAGMA foreign_keys=ON")
  ensureAgentRunStoreSchema(db)
  ensureStrategySourceAdoptionStoreSchema(db)
  let closing = false
  const close = () => {
    closing = true
  }
  process.on("SIGINT", close)
  process.on("SIGTERM", close)
  if (existsSync(input.ready_file)) rmSync(input.ready_file)
  writeFileSync(input.ready_file, "ready\n", { flag: "wx", mode: 0o600 })
  console.log(JSON.stringify({
    schema_version: "trade.agent-patch-adoption-worker-start.v1",
    status: "ready",
  }))
  try {
    while (!closing) {
      const next = listRecoverableAgentPatchAdoptions(db, 1)[0]
      if (next) {
        try {
          const result = await runDeveloperPatchAdoption({
            db,
            repository_root: root,
            adoption_id: next.adoption_id,
            run_id: next.run_id,
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
          console.log(JSON.stringify({
            schema_version: "trade.agent-patch-adoption-worker-result.v1",
            adoption_id: result.adoption_id,
            status: "candidate_certified",
            manifest_sha256: result.manifest_sha256,
          }))
        } catch (error) {
          console.error(JSON.stringify({
            schema_version: "trade.agent-patch-adoption-worker-error.v1",
            adoption_id: next.adoption_id,
            error_class: error instanceof Error ? error.name : "Error",
          }))
          await delay(input.poll_interval_ms)
        }
      }
      try {
        discoverAndQueueStrategySourceCandidates({
          db,
          repository_root: root,
          limit: 100,
        })
      } catch (error) {
        console.error(JSON.stringify({
          schema_version: "trade.strategy-source-discovery-worker-error.v1",
          error_class: error instanceof Error ? error.name : "Error",
        }))
      }
      const strategy = listRecoverableStrategySourceAdoptions(db, 1)[0]
      if (strategy) {
        try {
          const result = await runStrategySourceAdoption({
            db,
            repository_root: root,
            adoption_id: strategy.adoption_id,
            workspace_slot: "candidate",
            run_suite_check: (check) =>
              runIsolatedAgentWorkspaceSuiteCheck({
                socket_path: input.checker_socket,
                ...check,
              }),
          })
          console.log(JSON.stringify({
            schema_version: "trade.strategy-source-adoption-worker-result.v1",
            adoption_id: result.adoption_id,
            status: "candidate_certified",
            manifest_hash: result.manifest.manifest_hash,
          }))
        } catch (error) {
          console.error(JSON.stringify({
            schema_version: "trade.strategy-source-adoption-worker-error.v1",
            adoption_id: strategy.adoption_id,
            error_class: error instanceof Error ? error.name : "Error",
          }))
          await delay(input.poll_interval_ms)
          continue
        }
      }
      if (!next && !strategy) await delay(input.poll_interval_ms)
    }
  } finally {
    if (existsSync(input.ready_file)) rmSync(input.ready_file)
    db.close()
  }
}

function parseArgs(argv: string[]): {
  repository_root: string
  ops_db: string
  checker_socket: string
  ready_file: string
  poll_interval_ms: number
} {
  const values = new Map<string, string>()
  for (let index = 0; index < argv.length; index += 2) {
    const flag = argv[index]
    const value = argv[index + 1]
    if (!flag?.startsWith("--") || value == null) {
      throw new Error("Patch adoption worker arguments must be --key value pairs")
    }
    values.set(flag.slice(2), value)
  }
  return {
    repository_root: values.get("repository-root")
      || process.env.TRADE_REPO_ROOT
      || process.cwd(),
    ops_db: repoPath(
      values.get("ops-db")
        || process.env.TRADE_AGENT_OPS_DB
        || "data/ops/ops_runtime.db",
      "ops_db",
    ),
    checker_socket: absolutePath(
      values.get("checker-socket")
        || process.env.TRADE_AGENT_RELEASE_CHECKER_SOCKET
        || "/app/control/release-checker.sock",
      "checker_socket",
    ),
    ready_file: absolutePath(
      values.get("ready-file") || "/app/control/adopter.ready",
      "ready_file",
    ),
    poll_interval_ms: boundedInteger(
      values.get("poll-interval-ms") ?? "5000",
      100,
      60_000,
      "poll_interval_ms",
    ),
  }
}

function resolveInsideData(root: string, value: string): string {
  const path = resolve(root, value)
  const dataRoot = resolve(root, "data")
  if (path !== dataRoot && !path.startsWith(`${dataRoot}${sep}`)) {
    throw new Error("Patch adoption worker DB escaped data root")
  }
  return path
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

function boundedInteger(
  value: string,
  minimum: number,
  maximum: number,
  field: string,
): number {
  const number = Number(value)
  if (!Number.isSafeInteger(number) || number < minimum || number > maximum) {
    throw new Error(`${field} is invalid`)
  }
  return number
}

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolveDelay) => setTimeout(resolveDelay, milliseconds))
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
