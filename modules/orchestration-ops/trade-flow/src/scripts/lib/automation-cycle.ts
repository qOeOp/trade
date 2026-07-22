import { existsSync, readFileSync } from "node:fs"
import { dirname, join, relative } from "node:path"
import { Database } from "bun:sqlite"
import { buildJobTicket, type ProtocolToolsetEntry } from "../../../../../contracts/protocol-fabric/src/protocol-fabric"
import { buildLifecycleProcessorRecord, buildLifecycleProcessorSpec } from "../../../../../contracts/runtime-core/src/lifecycle"
import { activeFlows as readActiveFlows } from "./flow-projector-client"
import { displayPath, repoRoot, resolveRepoPath } from "../../../../../contracts/runtime-core/src/paths"

type JSONRecord = Record<string, unknown>

const DEFAULT_CATALOG_DB = "./data/data_catalog.db"
const DEFAULT_OPS_RUNTIME_DB = "./data/ops_runtime.db"
const DEFAULT_GOVERNANCE_DB = "./data/governance.db"
const DEFAULT_RD_STATE_DB = "./data/rd_state.db"
const DEFAULT_RD_PROGRAM_ID = "rd-program"
const TOOLSET_PATH = "toolset.json"

interface CadenceState {
  due: boolean
  reason: string
  interval_minutes: number
  last_run_at: string | null
  next_due_at: string
}

export interface AutomationCycleInput {
  cycle_id?: string
  now?: string
  include_account_reconcile?: boolean
  include_fast_track?: boolean
  include_runtime_health?: boolean
  include_slow_track?: boolean
  include_rd_strategy_supervisor?: boolean
  include_rd_trackers?: boolean
  include_closed_flow_review?: boolean
  include_catalog_hygiene?: boolean
  include_control_effectiveness_review?: boolean
  include_ops_notify?: boolean
  fast_interval_minutes?: number
  slow_interval_minutes?: number
  rd_supervisor_interval_minutes?: number
  rd_interval_minutes?: number
  review_interval_minutes?: number
  catalog_interval_minutes?: number
  force_jobs?: string[]
  last_runs?: JSONRecord
  rd_state_db?: string
  rd_program_id?: string
  rd_strategy_goal?: JSONRecord
  rd_learning_memory_ref?: string
  rd_trackers?: JSONRecord[]
  catalog_db?: string
  catalog_roots?: string[]
  ops_runtime_db?: string
  governance_db?: string
  runtime_health?: JSONRecord
  job_health_requirements?: JSONRecord
  control_effectiveness_review?: JSONRecord
  ops_notify?: JSONRecord
}

