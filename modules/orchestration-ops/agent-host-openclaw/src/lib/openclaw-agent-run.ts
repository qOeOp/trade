import type { Database } from "bun:sqlite"
import {
  buildAgentRunEvent,
  buildAgentRunResult,
  type AgentArtifactRef,
  type AgentRunFailureClass,
  type AgentRunRequest,
} from "../../../../contracts/agent-run-contract/src/agent-run-contract"
import type {
  AgentHostPort,
  AgentRunAcceptance,
  AgentRunApproval,
  AgentRunStatus,
  AgentRunSteer,
} from "../../../../contracts/agent-run-contract/src/agent-host-port"
import {
  admitAgentRun,
  appendAgentRunEvent,
  completeAgentRun,
  markAgentRunCancelling,
  projectAgentRunStatus,
  readAgentRun,
  readAgentRunEvents,
  listRecoverableAgentRuns,
} from "../../../ops-runtime-store/src/lib/agent-run-store"

export type OpenClawTransportExpectation = "gateway" | "embedded"

export interface OpenClawExecutionRequest {
  run_id: string
  agent_id: string
  message: string
  timeout_seconds: number
  transport: OpenClawTransportExpectation
}

export interface OpenClawExecutionResult {
  exit_code: number
  stdout: string
  stderr: string
  interrupted: boolean
}

export interface OpenClawAgentHostOptions {
  db: Database
  host_profile: `openclaw-${OpenClawTransportExpectation}`
  allowed_task_profiles: AgentRunRequest["task_profile"][]
  agent_ids: Record<AgentRunRequest["task_profile"], string>
  materialize(request: AgentRunRequest): Promise<string>
  store_output(request: AgentRunRequest, text: string): Promise<AgentArtifactRef>
  execute(input: OpenClawExecutionRequest, signal: AbortSignal): Promise<OpenClawExecutionResult>
  now?: () => Date
}

interface ActiveRun {
  request: AgentRunRequest
  controller: AbortController
  started_ms: number
}

export class OpenClawAgentHost implements AgentHostPort {
  private readonly active = new Map<string, ActiveRun>()
  private readonly tasks = new Map<string, Promise<void>>()
  private readonly now: () => Date

  constructor(private readonly options: OpenClawAgentHostOptions) {
    this.now = options.now ?? (() => new Date())
  }

  async submit(request: AgentRunRequest): Promise<AgentRunAcceptance> {
    if (!this.options.allowed_task_profiles.includes(request.task_profile)) {
      throw new Error(`OpenClaw Host profile does not allow ${request.task_profile}`)
    }
    const accepted = admitAgentRun(
      this.options.db,
      request,
      this.options.host_profile,
      this.isoNow(),
    )
    const stored = readAgentRun(this.options.db, request.run_id)!
    if (stored.result || this.active.has(request.run_id)) return accepted
    if (accepted.replayed && stored.status === "running") {
      await this.fail(
        stored.request,
        stored.request.task_profile === "developer" ? "tool_effect_uncertain" : "host_unavailable",
        this.now().getTime(),
      )
      return accepted
    }
    const task = this.launch(stored.request)
    this.tasks.set(request.run_id, task)
    void task.finally(() => this.tasks.delete(request.run_id))
    return accepted
  }

  async events(runId: string, afterSequence: number, limit: number) {
    return readAgentRunEvents(this.options.db, runId, afterSequence, limit)
  }

  async status(runId: string): Promise<AgentRunStatus> {
    const record = readAgentRun(this.options.db, runId)
    if (!record) throw new Error(`Agent Run not found: ${runId}`)
    return projectAgentRunStatus(record)
  }

  async steer(_input: AgentRunSteer): Promise<void> {
    throw new Error("OpenClaw one-shot adapter does not support steering")
  }

  async approve(_input: AgentRunApproval): Promise<void> {
    throw new Error("OpenClaw one-shot adapter has no approval surface")
  }

