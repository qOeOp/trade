#!/usr/bin/env bun

import {
  existsSync,
  mkdirSync,
  realpathSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs"
import { dirname, resolve } from "node:path"
import { Database } from "bun:sqlite"
import {
  listCertifiedStrategySourceAdoptions,
} from "../apps/orchestration-ops/ops-runtime-store/src/lib/strategy-source-adoption-store"
import {
  readForwardSourceAdmission,
} from "../apps/research-strategy-development/research-control-plane/state-store/src/lib/forward-source-admission"
import {
  ensureResearchControlPlaneSchema,
} from "../apps/research-strategy-development/research-control-plane/state-store/src/lib/research-control-plane-schema"
import {
  admitCertifiedStrategyAdoptionToForward,
} from "./lib/rd-forward-source-admission"
import {
  resolveWorkerDataPath,
  workerAbsolutePath,
  workerBoundedInteger,
  workerDelay,
  workerRepoPath,
} from "./lib/resident-worker-cli"

async function main(): Promise<void> {
  const input = parseArgs(Bun.argv.slice(2))
  const root = realpathSync(resolve(input.repository_root))
  const researchPath = resolveWorkerDataPath(
    root,
    input.research_db,
    "Forward source worker Research DB",
  )
  const opsPath = resolveWorkerDataPath(
    root,
    input.ops_db,
    "Forward source worker Ops DB",
  )
  mkdirSync(dirname(researchPath), { recursive: true, mode: 0o700 })
  const researchDb = new Database(researchPath, { create: true })
  const opsDb = new Database(opsPath, { readonly: true })
  researchDb.exec("PRAGMA journal_mode=WAL")
  researchDb.exec("PRAGMA busy_timeout=5000")
  researchDb.exec("PRAGMA foreign_keys=ON")
  opsDb.exec("PRAGMA query_only=ON")
  opsDb.exec("PRAGMA busy_timeout=5000")
  ensureResearchControlPlaneSchema(researchDb)
  let closing = false
  const close = () => {
    closing = true
  }
  process.on("SIGINT", close)
  process.on("SIGTERM", close)
  mkdirSync(dirname(input.ready_file), { recursive: true, mode: 0o700 })
  if (existsSync(input.ready_file)) rmSync(input.ready_file)
  writeFileSync(input.ready_file, "ready\n", { flag: "wx", mode: 0o600 })
  writeState(input.state_file, {
    status: "running",
    updated_at: new Date().toISOString(),
    admitted_count: 0,
    failure_count: 0,
  })
  try {
    while (!closing) {
      let admittedCount = 0
      let failureCount = 0
      const records = listCertifiedStrategySourceAdoptions(opsDb, 1_000)
      for (const record of records) {
        const admissionId =
          `forward-source:${record.source_candidate_manifest_hash.slice(0, 48)}`
        if (readForwardSourceAdmission(researchDb, admissionId)) continue
        try {
          const binding = admitCertifiedStrategyAdoptionToForward({
            research_db: researchDb,
            ops_db: opsDb,
            repository_root: root,
            adoption_id: record.adoption_id,
          })
          admittedCount += 1
          console.log(JSON.stringify({
            schema_version:
              "trade.rd-forward-source-admission-worker-result.v1",
            admission_id: binding.admission_id,
            experiment_id: binding.experiment_id,
            status: "forward_source_admitted",
            deployment_authority: "none",
            trading_authority: false,
          }))
        } catch (error) {
          failureCount += 1
          console.error(JSON.stringify({
            schema_version:
              "trade.rd-forward-source-admission-worker-error.v1",
            adoption_id: record.adoption_id,
            error_class: error instanceof Error ? error.name : "Error",
          }))
        }
      }
      writeState(input.state_file, {
        status: "running",
        updated_at: new Date().toISOString(),
        admitted_count: admittedCount,
        failure_count: failureCount,
      })
      await workerDelay(input.poll_interval_ms)
    }
  } finally {
    if (existsSync(input.ready_file)) rmSync(input.ready_file)
    writeState(input.state_file, {
      status: "stopped",
      updated_at: new Date().toISOString(),
      admitted_count: 0,
      failure_count: 0,
    })
    opsDb.close()
    researchDb.close()
  }
}

function parseArgs(argv: string[]): {
  repository_root: string
  research_db: string
  ops_db: string
  ready_file: string
  state_file: string
  poll_interval_ms: number
} {
  const values = new Map<string, string>()
  for (let index = 0; index < argv.length; index += 2) {
    const flag = argv[index]
    const value = argv[index + 1]
    if (!flag?.startsWith("--") || value == null) {
      throw new Error(
        "Forward source worker arguments must be --key value pairs",
      )
    }
    values.set(flag.slice(2), value)
  }
  return {
    repository_root: values.get("repository-root")
      || process.env.TRADE_REPO_ROOT
      || process.cwd(),
    research_db: workerRepoPath(
      values.get("research-db")
        || process.env.TRADE_RD_STATE_DB
        || "data/rd_state.db",
      "research_db",
    ),
    ops_db: workerRepoPath(
      values.get("ops-db")
        || process.env.TRADE_AGENT_OPS_DB
        || "data/ops/ops_runtime.db",
      "ops_db",
    ),
    ready_file: workerAbsolutePath(
      values.get("ready-file")
        || "/app/tmp/runtime/forward-source-admission-worker/ready",
      "ready_file",
    ),
    state_file: workerAbsolutePath(
      values.get("state-file")
        || "/app/tmp/runtime/forward-source-admission-worker/state.json",
      "state_file",
    ),
    poll_interval_ms: workerBoundedInteger(
      values.get("poll-interval-ms") ?? "5000",
      100,
      60_000,
      "poll_interval_ms",
    ),
  }
}

function writeState(
  path: string,
  value: {
    status: "running" | "stopped"
    updated_at: string
    admitted_count: number
    failure_count: number
  },
): void {
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 })
  const temporary = `${path}.${process.pid}.tmp`
  writeFileSync(temporary, `${JSON.stringify({
    schema_version: "trade.rd-forward-source-admission-worker-state.v1",
    ...value,
    deployment_authority: "none",
    trading_authority: false,
  })}\n`, { mode: 0o600 })
  renameSync(temporary, path)
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