export function buildAutomationCyclePlan(_db: Database, dbPath: string, input: AutomationCycleInput = {}): JSONRecord {
  const generatedAt = normalizeNow(input.now)
  const tradeDbPath = displayPath(dbPath)
  const activeProjection = readActiveFlows(dbPath)
  const activeFlows = asArray(activeProjection.active_flows).map(asRecord)
  const laneConflicts = asArray(activeProjection.lane_conflicts).map(asRecord)
  const activeFlowCount = activeFlows.length
  const dataDir = dirname(dbPath)
  const lastRuns = {
    ...readLastRunsFromCronLog(dataDir),
    ...asRecord(input.last_runs),
  }
  const forceJobs = new Set(asArray(input.force_jobs).map(String))
  const cadence = {
    fast_track_guard: dueState({
      jobId: "fast_track_guard",
      now: generatedAt,
      intervalMinutes: positiveNumber(input.fast_interval_minutes) || 15,
      lastRunAt: stringField(lastRuns.fast_track_guard) || stringField(lastRuns.fast),
      forceJobs,
    }),
    slow_track_market_watch: dueState({
      jobId: "slow_track_market_watch",
      now: generatedAt,
      intervalMinutes: positiveNumber(input.slow_interval_minutes) || 240,
      lastRunAt: stringField(lastRuns.slow_track_market_watch) || stringField(lastRuns.slow),
      forceJobs,
    }),
    rd_strategy_supervisor: dueState({
      jobId: "rd_strategy_supervisor",
      now: generatedAt,
      intervalMinutes: positiveNumber(input.rd_supervisor_interval_minutes) || 720,
      lastRunAt: stringField(lastRuns.rd_strategy_supervisor),
      forceJobs,
    }),
    rd_forward_shadow_trackers: dueState({
      jobId: "rd_forward_shadow_trackers",
      now: generatedAt,
      intervalMinutes: positiveNumber(input.rd_interval_minutes) || 240,
      lastRunAt: stringField(lastRuns.rd_forward_shadow_trackers),
      forceJobs,
    }),
    closed_flow_review_sweep: dueState({
      jobId: "closed_flow_review_sweep",
      now: generatedAt,
      intervalMinutes: positiveNumber(input.review_interval_minutes) || 240,
      lastRunAt: stringField(lastRuns.closed_flow_review_sweep),
      forceJobs,
    }),
    catalog_hygiene_scan: dueState({
      jobId: "catalog_hygiene_scan",
      now: generatedAt,
      intervalMinutes: positiveNumber(input.catalog_interval_minutes) || 1440,
      lastRunAt: stringField(lastRuns.catalog_hygiene_scan),
      forceJobs,
    }),
  }
  const rdTrackers = asArray(input.rd_trackers).map(asRecord).filter((item) => stringField(item.tracker_id))
  const rdStateDb = stringField(input.rd_state_db) || DEFAULT_RD_STATE_DB
  const rdProgramId = safeID(stringField(input.rd_program_id) || DEFAULT_RD_PROGRAM_ID)
  const rdProgramStateRef = rdProgramRef(rdProgramId)
  const rdProgramState = readRdProgramStateSummary(rdStateDb, rdProgramId)
  const rdStrategyGoal = rdProgramState ? rdProgramGoalFromSummary(rdProgramState) : asRecord(input.rd_strategy_goal)
  const rdStrategyConfigured = Object.keys(rdStrategyGoal).length > 0
  const rdStrategyCanRun = rdStrategyConfigured && (!rdProgramState || rdProgramState.status === "active")
  const configuredCatalogRoots = asArray(input.catalog_roots).map(String).filter(Boolean)
  const catalogRoots = configuredCatalogRoots.length > 0 ? configuredCatalogRoots : ["./data", "./tmp"]
  const catalogDb = displayPath(stringField(input.catalog_db) || DEFAULT_CATALOG_DB)
  const opsRuntimeDb = displayPath(stringField(input.ops_runtime_db) || DEFAULT_OPS_RUNTIME_DB)
  const healthOpsRuntimeDbArg = toolRelativePath(opsRuntimeDb, "modules/orchestration-ops/runtime-health-guard")
  const notifyOpsRuntimeDbArg = toolRelativePath(opsRuntimeDb, "modules/orchestration-ops/ops-notify-dispatch")
  const reviewOpsRuntimeDbArg = toolRelativePath(opsRuntimeDb, "modules/orchestration-ops/control-effectiveness-review")
  const governanceDb = displayPath(stringField(input.governance_db) || DEFAULT_GOVERNANCE_DB)
  const cycleId = input.cycle_id || `automation-cycle-${generatedAt.replace(/[:.]/g, "-")}`
  const activeChainIds = activeFlows.map((flow) => stringField(flow.chain_id)).filter(Boolean)
  const tradeWorkDue = (activeFlowCount > 0 && cadence.fast_track_guard.due) || cadence.slow_track_market_watch.due
  const jobHealthRequirements = normalizeJobHealthRequirements(input.job_health_requirements)
  if (jobHealthRequirements.size > 0 && input.include_runtime_health === false) {
    throw new Error("job health requirements need runtime_health_guard enabled")
  }
  const runtimeHealthInput = runtimeHealthConfig(input.runtime_health, jobHealthRequirements)

  const lifecycleProcessors = [
    opsLifecycleProcessor({
      processor_id: "runtime_health_guard",
      lifecycle_phase: "pre_cycle",
      enabled: input.include_runtime_health !== false,
      active: true,
      reason: "runtime health runs before any trade, research, or governance job consumes local state",
      processorSpec: resolveLifecycleProcessor({
        processorId: "runtime_health_guard",
        lifecyclePhase: "pre_cycle",
        toolId: "ops.runtime-health-guard",
        executable: true,
        payload: {
          db_path: opsRuntimeDb,
          json: {
            cycle_id: cycleId,
            now: generatedAt,
            ...runtimeHealthInput,
          },
        },
        argv: ["bun", "src/scripts/main.ts", "--db", healthOpsRuntimeDbArg, "--json", JSON.stringify({
          cycle_id: cycleId,
          now: generatedAt,
          ...runtimeHealthInput,
        })],
      }),
    }),
    opsLifecycleProcessor({
      processor_id: "ops_notify_dispatch",
      lifecycle_phase: "post_cycle",
      enabled: input.include_ops_notify !== false,
      active: true,
      reason: "ops notify closes the cycle with health, skipped, blocked, and takeover refs",
      processorSpec: resolveLifecycleProcessor({
        processorId: "ops_notify_dispatch",
        lifecyclePhase: "post_cycle",
        toolId: "ops.notify-dispatch",
        executable: true,
        payload: {
          db_path: opsRuntimeDb,
          json: {
            cycle_id: cycleId,
            now: generatedAt,
            dry_run: true,
            payload: {
              message: "automation cycle summary ready",
              generated_at: generatedAt,
            },
            ...asRecord(input.ops_notify),
          },
        },
        argv: ["bun", "src/scripts/main.ts", "--db", notifyOpsRuntimeDbArg, "--json", JSON.stringify({
          cycle_id: cycleId,
          now: generatedAt,
          dry_run: true,
          payload: {
            message: "automation cycle summary ready",
            generated_at: generatedAt,
          },
          ...asRecord(input.ops_notify),
        })],
      }),
    }),
    opsLifecycleProcessor({
      processor_id: "control_effectiveness_review",
      lifecycle_phase: "post_cycle",
      enabled: input.include_control_effectiveness_review !== false,
      active: true,
      reason: "control effectiveness review diagnoses repeated incidents, failed jobs, and notify failures before final notification",
      processorSpec: resolveLifecycleProcessor({
        processorId: "control_effectiveness_review",
        lifecyclePhase: "post_cycle",
        toolId: "ops.control-effectiveness-review",
        executable: true,
        payload: {
          db_path: opsRuntimeDb,
          json: {
            cycle_id: cycleId,
            now: generatedAt,
            ...asRecord(input.control_effectiveness_review),
          },
        },
        argv: ["bun", "src/scripts/main.ts", "--db", reviewOpsRuntimeDbArg, "--json", JSON.stringify({
          cycle_id: cycleId,
          now: generatedAt,
          ...asRecord(input.control_effectiveness_review),
        })],
      }),
    }),
  ]

  const jobs = attachJobHealthRequirements([
    accountReconcileJob({
      job_id: "account_reconcile_guard",
      enabled: input.include_account_reconcile !== false,
      active: activeFlowCount > 0,
      reason: activeFlowCount > 0 ? "active flows need account snapshot reconciliation before fast guard decisions" : "no active flow needs account reconcile",
      candidateChainIds: activeChainIds,
      tradeDbPath,
      now: generatedAt,
    }),
    tradeJob({
      job_id: "fast_track_guard",
      enabled: input.include_fast_track !== false,
      active: activeFlowCount > 0 && cadence.fast_track_guard.due,
      toolJob: resolveToolJob({
        jobId: "fast_track_guard",
        toolId: "execution.fast-track-guard",
        executable: activeFlowCount > 0 && cadence.fast_track_guard.due,
        payload: {
          db_path: tradeDbPath,
          json: {
            cycle_id: cycleId,
            ticket_no: "J02",
            job_id: "fast_track_guard",
            now: generatedAt,
            run_id: `${cycleId}-J02`,
          },
        },
        argv: ["bun", "src/scripts/main.ts", "--fast-guard-job", "--db", tradeDbPath, "--json", JSON.stringify({
          cycle_id: cycleId,
          ticket_no: "J02",
          job_id: "fast_track_guard",
          now: generatedAt,
          run_id: `${cycleId}-J02`,
        })],
      }),
      reason: activeFlowCount > 0 ? "active flows need trigger, protection, and reconcile checks" : "no active flow needs fast guard",
      cadence: cadence.fast_track_guard,
      allowedRuntimeWrites: ["trade_event_store"],
      dependsOnJobIds: ["account_reconcile_guard"],
    }),
    tradeJob({
      job_id: "slow_track_market_watch",
      enabled: input.include_slow_track !== false,
      active: cadence.slow_track_market_watch.due,
      toolJob: resolveToolJob({
        jobId: "slow_track_market_watch",
        toolId: "trade-flow.runtime",
        executable: cadence.slow_track_market_watch.due,
        payload: { db_path: tradeDbPath, track: "slow" },
        argv: ["bun", "src/scripts/main.ts", "--db", tradeDbPath, "--track", "slow"],
      }),
      reason: "slow track owns market watch and strategic observe",
      cadence: cadence.slow_track_market_watch,
    }),
    rdStrategySupervisorJob({
      job_id: "rd_strategy_supervisor",
      enabled: input.include_rd_strategy_supervisor !== false,
      active: rdStrategyCanRun && cadence.rd_strategy_supervisor.due,
      reason: rdProgramState && rdProgramState.status !== "active"
        ? `rd_program_state status is ${rdProgramState.status}; supervisor loop is stopped`
        : rdStrategyConfigured
        ? "strategy R&D goal is configured; continue the learning loop until shadow candidate, budget exhaustion, or blocker"
        : "no rd_strategy_goal configured",
      cadence: cadence.rd_strategy_supervisor,
      goal: rdStrategyGoal,
      learningMemoryRef: stringField(input.rd_learning_memory_ref) || rdProgramStateRef,
      programStateRef: rdProgramStateRef,
      programStateStatus: rdProgramState ? stringField(rdProgramState.status) : undefined,
      rdStateDb,
      rdProgramId,
      catalogDb,
      cycleId,
      now: generatedAt,
    }),
    artifactJob({
      job_id: "rd_forward_shadow_trackers",
      enabled: input.include_rd_trackers !== false,
      active: rdTrackers.length > 0 && cadence.rd_forward_shadow_trackers.due,
      reason: rdTrackers.length > 0 ? "configured R&D forward trackers can run without trade.db writes" : "no rd_trackers configured",
      trackers: rdTrackers,
      cadence: cadence.rd_forward_shadow_trackers,
      toolJob: resolveToolJob({
        jobId: "rd_forward_shadow_trackers",
        toolId: "research.rd-shadow-tracker",
        executable: rdTrackers.length > 0 && cadence.rd_forward_shadow_trackers.due,
        payload: {
          action: "shadow_tracker_job",
          catalog_db: catalogDb,
          json: {
            cycle_id: cycleId,
            ticket_no: "J05",
            job_id: "rd_forward_shadow_trackers",
            now: generatedAt,
            catalog_db_path: catalogDb,
            trackers: rdTrackers,
          },
        },
        argv: ["bun", "src/scripts/main.ts", "--shadow-tracker-job", "--catalog-db", catalogDb, "--json", JSON.stringify({
          cycle_id: cycleId,
          ticket_no: "J05",
          job_id: "rd_forward_shadow_trackers",
          now: generatedAt,
          catalog_db_path: catalogDb,
          trackers: rdTrackers,
        })],
      }),
      allowedRuntimeWrites: ["artifact_catalog"],
    }),
    reviewJob({
      job_id: "closed_flow_review_sweep",
      enabled: input.include_closed_flow_review !== false,
      active: activeFlowCount > 0 && (tradeWorkDue || cadence.closed_flow_review_sweep.due),
      reason: "review is conditionally dispatched after upstream work reports a newly closed flow; cadence is only a missed-review fallback",
      cadence: cadence.closed_flow_review_sweep,
      candidateChainIds: activeChainIds,
      tradeDbPath,
      governanceDb,
      cycleId,
      now: generatedAt,
    }),
    artifactJob({
      job_id: "catalog_hygiene_scan",
      enabled: input.include_catalog_hygiene !== false,
      active: cadence.catalog_hygiene_scan.due,
      reason: "artifact visibility can run outside trade.db mutation path",
      toolJob: resolveToolJob({
        jobId: "catalog_hygiene_scan",
        toolId: "artifact-catalog",
        executable: cadence.catalog_hygiene_scan.due,
        payload: {
          action: "catalog_hygiene_job",
          catalog_db: catalogDb,
          catalog_roots: catalogRoots,
          json: {
            cycle_id: cycleId,
            ticket_no: "J06",
            job_id: "catalog_hygiene_scan",
            now: generatedAt,
          },
        },
        argv: ["bun", "src/scripts/main.ts", "--catalog-hygiene-job", "--catalog-db", catalogDb, ...catalogRoots.flatMap((root) => ["--catalog-root", root]), "--json", JSON.stringify({
          cycle_id: cycleId,
          ticket_no: "J06",
          job_id: "catalog_hygiene_scan",
          now: generatedAt,
        })],
      }),
      cadence: cadence.catalog_hygiene_scan,
      allowedRuntimeWrites: ["artifact_catalog"],
    }),
  ], jobHealthRequirements)

  return {
    schema_version: "trade-flow.automation-cycle-plan.v1",
    cycle_id: cycleId,
    generated_at: generatedAt,
    mode: "supervisor_plan",
    executable: false,
    dispatch_model: {
      single_automation_entry: true,
      isolated_job_fanout: "supported",
      agent_fallback: "available",
      rule: "The invoking supervisor owns scheduling and summary; every isolated job remains bounded by its owner contract and write scope.",
    },
    trade_db_path: tradeDbPath,
    active_flow_count: activeFlowCount,
    lane_conflicts: laneConflicts,
    cadence,
    lifecycle_processors: lifecycleProcessors,
    jobs,
    dispatch_order: [
      {
        stage: "pre_cycle",
        processor_ids: ["runtime_health_guard"],
        why: "Runtime health, safe mode, lock, and store readiness are checked before downstream jobs consume refs.",
      },
      {
        stage: "serial_account_reconcile",
        job_ids: ["account_reconcile_guard"],
        why: "Account snapshot reconciliation runs before fast guard decisions so local state drift is surfaced early.",
      },
      {
        stage: "serial_fast_guard",
        job_ids: ["fast_track_guard"],
        why: "Existing flow safety checks run before broad market or research work.",
      },
      {
        stage: "parallel_isolated_work",
        job_ids: ["slow_track_market_watch", "rd_strategy_supervisor", "rd_forward_shadow_trackers", "catalog_hygiene_scan"],
        why: "Only slow_track_market_watch may touch trade.db; strategy R&D, forward trackers, and catalog jobs are artifact/catalog scoped.",
      },
      {
        stage: "serial_review_closeout",
        job_ids: ["closed_flow_review_sweep"],
        why: "Conditionally dispatch review only after upstream work reports a newly closed flow; fallback cadence may scan missed reviews.",
      },
      {
        stage: "post_cycle_review",
        processor_ids: ["control_effectiveness_review"],
        why: "Control effectiveness review records code/process improvement items before final notification.",
      },
      {
        stage: "post_cycle_notify",
        processor_ids: ["ops_notify_dispatch"],
        why: "Notify dispatch summarizes blocked/skipped/failed refs, incidents, and control-review refs without mutating trade state.",
      },
    ],
    guardrails: [
      "The supervisor and subagents must never call --run-live-small or execution Binance tools unless a separate live-small request is explicitly authorized.",
      "At most one job in a cycle may write trade.db at a time; existing cron lock remains the final local guard.",
      "Slow/R&D/catalog jobs must pass cadence due checks when the single external automation runs at fast-track frequency; review is event-first with cadence fallback.",
      "R&D strategy supervisor must write a draft strategy policy after a gated validated candidate; otherwise it stops at budget_exhausted or data_or_tool_blocked.",
      "R&D strategy supervisor learns from prior failure_summary/reliability_gate records and must carry rejected mechanisms, universe lessons, and next hypothesis constraints forward.",
      "R&D forward trackers write artifacts only and cannot create strategy evidence or promotion by themselves.",
      "Closed-flow review is event-first: dispatch after trade/reconcile reports a newly closed unreviewed flow; the review cadence is only a fallback sweep.",
    ],
  }
}

