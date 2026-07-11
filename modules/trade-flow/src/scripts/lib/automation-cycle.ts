import { existsSync, readFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { Database } from "bun:sqlite"
import { findActiveLaneConflicts, listActiveFlows } from "./flow-state"
import { displayPath, repoRoot } from "./paths"

type JSONRecord = Record<string, unknown>

const DEFAULT_CATALOG_DB = "./data/data_catalog.db"
const TRADE_FLOW_MAIN = "bun modules/trade-flow/src/scripts/main.ts"
const ARTIFACT_CATALOG_MAIN = "bun modules/ops/artifact-catalog/src/scripts/main.ts"
const TOOLSET_PATH = "toolset.json"

interface CadenceState {
  due: boolean
  reason: string
  interval_minutes: number
  last_run_at: string | null
  next_due_at: string
}

interface ToolsetEntry {
  id: string
  module_type: string
  capability_class: string[]
  command: {
    cwd: string
    argv: string[]
  }
  writes: JSONRecord
  entry_contract: JSONRecord
  requires_preflight: boolean
  concurrency_group: string
}

export interface AutomationCycleInput {
  cycle_id?: string
  now?: string
  include_fast_track?: boolean
  include_slow_track?: boolean
  include_rd_strategy_supervisor?: boolean
  include_rd_trackers?: boolean
  include_closed_flow_review?: boolean
  include_catalog_hygiene?: boolean
  fast_interval_minutes?: number
  slow_interval_minutes?: number
  rd_supervisor_interval_minutes?: number
  rd_interval_minutes?: number
  review_interval_minutes?: number
  catalog_interval_minutes?: number
  force_jobs?: string[]
  last_runs?: JSONRecord
  rd_program_state_path?: string
  rd_strategy_goal?: JSONRecord
  rd_learning_memory_ref?: string
  rd_trackers?: JSONRecord[]
  catalog_db?: string
  catalog_roots?: string[]
}

export function buildAutomationCyclePlan(db: Database, dbPath: string, input: AutomationCycleInput = {}): JSONRecord {
  const generatedAt = normalizeNow(input.now)
  const tradeDbPath = displayPath(dbPath)
  const activeFlows = listActiveFlows(db)
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
  const rdProgramStatePath = stringField(input.rd_program_state_path)
  const rdProgramState = rdProgramStatePath ? readRdProgramStateSummary(rdProgramStatePath) : null
  const rdStrategyGoal = rdProgramState ? rdProgramGoalFromSummary(rdProgramState) : asRecord(input.rd_strategy_goal)
  const rdStrategyConfigured = Object.keys(rdStrategyGoal).length > 0
  const rdStrategyCanRun = rdStrategyConfigured && (!rdProgramState || rdProgramState.status === "active")
  const configuredCatalogRoots = asArray(input.catalog_roots).map(String).filter(Boolean)
  const catalogRoots = configuredCatalogRoots.length > 0 ? configuredCatalogRoots : ["./data", "./tmp"]
  const catalogDb = displayPath(stringField(input.catalog_db) || DEFAULT_CATALOG_DB)
  const tradeWorkDue = (activeFlowCount > 0 && cadence.fast_track_guard.due) || cadence.slow_track_market_watch.due

  const jobs = [
    tradeJob({
      job_id: "fast_track_guard",
      enabled: input.include_fast_track !== false,
      active: activeFlowCount > 0 && cadence.fast_track_guard.due,
      command: `${TRADE_FLOW_MAIN} --db ${tradeDbPath} --track fast`,
      toolJob: resolveToolJob({
        jobId: "fast_track_guard",
        toolId: "trade-flow.runtime",
        executable: activeFlowCount > 0 && cadence.fast_track_guard.due,
        payload: { db_path: tradeDbPath, track: "fast" },
        argv: ["bun", "src/scripts/main.ts", "--db", tradeDbPath, "--track", "fast"],
      }),
      reason: activeFlowCount > 0 ? "active flows need trigger, protection, and reconcile checks" : "no active flow needs fast guard",
      cadence: cadence.fast_track_guard,
    }),
    tradeJob({
      job_id: "slow_track_market_watch",
      enabled: input.include_slow_track !== false,
      active: cadence.slow_track_market_watch.due,
      command: `${TRADE_FLOW_MAIN} --db ${tradeDbPath} --track slow`,
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
      learningMemoryRef: stringField(input.rd_learning_memory_ref) || rdProgramStatePath || "data_catalog.db + docs/rd-audit.md",
      programStateRef: rdProgramStatePath,
      programStateStatus: rdProgramState ? stringField(rdProgramState.status) : undefined,
      catalogDb,
    }),
    artifactJob({
      job_id: "rd_forward_shadow_trackers",
      enabled: input.include_rd_trackers !== false,
      active: rdTrackers.length > 0 && cadence.rd_forward_shadow_trackers.due,
      reason: rdTrackers.length > 0 ? "configured R&D forward trackers can run without trade.db writes" : "no rd_trackers configured",
      trackers: rdTrackers,
      cadence: cadence.rd_forward_shadow_trackers,
    }),
    reviewJob({
      job_id: "closed_flow_review_sweep",
      enabled: input.include_closed_flow_review !== false,
      active: activeFlowCount > 0 && (tradeWorkDue || cadence.closed_flow_review_sweep.due),
      reason: "review is conditionally dispatched after upstream work reports a newly closed flow; cadence is only a missed-review fallback",
      cadence: cadence.closed_flow_review_sweep,
      candidateChainIds: activeFlows.map((flow) => flow.chain_id),
    }),
    artifactJob({
      job_id: "catalog_hygiene_scan",
      enabled: input.include_catalog_hygiene !== false,
      active: cadence.catalog_hygiene_scan.due,
      reason: "artifact visibility can run outside trade.db mutation path",
      command: `${ARTIFACT_CATALOG_MAIN} --catalog-scan --catalog-db ${catalogDb}${catalogRoots.map((root) => ` --catalog-root ${root}`).join("")}`,
      toolJob: resolveToolJob({
        jobId: "catalog_hygiene_scan",
        toolId: "artifact-catalog",
        executable: cadence.catalog_hygiene_scan.due,
        payload: { action: "catalog_scan", catalog_db: catalogDb, catalog_roots: catalogRoots },
        argv: ["bun", "src/scripts/main.ts", "--catalog-scan", "--catalog-db", catalogDb, ...catalogRoots.flatMap((root) => ["--catalog-root", root])],
      }),
      cadence: cadence.catalog_hygiene_scan,
    }),
  ]

  return {
    schema_version: "trade-flow.automation-cycle-plan.v1",
    cycle_id: input.cycle_id || `automation-cycle-${generatedAt.replace(/[:.]/g, "-")}`,
    generated_at: generatedAt,
    mode: "supervisor_plan",
    executable: false,
    dispatch_model: {
      single_automation_entry: true,
      subagent_fanout: "recommended",
      rule: "The supervisor owns scheduling and summary; child agents own isolated jobs and must not broaden their write scope.",
    },
    trade_db_path: tradeDbPath,
    active_flow_count: activeFlowCount,
    lane_conflicts: findActiveLaneConflicts(activeFlows),
    cadence,
    jobs,
    dispatch_order: [
      {
        stage: "serial_trade_db_guard",
        job_ids: ["fast_track_guard"],
        why: "Existing flow safety and reconcile checks run before broad market or research work.",
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
  command: string
  toolJob: JSONRecord
  reason: string
  cadence: CadenceState
}): JSONRecord {
  return {
    ...baseJob(input),
    subagent_role: "trade-flow-operator",
    write_scope: ["trade.db", "cron.log", "track artifacts"],
    concurrency_group: "trade-db",
    may_write_trade_db: true,
    may_call_binance_write: false,
    command: input.command,
    tool_job: input.toolJob,
    cadence: input.cadence,
  }
}

function artifactJob(input: {
  job_id: string
  enabled: boolean
  active: boolean
  reason: string
  cadence: CadenceState
  command?: string
  toolJob?: JSONRecord
  trackers?: JSONRecord[]
}): JSONRecord {
  return {
    ...baseJob(input),
    subagent_role: "research-artifact-operator",
    write_scope: ["research artifacts", "catalog metadata"],
    concurrency_group: input.job_id,
    may_write_trade_db: false,
    may_call_binance_write: false,
    cadence: input.cadence,
    ...(input.command ? { command: input.command } : {}),
    ...(input.toolJob ? { tool_job: input.toolJob } : {}),
    ...(input.trackers ? { trackers: input.trackers } : {}),
  }
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
  catalogDb: string
}): JSONRecord {
  const budget = asRecord(input.goal.budget)
  const programStateRef = input.programStateRef ? displayPath(input.programStateRef) : ""
  const supervisorPayload = {
    max_iterations: 20,
    artifact_root: "./tmp/artifacts/strategy-rnd",
    catalog_db_path: input.catalogDb,
  }
  const initPayload = {
    action: "init",
    objective: stringField(input.goal.objective) || "find a shadow-eligible 4H swing strategy",
    budget: {
      max_hypotheses: positiveNumber(budget.max_hypotheses) || 20,
      max_trials_total: positiveNumber(budget.max_trials_total) || 80,
      max_locked_holdout_uses: positiveNumber(budget.max_locked_holdout_uses) || 1,
    },
  }
  const commandArgv = programStateRef
    ? [
      "bun",
      "modules/research/rd-supervisor/src/scripts/main.ts",
      "--state",
      programStateRef,
      "--catalog-db",
      input.catalogDb,
      "--json",
      JSON.stringify(supervisorPayload),
    ]
    : []
  const supervisorToolJob = programStateRef
    ? resolveToolJob({
      jobId: "rd_strategy_supervisor",
      toolId: "research.rd-supervisor",
      executable: input.active,
      payload: { state: programStateRef, catalog_db: input.catalogDb, json: supervisorPayload },
      argv: commandArgv,
    })
    : null
  const initArgv = [
    "bun",
    "modules/research/rd-program-state/src/scripts/main.ts",
    "--state",
    "./data/rd/program.json",
    "--catalog-db",
    input.catalogDb,
    "--json",
    JSON.stringify(initPayload),
  ]
  const initToolJob = resolveToolJob({
    jobId: "rd_strategy_supervisor.init",
    toolId: "research.rd-program-state",
    executable: false,
    payload: { state: "./data/rd/program.json", catalog_db: input.catalogDb, json: initPayload },
    argv: initArgv,
  })
  return {
    ...baseJob(input),
    subagent_role: "rd-supervisor",
    write_scope: ["research artifacts", "catalog metadata", "strategy drafts only after gated candidate"],
    concurrency_group: "research-rd",
    may_write_trade_db: false,
    may_call_binance_write: false,
    cadence: input.cadence,
    goal: input.goal,
    ...(programStateRef ? { program_state_ref: programStateRef } : {}),
    ...(input.programStateStatus ? { program_state_status: input.programStateStatus } : {}),
    ...(commandArgv.length > 0 ? {
      command: shellCommand(commandArgv),
      tool_job: supervisorToolJob,
      command_spec: {
        executable: input.active,
        argv: commandArgv,
        writes: ["tmp/artifacts/strategy-rnd", input.catalogDb, programStateRef],
      },
    } : {
      tool_job: initToolJob,
      init_command_spec: {
        executable: false,
        argv: initArgv,
        writes: ["data/rd", input.catalogDb],
      },
    }),
    entrypoint: "read rd_program_state, request action=plan_next, then explicitly run the returned R&D loop/campaign payload and write learning-memory updates until a stop condition is reached",
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
        max_locked_holdout_uses: positiveNumber(budget.max_locked_holdout_uses) || 1,
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
      single_writer_rule: "Sidecar subagents are read-only scouts; only rd-supervisor may write rd_program_state through research.rd-program-state or payload writeback.",
    },
  }
}

function shellCommand(argv: string[]): string {
  return argv.map(shellQuote).join(" ")
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
}): JSONRecord {
  return {
    ...baseJob(input),
    subagent_role: "closed-flow-reviewer",
    write_scope: ["trade.db review events", "review artifacts"],
    concurrency_group: "trade-db",
    may_write_trade_db: true,
    may_call_binance_write: false,
    trigger_mode: "event_or_fallback_sweep",
    dispatch_condition: "Run after upstream jobs only when they report a newly closed flow without review; when fallback cadence is due, scan candidate_chain_ids for missed reviews.",
    candidate_chain_ids: input.candidateChainIds,
    entrypoint: "reduce the closed flow, derive deterministic quant fields, add bounded qualitative attribution, then append exactly one review event through --append-review",
    cadence: input.cadence,
  }
}

