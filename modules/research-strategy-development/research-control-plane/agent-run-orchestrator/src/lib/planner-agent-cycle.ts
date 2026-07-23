import type { Database } from "bun:sqlite"
import type { AgentHostPort } from "../../../../../contracts/agent-run-contract/src/agent-host-port"
import { readPlannerControlPlaneContext } from "../../../state-store/src/lib/research-control-plane-operations"
import {
  admitPlannerAgentResult,
  preparePlannerAgentRun,
  type AgentArtifactPort,
} from "./planner-agent-run"
import { executeAgentRunThroughHost } from "./agent-run-host-execution"

export async function runPlannerAgentCycle(input: {
  db: Database
  host: AgentHostPort
  artifacts: AgentArtifactPort
  planner_run_id: string
  trace_id: string
  idempotency_key: string
  objective: string
  source_revision: string
  requested_at: string
  deadline_at: string
  poll_interval_ms?: number
  signal?: AbortSignal
}) {
  const prepared = preparePlannerAgentRun({
    planner_run_id: input.planner_run_id,
    trace_id: input.trace_id,
    idempotency_key: input.idempotency_key,
    objective: input.objective,
    source_revision: input.source_revision,
    requested_at: input.requested_at,
    deadline_at: input.deadline_at,
    control_plane_context: readPlannerControlPlaneContext(input.db),
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
  const admission = admitPlannerAgentResult({
    db: input.db,
    prepared,
    events: completed.events,
    result: completed.result,
    artifacts: input.artifacts,
    recorded_at: recordedAt,
  })
  return {
    schema_version: "trade.rd-planner-agent-cycle-result.v1" as const,
    run_id: prepared.request.run_id,
    request_hash: prepared.request.request_hash,
    result_hash: completed.result.result_hash,
    output_refs: completed.result.output_refs,
    admission,
  }
}