function tradeJob(input: {
  job_id: string
  enabled: boolean
  active: boolean
  toolJob: JSONRecord
  reason: string
  cadence: CadenceState
  allowedRuntimeWrites?: string[]
  dependsOnJobIds?: string[]
}): JSONRecord {
  return {
    ...baseJob(input),
    subagent_role: "trade-flow-operator",
    write_scope: ["trade.db", "cron.log", "track artifacts"],
    concurrency_group: "trade-db",
    may_write_trade_db: true,
    may_call_binance_write: false,
    command: commandFromToolJob(input.toolJob),
    tool_job: input.toolJob,
    command_spec: asRecord(input.toolJob.command_spec),
    cadence: input.cadence,
    ...(input.allowedRuntimeWrites ? { allowed_runtime_writes: input.allowedRuntimeWrites } : {}),
    ...(input.dependsOnJobIds ? { depends_on_job_ids: input.dependsOnJobIds } : {}),
  }
}

function artifactJob(input: {
  job_id: string
  enabled: boolean
  active: boolean
  reason: string
  cadence: CadenceState
  toolJob?: JSONRecord
  trackers?: JSONRecord[]
  allowedRuntimeWrites?: string[]
}): JSONRecord {
  return {
    ...baseJob(input),
    subagent_role: "research-artifact-operator",
    write_scope: ["research artifacts", "catalog metadata"],
    concurrency_group: input.job_id,
    may_write_trade_db: false,
    may_call_binance_write: false,
    cadence: input.cadence,
    ...(input.allowedRuntimeWrites ? { allowed_runtime_writes: input.allowedRuntimeWrites } : {}),
    ...(input.toolJob ? { command: commandFromToolJob(input.toolJob), tool_job: input.toolJob, command_spec: asRecord(input.toolJob.command_spec) } : {}),
    ...(input.trackers ? { trackers: input.trackers } : {}),
  }
}

