import type { Database } from "bun:sqlite"
import {
  buildAgentRunEvent,
  buildAgentRunResult,
  type AgentArtifactRef,
  type AgentRunFailureClass,
  type AgentRunRequest,
} from "../../../../contracts/agent-run-contract/src/agent-run-contract"
import {
  validateAgentRunApproval,
  type AgentHostPort,
  type AgentRunAcceptance,
  type AgentRunApproval,
  type AgentRunStatus,
  type AgentRunSteer,
} from "../../../../contracts/agent-run-contract/src/agent-host-port"
import {
  admitAgentRun,
  appendAgentRunEvent,
  bindAgentRunHostSession,
  completeAgentRun,
  markAgentRunCancelling,
  projectAgentRunStatus,
  readAgentRun,
  readAgentRunEvents,
} from "../../../ops-runtime-store/src/lib/agent-run-store"
import {
  buildCodexAgentRunWirePlan,
  normalizeCodexNotification,
  type CodexAgentRunMaterialization,
} from "./codex-agent-run-mapping"
import type { CodexAppServerClientPort } from "./codex-app-server-client"

type JSONRecord = Record<string, unknown>

export interface DirectCodexAgentHostOptions {
  db: Database
  materialize(request: AgentRunRequest): Promise<CodexAgentRunMaterialization>
  store_output(request: AgentRunRequest, text: string): Promise<AgentArtifactRef>
  resolve_steer(input: AgentRunSteer): Promise<string>
  create_client(onNotification: (method: string, params: unknown) => void, onExit: (error: Error | null) => void): CodexAppServerClientPort
  now?: () => Date
}

interface ActiveRun {
  request: AgentRunRequest
  client: CodexAppServerClientPort
  thread_id?: string
  turn_id?: string
  started_ms: number
  tool_calls: number
  final_text?: string
  queue: Promise<void>
  deadline_timer?: ReturnType<typeof setTimeout>
}

export class DirectCodexAgentHost implements AgentHostPort {
  private readonly active = new Map<string, ActiveRun>()
  private readonly now: () => Date

  constructor(private readonly options: DirectCodexAgentHostOptions) {
    this.now = options.now ?? (() => new Date())
  }

