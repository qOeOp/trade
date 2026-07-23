import { createHash } from "node:crypto"
import { join } from "node:path"
import { Database } from "bun:sqlite"
import {
  assertDatabaseIdentity,
  buildDatabaseIdentity,
} from "../../../../../contracts/runtime-core/src/database-identity"
import {
  assertProjectRuntimePath,
  resolveRepoPath,
} from "../../../../../contracts/runtime-core/src/paths"
import {
  assertDraftStrategyCompilerSourceSchema,
  compileDraftStrategyInput,
} from "./draft-strategy-compiler"
import {
  claimStrategyRegistryJob,
  completeStrategyRegistryJob,
  ensureStrategyRegistryJobQueueSchema,
  failStrategyRegistryJob,
  reconcileAcceptedDraftJobs,
  type StrategyRegistryJobLease,
} from "./strategy-registry-job-queue"
import {
  ensureStrategyRegistrySchema,
  materializeDraftStrategy,
} from "./strategy-registry"
import { publishStrategySourceCandidate } from "./strategy-source-candidate"

export const STRATEGY_REGISTRY_RESIDENT_CYCLE_SCHEMA =
  "trade.rd-strategy-registry-resident-cycle.v1" as const

export interface StrategyRegistryResidentCycleInput {
  environment_id: string
  worker_id: string
  candidate_root: string
  lease_duration_ms: number
  max_attempts: number
}

export interface StrategyRegistryResidentCycleResult {
  schema_version: typeof STRATEGY_REGISTRY_RESIDENT_CYCLE_SCHEMA
  status: "idle" | "completed" | "retrying" | "dead_letter"
  job_id: string | null
  decision_id: string | null
  draft_id: string | null
  strategy_ref: string | null
  candidate_manifest_ref: string | null
  candidate_manifest_hash: string | null
  failure_class: string | null
  release_authority: "candidate_source_only" | "none"
  deployment_authority: "none"
  trading_authority: false
}

interface Dependencies {
  now(): Date
  compile: typeof compileDraftStrategyInput
  materialize: typeof materializeDraftStrategy
}

const DEFAULT_DEPENDENCIES: Dependencies = {
  now: () => new Date(),
  compile: compileDraftStrategyInput,
  materialize: materializeDraftStrategy,
}

export function runStrategyRegistryResidentCycle(input: {
  db_path: string
  config: StrategyRegistryResidentCycleInput
  dependencies?: Dependencies
}): StrategyRegistryResidentCycleResult {
  assertProjectRuntimePath(input.db_path)
  assertProjectRuntimePath(input.config.candidate_root)
  const dependencies = input.dependencies ?? DEFAULT_DEPENDENCIES
  const workerId = identifier(input.config.worker_id, "worker_id")
  const db = new Database(
    resolveRepoPath(input.db_path),
    { readwrite: true, create: false },
  )
  let lease: StrategyRegistryJobLease | null = null
  try {
    db.exec("PRAGMA busy_timeout=5000")
    assertDatabaseIdentity(
      db,
      buildDatabaseIdentity(input.config.environment_id, "research_state_store"),
    )
    assertDraftStrategyCompilerSourceSchema(db)
    ensureStrategyRegistrySchema(db)
    ensureStrategyRegistryJobQueueSchema(db)
    const observedAt = dependencies.now().toISOString()
    reconcileAcceptedDraftJobs(db, observedAt)
    lease = claimStrategyRegistryJob(db, {
      worker_id: workerId,
      claimed_at: observedAt,
      lease_duration_ms: input.config.lease_duration_ms,
      max_attempts: input.config.max_attempts,
    })
    if (!lease) return idle()
    const decisionRoot = join(
      input.config.candidate_root,
      createHash("sha256").update(lease.decision_id).digest("hex").slice(0, 32),
    )
    const compiled = dependencies.compile(db, {
      decision_id: lease.decision_id,
      strategy_root: join(decisionRoot, "strategies"),
    })
    const binding = dependencies.materialize(db, compiled)
    const candidate = publishStrategySourceCandidate({
      decision_root: decisionRoot,
      compiled,
      binding,
    })
    completeStrategyRegistryJob(db, {
      lease,
      worker_id: workerId,
      completed_at: dependencies.now().toISOString(),
      draft_id: binding.draft_id,
      strategy_ref: binding.strategy_ref,
      strategy_policy_hash: binding.strategy_policy_hash,
      candidate_manifest_ref: candidate.manifest_ref,
      candidate_manifest_hash: candidate.manifest.manifest_hash,
    })
    return {
      schema_version: STRATEGY_REGISTRY_RESIDENT_CYCLE_SCHEMA,
      status: "completed",
      job_id: lease.job_id,
      decision_id: lease.decision_id,
      draft_id: binding.draft_id,
      strategy_ref: binding.strategy_ref,
      candidate_manifest_ref: candidate.manifest_ref,
      candidate_manifest_hash: candidate.manifest.manifest_hash,
      failure_class: null,
      release_authority: "candidate_source_only",
      deployment_authority: "none",
      trading_authority: false,
    }
  } catch (error) {
    if (!lease) throw error
    const message = error instanceof Error ? error.message : String(error)
    const permanent = isPermanent(message)
    const status = failStrategyRegistryJob(db, {
      lease,
      worker_id: workerId,
      observed_at: dependencies.now().toISOString(),
      error: message,
      permanent,
      max_attempts: input.config.max_attempts,
    })
    return {
      schema_version: STRATEGY_REGISTRY_RESIDENT_CYCLE_SCHEMA,
      status: status === "dead_letter" ? "dead_letter" : "retrying",
      job_id: lease.job_id,
      decision_id: lease.decision_id,
      draft_id: null,
      strategy_ref: null,
      candidate_manifest_ref: null,
      candidate_manifest_hash: null,
      failure_class: permanent
        ? "owner_contract_drift"
        : "candidate_storage_unavailable",
      release_authority: "none",
      deployment_authority: "none",
      trading_authority: false,
    }
  } finally {
    db.close()
  }
}

function isPermanent(message: string): boolean {
  return /(?:drift|collision|different authority|invalid|required|missing|does not match|not authorized|not a regular file|content)/i.test(message)
}

function idle(): StrategyRegistryResidentCycleResult {
  return {
    schema_version: STRATEGY_REGISTRY_RESIDENT_CYCLE_SCHEMA,
    status: "idle",
    job_id: null,
    decision_id: null,
    draft_id: null,
    strategy_ref: null,
    candidate_manifest_ref: null,
    candidate_manifest_hash: null,
    failure_class: null,
    release_authority: "none",
    deployment_authority: "none",
    trading_authority: false,
  }
}

function identifier(value: unknown, field: string): string {
  if (typeof value !== "string"
      || !/^[A-Za-z0-9][A-Za-z0-9:._-]{0,159}$/.test(value)) {
    throw new Error(`${field} is invalid`)
  }
  return value
}