function accountReconcileJob(input: {
  job_id: string
  enabled: boolean
  active: boolean
  reason: string
  candidateChainIds: string[]
  tradeDbPath: string
  now: string
}): JSONRecord {
  const chainId = input.candidateChainIds[0] || ""
  const payload = {
    now: input.now,
    apply_reconcile: false,
  }
  const argv = chainId
    ? [
      "bun",
      "src/scripts/main.ts",
      "--db",
      input.tradeDbPath,
      "--cron-recover-from-tools",
      "--chain-id",
      chainId,
      "--json",
      JSON.stringify(payload),
    ]
    : []
  const toolJob = resolveToolJob({
    jobId: "account_reconcile_guard",
    toolId: "trade-flow.recovery",
    executable: input.active && chainId.length > 0,
    payload: {
      db_path: input.tradeDbPath,
      candidate_chain_ids: input.candidateChainIds,
      json: payload,
    },
    argv,
  })
  return {
    ...baseJob(input),
    subagent_role: "account-reconcile-operator",
    write_scope: ["trade.db reconcile drafts", "needs_review events"],
    concurrency_group: "trade-db",
    may_write_trade_db: true,
    may_call_binance_write: false,
    result_policy: {
      status_path: ["data", "status"],
      completed_statuses: ["recovered_noop", "recovered_applied"],
      blocked_statuses: ["reconcile_draft_ready", "abort_unmatched_reconcile"],
    },
    trigger_mode: "active_flow_guard",
    candidate_chain_ids: input.candidateChainIds,
    entrypoint: "read active flow refs, reconcile account snapshot facts, and only write local reconcile/needs_review facts",
    tool_job: toolJob,
    command_spec: asRecord(toolJob.command_spec),
    ...(chainId ? { command: shellCommand(argv) } : {}),
  }
}

