import test from "node:test"
import assert from "node:assert/strict"
import { Database } from "bun:sqlite"
import {
  buildAgentRunEvent,
  buildAgentRunResult,
  type AgentArtifactRef,
} from "../../../../../contracts/agent-run-contract/src/agent-run-contract"
import { canonicalJson } from "../../../../../contracts/runtime-core/src/canonical-json"
import { buildPlannerProposal } from "../../../../agent-roles/planner/src/lib/planner-role"
import { ensureResearchStateSchema } from "../../../state-store/src/lib/research-state-store"
import { seedDefaultResearchControlPlane } from "../../../state-store/src/lib/research-universe-default-seed"
import { readPlannerControlPlaneContext } from "../../../state-store/src/lib/research-control-plane-operations"
import {
  admitPlannerAgentResult,
  preparePlannerAgentRun,
} from "./planner-agent-run"
import { memoryArtifacts } from "./agent-artifact-port.test-fixture"

test("Planner Agent context reaches existing owner admission without direct Agent state writes", () => {
  const db = new Database(":memory:")
  const artifacts = memoryArtifacts()
  try {
    ensureResearchStateSchema(db)
    seedDefaultResearchControlPlane(db, "2026-07-23T10:00:00.000Z")
    const context = readPlannerControlPlaneContext(db)
    const prepared = preparePlannerAgentRun({
      planner_run_id: "planner-agent-run-1",
      trace_id: "trace-planner-1",
      idempotency_key: "planner-agent-key-1",
      objective: "Test one bounded time-series momentum mechanism",
      source_revision: "0123456789abcdef",
      requested_at: "2026-07-23T10:01:00.000Z",
      deadline_at: "2026-07-23T10:11:00.000Z",
      control_plane_context: context,
      artifacts,
    })
    assert.equal(
      (db.query("SELECT COUNT(*) AS count FROM rd_planner_proposal_revision").get() as { count: number }).count,
      0,
    )
    const proposal = buildPlannerProposal({
      proposal_id: "proposal-agent-1",
      hypothesis_id: "hypothesis-agent-1",
      universe_node_id: "canonical:trend/time-series-trend/time-series-momentum",
      objective: prepared.context_pack.objective,
      dataset_requirements: ["ohlcv"],
      candidate_space: { lookback_bars: [20, 40] },
      trial_budget: 2,
      evaluation_protocol_ref: "protocol://historical-v1",
      control_plane_context: context,
      created_at: "2026-07-23T10:02:00.000Z",
    })
    const output = artifacts.put(canonicalJson(proposal), "application/json")
    const { events, result } = completion(prepared.request, output)
    const admission = admitPlannerAgentResult({
      db,
      prepared,
      events,
      result,
      artifacts,
      recorded_at: "2026-07-23T10:03:01.000Z",
    })
    assert.equal(admission.status, "accepted")
    assert.equal(admission.planner_run_id, prepared.request.run_id)
    const replayed = admitPlannerAgentResult({
      db,
      prepared,
      events,
      result,
      artifacts,
      recorded_at: "2026-07-23T10:03:01.000Z",
    })
    assert.equal(replayed.admission_hash, admission.admission_hash)
    assert.equal(
      (db.query("SELECT COUNT(*) AS count FROM rd_planner_proposal_revision").get() as { count: number }).count,
      1,
    )
  } finally {
    db.close()
  }
})

test("Planner Agent admission rejects a validly hashed proposal from another context", () => {
  const db = new Database(":memory:")
  const artifacts = memoryArtifacts()
  try {
    ensureResearchStateSchema(db)
    seedDefaultResearchControlPlane(db, "2026-07-23T10:00:00.000Z")
    const context = readPlannerControlPlaneContext(db)
    const prepared = preparePlannerAgentRun({
      planner_run_id: "planner-agent-run-drift",
      trace_id: "trace-planner-drift",
      idempotency_key: "planner-agent-key-drift",
      objective: "Test one bounded time-series momentum mechanism",
      source_revision: "0123456789abcdef",
      requested_at: "2026-07-23T10:01:00.000Z",
      deadline_at: "2026-07-23T10:11:00.000Z",
      control_plane_context: context,
      artifacts,
    })
    const proposal = buildPlannerProposal({
      proposal_id: "proposal-agent-drift",
      hypothesis_id: "hypothesis-agent-drift",
      universe_node_id: "canonical:trend/time-series-trend/time-series-momentum",
      objective: "Different objective",
      dataset_requirements: ["ohlcv"],
      candidate_space: { lookback_bars: [20] },
      trial_budget: 1,
      evaluation_protocol_ref: "protocol://historical-v1",
      control_plane_context: context,
      created_at: "2026-07-23T10:02:00.000Z",
    })
    const output = artifacts.put(canonicalJson(proposal), "application/json")
    const { events, result } = completion(prepared.request, output)
    assert.throws(() => admitPlannerAgentResult({
      db,
      prepared,
      events,
      result,
      artifacts,
      recorded_at: "2026-07-23T10:03:01.000Z",
    }), /objective drifted/)
    assert.equal(
      (db.query("SELECT COUNT(*) AS count FROM rd_planner_proposal_revision").get() as { count: number }).count,
      0,
    )
  } finally {
    db.close()
  }
})

function completion(request: ReturnType<typeof preparePlannerAgentRun>["request"], output: AgentArtifactRef) {
  const accepted = buildAgentRunEvent({
    run_id: request.run_id,
    trace_id: request.trace_id,
    request_hash: request.request_hash,
    sequence: 1,
    occurred_at: "2026-07-23T10:01:01.000Z",
    kind: "accepted",
    summary: "Planner run accepted.",
  })
  const started = buildAgentRunEvent({
    run_id: request.run_id,
    trace_id: request.trace_id,
    request_hash: request.request_hash,
    sequence: 2,
    occurred_at: "2026-07-23T10:01:02.000Z",
    kind: "started",
    summary: "Planner run started.",
  })
  const terminal = buildAgentRunEvent({
    run_id: request.run_id,
    trace_id: request.trace_id,
    request_hash: request.request_hash,
    sequence: 3,
    occurred_at: "2026-07-23T10:03:00.000Z",
    kind: "terminal",
    summary: "Planner run completed.",
    status: "completed",
  })
  return {
    events: [accepted, started, terminal],
    result: buildAgentRunResult({
      run_id: request.run_id,
      trace_id: request.trace_id,
      request_hash: request.request_hash,
      terminal_sequence: 3,
      finished_at: "2026-07-23T10:03:00.000Z",
      status: "completed",
      output_refs: [output],
      usage: {
        wall_time_ms: 119_000,
        turns: 1,
        tool_calls: 0,
        input_bytes: request.instruction_ref.bytes + request.input_refs[0]!.bytes,
        output_bytes: output.bytes,
      },
    }),
  }
}
