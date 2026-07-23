import type { Database } from "bun:sqlite"
import type { AgentArtifactRef } from "../../../../../contracts/agent-run-contract/src/agent-run-contract"
import type { AgentHostPort } from "../../../../../contracts/agent-run-contract/src/agent-host-port"
import {
  admitDeveloperAgentResult,
  prepareDeveloperAgentRun,
} from "./developer-agent-run"
import { executeAgentRunThroughHost } from "./agent-run-host-execution"
import type { AgentArtifactPort } from "./planner-agent-run"
import type { DeveloperDataSnapshotBinding } from "./developer-capability-assessment"

export async function runDeveloperAgentCycle(input: {
  db: Database
  host: AgentHostPort
  artifacts: AgentArtifactPort
  developer_run_id: string
  trace_id: string
  idempotency_key: string
  source_revision: string
  requested_at: string
  deadline_at: string
  proposal_id: string
  proposal_revision: number
  brief_id: string
  predecessor_run_id?: string
  replay_result_refs?: AgentArtifactRef[]
  data_snapshot_binding?: DeveloperDataSnapshotBinding | null
  poll_interval_ms?: number
  signal?: AbortSignal
}) {
  const prepared = prepareDeveloperAgentRun({
    db: input.db,
    developer_run_id: input.developer_run_id,
    trace_id: input.trace_id,
    idempotency_key: input.idempotency_key,
    source_revision: input.source_revision,
    requested_at: input.requested_at,
    deadline_at: input.deadline_at,
    proposal_id: input.proposal_id,
    proposal_revision: input.proposal_revision,
    brief_id: input.brief_id,
    artifacts: input.artifacts,
    ...(input.predecessor_run_id
      ? { predecessor_run_id: input.predecessor_run_id }
      : {}),
    ...(input.replay_result_refs
      ? { replay_result_refs: input.replay_result_refs }
      : {}),
    ...(input.data_snapshot_binding
      ? { data_snapshot_binding: input.data_snapshot_binding }
      : {}),
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
  const admission = admitDeveloperAgentResult({
    db: input.db,
    prepared,
    events: completed.events,
    result: completed.result,
    artifacts: input.artifacts,
    recorded_at: recordedAt,
  })
  return {
    schema_version: "trade.rd-developer-agent-cycle-result.v1" as const,
    run_id: prepared.request.run_id,
    request_hash: prepared.request.request_hash,
    result_hash: completed.result.result_hash,
    output_refs: completed.result.output_refs,
    admission,
  }
}