function opsLifecycleProcessor(input: {
  processor_id: string
  lifecycle_phase: string
  enabled: boolean
  active: boolean
  reason: string
  processorSpec: JSONRecord
}): JSONRecord {
  return buildLifecycleProcessorRecord(input)
}

function rdStrategySupervisorJob(input: {
  job_id: string
  enabled: boolean
  active: boolean
  reason: string
  cadence: CadenceState
  goal: JSONRecord
  learningMemoryRef: string
  programStateRef?: string
  programStateStatus?: string
  rdStateDb: string
  rdProgramId: string
  catalogDb: string
  cycleId: string
  now: string
}): JSONRecord {
  const budget = asRecord(input.goal.budget)
  const maxLockedHoldoutUses = nonNegativeNumberOr(budget.max_locked_holdout_uses, 1)
  const programStateRef = input.programStateRef || rdProgramRef(input.rdProgramId)
  const supervisorPayload: JSONRecord = {
    max_iterations: 20,
    artifact_root: "./tmp/artifacts/strategy-rnd",
    catalog_db_path: input.catalogDb,
  }
  const jobPayload = {
    cycle_id: input.cycleId,
    ticket_no: "J04",
    job_id: "rd_strategy_supervisor",
    now: input.now,
    db_path: input.rdStateDb,
    program_id: input.rdProgramId,
    catalog_db_path: input.catalogDb,
    goal: {
      objective: stringField(input.goal.objective) || "find a shadow-eligible 4H swing strategy",
      budget: {
        max_hypotheses: positiveNumber(budget.max_hypotheses) || 20,
        max_trials_total: positiveNumber(budget.max_trials_total) || 80,
        max_locked_holdout_uses: maxLockedHoldoutUses,
      },
      next_hypothesis_queue: asArray(input.goal.next_hypothesis_queue).map(asRecord),
    },
    supervisor: supervisorPayload,
  }
  const commandArgv = [
    "bun",
    "src/scripts/main.ts",
    "--db",
    input.rdStateDb,
    "--catalog-db",
    input.catalogDb,
    "--program-id",
    input.rdProgramId,
    "--profile",
    "profile/model-gateway.json",
    "--json",
    JSON.stringify(jobPayload),
  ]
  const supervisorToolJob = resolveToolJob({
    jobId: "rd_strategy_supervisor",
    toolId: "research.rd-autonomy-cycle",
    executable: input.active,
    payload: { state_ref: programStateRef, db_path: input.rdStateDb, program_id: input.rdProgramId, catalog_db: input.catalogDb, model_profile: "profile/model-gateway.json", json: jobPayload },
    argv: commandArgv,
  })
  return {
    ...baseJob(input),
    subagent_role: "rd-autonomy-cycle",
    write_scope: ["research artifacts", "catalog metadata", "strategy drafts only after gated candidate"],
    concurrency_group: "research-rd",
    may_write_trade_db: false,
    may_call_binance_write: false,
    cadence: input.cadence,
    goal: input.goal,
    ...(programStateRef ? { program_state_ref: programStateRef } : {}),
    ...(input.programStateStatus ? { program_state_status: input.programStateStatus } : {}),
    allowed_runtime_writes: ["research_state_store", "artifact_catalog"],
    command: commandFromToolJob(supervisorToolJob),
    tool_job: supervisorToolJob,
    command_spec: asRecord(supervisorToolJob.command_spec),
    entrypoint: "read plan_next; if the active queue is empty, run one bounded hypothesis model task and CAS queue only a validated ready proposal; then delegate the existing R&D supervisor",
    research_loop_contract: {
      loop_until: ["strategy_draft_created", "budget_exhausted", "data_or_tool_blocked"],
      stop_without_user: true,
      allowed_actions: [
        "research.rd-program-state action=plan_next",
        "research.data-split",
        "research.rd-loop-runner",
        "research.rd-campaign-runner",
        "research.panel-evaluator",
        "research.forward-holdout",
        "research.rd-shadow-tracker",
        "strategy-review dry-run",
        "draft strategy policy after gated candidate only",
      ],
      forbidden_actions: [
        "write trade.db",
        "call Binance write APIs",
        "promote strategy without explicit strategy-promote gate",
        "reuse failed locked holdout after modifying parameters",
      ],
      budget: {
        max_hypotheses: positiveNumber(budget.max_hypotheses) || 20,
        max_trials_total: positiveNumber(budget.max_trials_total) || 80,
        max_locked_holdout_uses: maxLockedHoldoutUses,
      },
      learning_memory: {
        read_ref: input.learningMemoryRef,
        write_back: ["failure_summary", "reliability_gate", "rejected_mechanisms", "universe_lessons", "next_hypothesis_queue"],
      },
      sidecar_subagents: [
        {
          role: "rd-history-scout",
          write_scope: [],
          may_write_state: false,
          purpose: "Read prior R&D artifacts, rejected mechanisms, and docs to identify mechanisms that must not be retried.",
          output: "bounded proposal: avoid_list + candidate market edge + supporting refs",
        },
        {
          role: "rd-data-scout",
          write_scope: [],
          may_write_state: false,
          purpose: "Inspect available manifests, split coverage, and family requirements before the supervisor spends trial budget.",
          output: "bounded proposal: usable datasets + required splits + blocker risks",
        },
        {
          role: "rd-edge-scout",
          write_scope: [],
          may_write_state: false,
          purpose: "Draft distinct predeclared market edges when learning memory is blocked on a new mechanism.",
          output: "bounded proposal: thesis certificate fields + candidate universe sketch",
        },
      ],
      single_writer_rule: "Sidecar scouts and model output are read-only proposals; autonomy-cycle may only CAS a ready queue proposal through research.rd-program-state, and rd-supervisor owns Trial/result writeback.",
    },
  }
}