function baseJob(input: { job_id: string; enabled: boolean; active: boolean; reason: string }): JSONRecord {
  return {
    job_id: input.job_id,
    enabled: input.enabled,
    active: input.enabled && input.active,
    reason: input.reason,
  }
}

function resolveToolJob(input: {
  jobId: string
  toolId: string
  executable: boolean
  payload: JSONRecord
  argv: string[]
}): JSONRecord {
  const tool = readToolsetEntry(input.toolId)
  return {
    job_id: input.jobId,
    tool_id: tool.id,
    module_type: tool.module_type,
    capability_class: tool.capability_class,
    writes: tool.writes,
    concurrency_group: tool.concurrency_group,
    requires_preflight: tool.requires_preflight,
    payload: input.payload,
    entry_contract: tool.entry_contract,
    command_spec: {
      executable: input.executable,
      cwd: tool.command.cwd,
      argv: normalizeToolArgv(tool, input.argv),
    },
  }
}

function readToolsetEntry(toolId: string): ToolsetEntry {
  const manifest = JSON.parse(readFileSync(join(repoRoot(), TOOLSET_PATH), "utf8")) as { tools?: unknown[] }
  const tools = Array.isArray(manifest.tools) ? manifest.tools.map(asRecord) : []
  const raw = tools.find((entry) => stringField(entry.id) === toolId)
  if (!raw) {
    throw new Error(`toolset entry not found: ${toolId}`)
  }
  const command = asRecord(raw.command)
  return {
    id: stringField(raw.id),
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

function normalizeToolArgv(tool: ToolsetEntry, argv: string[]): string[] {
  const prefix = `${tool.command.cwd}/`
  return argv.map((part, index) => index === 1 && part.startsWith(prefix) ? part.slice(prefix.length) : part)
}

function readRdProgramStateSummary(path: string): JSONRecord | null {
  try {
    return asRecord(JSON.parse(readFileSync(path, "utf8")))
  } catch {
    return null
  }
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

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : []
}

function asRecord(value: unknown): JSONRecord {
  return value && typeof value === "object" && !Array.isArray(value) ? value as JSONRecord : {}
}

function stringField(value: unknown): string {
  return typeof value === "string" ? value.trim() : ""
}
