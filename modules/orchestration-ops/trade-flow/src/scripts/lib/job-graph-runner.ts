import { mkdirSync } from "node:fs"
import { dirname, join } from "node:path"
import { Database } from "bun:sqlite"
import {
  buildCycleRun,
  buildIncident,
  buildJobRun,
  ensureOpsRuntimeSchema,
  readCycleSummary,
  recordIncident,
  upsertCycleRun,
  upsertJobRun,
} from "../../../../ops-runtime-store/src/lib/ops-runtime-store"
import { publishDomainMessage } from "../../../../domain-bus/src/lib/domain-bus"
import { buildDomainJobResult, validateDomainJobResult } from "../../../../../contracts/domain-runtime/src/domain-runtime"
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
  runtime_result?: JSONRecord
}

interface ProcessorResult {
  processor_id: string
  lifecycle_phase: string
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
    const processorById = new Map(asArray(plan.lifecycle_processors).map(asRecord).map((processor) => [stringField(processor.processor_id), processor]))
    const results: JobResult[] = []
    const processorResults: ProcessorResult[] = []

    for (const stage of asArray(plan.dispatch_order).map(asRecord)) {
      const stageName = stringField(stage.stage) || "unspecified"
      const stageProcessors = asArray(stage.processor_ids).map(String).map((processorId) => processorById.get(processorId)).filter((processor): processor is JSONRecord => Boolean(processor))
      const stageProcessorResults = await Promise.all(stageProcessors.map((processor) => runOneProcessor({
        processor,
        stage: stageName,
        cycleId,
        generatedAt,
        executeJobs: input.execute_jobs === true,
        allowLiveWrites: input.allow_live_writes === true,
        opsDb,
        executor,
      })))
      processorResults.push(...stageProcessorResults)

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

    const failedOrBlocked = [...results, ...processorResults].some((unit) => unit.status === "failed" || unit.status === "blocked")
    const status = failedOrBlocked
      ? "failed"
      : "completed"
    const summary = {
      mode: input.execute_jobs === true ? "execute" : "dry_run",
      total_jobs: results.length,
      total_processors: processorResults.length,
      completed: results.filter((job) => job.status === "completed").length,
      skipped: results.filter((job) => job.status === "skipped").length,
      failed: results.filter((job) => job.status === "failed").length,
      blocked: results.filter((job) => job.status === "blocked").length,
      processors: {
        completed: processorResults.filter((processor) => processor.status === "completed").length,
        skipped: processorResults.filter((processor) => processor.status === "skipped").length,
        failed: processorResults.filter((processor) => processor.status === "failed").length,
        blocked: processorResults.filter((processor) => processor.status === "blocked").length,
      },
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
      lifecycle_processors: processorResults,
      jobs: results,
      plan,
    }
  } finally {
    opsDb.close()
  }
}

