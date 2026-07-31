import type { Database } from "bun:sqlite"
import type { AgentHostPort } from "../../../../../contracts/agent-run-contract/src/agent-host-port"
import { executeAgentRunThroughHost } from "./agent-run-host-execution"
import type { AgentArtifactPort } from "./planner-agent-run"
import {
  admitReviewerAgentResult,
  prepareReviewerAgentRun,
} from "./reviewer-agent-run"

export async function runReviewerAgentCycle(input: {
  db: Database
  host: AgentHostPort
  artifacts: AgentArtifactPort
  reviewer_run_id: string
  trace_id: string
  idempotency_key: string
  source_revision: string
  requested_at: string
  deadline_at: string
  experiment_id: string
  stage_id: string
  result_ids: string[]
  poll_interval_ms?: number
  signal?: AbortSignal
}) {
  const prepared = prepareReviewerAgentRun({
    db: input.db,
    reviewer_run_id: input.reviewer_run_id,
    trace_id: input.trace_id,
    idempotency_key: input.idempotency_key,
    source_revision: input.source_revision,
    requested_at: input.requested_at,
    deadline_at: input.deadline_at,
    experiment_id: input.experiment_id,
    stage_id: input.stage_id,
    result_ids: input.result_ids,
    artifacts: input.artifacts,
  })
  const completed = await executeAgentRunThroughHost({
    host: input.host,
    request: prepared.request,
    poll_interval_ms: input.poll_interval_ms,
    signal: input.signal,
  })
  const recordedAt = new Date(Math.max(
    Date.now(),
    Date.parse(completed.result.finished_at),
  )).toISOString()
  const submission = admitReviewerAgentResult({
    db: input.db,
    prepared,
    events: completed.events,
    result: completed.result,
    artifacts: input.artifacts,
    recorded_at: recordedAt,
  })
  return {
    schema_version: "trade.rd-reviewer-agent-cycle-result.v1" as const,
    run_id: prepared.request.run_id,
    request_hash: prepared.request.request_hash,
    result_hash: completed.result.result_hash,
    output_refs: completed.result.output_refs,
    submission,
  }
}
