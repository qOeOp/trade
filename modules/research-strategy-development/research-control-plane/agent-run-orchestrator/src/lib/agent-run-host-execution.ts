import {
  validateAgentRunCompletion,
  type AgentRunEvent,
  type AgentRunRequest,
  type AgentRunResult,
} from "../../../../../contracts/agent-run-contract/src/agent-run-contract"
import type { AgentHostPort } from "../../../../../contracts/agent-run-contract/src/agent-host-port"

export interface CompletedHostedAgentRun {
  request: AgentRunRequest
  events: AgentRunEvent[]
  result: AgentRunResult
}

export async function executeAgentRunThroughHost(input: {
  host: AgentHostPort
  request: AgentRunRequest
  poll_interval_ms?: number
  signal?: AbortSignal
}): Promise<CompletedHostedAgentRun> {
  const pollInterval = input.poll_interval_ms ?? 1_000
  if (!Number.isSafeInteger(pollInterval) || pollInterval < 10 || pollInterval > 30_000) {
    throw new Error("Agent Host poll interval is invalid")
  }
  await input.host.submit(input.request)
  try {
    while (true) {
      if (input.signal?.aborted) {
        await input.host.cancel(input.request.run_id, input.request.request_hash)
        throw new Error("Agent Run was cancelled by caller")
      }
      const status = await input.host.status(input.request.run_id)
      if (status.request_hash !== input.request.request_hash) {
        throw new Error("Agent Host status identity drifted")
      }
      if (status.terminal) {
        const result = await input.host.result(input.request.run_id)
        if (!result) throw new Error("terminal Agent Run omitted its result")
        const finalEvents = await readRemainingEvents(input.host, input.request, [])
        validateAgentRunCompletion(input.request, finalEvents, result)
        return { request: input.request, events: finalEvents, result }
      }
      if (Date.now() >= Date.parse(input.request.budget.deadline_at)) {
        await input.host.cancel(input.request.run_id, input.request.request_hash)
        throw new Error("Agent Run exceeded its deadline")
      }
      await wait(pollInterval, input.signal)
    }
  } catch (error) {
    if (input.signal?.aborted) {
      await input.host.cancel(input.request.run_id, input.request.request_hash)
        .catch(() => undefined)
    }
    throw error
  }
}

async function readRemainingEvents(
  host: AgentHostPort,
  request: AgentRunRequest,
  existing: AgentRunEvent[],
): Promise<AgentRunEvent[]> {
  const events = [...existing]
  while (true) {
    const page = await host.events(
      request.run_id,
      events.at(-1)?.sequence ?? 0,
      1_000,
    )
    events.push(...page)
    if (page.length < 1_000) return events
    if (events.length > 3_000) throw new Error("Agent Run event stream exceeded limit")
  }
}

async function wait(milliseconds: number, signal?: AbortSignal): Promise<void> {
  if (!signal) {
    await new Promise((resolve) => setTimeout(resolve, milliseconds))
    return
  }
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => {
      signal.removeEventListener("abort", abort)
      resolve()
    }, milliseconds)
    const abort = () => {
      clearTimeout(timer)
      reject(new Error("Agent Run was cancelled by caller"))
    }
    signal.addEventListener("abort", abort, { once: true })
  })
}
