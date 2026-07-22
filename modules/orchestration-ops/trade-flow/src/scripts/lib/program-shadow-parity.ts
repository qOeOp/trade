import { Database } from "bun:sqlite"
import {
  ensureOpsRuntimeSchema,
  recordRuntimeParityObservation,
  type RuntimeParityObservation,
} from "../../../../ops-runtime-store/src/lib/ops-runtime-store"
import type { JSONRecord } from "../../../../../contracts/runtime-core/src/json"
import { canonicalJson } from "../../../../../contracts/runtime-core/src/canonical-json"
import {
  runAutomationJobGraph,
  type CommandExecutor,
  type CommandExecutionResult,
} from "./job-graph-runner"

export const SHARED_PARITY_COMPARISON_BASIS = "shared_owner_result_replay_v1"

export function createParityCommandRecorder(baseExecutor: CommandExecutor): {
  record: CommandExecutor
  replay: CommandExecutor
} {
  const captured = new Map<string, CommandExecutionResult[]>()
  return {
    record: async (command, options) => {
      const result = await baseExecutor(command, options)
      const key = parityCommandKey(command)
      captured.set(key, [...(captured.get(key) ?? []), { ...result }])
      return result
    },
    replay: async (command) => {
      const key = parityCommandKey(command)
      const queue = captured.get(key) ?? []
      const result = queue.shift()
      if (!result) {
        return {
          exit_code: 125,
          stdout: "",
          stderr: `parity replay omitted captured owner result for ${key || "unknown-owner"}`,
        }
      }
      captured.set(key, queue)
      return { ...result }
    },
  }
}

function parityCommandKey(command: Parameters<CommandExecutor>[0]): string {
  return canonicalJson({
    executable: command.executable,
    cwd: command.cwd,
    argv: command.argv.map(normalizeParityCommandArg),
  })
}

function normalizeParityCommandArg(value: string): unknown {
  try {
    return stripParityInvocationIdentity(JSON.parse(value))
  } catch {
    return value
  }
}

function stripParityInvocationIdentity(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stripParityInvocationIdentity)
  if (!value || typeof value !== "object") return value
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .filter(([key]) => !PARITY_INVOCATION_IDENTITY_FIELDS.has(key))
      .map(([key, item]) => [key, stripParityInvocationIdentity(item)]),
  )
}

const PARITY_INVOCATION_IDENTITY_FIELDS = new Set([
  "attempted_at",
  "cycle_id",
  "generated_at",
  "health_id",
  "notify_id",
  "now",
  "observed_at",
  "review_id",
])

export async function observeProgramShadowParity(
  tradeDb: Database,
  tradeDbPath: string,
  input: {
    program_cycle_id: string
    agent_cycle_id: string
    now: string
    observed_at: string
    ops_runtime_db: string
    program_graph: JSONRecord
    runtime_health?: JSONRecord
  },
  executor?: CommandExecutor,
): Promise<JSONRecord> {
  const agentGraph = await runAutomationJobGraph(
    tradeDb,
    tradeDbPath,
    legacyAgentShadowGraphInput(input),
    executor,
  )
  const programProjection = requiredProjection(input.program_graph, "program")
  const agentProjection = requiredProjection(agentGraph, "Agent")
  const programHash = requiredHash(programProjection, "program")
  const agentHash = requiredHash(agentProjection, "Agent")
  const status = programHash === agentHash ? "match" : "mismatch"
  const observation: RuntimeParityObservation = {
    observation_id: `parity:${input.program_cycle_id}`,
    program_cycle_id: input.program_cycle_id,
    agent_cycle_id: input.agent_cycle_id,
    program_projection_hash: programHash,
    agent_projection_hash: agentHash,
    status,
    detail_json: {
      comparison_basis: SHARED_PARITY_COMPARISON_BASIS,
      program: programProjection,
      agent: agentProjection,
    },
    observed_at: input.observed_at,
  }
  const opsDb = new Database(input.ops_runtime_db)
  try {
    opsDb.run("PRAGMA busy_timeout = 1000")
    ensureOpsRuntimeSchema(opsDb)
    recordRuntimeParityObservation(opsDb, observation)
  } finally {
    opsDb.close()
  }
  return {
    schema_version: "trade-flow.program-shadow-parity-observation.v1",
    comparison_basis: SHARED_PARITY_COMPARISON_BASIS,
    ...observation,
  }
}

function legacyAgentShadowGraphInput(input: {
  agent_cycle_id: string
  now: string
  observed_at: string
  ops_runtime_db: string
  runtime_health?: JSONRecord
}): JSONRecord {
  const attemptId = input.agent_cycle_id.replace(/[^A-Za-z0-9_-]/g, "-")
  return {
    cycle_id: input.agent_cycle_id,
    now: input.now,
    ops_runtime_db: input.ops_runtime_db,
    command_timeout_ms: 30_000,
    execute_jobs: true,
    allow_live_writes: false,
    include_runtime_health: true,
    include_account_reconcile: false,
    include_fast_track: false,
    include_slow_track: false,
    include_rd_strategy_supervisor: false,
    include_rd_trackers: false,
    include_closed_flow_review: false,
    include_catalog_hygiene: false,
    include_control_effectiveness_review: true,
    include_ops_notify: true,
    runtime_health: {
      ...(input.runtime_health ?? {}),
      require_l2_ready: true,
      require_l2_watch_consumer_ready: true,
      health_id: `health-${attemptId}`,
      observed_at: input.observed_at,
    },
    control_effectiveness_review: {
      review_id: `control-review-${attemptId}`,
      now: input.observed_at,
    },
    ops_notify: {
      dry_run: true,
      notify_id: `notify-${attemptId}`,
      attempted_at: input.observed_at,
    },
  }
}

function requiredProjection(graph: JSONRecord, owner: string): JSONRecord {
  const projection = asRecord(graph.parity_projection)
  if (projection.schema_version !== "trade-flow.job-graph-parity-projection.v1") {
    throw new Error(`${owner} graph omitted the parity projection`)
  }
  return projection
}

function requiredHash(projection: JSONRecord, owner: string): string {
  const hash = typeof projection.projection_hash === "string" ? projection.projection_hash.trim() : ""
  if (!hash) throw new Error(`${owner} parity projection omitted its hash`)
  return hash
}

function asRecord(value: unknown): JSONRecord {
  return value && typeof value === "object" && !Array.isArray(value) ? value as JSONRecord : {}
}