  async cancel(runId: string, requestHash: string): Promise<void> {
    const record = readAgentRun(this.options.db, runId)
    if (!record || record.request.request_hash !== requestHash) {
      throw new Error("Agent Run cancel identity drifted")
    }
    if (record.result) return
    markAgentRunCancelling(this.options.db, runId, requestHash, this.isoNow())
    this.active.get(runId)?.controller.abort()
  }

  async result(runId: string) {
    return readAgentRun(this.options.db, runId)?.result ?? null
  }

  async close(): Promise<void> {
    for (const run of this.active.values()) run.controller.abort()
    await Promise.allSettled([...this.tasks.values()])
  }

  async recoverInterruptedRuns(): Promise<number> {
    let recovered = 0
    for (const record of listRecoverableAgentRuns(this.options.db, 1_000)) {
      if (record.host_profile !== this.options.host_profile) continue
      await this.fail(
        record.request,
        record.request.task_profile === "developer"
          ? "tool_effect_uncertain"
          : "host_unavailable",
        Date.parse(record.updated_at),
      )
      recovered += 1
    }
    return recovered
  }

  private async launch(request: AgentRunRequest): Promise<void> {
    const controller = new AbortController()
    const startedMs = this.now().getTime()
    this.active.set(request.run_id, { request, controller, started_ms: startedMs })
    try {
      this.appendStarted(request)
      const message = await this.options.materialize(request)
      const remainingMs = Math.min(
        request.budget.max_wall_time_ms,
        Date.parse(request.budget.deadline_at) - this.now().getTime(),
      )
      if (remainingMs <= 0) return await this.fail(request, "budget_exhausted", startedMs)
      const result = await this.options.execute({
        run_id: request.run_id,
        agent_id: this.options.agent_ids[request.task_profile],
        message,
        timeout_seconds: Math.max(1, Math.ceil(remainingMs / 1_000)),
        transport: this.expectedTransport(),
      }, controller.signal)
      if (result.interrupted || controller.signal.aborted) {
        return await this.fail(
          request,
          request.task_profile === "developer" ? "tool_effect_uncertain" : "cancelled",
          startedMs,
        )
      }
      if (result.exit_code !== 0) {
        return await this.fail(request, classifyFailure(result.stderr), startedMs)
      }
      const text = parseOpenClawOutput(result.stdout, this.expectedTransport())
      const output = await this.options.store_output(request, text)
      if (output.bytes > request.budget.max_output_bytes) {
        return await this.fail(request, "budget_exhausted", startedMs)
      }
      await this.complete(request, "completed", startedMs, undefined, [output])
    } catch {
      await this.fail(request, controller.signal.aborted ? "cancelled" : "host_unavailable", startedMs)
    } finally {
      this.active.delete(request.run_id)
    }
  }

  private appendStarted(request: AgentRunRequest): void {
    const record = readAgentRun(this.options.db, request.run_id)!
    appendAgentRunEvent(this.options.db, buildAgentRunEvent({
      run_id: request.run_id,
      trace_id: request.trace_id,
      request_hash: request.request_hash,
      sequence: record.last_sequence + 1,
      occurred_at: this.isoNow(),
      kind: "started",
      summary: `OpenClaw ${this.expectedTransport()} Agent Run started.`,
    }))
  }

  private async fail(
    request: AgentRunRequest,
    failure: AgentRunFailureClass,
    startedMs: number,
  ): Promise<void> {
    if (readAgentRun(this.options.db, request.run_id)?.result) return
    await this.complete(
      request,
      failure === "cancelled" ? "cancelled" : "failed",
      startedMs,
      failure,
    )
  }

