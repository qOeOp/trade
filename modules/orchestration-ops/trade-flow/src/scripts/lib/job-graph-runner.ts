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
import { buildDomainJobResult, buildHookContext, validateDomainJobResult } from "../../../../../contracts/domain-runtime/src/domain-runtime"
import { buildAutomationCyclePlanAsync, type AutomationCycleInput } from "./automation-cycle"
import { repoRoot } from "../../../../../contracts/runtime-core/src/paths"
import { canonicalHash } from "../../../../../contracts/runtime-core/src/canonical-json"

type JSONRecord = Record<string, unknown>

export interface JobGraphRunnerInput extends AutomationCycleInput {
  execute_jobs?: boolean
  allow_live_writes?: boolean
  command_timeout_ms?: number
}

export interface CommandExecutionResult {
  exit_code: number
  stdout: string
  stderr: string
  timed_out?: boolean
}

export interface CommandExecutionOptions {
  timeoutMs?: number
}

export type CommandExecutor = (command: CommandSpec, options?: CommandExecutionOptions) => Promise<CommandExecutionResult>

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
  timed_out?: boolean
  business_status?: string
  health_checks?: JSONRecord
}

export async function runAutomationJobGraph(
  tradeDb: Database,
  tradeDbPath: string,
  input: JobGraphRunnerInput = {},
  executor: CommandExecutor = executeCommand,
): Promise<JSONRecord> {
  const plan = await buildAutomationCyclePlanAsync(tradeDb, tradeDbPath, input)
  const cycleId = stringField(plan.cycle_id)
  const generatedAt = stringField(plan.generated_at) || new Date().toISOString()
  const opsRuntimeDbPath = stringField(input.ops_runtime_db) || "./data/ops_runtime.db"
  const commandTimeoutMs = normalizeCommandTimeoutMs(input.command_timeout_ms)
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
        commandTimeoutMs,
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
        commandTimeoutMs,
        priorResults: results,
        priorProcessorResults: processorResults,
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

    const graphResult: JSONRecord = {
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
    return {
      ...graphResult,
      parity_projection: projectJobGraphParity(graphResult),
    }
  } finally {
    opsDb.close()
  }
}