function shellCommand(argv: string[]): string {
  return argv.map(shellQuote).join(" ")
}

function toolRelativePath(path: string, toolCwd: string): string {
  return relative(join(repoRoot(), toolCwd), resolveRepoPath(path)) || "."
}

function commandFromToolJob(toolJob: JSONRecord): string {
  const commandSpec = asRecord(toolJob.command_spec)
  const cwd = stringField(commandSpec.cwd)
  const argv = asArray(commandSpec.argv).map(String)
  if (cwd && argv.length >= 2 && !argv[1].startsWith(`${cwd}/`)) {
    return shellCommand([argv[0], `${cwd}/${argv[1]}`, ...argv.slice(2)])
  }
  return shellCommand(argv)
}

function shellQuote(value: string): string {
  return /^[a-zA-Z0-9_./:=@-]+$/.test(value) ? value : `'${value.replace(/'/g, "'\\''")}'`
}

function reviewJob(input: {
  job_id: string
  enabled: boolean
  active: boolean
  reason: string
  cadence: CadenceState
  candidateChainIds: string[]
  tradeDbPath: string
  governanceDb: string
  cycleId: string
  now: string
}): JSONRecord {
  const payload = {
    candidate_chain_ids: input.candidateChainIds,
    cycle_id: input.cycleId,
    ticket_no: "J07",
    job_id: "closed_flow_review_sweep",
    now: input.now,
  }
  const argv = [
    "bun",
    "src/scripts/main.ts",
    "--trade-db",
    input.tradeDbPath,
    "--governance-db",
    input.governanceDb,
    "--json",
    JSON.stringify(payload),
  ]
  const toolJob = resolveToolJob({
    jobId: "closed_flow_review_sweep",
    toolId: "governance.closed-flow-review-sweep",
    executable: input.active,
    payload: {
      trade_db_path: input.tradeDbPath,
      governance_db_path: input.governanceDb,
      json: payload,
    },
    argv,
  })
  return {
    ...baseJob(input),
    subagent_role: "closed-flow-reviewer",
    write_scope: ["governance_ledger review batch refs"],
    concurrency_group: "governance-ledger",
    may_write_trade_db: false,
    may_call_binance_write: false,
    trigger_mode: "event_or_fallback_sweep",
    dispatch_condition: "Run after upstream jobs only when they report a newly closed flow without review; when fallback cadence is due, scan candidate_chain_ids for missed reviews.",
    candidate_chain_ids: input.candidateChainIds,
    entrypoint: "scan closed unreviewed flow candidates and record a governance review batch; subjective review remains a separate strategy-review step",
    cadence: input.cadence,
    allowed_runtime_writes: ["governance_ledger"],
    tool_job: toolJob,
    command_spec: asRecord(toolJob.command_spec),
  }
}

