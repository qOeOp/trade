#!/usr/bin/env bun

import { Database } from "bun:sqlite"
import { realpathSync } from "node:fs"
import { resolve, sep } from "node:path"
import type { AgentArtifactRef } from "../apps/contracts/agent-run-contract/src/agent-run-contract"
import {
  buildDatabaseIdentity,
  ensureDatabaseIdentity,
} from "../apps/contracts/runtime-core/src/database-identity"
import { ensureAgentRunStoreSchema } from "../apps/orchestration-ops/ops-runtime-store/src/lib/agent-run-store"
import { configureAgentCycleDatabase } from "../apps/research-strategy-development/research-control-plane/agent-run-orchestrator/src/lib/agent-cycle-cli"
import {
  createDeveloperDataSnapshotBinding,
  type DeveloperDataSnapshotBinding,
} from "../apps/research-strategy-development/research-control-plane/agent-run-orchestrator/src/lib/developer-capability-assessment"
import { ensureResearchStateSchema } from "../apps/research-strategy-development/research-control-plane/state-store/src/lib/research-state-store"
import { runDeveloperWorkspaceCycle } from "./lib/rd-developer-workspace-cycle"

type JSONRecord = Record<string, unknown>

async function main(): Promise<void> {
  const input = parseInput(Bun.argv.slice(2))
  const root = realpathSync(resolve(input.repository_root))
  const researchDbPath = dataPath(root, input.research_db)
  const opsDbPath = dataPath(root, input.ops_db)
  const researchDb = new Database(researchDbPath, { create: true })
  const opsDb = new Database(opsDbPath, { create: true })
  try {
    configureAgentCycleDatabase(researchDb)
    configureAgentCycleDatabase(opsDb)
    ensureResearchStateSchema(researchDb)
    ensureDatabaseIdentity(
      opsDb,
      buildDatabaseIdentity(input.environment_id, "ops_runtime_store"),
    )
    ensureAgentRunStoreSchema(opsDb)
    const result = await runDeveloperWorkspaceCycle({
      research_db: researchDb,
      ops_db: opsDb,
      repository_root: root,
      codex_path: input.codex_path,
      allowed_write_prefixes: input.allowed_write_prefixes,
      package_paths: input.package_paths,
      developer_run_id: input.run_id,
      trace_id: input.trace_id,
      idempotency_key: input.idempotency_key,
      source_revision: input.source_revision,
      requested_at: input.requested_at,
      deadline_at: input.deadline_at,
      proposal_id: input.proposal_id,
      proposal_revision: input.proposal_revision,
      brief_id: input.brief_id,
      ...(input.predecessor_run_id == null
        ? {}
        : { predecessor_run_id: input.predecessor_run_id }),
      ...(input.predecessor_patch_ref == null
        ? {}
        : { predecessor_patch_ref: input.predecessor_patch_ref }),
      replay_result_refs: input.replay_result_refs,
      ...(input.data_snapshot_binding == null
        ? {}
        : { data_snapshot_binding: input.data_snapshot_binding }),
      poll_interval_ms: input.poll_interval_ms,
    })
    console.log(JSON.stringify({ ok: true, result }))
  } finally {
    researchDb.close()
    opsDb.close()
  }
}

function parseInput(argv: string[]): {
  repository_root: string
  research_db: string
  ops_db: string
  environment_id: string
  codex_path: string
  allowed_write_prefixes: string[]
  package_paths: string[]
  run_id: string
  trace_id: string
  idempotency_key: string
  source_revision: string
  requested_at: string
  deadline_at: string
  proposal_id: string
  proposal_revision: number
  brief_id: string
  predecessor_run_id: string | null
  predecessor_patch_ref: AgentArtifactRef | null
  replay_result_refs: AgentArtifactRef[]
  data_snapshot_binding: DeveloperDataSnapshotBinding | null
  poll_interval_ms: number
} {
  if (argv.length !== 2 || argv[0] !== "--json") {
    throw new Error("Developer workspace cycle requires --json '<payload>'")
  }
  const value = JSON.parse(argv[1]!) as JSONRecord
  const requestedAt = utc(
    text(value.requested_at) || new Date().toISOString(),
    "requested_at",
  )
  const codexPath = text(value.codex_path)
    || process.env.TRADE_CODEX_PATH
    || Bun.which("codex")
  if (!codexPath || !codexPath.startsWith("/")) {
    throw new Error("codex_path must resolve to an absolute executable")
  }
  return {
    repository_root: text(value.repository_root)
      || process.env.TRADE_REPO_ROOT
      || process.cwd(),
    research_db: repoPath(text(value.research_db) || "data/rd_state.db", "research_db"),
    ops_db: repoPath(text(value.ops_db) || "data/ops_runtime.db", "ops_db"),
    environment_id: identifier(
      value.environment_id ?? process.env.TRADE_ENVIRONMENT_ID ?? "local:local",
      "environment_id",
    ),
    codex_path: codexPath,
    allowed_write_prefixes: paths(
      value.allowed_write_prefixes,
      "allowed_write_prefixes",
    ),
    package_paths: value.package_paths == null
      ? [repoPath(text(value.package_path), "package_path")]
      : paths(value.package_paths, "package_paths"),
    run_id: identifier(value.run_id, "run_id"),
    trace_id: identifier(value.trace_id, "trace_id"),
    idempotency_key: identifier(value.idempotency_key, "idempotency_key"),
    source_revision: revision(value.source_revision),
    requested_at: requestedAt,
    deadline_at: utc(
      text(value.deadline_at)
        || new Date(Date.parse(requestedAt) + 30 * 60_000).toISOString(),
      "deadline_at",
    ),
    proposal_id: identifier(value.proposal_id, "proposal_id"),
    proposal_revision: integer(
      value.proposal_revision,
      1,
      1_000_000,
      "proposal_revision",
    ),
    brief_id: identifier(value.brief_id, "brief_id"),
    predecessor_run_id: value.predecessor_run_id == null
      ? null
      : identifier(value.predecessor_run_id, "predecessor_run_id"),
    predecessor_patch_ref: value.predecessor_patch_ref == null
      ? null
      : artifactRef(value.predecessor_patch_ref, "predecessor_patch_ref"),
    replay_result_refs: artifactRefs(value.replay_result_refs),
    data_snapshot_binding: value.data_snapshot_binding == null
      ? null
      : createDeveloperDataSnapshotBinding(
        value.data_snapshot_binding as DeveloperDataSnapshotBinding,
      ),
    poll_interval_ms: integer(
      value.poll_interval_ms ?? 1_000,
      10,
      30_000,
      "poll_interval_ms",
    ),
  }
}

