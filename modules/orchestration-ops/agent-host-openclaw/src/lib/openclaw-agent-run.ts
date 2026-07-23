import type { Database } from "bun:sqlite"
import {
  buildAgentRunEvent,
  buildAgentRunResult,
  type AgentArtifactRef,
  type AgentRunFailureClass,
  type AgentRunRequest,
  type AgentRunResult,
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
  readAgentRunTerminalToolResult,
  readAgentRunToolUsage,
} from "../../../ops-runtime-store/src/lib/agent-run-store"

export type OpenClawTransportExpectation = "gateway" | "embedded"
export type OpenClawHostProfile =
  | `openclaw-${OpenClawTransportExpectation}`
  | "openclaw-workspace-gateway"

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
  tool_calls?: number
  model_turns?: number
}

export interface OpenClawAgentHostOptions {
  db: Database
  host_profile: OpenClawHostProfile
  transport?: OpenClawTransportExpectation
  allowed_task_profiles: AgentRunRequest["task_profile"][]
  agent_ids: Record<AgentRunRequest["task_profile"], string>
  materialize(request: AgentRunRequest): Promise<string>
  store_output?(request: AgentRunRequest, text: string): Promise<AgentArtifactRef>
  store_outputs?(request: AgentRunRequest, text: string): Promise<AgentArtifactRef[]>
  validate_output_ref?(
    request: AgentRunRequest,
    artifact: AgentArtifactRef,
  ): Promise<AgentArtifactRef>
  terminal_tool_outputs?: Partial<Record<
    AgentRunRequest["task_profile"],
    { tool_name: string; output_schema_version: string }
  >>
  execute(input: OpenClawExecutionRequest, signal: AbortSignal): Promise<OpenClawExecutionResult>
  max_concurrent_runs?: number
  after_terminal?(request: AgentRunRequest, result: AgentRunResult): Promise<void>
  report_error?: (input: {
    run_id: string
    failure_class: AgentRunFailureClass
    stage: "launch" | "output_finalization" | "post_terminal"
    message: string
  }) => void
  now?: () => Date
}

interface ActiveRun {
  request: AgentRunRequest
  controller: AbortController
  started_ms: number
}

export class OpenClawAgentHost implements AgentHostPort {
  private readonly active = new Map<string, ActiveRun>()
  private readonly pending = new Map<string, AgentRunRequest>()
  private readonly tasks = new Map<string, Promise<void>>()
  private readonly now: () => Date
  private readonly maxConcurrentRuns: number
  private closing = false

  constructor(private readonly options: OpenClawAgentHostOptions) {
    if ((options.store_output == null) === (options.store_outputs == null)) {
      throw new Error("OpenClaw Host requires exactly one output storage strategy")
    }
    if (!options.transport && options.host_profile === "openclaw-workspace-gateway") {
      throw new Error("Custom OpenClaw Host profiles require an explicit transport")
    }
    this.maxConcurrentRuns = options.max_concurrent_runs ?? 16
    if (!Number.isSafeInteger(this.maxConcurrentRuns)
      || this.maxConcurrentRuns < 1
      || this.maxConcurrentRuns > 64) {
      throw new Error("OpenClaw Host concurrency is invalid")
    }
    this.now = options.now ?? (() => new Date())
  }

  async submit(request: AgentRunRequest): Promise<AgentRunAcceptance> {
    if (this.closing) throw new Error("OpenClaw Host is closing")
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
    if (stored.result
      || this.active.has(request.run_id)
      || this.pending.has(request.run_id)) return accepted
    if (accepted.replayed && stored.status === "running") {
      if (await this.recoverTerminalToolOutput(stored.request, Date.parse(stored.updated_at))) {
        return accepted
      }
      await this.fail(
        stored.request,
        stored.request.task_profile === "developer" ? "tool_effect_uncertain" : "host_unavailable",
        this.now().getTime(),
      )
      return accepted
    }
    this.enqueue(stored.request)
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
    this.closing = true
    for (const run of this.active.values()) run.controller.abort()
    await Promise.allSettled([...this.tasks.values()])
  }

