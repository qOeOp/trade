import type { AgentRunEvent, AgentRunRequest, AgentRunResult } from "./agent-run-contract"

export type AgentRunLifecycleStatus =
  | "accepted"
  | "running"
  | "awaiting_approval"
  | "cancelling"
  | "completed"
  | "blocked"
  | "cancelled"
  | "failed"

export interface AgentRunAcceptance {
  run_id: string
  request_hash: string
  accepted: boolean
  replayed: boolean
}

export interface AgentRunStatus {
  run_id: string
  request_hash: string
  status: AgentRunLifecycleStatus
  last_sequence: number
  terminal: boolean
}

export interface AgentRunSteer {
  run_id: string
  request_hash: string
  message_ref: string
  message_sha256: string
}

export interface AgentRunApproval {
  run_id: string
  request_hash: string
  operation_ref: string
  decision: "deny" | "allow_once"
}

export interface AgentHostPort {
  submit(request: AgentRunRequest): Promise<AgentRunAcceptance>
  events(runId: string, afterSequence: number, limit: number): Promise<AgentRunEvent[]>
  status(runId: string): Promise<AgentRunStatus>
  steer(input: AgentRunSteer): Promise<void>
  approve(input: AgentRunApproval): Promise<void>
  cancel(runId: string, requestHash: string): Promise<void>
  result(runId: string): Promise<AgentRunResult | null>
}

export function validateAgentRunAcceptance(
  request: AgentRunRequest,
  value: AgentRunAcceptance,
): AgentRunAcceptance {
  if (value.run_id !== request.run_id || value.request_hash !== request.request_hash) {
    throw new Error("Agent Host acceptance identity drifted")
  }
  if (typeof value.accepted !== "boolean" || typeof value.replayed !== "boolean") {
    throw new Error("Agent Host acceptance flags are invalid")
  }
  if (!value.accepted && value.replayed) throw new Error("replayed Agent Run must be accepted")
  return value
}

export function validateAgentRunStatus(value: AgentRunStatus): AgentRunStatus {
  if (!/^[A-Za-z0-9][A-Za-z0-9._:-]{0,159}$/.test(value.run_id)) throw new Error("Agent Host status run_id is invalid")
  if (!/^[a-f0-9]{64}$/.test(value.request_hash)) throw new Error("Agent Host status request_hash is invalid")
  const statuses = new Set<AgentRunLifecycleStatus>([
    "accepted", "running", "awaiting_approval", "cancelling",
    "completed", "blocked", "cancelled", "failed",
  ])
  if (!statuses.has(value.status)) throw new Error("Agent Host status is unsupported")
  if (!Number.isSafeInteger(value.last_sequence) || value.last_sequence < 0) {
    throw new Error("Agent Host status sequence is invalid")
  }
  const terminal = new Set<AgentRunLifecycleStatus>(["completed", "blocked", "cancelled", "failed"]).has(value.status)
  if (value.terminal !== terminal) throw new Error("Agent Host terminal projection is inconsistent")
  return value
}

export function validateAgentRunApproval(input: AgentRunApproval, profile: AgentRunRequest["task_profile"]): void {
  if (profile !== "developer" && input.decision === "allow_once") {
    throw new Error("read-only Agent profile cannot approve an effect")
  }
  if (!/^[a-f0-9]{64}$/.test(input.request_hash)) throw new Error("Agent Run approval request_hash is invalid")
  if (!input.operation_ref || input.operation_ref.length > 512) throw new Error("Agent Run approval operation_ref is invalid")
}