  private async complete(
    request: AgentRunRequest,
    status: "completed" | "cancelled" | "failed",
    startedMs: number,
    failure?: AgentRunFailureClass,
    outputRefs: AgentArtifactRef[] = [],
  ): Promise<void> {
    const record = readAgentRun(this.options.db, request.run_id)
    if (!record || record.result) return
    const now = this.isoNow()
    const terminal = buildAgentRunEvent({
      run_id: request.run_id,
      trace_id: request.trace_id,
      request_hash: request.request_hash,
      sequence: record.last_sequence + 1,
      occurred_at: now,
      kind: "terminal",
      summary: status === "completed" ? "OpenClaw Agent Run completed." : `OpenClaw Agent Run ${status}.`,
      status,
      ...(status === "completed" ? {} : { failure_class: failure ?? "host_unavailable" }),
    })
    appendAgentRunEvent(this.options.db, terminal)
    completeAgentRun(this.options.db, buildAgentRunResult({
      run_id: request.run_id,
      trace_id: request.trace_id,
      request_hash: request.request_hash,
      terminal_sequence: terminal.sequence,
      finished_at: now,
      status,
      output_refs: outputRefs,
      usage: {
        wall_time_ms: Math.max(0, Math.min(
          this.now().getTime() - startedMs,
          request.budget.max_wall_time_ms,
        )),
        turns: 1,
        tool_calls: 0,
        input_bytes: request.instruction_ref.bytes
          + request.input_refs.reduce((sum, ref) => sum + ref.bytes, 0),
        output_bytes: outputRefs.reduce((sum, ref) => sum + ref.bytes, 0),
      },
      ...(status === "completed" ? {} : {
        failure: {
          class: failure ?? "host_unavailable",
          retryable: !["cancelled", "tool_effect_uncertain", "validation_failed"].includes(
            failure ?? "",
          ),
          effect_status: failure === "tool_effect_uncertain" ? "uncertain" : "none",
        },
      }),
    }))
  }

  private expectedTransport(): OpenClawTransportExpectation {
    return this.options.host_profile === "openclaw-gateway" ? "gateway" : "embedded"
  }

  private isoNow(): string {
    return this.now().toISOString()
  }
}

export function parseOpenClawOutput(
  stdout: string,
  expectedTransport: OpenClawTransportExpectation,
): string {
  const value = JSON.parse(stdout) as Record<string, unknown>
  const gateway = value.result && typeof value.result === "object" && !Array.isArray(value.result)
  const result = gateway ? value.result as Record<string, unknown> : value
  const meta = result.meta && typeof result.meta === "object" && !Array.isArray(result.meta)
    ? result.meta as Record<string, unknown>
    : {}
  const trace = meta.executionTrace && typeof meta.executionTrace === "object"
    && !Array.isArray(meta.executionTrace)
    ? meta.executionTrace as Record<string, unknown>
    : {}
  const observedTransport = meta.transport === "embedded" || trace.runner === "embedded"
    ? "embedded"
    : meta.transport === "gateway" || trace.runner === "gateway" || gateway
      ? "gateway"
      : null
  if (!observedTransport) throw new Error("OpenClaw result did not attest its transport")
  if (observedTransport !== expectedTransport) {
    throw new Error(`OpenClaw transport drifted: expected ${expectedTransport}, observed ${observedTransport}`)
  }
  if (trace.fallbackUsed === true || meta.fallbackFrom != null) {
    throw new Error("OpenClaw result used an undeclared transport or provider fallback")
  }
  if (gateway && value.status !== "ok") throw new Error("OpenClaw Gateway result is not ok")
  const payloads = result.payloads
  if (!Array.isArray(payloads) || payloads.length !== 1) {
    throw new Error("OpenClaw result requires exactly one visible payload")
  }
  const payload = payloads[0]
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    throw new Error("OpenClaw payload is malformed")
  }
  const text = (payload as Record<string, unknown>).text
  if (typeof text !== "string" || !text.trim()) throw new Error("OpenClaw payload text is missing")
  return text
}

function classifyFailure(stderr: string): AgentRunFailureClass {
  if (/timed? ?out|deadline|rate.?limit|429|provider|model unavailable/i.test(stderr)) {
    return "provider_unavailable"
  }
  if (/sandbox|permission denied/i.test(stderr)) return "sandbox_failed"
  return "host_unavailable"
}