function artifactRefs(value: unknown): AgentArtifactRef[] {
  if (value == null) return []
  if (!Array.isArray(value) || value.length > 32) {
    throw new Error("replay_result_refs must be bounded")
  }
  return value.map((item, index) =>
    artifactRef(item, `replay_result_refs[${index}]`))
}

function artifactRef(value: unknown, field: string): AgentArtifactRef {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${field} is invalid`)
  }
  const ref = value as JSONRecord
  const mediaType = text(ref.media_type)
  const result: AgentArtifactRef = {
    ref: repoOrOpaqueRef(ref.ref, `${field}.ref`),
    sha256: digest(ref.sha256, `${field}.sha256`),
    media_type: mediaType as AgentArtifactRef["media_type"],
    bytes: integer(
      ref.bytes,
      0,
      16 * 1024 * 1024,
      `${field}.bytes`,
    ),
  }
  if (!["application/json", "text/markdown", "text/x-diff", "text/plain"]
    .includes(result.media_type)) {
    throw new Error(`${field}.media_type is invalid`)
  }
  return result
}

function paths(value: unknown, field: string): string[] {
  if (!Array.isArray(value) || value.length < 1 || value.length > 32) {
    throw new Error(`${field} must be bounded and non-empty`)
  }
  const result = value.map((item) => repoPath(text(item), field)).sort()
  if (new Set(result).size !== result.length) {
    throw new Error(`${field} must be unique`)
  }
  return result
}

function dataPath(root: string, value: string): string {
  const path = resolve(root, value)
  const dataRoot = resolve(root, "data")
  if (path !== dataRoot && !path.startsWith(`${dataRoot}${sep}`)) {
    throw new Error("Developer workspace database escaped data root")
  }
  return path
}

function repoPath(value: string, field: string): string {
  const normalized = value.replaceAll("\\", "/").replace(/\/+$/, "")
  if (!normalized || normalized.startsWith("/")
    || normalized.split("/").includes("..") || normalized.includes("\0")) {
    throw new Error(`${field} is invalid`)
  }
  return normalized
}

function repoOrOpaqueRef(value: unknown, field: string): string {
  const result = text(value)
  if (!result || result.startsWith("/") || result.split("/").includes("..")) {
    throw new Error(`${field} is invalid`)
  }
  return result
}

function identifier(value: unknown, field: string): string {
  const result = text(value)
  if (!/^[A-Za-z0-9][A-Za-z0-9._:-]{0,159}$/.test(result)) {
    throw new Error(`${field} is invalid`)
  }
  return result
}

function revision(value: unknown): string {
  const result = text(value)
  if (!/^[A-Za-z0-9][A-Za-z0-9._+-]{0,127}$/.test(result)) {
    throw new Error("source_revision is invalid")
  }
  return result
}

function digest(value: unknown, field: string): string {
  const result = text(value)
  if (!/^[a-f0-9]{64}$/.test(result)) throw new Error(`${field} is invalid`)
  return result
}

function integer(
  value: unknown,
  minimum: number,
  maximum: number,
  field: string,
): number {
  const result = Number(value)
  if (!Number.isSafeInteger(result)
    || result < minimum || result > maximum) {
    throw new Error(`${field} is invalid`)
  }
  return result
}

function utc(value: string, field: string): string {
  const date = new Date(value)
  if (!Number.isFinite(date.getTime()) || date.toISOString() !== value) {
    throw new Error(`${field} must be canonical UTC`)
  }
  return value
}

function text(value: unknown): string {
  return typeof value === "string" ? value : ""
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
