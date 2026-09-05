import type { OperationRunV1, RunPageV1 } from "./run-store.ts";
import type { RunListBrowserEnvelopeV1, RunListItemV1 } from "./run-list-contract.ts";

function duration(run: OperationRunV1): number | null {
  if (!run.started_at) return null;
  const start = Date.parse(run.started_at);
  const end = run.finished_at ? Date.parse(run.finished_at) : Date.parse(run.updated_at);
  return Number.isFinite(start) && Number.isFinite(end) && end >= start ? end - start : null;
}

function projectRun(run: OperationRunV1): RunListItemV1 {
  return {
    schema_version: 1,
    run_identity: run.run_identity,
    operation_id: run.operation_id,
    channel: run.channel,
    run_kind: run.run_kind,
    trigger_kind: run.trigger_kind,
    state: run.state,
    owner_outcome_state: run.owner_outcome_state,
    created_at: run.created_at,
    started_at: run.started_at,
    finished_at: run.finished_at,
    duration_ms: duration(run),
    terminal_code: run.terminal_code,
  };
}

export function projectRunListBrowserEnvelopeV1(page: RunPageV1): RunListBrowserEnvelopeV1 {
  return {
    schema_version: 1,
    operation: "dashboard.run_store.list.v1",
    availability: "available",
    unavailable_reason: null,
    observed_at: page.observed_at,
    runs: page.runs.map(projectRun),
    next_cursor: page.next_cursor,
  };
}
