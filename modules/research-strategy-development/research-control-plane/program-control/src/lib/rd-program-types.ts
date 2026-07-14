import type { JSONRecord } from "../../../../../contracts/runtime-core/src/json"

type RdProgramStatus = "active" | "shadow_candidate_found" | "budget_exhausted" | "data_or_tool_blocked" | "paused"

interface RdProgramBudget {
  max_hypotheses: number
  max_trials_total: number
  max_locked_holdout_uses: number
}

interface RdProgramUsage {
  hypotheses_run: number
  trials_used: number
  locked_holdout_uses: number
}

interface RdProgramState {
  schema_version: "trade-flow.rd-program-state.v1"
  program_id: string
  objective: string
  status: RdProgramStatus
  created_at: string
  updated_at: string
  budget: RdProgramBudget
  usage: RdProgramUsage
  stop_conditions: ["shadow_candidate_found", "budget_exhausted", "data_or_tool_blocked"]
  latest_failure_summary: JSONRecord | null
  latest_reliability_gate: JSONRecord | null
  rejected_mechanisms: JSONRecord[]
  universe_lessons: JSONRecord[]
  next_hypothesis_queue: JSONRecord[]
  artifact_refs: string[]
  guardrails: {
    may_write_trade_db: false
    may_call_binance_write: false
    evidence_status: "research_memory_not_strategy_evidence"
  }
}

interface RdProgramStateUpdateInput {
  now?: string
  status?: RdProgramStatus
  usageDelta?: Partial<RdProgramUsage>
  latestFailureSummary?: JSONRecord | null
  latestReliabilityGate?: JSONRecord | null
  rejectedMechanisms?: JSONRecord[]
  universeLessons?: JSONRecord[]
  completedHypothesisIds?: string[]
  followupHypotheses?: JSONRecord[]
  nextHypothesisQueue?: JSONRecord[]
  artifactRefs?: string[]
}

interface RdProgramStateCommandResult {
  schema_version: "trade-flow.rd-program-state-result.v1"
  action: "init" | "read" | "update" | "plan_next"
  state_ref: string
  db_path?: string
  state: RdProgramState
  goal: JSONRecord
  next_plan?: RdSupervisorNextPlan
}

interface RdSupervisorNextPlan {
  schema_version: "trade-flow.rd-supervisor-next-plan.v1"
  plan_id: string
  created_at: string
  status: "ready" | "blocked" | "stopped"
  reason: string
  command: string | null
  payload: JSONRecord | null
  selected_hypothesis: JSONRecord | null
  queue_seed_recommendation: JSONRecord | null
  scout_subagent_plan: JSONRecord
  strategy_universe_backlog: JSONRecord
  budget_remaining: RdProgramBudget
  guardrails: {
    read_only_plan: true
    may_write_trade_db: false
    may_call_binance_write: false
    requires_explicit_execution: true
  }
}

export type {
  RdProgramBudget,
  RdProgramState,
  RdProgramStateCommandResult,
  RdProgramStateUpdateInput,
  RdProgramStatus,
  RdProgramUsage,
  RdSupervisorNextPlan,
}