  async submit(request: AgentRunRequest): Promise<AgentRunAcceptance> {
    const accepted = admitAgentRun(this.options.db, request, "direct-codex", this.isoNow())
    const stored = readAgentRun(this.options.db, request.run_id)!
    if (stored.result || this.active.has(request.run_id)) return accepted
    if (accepted.replayed && stored.host_thread_id) {
      await this.blockInterrupted(stored.request)
      return accepted
    }
    void this.launch(stored.request)
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

  async steer(input: AgentRunSteer): Promise<void> {
    const active = this.requireActive(input.run_id, input.request_hash)
    if (!active.thread_id || !active.turn_id) throw new Error("Agent Run is not ready for steering")
    const text = await this.options.resolve_steer(input)
    verifySteer(text, input)
    await active.client.steer(active.thread_id, active.turn_id, text, `${input.run_id}-steer`)
  }

  async approve(input: AgentRunApproval): Promise<void> {
    const record = readAgentRun(this.options.db, input.run_id)
    if (!record || record.request.request_hash !== input.request_hash) throw new Error("Agent Run approval identity drifted")
    validateAgentRunApproval(input, record.request.task_profile)
    if (input.decision === "allow_once") throw new Error("Direct Codex adapter has no effect approval surface")
  }

  async cancel(runId: string, requestHash: string): Promise<void> {
    const record = readAgentRun(this.options.db, runId)
    if (!record || record.request.request_hash !== requestHash) throw new Error("Agent Run cancel identity drifted")
    if (record.result) return
    markAgentRunCancelling(this.options.db, runId, requestHash, this.isoNow())
    const active = this.active.get(runId)
    if (!active?.thread_id || !active.turn_id) {
      await this.finishFailure(record.request, "cancelled")
      return
    }
    await active.client.interrupt(active.thread_id, active.turn_id)
  }

  async result(runId: string) {
    return readAgentRun(this.options.db, runId)?.result ?? null
  }

  async close(): Promise<void> {
    const active = [...this.active.values()]
    this.active.clear()
    for (const run of active) {
      if (run.deadline_timer) clearTimeout(run.deadline_timer)
      await run.client.close()
    }
  }

  private async launch(request: AgentRunRequest): Promise<void> {
    let active: ActiveRun | null = null
    try {
      const materialization = await this.options.materialize(request)
      const plan = buildCodexAgentRunWirePlan(request, materialization)
      const client = this.options.create_client(
        (method, params) => this.enqueue(request.run_id, () => this.onNotification(request.run_id, method, params)),
        (error) => {
          if (error) this.enqueue(request.run_id, () => this.finishFailure(request, "host_unavailable"))
        },
      )
      active = {
        request,
        client,
        started_ms: this.now().getTime(),
        tool_calls: 0,
        queue: Promise.resolve(),
      }
      this.active.set(request.run_id, active)
      await client.initialize(plan.initialize)
      active.thread_id = await client.startThread(plan.thread_start)
      active.turn_id = await client.startTurn(plan.turn_start(active.thread_id))
      bindAgentRunHostSession(this.options.db, {
        run_id: request.run_id,
        request_hash: request.request_hash,
        host_thread_id: active.thread_id,
        host_turn_id: active.turn_id,
        observed_at: this.isoNow(),
      })
      const remaining = Math.min(
        request.budget.max_wall_time_ms,
        Date.parse(request.budget.deadline_at) - this.now().getTime(),
      )
      if (remaining <= 0) return void await this.finishFailure(request, "budget_exhausted")
      active.deadline_timer = setTimeout(() => {
        this.enqueue(request.run_id, async () => {
          const current = this.active.get(request.run_id)
          if (current?.thread_id && current.turn_id) {
            markAgentRunCancelling(this.options.db, request.run_id, request.request_hash, this.isoNow())
            await current.client.interrupt(current.thread_id, current.turn_id).catch(() => undefined)
          }
          await this.finishFailure(request, "budget_exhausted")
        })
      }, remaining)
    } catch {
      await this.finishFailure(request, "host_unavailable")
      if (active) await active.client.close()
    }
  }

  private enqueue(runId: string, operation: () => Promise<void>): void {
    const active = this.active.get(runId)
    if (!active) return
    active.queue = active.queue.then(operation, operation)
  }

  private async onNotification(runId: string, method: string, params: unknown): Promise<void> {
    const active = this.active.get(runId)
    if (!active || readAgentRun(this.options.db, runId)?.result) return
    const item = notificationItem(params)
    if (method === "item/completed" && item?.type === "agentMessage" && typeof item.text === "string") {
      active.final_text = item.text
    }
    if (method === "item/started" && item && isToolItem(item.type)) active.tool_calls += 1
    if (method === "turn/completed") {
      await this.finishFromTerminal(active, params)
      return
    }
    const current = readAgentRun(this.options.db, runId)!
    const event = normalizeCodexNotification({
      request: active.request,
      sequence: current.last_sequence + 1,
      observed_at: this.isoNow(),
      method,
      params,
    })
    if (event) appendAgentRunEvent(this.options.db, event)
  }

  private async finishFromTerminal(active: ActiveRun, params: unknown): Promise<void> {
    const turn = record(record(params, "turn notification").turn, "turn")
    const status = String(turn.status)
    if (status === "completed" && !active.final_text) {
      await this.finishFailure(active.request, "validation_failed")
      return
    }
    if (status === "completed") {
      const output = await this.options.store_output(active.request, active.final_text!)
      if (output.bytes > active.request.budget.max_output_bytes) {
        await this.finishFailure(active.request, "budget_exhausted")
        return
      }
      await this.finish(active, "completed", undefined, [output])
      return
    }
    const normalized = normalizeCodexNotification({
      request: active.request,
      sequence: readAgentRun(this.options.db, active.request.run_id)!.last_sequence + 1,
      observed_at: this.isoNow(),
      method: "turn/completed",
      params,
    })
    await this.finish(active, normalized?.status === "cancelled" ? "cancelled" : "failed", normalized?.failure_class)
  }

  private async finishFailure(request: AgentRunRequest, failure: AgentRunFailureClass): Promise<void> {
    const active = this.active.get(request.run_id)
    if (readAgentRun(this.options.db, request.run_id)?.result) return
    await this.finish(active ?? {
      request,
      client: nullClient,
      started_ms: this.now().getTime(),
      tool_calls: 0,
      queue: Promise.resolve(),
    }, failure === "cancelled" ? "cancelled" : "failed", failure)
  }

  private async blockInterrupted(request: AgentRunRequest): Promise<void> {
    const uncertain = request.capabilities.includes("workspace_patch")
    await this.finishFailure(request, uncertain ? "tool_effect_uncertain" : "host_unavailable")
  }

  private async finish(
    active: ActiveRun,
    status: "completed" | "cancelled" | "failed",
    failure?: AgentRunFailureClass,
    outputRefs: AgentArtifactRef[] = [],
  ): Promise<void> {
    const current = readAgentRun(this.options.db, active.request.run_id)
    if (!current || current.result) return
    const now = this.isoNow()
    const terminal = buildAgentRunEvent({
      run_id: active.request.run_id,
      trace_id: active.request.trace_id,
      request_hash: active.request.request_hash,
      sequence: current.last_sequence + 1,
      occurred_at: now,
      kind: "terminal",
      summary: status === "completed" ? "Codex turn completed." : `Codex Agent Run ${status}.`,
      status,
      ...(status === "completed" ? {} : { failure_class: failure ?? "host_unavailable" }),
    })
    appendAgentRunEvent(this.options.db, terminal)
    const wallTime = Math.max(0, Math.min(this.now().getTime() - active.started_ms, active.request.budget.max_wall_time_ms))
    completeAgentRun(this.options.db, buildAgentRunResult({
      run_id: active.request.run_id,
      trace_id: active.request.trace_id,
      request_hash: active.request.request_hash,
      terminal_sequence: terminal.sequence,
      finished_at: now,
      status,
      output_refs: outputRefs,
      usage: {
        wall_time_ms: wallTime,
        turns: active.started_ms === 0 ? 0 : 1,
        tool_calls: Math.min(active.tool_calls, active.request.budget.max_tool_calls),
        input_bytes: active.request.instruction_ref.bytes + active.request.input_refs.reduce((sum, ref) => sum + ref.bytes, 0),
        output_bytes: outputRefs.reduce((sum, ref) => sum + ref.bytes, 0),
      },
      ...(status === "completed" ? {} : {
        failure: {
          class: failure ?? "host_unavailable",
          retryable: !["cancelled", "tool_effect_uncertain", "validation_failed"].includes(failure ?? ""),
          effect_status: failure === "tool_effect_uncertain" ? "uncertain" : "none",
        },
      }),
    }))
    if (active.deadline_timer) clearTimeout(active.deadline_timer)
    this.active.delete(active.request.run_id)
    await active.client.close()
  }

  private requireActive(runId: string, requestHash: string): ActiveRun {
    const active = this.active.get(runId)
    if (!active || active.request.request_hash !== requestHash) throw new Error("Agent Run active identity drifted")
    return active
  }

  private isoNow(): string {
    return this.now().toISOString()
  }
}

const nullClient: CodexAppServerClientPort = {
  async initialize() {}, async startThread() { return "none" }, async startTurn() { return "none" },
  async steer() {}, async interrupt() {}, async close() {},
}

function notificationItem(params: unknown): JSONRecord | null {
  if (!params || typeof params !== "object" || Array.isArray(params)) return null
  const item = (params as JSONRecord).item
  return item && typeof item === "object" && !Array.isArray(item) ? item as JSONRecord : null
}

function isToolItem(value: unknown): boolean {
  return typeof value === "string" && !["reasoning", "agentMessage", "plan", "userMessage"].includes(value)
}

function record(value: unknown, field: string): JSONRecord {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`${field} must be an object`)
  return value as JSONRecord
}

function verifySteer(text: string, input: AgentRunSteer): void {
  const bytes = Buffer.from(text)
  if (bytes.byteLength > 64 * 1024) throw new Error("Agent Run steer message is oversized")
  const hash = new Bun.CryptoHasher("sha256").update(bytes).digest("hex")
  if (hash !== input.message_sha256) throw new Error("Agent Run steer message hash drifted")
}