async function runOneProcessor(input: {
  processor: JSONRecord
  stage: string
  cycleId: string
  generatedAt: string
  executeJobs: boolean
  allowLiveWrites: boolean
  opsDb: Database
  executor: CommandExecutor
}): Promise<ProcessorResult> {
  const command = commandSpecFromJob(input.processor)
  const processorId = stringField(input.processor.processor_id)
  const lifecyclePhase = stringField(input.processor.lifecycle_phase) || input.stage
  const base = {
    processor_id: processorId,
    lifecycle_phase: lifecyclePhase,
    stage: input.stage,
  }

  if (input.processor.enabled === false) {
    return { ...base, status: "skipped", reason: "processor disabled" }
  }
  if (input.processor.active !== true) {
    return { ...base, status: "skipped", reason: stringField(input.processor.reason) || "processor inactive" }
  }
  if (!command.executable) {
    return { ...base, status: "skipped", reason: "command_spec is not executable" }
  }
  if (!input.executeJobs) {
    return { ...base, status: "skipped", reason: "runner dry-run; set execute_jobs=true to run command_spec" }
  }

  const liveWriteBlocker = liveWriteBlockerReason(command, input.allowLiveWrites)
  if (liveWriteBlocker) {
    const result = { ...base, status: "blocked", reason: liveWriteBlocker }
    recordProcessorIncident(input.opsDb, input.cycleId, input.generatedAt, result)
    return result
  }

  const executed = await input.executor(command)
  const resultRef = `ops-runtime://cycle/${input.cycleId}/processor/${processorId}`
  const result = {
    ...base,
    status: executed.exit_code === 0 ? "completed" : "failed",
    reason: executed.exit_code === 0 ? "command completed" : "command exited non-zero",
    result_ref: resultRef,
    exit_code: executed.exit_code,
  }
  recordProcessorIncident(input.opsDb, input.cycleId, input.generatedAt, result)
  return result
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
    input_refs: asArray(toolJob.input_refs ?? input.job.input_refs).map(String),
    writes: asRecord(toolJob.writes),
    allowed_runtime_writes: asArray(input.job.allowed_runtime_writes).map(String),
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
    const nativeRuntimeResult = extractNativeRuntimeResult(executed.stdout)
    if (nativeRuntimeResult) {
      return recordJobAndBus(input.opsDb, input.cycleId, base, runnerStatusFromRuntimeResult(nativeRuntimeResult), "domain job returned native runtime_result", input.generatedAt, {
        result_ref: firstOutputRef(nativeRuntimeResult) || `ops-runtime://cycle/${input.cycleId}/job/${ticketNo}`,
        exit_code: executed.exit_code,
        runtime_result: nativeRuntimeResult,
      })
    }
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
  base: JobResultBase,
  status: string,
  reason: string,
  now: string,
  extra: JobRecordExtra = {},
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
  base: JobResultBase,
  status: string,
  reason: string,
  now: string,
  extra: JobRecordExtra = {},
  error: JSONRecord = {},
): JobResult {
  const completedAt = new Date().toISOString()
  const resultRef = extra.result_ref || `ops-runtime://cycle/${cycleId}/job/${base.ticket_no}`
  upsertJobRun(db, buildJobRun({
    cycle_id: cycleId,
    ticket_no: base.ticket_no,
    job_id: base.job_id,
    target_domain: base.target_domain,
    status,
    command_ref: `${base.stage}:${base.job_id}`,
    started_at: now,
    completed_at: completedAt,
    result_ref: resultRef,
    error: Object.keys(error).length > 0 ? error : undefined,
  }))
  const runtimeResult = extra.runtime_result ?? buildDomainJobResult({
    domain: base.target_domain,
    job_id: base.job_id,
    idempotency_key: `${cycleId}:${base.ticket_no}`,
    status: domainStatusFromRunnerStatus(status),
    input_refs: base.input_refs,
    output_refs: [resultRef],
    writes: runtimeWritesForBase(base),
    incidents: [],
    audit: {
      cycle_id: cycleId,
      ticket_no: base.ticket_no,
      stage: base.stage,
      completed_at: completedAt,
    },
  })
  validateDomainJobResult(runtimeResult, allowedRuntimeWrites(base))
  if (status === "failed" || status === "blocked") {
    recordIncident(db, buildIncident({
      incident_id: `incident-${cycleId}-${base.ticket_no}-${status}`,
      cycle_id: cycleId,
      source: "job_run",
      severity: "critical",
      title: `${base.job_id} ${status}`,
      refs: [resultRef],
      detail: {
        ticket_no: base.ticket_no,
        job_id: base.job_id,
        target_domain: base.target_domain,
        stage: base.stage,
        status,
        reason,
        error,
      },
      first_seen_at: completedAt,
    }))
  }
  return {
    ticket_no: base.ticket_no,
    job_id: base.job_id,
    target_domain: base.target_domain,
    stage: base.stage,
    status,
    reason,
    runtime_result: runtimeResult,
    ...extra,
  }
}

function recordProcessorIncident(db: Database, cycleId: string, now: string, result: ProcessorResult): void {
  if (result.status !== "failed" && result.status !== "blocked") {
    return
  }
  recordIncident(db, buildIncident({
    incident_id: `incident-${cycleId}-${result.processor_id}-${result.status}`,
    cycle_id: cycleId,
    source: "lifecycle_processor",
    severity: "critical",
    title: `${result.processor_id} ${result.status}`,
    refs: result.result_ref ? [result.result_ref] : [],
    detail: {
      processor_id: result.processor_id,
      lifecycle_phase: result.lifecycle_phase,
      stage: result.stage,
      status: result.status,
      reason: result.reason,
      exit_code: result.exit_code,
    },
    first_seen_at: now,
  }))
}

interface JobResultBase {
  ticket_no: string
  job_id: string
  target_domain: string
  stage: string
  input_refs: string[]
  writes: JSONRecord
  allowed_runtime_writes: string[]
}

interface JobRecordExtra {
  result_ref?: string
  exit_code?: number
  runtime_result?: JSONRecord
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

function extractNativeRuntimeResult(stdout: string): JSONRecord | undefined {
  const parsed = parseJsonObject(stdout)
  const direct = asRecord(parsed.runtime_result)
  if (Object.keys(direct).length > 0) {
    return direct
  }
  const wrapped = asRecord(asRecord(parsed.data).runtime_result)
  return Object.keys(wrapped).length > 0 ? wrapped : undefined
}

function parseJsonObject(value: string): JSONRecord {
  try {
    const parsed = JSON.parse(value)
    return asRecord(parsed)
  } catch {
    return {}
  }
}

function firstOutputRef(runtimeResult: JSONRecord): string {
  return asArray(runtimeResult.output_refs).map(String).find(Boolean) || ""
}

function runnerStatusFromRuntimeResult(runtimeResult: JSONRecord): string {
  const status = stringField(runtimeResult.status)
  if (status === "ok") {
    return "completed"
  }
  if (status === "skipped" || status === "blocked" || status === "failed") {
    return status
  }
  return "blocked"
}

function allowedRuntimeWrites(base: JobResultBase): string[] {
  return base.allowed_runtime_writes.length > 0 ? base.allowed_runtime_writes : Object.keys(base.writes)
}

function runtimeWritesForBase(base: JobResultBase): JSONRecord {
  if (base.allowed_runtime_writes.length === 0) {
    return base.writes
  }
  return Object.fromEntries(base.allowed_runtime_writes.map((write) => [write, true]))
}

function domainStatusFromRunnerStatus(status: string): string {
  if (status === "completed") {
    return "ok"
  }
  if (status === "skipped" || status === "blocked" || status === "failed") {
    return status
  }
  return "failed"
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
