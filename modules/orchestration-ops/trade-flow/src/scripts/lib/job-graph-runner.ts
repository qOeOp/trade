import { mkdirSync } from "node:fs"
import { dirname, join } from "node:path"
import { Database } from "bun:sqlite"
import {
  buildCycleRun,
  buildJobRun,
  ensureOpsRuntimeSchema,
  readCycleSummary,
  upsertCycleRun,
  upsertJobRun,
} from "../../../../ops-runtime-store/src/lib/ops-runtime-store"
import { publishDomainMessage } from "../../../../domain-bus/src/lib/domain-bus"
import { buildAutomationCyclePlan, type AutomationCycleInput } from "./automation-cycle"
import { repoRoot } from "./paths"

type JSONRecord = Record<string, unknown>

export interface JobGraphRunnerInput extends AutomationCycleInput {
  execute_jobs?: boolean
  allow_live_writes?: boolean
}

export interface CommandExecutionResult {
  exit_code: number
  stdout: string
  stderr: string
}

export type CommandExecutor = (command: CommandSpec) => Promise<CommandExecutionResult>

interface CommandSpec {
  executable: boolean
  cwd: string
  argv: string[]
}

interface JobResult {
  ticket_no: string
  job_id: string
  target_domain: string
  stage: string
  status: string
  reason: string
  result_ref?: string
  exit_code?: number
}

export async function runAutomationJobGraph(
  tradeDb: Database,
  tradeDbPath: string,
  input: JobGraphRunnerInput = {},
  executor: CommandExecutor = executeCommand,
): Promise<JSONRecord> {
  const plan = buildAutomationCyclePlan(tradeDb, tradeDbPath, input)
  const cycleId = stringField(plan.cycle_id)
  const generatedAt = stringField(plan.generated_at) || new Date().toISOString()
  const opsRuntimeDbPath = stringField(input.ops_runtime_db) || "./data/ops_runtime.db"
  mkdirSync(dirname(opsRuntimeDbPath), { recursive: true })

  const opsDb = new Database(opsRuntimeDbPath)
  try {
    ensureOpsRuntimeSchema(opsDb)
    upsertCycleRun(opsDb, buildCycleRun({
      cycle_id: cycleId,
      now: generatedAt,
      status: "running",
      summary: {
        mode: input.execute_jobs === true ? "execute" : "dry_run",
        plan_schema_version: plan.schema_version,
      },
    }))

    const jobById = new Map(asArray(plan.jobs).map(asRecord).map((job) => [stringField(job.job_id), job]))
    const results: JobResult[] = []

    for (const stage of asArray(plan.dispatch_order).map(asRecord)) {
      const stageName = stringField(stage.stage) || "unspecified"
      const stageJobs = asArray(stage.job_ids).map(String).map((jobId) => jobById.get(jobId)).filter((job): job is JSONRecord => Boolean(job))
      const stageResults = await Promise.all(stageJobs.map((job) => runOneJob({
        job,
        stage: stageName,
        cycleId,
        generatedAt,
        executeJobs: input.execute_jobs === true,
        allowLiveWrites: input.allow_live_writes === true,
        opsDb,
        executor,
      })))
      results.push(...stageResults)
    }

    const status = results.some((job) => job.status === "failed" || job.status === "blocked")
      ? "failed"
      : "completed"
    const summary = {
      mode: input.execute_jobs === true ? "execute" : "dry_run",
      total_jobs: results.length,
      completed: results.filter((job) => job.status === "completed").length,
      skipped: results.filter((job) => job.status === "skipped").length,
      failed: results.filter((job) => job.status === "failed").length,
      blocked: results.filter((job) => job.status === "blocked").length,
    }
    upsertCycleRun(opsDb, buildCycleRun({
      cycle_id: cycleId,
      now: generatedAt,
      triggered_at: generatedAt,
      completed_at: new Date().toISOString(),
      status,
      summary,
    }))
    const cycleSummary = readCycleSummary(opsDb, cycleId)

    return {
      schema_version: "trade-flow.job-graph-runner-result.v1",
      ok: status === "completed",
      cycle_id: cycleId,
      mode: summary.mode,
      ops_runtime_db: opsRuntimeDbPath,
      summary,
      ops_summary: cycleSummary.ops_summary,
      jobs: results,
      plan,
    }
  } finally {
    opsDb.close()
  }
}