function normalizeJobHealthRequirements(value: unknown): Map<string, string[]> {
  const requirements = new Map<string, string[]>()
  if (value == null) return requirements
  if (typeof value !== "object" || Array.isArray(value)) {
    throw new Error("job_health_requirements must be an object keyed by job_id")
  }
  for (const [jobId, rawChecks] of Object.entries(value as JSONRecord)) {
    if (!AUTOMATION_JOB_IDS.has(jobId)) throw new Error(`unknown health-dependent job: ${jobId}`)
    if (DEFENSE_BYPASS_JOB_IDS.has(jobId)) {
      throw new Error(`defense job cannot require runtime health: ${jobId}`)
    }
    if (!Array.isArray(rawChecks) || rawChecks.length === 0) {
      throw new Error(`health requirements for ${jobId} must be a non-empty array`)
    }
    const checks = [...new Set(rawChecks.map(stringField))]
    if (checks.some((check) => !check)) throw new Error(`health requirements for ${jobId} must be non-empty strings`)
    for (const check of checks) {
      if (!SUPPORTED_HEALTH_CHECKS.has(check)) throw new Error(`unsupported health dependency: ${check}`)
    }
    requirements.set(jobId, checks)
  }
  return requirements
}

function runtimeHealthConfig(value: unknown, requirements: Map<string, string[]>): JSONRecord {
  let config = asRecord(value)
  const needsL2 = [...requirements.values()].some((checks) => checks.includes(L2_OWNER_HEALTH_CHECK))
  if (needsL2) {
    if (Object.hasOwn(config, "require_l2_ready") && config.require_l2_ready !== true) {
      throw new Error("L2-dependent jobs require runtime_health.require_l2_ready=true")
    }
    config = { ...config, require_l2_ready: true }
  }
  const needsL2WatchConsumer = [...requirements.values()].some((checks) => checks.includes(L2_WATCH_CONSUMER_HEALTH_CHECK))
  if (needsL2WatchConsumer) {
    if (Object.hasOwn(config, "require_l2_watch_consumer_ready") && config.require_l2_watch_consumer_ready !== true) {
      throw new Error("L2-watch-dependent jobs require runtime_health.require_l2_watch_consumer_ready=true")
    }
    config = { ...config, require_l2_watch_consumer_ready: true }
  }
  return config
}

function attachJobHealthRequirements(jobs: JSONRecord[], requirements: Map<string, string[]>): JSONRecord[] {
  return jobs.map((job) => {
    const checks = requirements.get(stringField(job.job_id))
    return checks ? { ...job, required_health_checks: checks } : job
  })
}

function baseJob(input: { job_id: string; enabled: boolean; active: boolean; reason: string }): JSONRecord {
  return {
    job_id: input.job_id,
    enabled: input.enabled,
    active: input.enabled && input.active,
    reason: input.reason,
  }
}

const L2_OWNER_HEALTH_CHECK = "l2_service:owner_health"
const L2_WATCH_CONSUMER_HEALTH_CHECK = "l2_watch_consumer:owner_health"
const SUPPORTED_HEALTH_CHECKS = new Set([L2_OWNER_HEALTH_CHECK, L2_WATCH_CONSUMER_HEALTH_CHECK])
const DEFENSE_BYPASS_JOB_IDS = new Set(["account_reconcile_guard"])
const AUTOMATION_JOB_IDS = new Set([
  "account_reconcile_guard",
  "fast_track_guard",
  "slow_track_market_watch",
  "rd_strategy_supervisor",
  "rd_forward_shadow_trackers",
  "closed_flow_review_sweep",
  "catalog_hygiene_scan",
])

function resolveToolJob(input: {
  jobId: string
  toolId: string
  executable: boolean
  payload: JSONRecord
  argv: string[]
}): JSONRecord {
  const tool = readToolsetEntry(input.toolId)
  return buildJobTicket({
    job_id: input.jobId,
    ticket_no: ticketNoForJob(input.jobId),
    stage: stageForJob(input.jobId),
    target_domain: targetDomainForJob(input.jobId),
    tool,
    payload: input.payload,
    executable: input.executable,
    argv: input.argv,
  })
}

function resolveLifecycleProcessor(input: {
  processorId: string
  lifecyclePhase: string
  toolId: string
  executable: boolean
  payload: JSONRecord
  argv: string[]
}): JSONRecord {
  const tool = readToolsetEntry(input.toolId)
  return buildLifecycleProcessorSpec({
    processorId: input.processorId,
    lifecyclePhase: input.lifecyclePhase,
    tool,
    executable: input.executable,
    payload: input.payload,
    argv: input.argv,
  })
}

function ticketNoForJob(jobId: string): string | undefined {
  if (jobId === "account_reconcile_guard") {
    return "J01"
  }
  if (jobId === "fast_track_guard") {
    return "J02"
  }
  if (jobId === "slow_track_market_watch") {
    return "J03"
  }
  if (jobId.startsWith("rd_strategy_supervisor")) {
    return "J04"
  }
  if (jobId === "rd_forward_shadow_trackers") {
    return "J05"
  }
  if (jobId === "catalog_hygiene_scan") {
    return "J06"
  }
  if (jobId === "closed_flow_review_sweep") {
    return "J07"
  }
  return undefined
}

function stageForJob(jobId: string): string {
  if (jobId === "account_reconcile_guard") {
    return "serial_account_reconcile"
  }
  if (jobId === "fast_track_guard") {
    return "serial_fast_guard"
  }
  if (jobId === "closed_flow_review_sweep") {
    return "serial_review_closeout"
  }
  if (jobId.startsWith("rd_strategy_supervisor") || jobId === "rd_forward_shadow_trackers" || jobId === "catalog_hygiene_scan" || jobId === "slow_track_market_watch") {
    return "parallel_isolated_work"
  }
  return "unspecified"
}