  async recoverInterruptedRuns(): Promise<number> {
    let recovered = 0
    for (const record of listRecoverableAgentRuns(this.options.db, 1_000)) {
      if (record.host_profile !== this.options.host_profile) continue
      if (record.status === "accepted") {
        this.enqueue(record.request)
        recovered += 1
        continue
      }
      if (await this.recoverTerminalToolOutput(
        record.request,
        Date.parse(record.updated_at),
      )) {
        recovered += 1
        continue
      }
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

  private enqueue(request: AgentRunRequest): void {
    if (this.active.has(request.run_id)
      || this.pending.has(request.run_id)
      || readAgentRun(this.options.db, request.run_id)?.result) return
    this.pending.set(request.run_id, request)
    this.drain()
  }

  private drain(): void {
    if (this.closing) return
    while (this.active.size < this.maxConcurrentRuns
      && this.pending.size > 0) {
      const next = this.pending.entries().next().value as
        | [string, AgentRunRequest]
        | undefined
      if (!next) return
      const [runId, request] = next
      this.pending.delete(runId)
      const task = this.launch(request)
      this.tasks.set(runId, task)
      void task.finally(() => {
        this.tasks.delete(runId)
        this.drain()
      })
    }
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
      const terminalToolOutput = this.terminalToolOutput(request)
      if (result.exit_code !== 0 && !terminalToolOutput) {
        return await this.fail(request, classifyFailure(result.stderr), startedMs)
      }
      const ledgerUsage = readAgentRunToolUsage(
        this.options.db,
        request.run_id,
        request.request_hash,
      )
      const toolCalls = boundedUsage(
        Math.max(result.tool_calls ?? 0, ledgerUsage.tool_calls),
        request.budget.max_tool_calls,
        "tool calls",
      )
      const modelTurns = boundedUsage(
        Math.max(result.model_turns ?? 1, toolCalls + 1),
        request.budget.max_turns,
        "model turns",
      )
      const text = result.exit_code === 0
        ? parseOpenClawOutput(
          result.stdout,
          this.expectedTransport(),
          terminalToolOutput !== null,
        )
        : ""
      let outputs: AgentArtifactRef[]
      try {
        outputs = terminalToolOutput
          ? [await this.validateTerminalToolOutput(
              request,
              terminalToolOutput.artifact,
            )]
          : this.options.store_outputs
            ? await this.options.store_outputs(request, text)
            : [await this.options.store_output!(request, text)]
        validateOutputRefs(outputs)
      } catch (error) {
        this.options.report_error?.({
          run_id: request.run_id,
          failure_class: "validation_failed",
          stage: "output_finalization",
          message: safeErrorMessage(error),
        })
        return await this.fail(request, "validation_failed", startedMs)
      }
      if (outputs.reduce((sum, output) => sum + output.bytes, 0)
          > request.budget.max_output_bytes) {
        return await this.fail(request, "budget_exhausted", startedMs)
      }
      await this.complete(
        request,
        "completed",
        startedMs,
        undefined,
        outputs,
        { tool_calls: toolCalls, turns: modelTurns },
      )
    } catch (error) {
      const failureClass = controller.signal.aborted
        ? "cancelled"
        : classifyCaughtFailure(error)
      this.options.report_error?.({
        run_id: request.run_id,
        failure_class: failureClass,
        stage: "launch",
        message: safeErrorMessage(error),
      })
      await this.fail(
        request,
        failureClass,
        startedMs,
      )
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
    const toolCalls = Math.min(
      readAgentRunToolUsage(
        this.options.db,
        request.run_id,
        request.request_hash,
      ).tool_calls,
      request.budget.max_tool_calls,
    )
    await this.complete(
      request,
      failure === "cancelled" ? "cancelled" : "failed",
      startedMs,
      failure,
      [],
      {
        tool_calls: toolCalls,
        turns: Math.min(toolCalls + 1, request.budget.max_turns),
      },
    )
  }

  private async complete(
    request: AgentRunRequest,
    status: "completed" | "cancelled" | "failed",
    startedMs: number,
    failure?: AgentRunFailureClass,
    outputRefs: AgentArtifactRef[] = [],
    observedUsage: { tool_calls: number; turns: number } = {
      tool_calls: 0,
      turns: 0,
    },
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
    const result = buildAgentRunResult({
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
        turns: observedUsage.turns,
        tool_calls: observedUsage.tool_calls,
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
    })
    completeAgentRun(this.options.db, result)
    await this.options.after_terminal?.(request, result).catch((error) => {
      this.options.report_error?.({
        run_id: request.run_id,
        failure_class: "host_unavailable",
        stage: "post_terminal",
        message: safeErrorMessage(error),
      })
    })
  }

  private expectedTransport(): OpenClawTransportExpectation {
    if (this.options.transport) return this.options.transport
    return this.options.host_profile === "openclaw-gateway" ? "gateway" : "embedded"
  }

  private terminalToolOutput(request: AgentRunRequest) {
    const config = this.options.terminal_tool_outputs?.[request.task_profile]
    if (!config) return null
    if (config.output_schema_version !== request.output_schema_version) {
      return null
    }
    return readAgentRunTerminalToolResult(this.options.db, {
      run_id: request.run_id,
      request_hash: request.request_hash,
      task_profile: request.task_profile,
      tool_name: config.tool_name,
      output_schema_version: config.output_schema_version,
    })
  }

  private async validateTerminalToolOutput(
    request: AgentRunRequest,
    artifact: AgentArtifactRef,
  ): Promise<AgentArtifactRef> {
    if (!this.options.validate_output_ref) {
      throw new Error("OpenClaw terminal tool output validator is missing")
    }
    return this.options.validate_output_ref(request, artifact)
  }

  private async recoverTerminalToolOutput(
    request: AgentRunRequest,
    startedMs: number,
  ): Promise<boolean> {
    try {
      const terminal = this.terminalToolOutput(request)
      if (!terminal) return false
      const output = await this.validateTerminalToolOutput(request, terminal.artifact)
      if (output.bytes > request.budget.max_output_bytes) {
        await this.fail(request, "budget_exhausted", startedMs)
        return true
      }
      const toolCalls = Math.min(
        readAgentRunToolUsage(
          this.options.db,
          request.run_id,
          request.request_hash,
        ).tool_calls,
        request.budget.max_tool_calls,
      )
      await this.complete(
        request,
        "completed",
        startedMs,
        undefined,
        [output],
        {
          tool_calls: toolCalls,
          turns: Math.min(toolCalls + 1, request.budget.max_turns),
        },
      )
      return true
    } catch (error) {
      this.options.report_error?.({
        run_id: request.run_id,
        failure_class: "validation_failed",
        stage: "output_finalization",
        message: safeErrorMessage(error),
      })
      await this.fail(request, "validation_failed", startedMs)
      return true
    }
  }

  private isoNow(): string {
    return this.now().toISOString()
  }
}

function safeErrorMessage(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error)
  return message.replace(/[\r\n]+/g, " ").slice(0, 300)
}

export function parseOpenClawOutput(
  stdout: string,
  expectedTransport: OpenClawTransportExpectation,
  allowEmptyText = false,
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
  if (typeof text !== "string" || (!allowEmptyText && !text.trim())) {
    throw new Error("OpenClaw payload text is missing")
  }
  return text
}

function classifyFailure(stderr: string): AgentRunFailureClass {
  if (/timed? ?out|deadline|rate.?limit|429|provider|model unavailable/i.test(stderr)) {
    return "provider_unavailable"
  }
  if (/sandbox|permission denied/i.test(stderr)) return "sandbox_failed"
  return "host_unavailable"
}

function classifyCaughtFailure(error: unknown): AgentRunFailureClass {
  const message = error instanceof Error ? error.message : String(error)
  if (/output|payload|result|transport drift|fallback|json|artifact|byte budget/i.test(message)) {
    return "validation_failed"
  }
  return "host_unavailable"
}

function boundedUsage(
  value: number,
  maximum: number,
  field: string,
): number {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new Error(`OpenClaw ${field} metadata is invalid`)
  }
  if (value > maximum) throw new Error(`OpenClaw ${field} exceeded Agent Run budget`)
  return value
}

function validateOutputRefs(outputs: AgentArtifactRef[]): void {
  if (!Array.isArray(outputs) || outputs.length < 1 || outputs.length > 32) {
    throw new Error("OpenClaw Host output refs must be bounded and non-empty")
  }
  const identities = outputs.map((ref) => `${ref.ref}:${ref.sha256}`)
  if (new Set(identities).size !== identities.length) {
    throw new Error("OpenClaw Host output refs contain duplicates")
  }
}
