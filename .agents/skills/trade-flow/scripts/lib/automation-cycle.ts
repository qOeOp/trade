import { existsSync, readFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { Database } from "bun:sqlite"
import { findActiveLaneConflicts, listActiveFlows } from "./flow-state"
import { displayPath } from "./paths"

type JSONRecord = Record<string, unknown>

const DEFAULT_CATALOG_DB = "./data/data_catalog.db"
const TRADE_FLOW_MAIN = "bun .agents/skills/trade-flow/scripts/main.ts"

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
  include_fast_track?: boolean
  include_slow_track?: boolean
  include_rd_trackers?: boolean
  include_closed_flow_review?: boolean
  include_catalog_hygiene?: boolean
  fast_interval_minutes?: number
  slow_interval_minutes?: number
  rd_interval_minutes?: number
  review_interval_minutes?: number
  catalog_interval_minutes?: number
  force_jobs?: string[]
  last_runs?: JSONRecord
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
  const catalogRoots = asArray(input.catalog_roots).map(String).filter(Boolean)
  const catalogDb = stringField(input.catalog_db) || DEFAULT_CATALOG_DB
  const tradeWorkDue = (activeFlowCount > 0 && cadence.fast_track_guard.due) || cadence.slow_track_market_watch.due

  const jobs = [
    tradeJob({
      job_id: "fast_track_guard",
      enabled: input.include_fast_track !== false,
      active: activeFlowCount > 0 && cadence.fast_track_guard.due,
      command: `${TRADE_FLOW_MAIN} --db ${tradeDbPath} --track fast`,
      reason: activeFlowCount > 0 ? "active flows need trigger, protection, and reconcile checks" : "no active flow needs fast guard",
      cadence: cadence.fast_track_guard,
    }),
    tradeJob({
      job_id: "slow_track_market_watch",
      enabled: input.include_slow_track !== false,
      active: cadence.slow_track_market_watch.due,
      command: `${TRADE_FLOW_MAIN} --db ${tradeDbPath} --track slow`,
      reason: "slow track owns market watch and strategic observe",
      cadence: cadence.slow_track_market_watch,
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
      command: `${TRADE_FLOW_MAIN} --catalog-scan --catalog-db ${catalogDb}${catalogRoots.map((root) => ` --catalog-root ${root}`).join("")}`,
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
        job_ids: ["slow_track_market_watch", "rd_forward_shadow_trackers", "catalog_hygiene_scan"],
        why: "Only slow_track_market_watch may touch trade.db; R&D and catalog jobs are artifact/catalog scoped.",
      },
      {
        stage: "serial_review_closeout",
        job_ids: ["closed_flow_review_sweep"],
        why: "Conditionally dispatch review only after upstream work reports a newly closed flow; fallback cadence may scan missed reviews.",
      },
    ],
    guardrails: [
      "The supervisor and subagents must never call --run-live-small or execution Binance skills unless a separate live-small request is explicitly authorized.",
      "At most one job in a cycle may write trade.db at a time; existing cron lock remains the final local guard.",
      "Slow/R&D/catalog jobs must pass cadence due checks when the single external automation runs at fast-track frequency; review is event-first with cadence fallback.",
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
    ...(input.trackers ? { trackers: input.trackers } : {}),
  }
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