export function projectJobGraphParity(result: JSONRecord): JSONRecord {
  const summary = asRecord(result.summary)
  const opsSummary = asRecord(result.ops_summary)
  const incidentSummary = asRecord(opsSummary.incidents)
  const attention = asRecord(opsSummary.attention)
  const projection = {
    mode: stringField(result.mode),
    jobs: asArray(result.jobs).map(asRecord).map((job) => {
      const runtimeResult = asRecord(job.runtime_result)
      return {
        ticket_no: stringField(job.ticket_no),
        job_id: stringField(job.job_id),
        target_domain: stringField(job.target_domain),
        stage: stringField(job.stage),
        status: stringField(job.status),
        reason: stringField(job.reason),
        runtime_result: {
          schema_id: stringField(runtimeResult.schema_id),
          status: stringField(runtimeResult.status),
          domain: stringField(runtimeResult.domain),
          job_id: stringField(runtimeResult.job_id),
          writes: sortedRecord(asRecord(runtimeResult.writes)),
        },
      }
    }),
    lifecycle_processors: asArray(result.lifecycle_processors).map(asRecord).map((processor) => ({
      processor_id: stringField(processor.processor_id),
      lifecycle_phase: stringField(processor.lifecycle_phase),
      stage: stringField(processor.stage),
      status: stringField(processor.status),
      reason: stringField(processor.reason),
      business_status: stringField(processor.business_status),
      health_checks: sortedRecord(asRecord(processor.health_checks)),
    })),
    summary: {
      total_jobs: integerField(summary.total_jobs),
      total_processors: integerField(summary.total_processors),
      completed: integerField(summary.completed),
      skipped: integerField(summary.skipped),
      failed: integerField(summary.failed),
      blocked: integerField(summary.blocked),
      processors: sortedRecord(asRecord(summary.processors)),
    },
    incidents: {
      total: integerField(incidentSummary.total),
      open: integerField(incidentSummary.open),
      critical: integerField(incidentSummary.critical),
      warning: integerField(incidentSummary.warning),
    },
    attention: {
      needs_human: attention.needs_human === true,
      severity: stringField(attention.severity),
    },
  }
  return {
    schema_version: "trade-flow.job-graph-parity-projection.v1",
    projection_hash: canonicalHash(projection),
    ...projection,
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
  commandTimeoutMs?: number
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

  const executed = await executeWithTimeout(input.executor, command, input.commandTimeoutMs)
  const businessResult = executed.exit_code === 0
    ? runtimeHealthProcessorResult(processorId, executed.stdout)
    : null
  const resultRef = businessResult?.result_ref || `ops-runtime://cycle/${input.cycleId}/processor/${processorId}`
  const result = {
    ...base,
    status: businessResult?.status ?? (executed.exit_code === 0 ? "completed" : "failed"),
    reason: executed.timed_out
      ? "command timed out"
      : businessResult?.reason ?? (executed.exit_code === 0 ? "command completed" : "command exited non-zero"),
    result_ref: resultRef,
    exit_code: executed.exit_code,
    ...(executed.timed_out ? { timed_out: true } : {}),
    ...(businessResult?.business_status ? { business_status: businessResult.business_status } : {}),
    ...(businessResult?.health_checks ? { health_checks: businessResult.health_checks } : {}),
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
  commandTimeoutMs?: number
  priorResults: JobResult[]
  priorProcessorResults: ProcessorResult[]
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
    domain_hook_contexts: [] as JSONRecord[],
  }
  base.domain_hook_contexts.push(buildJobHookContext(base, input.cycleId, "pre_accept"))
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

  const healthBlocker = healthDependencyBlockerReason(input.job, input.priorProcessorResults)
  if (healthBlocker) {
    return recordJobAndBus(input.opsDb, input.cycleId, base, "blocked", healthBlocker, input.generatedAt)
  }

  const dependencyBlocker = dependencyBlockerReason(input.job, input.priorResults)
  if (dependencyBlocker) {
    return recordJobAndBus(input.opsDb, input.cycleId, base, "blocked", dependencyBlocker, input.generatedAt)
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
  base.domain_hook_contexts.push(
    buildJobHookContext(base, input.cycleId, "pre_handle"),
    buildJobHookContext(base, input.cycleId, "handler"),
  )
  const executed = await executeWithTimeout(input.executor, command, input.commandTimeoutMs)
  if (executed.exit_code === 0) {
    const nativeRuntimeResult = extractNativeRuntimeResult(executed.stdout)
    if (nativeRuntimeResult) {
      return recordJobAndBus(input.opsDb, input.cycleId, base, runnerStatusFromRuntimeResult(nativeRuntimeResult), "domain job returned native runtime_result", input.generatedAt, {
        result_ref: firstOutputRef(nativeRuntimeResult) || `ops-runtime://cycle/${input.cycleId}/job/${ticketNo}`,
        exit_code: executed.exit_code,
        runtime_result: nativeRuntimeResult,
      })
    }
    const businessStatus = resultPolicyStatus(input.job, executed.stdout)
    if (businessStatus) {
      return recordJobAndBus(input.opsDb, input.cycleId, base, businessStatus.status, businessStatus.reason, input.generatedAt, {
        result_ref: `ops-runtime://cycle/${input.cycleId}/job/${ticketNo}`,
        exit_code: executed.exit_code,
      })
    }
    return recordJobAndBus(input.opsDb, input.cycleId, base, "completed", "command completed", input.generatedAt, {
      result_ref: `ops-runtime://cycle/${input.cycleId}/job/${ticketNo}`,
      exit_code: executed.exit_code,
    })
  }
  const result = recordJobAndBus(input.opsDb, input.cycleId, base, "failed", executed.timed_out ? "command timed out" : "command exited non-zero", input.generatedAt, {
    result_ref: `ops-runtime://cycle/${input.cycleId}/job/${ticketNo}`,
    exit_code: executed.exit_code,
  }, {
    exit_code: executed.exit_code,
    timed_out: executed.timed_out === true,
    stderr: executed.stderr.slice(0, 4000),
    stdout_tail: executed.stdout.slice(-1000),
  })
  return result
}

function healthDependencyBlockerReason(job: JSONRecord, processorResults: ProcessorResult[]): string {
  const required = asArray(job.required_health_checks).map(String).filter(Boolean)
  if (required.length === 0) return ""
  const health = processorResults.find((result) => result.processor_id === "runtime_health_guard")
  if (!health) return "required runtime health observation is unavailable"
  const checks = asRecord(health.health_checks)
  for (const name of required) {
    const status = stringField(checks[name])
    if (status !== "ok") return `health dependency ${name} is ${status || "unavailable"}`
  }
  return ""
}

function runtimeHealthProcessorResult(processorId: string, stdout: string): null | {
  status: "completed" | "blocked" | "failed"
  reason: string
  result_ref: string
  business_status: string
  health_checks?: JSONRecord
} {
  if (processorId !== "runtime_health_guard") return null
  const response = parseJsonObject(stdout)
  if (response.processor_id !== processorId) {
    return {
      status: "failed",
      reason: "runtime health output omitted matching processor identity",
      result_ref: "",
      business_status: "invalid",
    }
  }
  const businessStatus = stringField(response.status)
  const resultRef = stringField(response.health_ref)
  try {
    const healthChecks = extractRuntimeHealthChecks(response)
    if (businessStatus === "ok" && response.ok === true) {
      return { status: "completed", reason: "runtime health status ok", result_ref: resultRef, business_status: businessStatus, health_checks: healthChecks }
    }
    if (["blocked", "degraded", "safe_mode"].includes(businessStatus) && response.ok === false) {
      return { status: "blocked", reason: `runtime health status ${businessStatus}`, result_ref: resultRef, business_status: businessStatus, health_checks: healthChecks }
    }
    return { status: "failed", reason: "runtime health output has inconsistent status", result_ref: resultRef, business_status: businessStatus || "invalid", health_checks: healthChecks }
  } catch {
    return { status: "failed", reason: "runtime health output has invalid checks", result_ref: resultRef, business_status: businessStatus || "invalid" }
  }
}

function extractRuntimeHealthChecks(response: JSONRecord): JSONRecord {
  const checks = asArray(asRecord(asRecord(response.health).checks_json).checks).map(asRecord)
  if (checks.length === 0) throw new Error("runtime health checks are missing")
  const result: JSONRecord = {}
  for (const check of checks) {
    const name = stringField(check.name)
    const status = stringField(check.status)
    if (!name || !["ok", "warn", "fail"].includes(status) || Object.hasOwn(result, name)) {
      throw new Error("runtime health check identity is invalid")
    }
    result[name] = status
  }
  return result
}

function dependencyBlockerReason(job: JSONRecord, priorResults: JobResult[]): string {
  const required = asArray(job.depends_on_job_ids).map(String).filter(Boolean)
  if (required.length === 0) return ""
  const byJobId = new Map(priorResults.map((result) => [result.job_id, result]))
  for (const jobId of required) {
    const result = byJobId.get(jobId)
    if (!result || result.status !== "completed") {
      return `dependency ${jobId} did not complete successfully${result ? ` (${result.status})` : ""}`
    }
  }
  return ""
}

function resultPolicyStatus(job: JSONRecord, stdout: string): { status: "completed" | "blocked" | "failed"; reason: string } | null {
  const policy = asRecord(job.result_policy)
  const statusPath = asArray(policy.status_path).map(String).filter(Boolean)
  if (statusPath.length === 0) return null
  let value: unknown = parseJsonObject(stdout)
  for (const key of statusPath) value = asRecord(value)[key]
  const businessStatus = stringField(value)
  if (!businessStatus) {
    return { status: "failed", reason: `command output omitted required business status at ${statusPath.join(".")}` }
  }
  if (asArray(policy.completed_statuses).map(String).includes(businessStatus)) {
    return { status: "completed", reason: `business status ${businessStatus}` }
  }
  if (asArray(policy.blocked_statuses).map(String).includes(businessStatus)) {
    return { status: "blocked", reason: `business status ${businessStatus}` }
  }
  return { status: "failed", reason: `unrecognized business status ${businessStatus}` }
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
  const baseRuntimeResult = extra.runtime_result ?? buildDomainJobResult({
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
  const runtimeResult = attachDomainHookAudit(baseRuntimeResult, base, cycleId, status, completedAt)
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
    ...extra,
    runtime_result: runtimeResult,
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
  domain_hook_contexts: JSONRecord[]
}

function buildJobHookContext(
  base: JobResultBase,
  cycleId: string,
  hook: "pre_accept" | "pre_handle" | "handler" | "post_handle" | "post_commit" | "outbox" | "on_error",
): JSONRecord {
  return buildHookContext({
    domain: base.target_domain,
    job_id: base.job_id,
    ticket_no: base.ticket_no,
    stage: base.stage,
    hook,
    idempotency_key: `${cycleId}:${base.ticket_no}`,
    input_refs: base.input_refs,
    allowed_writes: base.allowed_runtime_writes,
    audit: { cycle_id: cycleId },
  })
}

function attachDomainHookAudit(
  runtimeResult: JSONRecord,
  base: JobResultBase,
  cycleId: string,
  status: string,
  completedAt: string,
): JSONRecord {
  const hooks = [...base.domain_hook_contexts]
  const handlerRan = hooks.some((context) => context.hook === "handler")
  if (handlerRan) {
    if (status === "failed" || status === "blocked") {
      hooks.push(buildJobHookContext(base, cycleId, "on_error"))
    } else {
      hooks.push(
        buildJobHookContext(base, cycleId, "post_handle"),
        buildJobHookContext(base, cycleId, "post_commit"),
      )
    }
  }
  hooks.push(buildJobHookContext(base, cycleId, "outbox"))
  return {
    ...runtimeResult,
    audit: {
      ...asRecord(runtimeResult.audit),
      completed_at: completedAt,
      domain_hooks: hooks,
    },
  }
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
    interaction: input.direction === "inbox" ? "command" : "result",
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

async function executeWithTimeout(
  executor: CommandExecutor,
  command: CommandSpec,
  timeoutMs?: number,
): Promise<CommandExecutionResult> {
  const execution = executor(command, { timeoutMs })
  if (!timeoutMs) return execution
  if (executor === executeCommand) return execution
  let timer: ReturnType<typeof setTimeout> | undefined
  const timeout = new Promise<CommandExecutionResult>((resolve) => {
    timer = setTimeout(() => resolve({
      exit_code: 124,
      stdout: "",
      stderr: `command exceeded timeout of ${timeoutMs}ms`,
      timed_out: true,
    }), timeoutMs)
  })
  try {
    return await Promise.race([execution, timeout])
  } finally {
    if (timer) clearTimeout(timer)
  }
}

export async function executeCommand(command: CommandSpec, options: CommandExecutionOptions = {}): Promise<CommandExecutionResult> {
  const child = Bun.spawn(command.argv, {
    cwd: command.cwd ? join(repoRoot(), command.cwd) : repoRoot(),
    stdout: "pipe",
    stderr: "pipe",
  })
  let timedOut = false
  let terminateTimer: ReturnType<typeof setTimeout> | undefined
  let killTimer: ReturnType<typeof setTimeout> | undefined
  if (options.timeoutMs) {
    terminateTimer = setTimeout(() => {
      timedOut = true
      child.kill("SIGTERM")
      killTimer = setTimeout(() => child.kill("SIGKILL"), 1_000)
    }, options.timeoutMs)
  }
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
    child.exited,
  ])
  if (terminateTimer) clearTimeout(terminateTimer)
  if (killTimer) clearTimeout(killTimer)
  return {
    exit_code: timedOut ? 124 : exitCode,
    stdout,
    stderr: timedOut ? `${stderr}\ncommand exceeded timeout of ${options.timeoutMs}ms`.trim() : stderr,
    ...(timedOut ? { timed_out: true } : {}),
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

function integerField(value: unknown): number {
  return typeof value === "number" && Number.isSafeInteger(value) ? value : 0
}

function sortedRecord(value: JSONRecord): JSONRecord {
  return Object.fromEntries(Object.entries(value).sort(([left], [right]) => left.localeCompare(right)))
}

function normalizeCommandTimeoutMs(value: unknown): number | undefined {
  if (value === undefined) return undefined
  if (!Number.isInteger(value) || Number(value) < 100 || Number(value) > 300_000) {
    throw new Error("command_timeout_ms must be an integer from 100 to 300000")
  }
  return Number(value)
}