async function runOneJob(input: {
  job: JSONRecord
  stage: string
  cycleId: string
  generatedAt: string
  executeJobs: boolean
  allowLiveWrites: boolean
  opsDb: Database
  executor: CommandExecutor
}): Promise<JobResult> {
  const toolJob = asRecord(input.job.tool_job)
  const command = commandSpecFromJob(input.job)
  const ticketNo = stringField(toolJob.ticket_no) || stringField(input.job.ticket_no) || stringField(input.job.job_id)
  const jobId = stringField(input.job.job_id)
  const targetDomain = stringField(toolJob.target_domain) || stringField(input.job.target_domain) || "orchestration-ops"
  const base = {
    ticket_no: ticketNo,
    job_id: jobId,
    target_domain: targetDomain,
    stage: input.stage,
  }
  publishBusMessage(input.opsDb, {
    direction: "inbox",
    cycleId: input.cycleId,
    jobId,
    targetDomain,
    ticketNo,
    stage: input.stage,
    status: "published",
    createdAt: input.generatedAt,
  })

  if (input.job.enabled === false) {
    return recordJobAndBus(input.opsDb, input.cycleId, base, "skipped", "job disabled", input.generatedAt)
  }
  if (input.job.active !== true) {
    return recordJobAndBus(input.opsDb, input.cycleId, base, "skipped", stringField(input.job.reason) || "job inactive", input.generatedAt)
  }
  if (!command.executable) {
    return recordJobAndBus(input.opsDb, input.cycleId, base, "skipped", "command_spec is not executable", input.generatedAt)
  }
  if (!input.executeJobs) {
    return recordJobAndBus(input.opsDb, input.cycleId, base, "skipped", "runner dry-run; set execute_jobs=true to run command_spec", input.generatedAt)
  }

  const liveWriteBlocker = liveWriteBlockerReason(command, input.allowLiveWrites)
  if (liveWriteBlocker) {
    return recordJobAndBus(input.opsDb, input.cycleId, base, "blocked", liveWriteBlocker, input.generatedAt)
  }

  upsertJobRun(input.opsDb, buildJobRun({
    cycle_id: input.cycleId,
    ticket_no: ticketNo,
    job_id: jobId,
    target_domain: targetDomain,
    status: "running",
    command_ref: commandRef(command),
    started_at: new Date().toISOString(),
  }))
  const executed = await input.executor(command)
  if (executed.exit_code === 0) {
    return recordJobAndBus(input.opsDb, input.cycleId, base, "completed", "command completed", input.generatedAt, {
      result_ref: `ops-runtime://cycle/${input.cycleId}/job/${ticketNo}`,
      exit_code: executed.exit_code,
    })
  }
  const result = recordJobAndBus(input.opsDb, input.cycleId, base, "failed", "command exited non-zero", input.generatedAt, {
    result_ref: `ops-runtime://cycle/${input.cycleId}/job/${ticketNo}`,
    exit_code: executed.exit_code,
  }, {
    exit_code: executed.exit_code,
    stderr: executed.stderr.slice(0, 4000),
    stdout_tail: executed.stdout.slice(-1000),
  })
  return result
}

function recordJobAndBus(
  db: Database,
  cycleId: string,
  base: Omit<JobResult, "status" | "reason" | "result_ref" | "exit_code">,
  status: string,
  reason: string,
  now: string,
  extra: Pick<JobResult, "result_ref" | "exit_code"> = {},
  error: JSONRecord = {},
): JobResult {
  const result = recordJob(db, cycleId, base, status, reason, now, extra, error)
  publishBusMessage(db, {
    direction: "outbox",
    cycleId,
    jobId: base.job_id,
    targetDomain: base.target_domain,
    ticketNo: base.ticket_no,
    stage: base.stage,
    status: status === "failed" || status === "blocked" ? "failed" : "published",
    createdAt: new Date().toISOString(),
    payloadRef: result.result_ref || `ops-runtime://cycle/${cycleId}/job/${base.ticket_no}`,
  })
  return result
}

function recordJob(
  db: Database,
  cycleId: string,
  base: Omit<JobResult, "status" | "reason" | "result_ref" | "exit_code">,
  status: string,
  reason: string,
  now: string,
  extra: Pick<JobResult, "result_ref" | "exit_code"> = {},
  error: JSONRecord = {},
): JobResult {
  const completedAt = new Date().toISOString()
  upsertJobRun(db, buildJobRun({
    cycle_id: cycleId,
    ticket_no: base.ticket_no,
    job_id: base.job_id,
    target_domain: base.target_domain,
    status,
    command_ref: `${base.stage}:${base.job_id}`,
    started_at: now,
    completed_at: completedAt,
    result_ref: extra.result_ref || `ops-runtime://cycle/${cycleId}/job/${base.ticket_no}`,
    error: Object.keys(error).length > 0 ? error : undefined,
  }))
  return {
    ...base,
    status,
    reason,
    ...extra,
  }
}

function publishBusMessage(db: Database, input: {
  direction: "inbox" | "outbox"
  cycleId: string
  jobId: string
  targetDomain: string
  ticketNo: string
  stage: string
  status: string
  createdAt: string
  payloadRef?: string
}): void {
  publishDomainMessage(db, {
    direction: input.direction,
    cycle_id: input.cycleId,
    job_id: input.jobId,
    source_domain: input.direction === "inbox" ? "orchestration-ops" : input.targetDomain,
    target_domain: input.direction === "inbox" ? input.targetDomain : "orchestration-ops",
    rail: input.direction === "inbox" ? "command_rail" : "artifact_rail",
    payload_ref: input.payloadRef || `job:${input.ticketNo}`,
    idempotency_key: `${input.cycleId}:${input.ticketNo}:${input.direction}`,
    message_id: `${input.cycleId}:${input.ticketNo}:${input.direction}`,
    status: input.status,
    created_at: input.createdAt,
    stage: input.stage,
  })
}

function commandSpecFromJob(job: JSONRecord): CommandSpec {
  const commandSpec = asRecord(job.command_spec)
  return {
    executable: commandSpec.executable === true,
    cwd: stringField(commandSpec.cwd),
    argv: asArray(commandSpec.argv).map(String).filter(Boolean),
  }
}

async function executeCommand(command: CommandSpec): Promise<CommandExecutionResult> {
  const child = Bun.spawn(command.argv, {
    cwd: command.cwd ? join(repoRoot(), command.cwd) : repoRoot(),
    stdout: "pipe",
    stderr: "pipe",
  })
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
    child.exited,
  ])
  return {
    exit_code: exitCode,
    stdout,
    stderr,
  }
}

function liveWriteBlockerReason(command: CommandSpec, allowLiveWrites: boolean): string {
  if (allowLiveWrites) {
    return ""
  }
  return command.argv.includes("--run-live-small") || command.argv.some((part) => part.includes("binance-write"))
    ? "live write command requires a separate explicit authorization"
    : ""
}

function commandRef(command: CommandSpec): string {
  return `${command.cwd}:${command.argv.join(" ")}`
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