function targetDomainForJob(jobId: string): string {
  if (jobId === "slow_track_market_watch") {
    return "live-decision-planning"
  }
  if (jobId === "account_reconcile_guard" || jobId === "fast_track_guard") {
    return "live-execution-control"
  }
  if (jobId.startsWith("rd_strategy_supervisor") || jobId === "rd_forward_shadow_trackers") {
    return "research-strategy-development"
  }
  if (jobId === "closed_flow_review_sweep") {
    return "governance-review-compliance"
  }
  if (jobId === "catalog_hygiene_scan") {
    return "artifact-knowledge"
  }
  return "orchestration-ops"
}

function readToolsetEntry(toolId: string): ProtocolToolsetEntry {
  const manifest = JSON.parse(readFileSync(join(repoRoot(), TOOLSET_PATH), "utf8")) as { tools?: unknown[] }
  const tools = Array.isArray(manifest.tools) ? manifest.tools.map(asRecord) : []
  const raw = tools.find((entry) => stringField(entry.id) === toolId)
  if (!raw) {
    throw new Error(`toolset entry not found: ${toolId}`)
  }
  const command = asRecord(raw.command)
  return {
    id: stringField(raw.id),
    owner_scope: stringField(raw.owner_scope) || undefined,
    module_type: stringField(raw.module_type),
    capability_class: asArray(raw.capability_class).map(String).filter(Boolean),
    command: {
      cwd: stringField(command.cwd),
      argv: asArray(command.argv).map(String),
    },
    writes: asRecord(raw.writes),
    entry_contract: asRecord(raw.entry_contract),
    requires_preflight: raw.requires_preflight === true,
    concurrency_group: stringField(raw.concurrency_group),
  }
}

function readRdProgramStateSummary(dbPath: string, programId: string): JSONRecord | null {
  try {
    const db = new Database(dbPath, { readonly: true })
    try {
      const row = db.query("SELECT state_json FROM rd_program WHERE program_id=$program_id")
        .get({ $program_id: programId }) as { state_json: string } | null
      return row ? asRecord(JSON.parse(row.state_json)) : null
    } finally {
      db.close()
    }
  } catch {
    return null
  }
}

function rdProgramRef(programId: string): string {
  return `research_state_store:rd_program/${programId}`
}

function safeID(value: string): string {
  return value.trim().toLowerCase().replace(/[^a-z0-9._-]+/g, "-").replace(/^-+|-+$/g, "") || DEFAULT_RD_PROGRAM_ID
}

function rdProgramGoalFromSummary(state: JSONRecord): JSONRecord {
  return {
    objective: stringField(state.objective),
    status: stringField(state.status),
    budget: asRecord(state.budget),
    usage: asRecord(state.usage),
    stop_conditions: asRecord(state.stop_conditions),
    latest_failure_summary: asRecord(state.latest_failure_summary),
    latest_reliability_gate: asRecord(state.latest_reliability_gate),
    rejected_mechanisms: asArray(state.rejected_mechanisms),
    universe_lessons: asArray(state.universe_lessons),
    next_hypothesis_queue: asArray(state.next_hypothesis_queue),
    artifact_refs: asArray(state.artifact_refs),
  }
}

function normalizeNow(value: unknown): string {
  if (typeof value === "string" && value.trim()) {
    return value
  }
  return new Date().toISOString()
}

function dueState(input: {
  jobId: string
  now: string
  intervalMinutes: number
  lastRunAt: string
  forceJobs: Set<string>
}): CadenceState {
  if (input.forceJobs.has(input.jobId) || input.forceJobs.has("all")) {
    return {
      due: true,
      reason: "forced",
      interval_minutes: input.intervalMinutes,
      last_run_at: input.lastRunAt || null,
      next_due_at: input.now,
    }
  }
  const nowMs = Date.parse(input.now)
  const lastMs = Date.parse(input.lastRunAt)
  if (!Number.isFinite(lastMs) || !Number.isFinite(nowMs)) {
    return {
      due: true,
      reason: "no_valid_last_run",
      interval_minutes: input.intervalMinutes,
      last_run_at: input.lastRunAt || null,
      next_due_at: input.now,
    }
  }
  const nextDueMs = lastMs + input.intervalMinutes * 60 * 1000
  return {
    due: nowMs >= nextDueMs,
    reason: nowMs >= nextDueMs ? "interval_elapsed" : "cadence_not_due",
    interval_minutes: input.intervalMinutes,
    last_run_at: input.lastRunAt,
    next_due_at: new Date(nextDueMs).toISOString(),
  }
}

function readLastRunsFromCronLog(dataDir: string): JSONRecord {
  const path = join(dataDir, "cron.log")
  if (!existsSync(path)) {
    return {}
  }
  const lastRuns: JSONRecord = {}
  for (const line of readFileSync(path, "utf8").trim().split(/\n+/)) {
    try {
      const entry = JSON.parse(line) as JSONRecord
      const track = stringField(entry.track)
      const triggeredAt = stringField(entry.triggered_at)
      const status = stringField(entry.status)
      if ((track === "slow" || track === "fast") && triggeredAt && status === "completed") {
        lastRuns[track] = triggeredAt
      }
    } catch {
      continue
    }
  }
  return lastRuns
}

function positiveNumber(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : 0
}

function nonNegativeNumberOr(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : fallback
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : []
}

function asRecord(value: unknown): JSONRecord {
  return value && typeof value === "object" && !Array.isArray(value) ? value as JSONRecord : {}
}

function stringField(value: unknown): string {
  return typeof value === "string" ? value.trim() : ""
}
