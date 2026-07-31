import assert from "node:assert/strict"
import test from "node:test"
import { Database } from "bun:sqlite"
import {
  buildAgentRunEvent,
  buildAgentRunResult,
  type AgentArtifactRef,
  type AgentRunRequest,
} from "../../../../../contracts/agent-run-contract/src/agent-run-contract"
import { canonicalJson } from "../../../../../contracts/runtime-core/src/canonical-json"
import { readFamilyEvaluationProtocol } from "../../../../../contracts/rd-agent-capability-contract/src/rd-agent-capability-contract"
import {
  createDeveloperAgentSubmission,
  DEVELOPER_AGENT_SUBMISSION_SCHEMA,
} from "../../../contracts/src/lib/developer-agent-submission"
import {
  DEVELOPER_EXPERIMENT_CONTRACT_DRAFT_PAYLOAD_SCHEMA_VERSION,
} from "../../../contracts/src/lib/developer-contract-draft"
import { PLANNER_PROPOSAL_INTAKE_REQUEST_SCHEMA_VERSION } from "../../../contracts/src/lib/planner-proposal-submission"
import { buildDeveloperContractDraftSubmission } from "../../../../agent-roles/developer/src/lib/developer-role"
import { buildPlannerProposal } from "../../../../agent-roles/planner/src/lib/planner-role"
import { admitPlannerProposal } from "../../../state-store/src/lib/planner-proposal-intake"
import { readPlannerControlPlaneContext } from "../../../state-store/src/lib/research-control-plane-operations"
import { ensureResearchStateSchema } from "../../../state-store/src/lib/research-state-store"
import { seedDefaultResearchControlPlane } from "../../../state-store/src/lib/research-universe-default-seed"
import {
  admitDeveloperAgentResult,
  compileDeveloperAgentContextPack,
  createDeveloperWorkspaceAgentSubmission,
  createDeveloperWorkspaceAgentSubmissionFromContextPack,
  prepareDeveloperAgentRun,
} from "./developer-agent-run"
import { memoryArtifacts } from "./agent-artifact-port.test-fixture"
import {
  DEVELOPER_DATA_SNAPSHOT_BINDING_SCHEMA_VERSION,
  createDeveloperDataSnapshotBinding,
} from "./developer-capability-assessment"

test("Developer Agent capability assessment and draft enter the existing unvalidated intake only once", () => {
  const db = new Database(":memory:")
  const artifacts = memoryArtifacts()
  try {
    const proposal = seedProposal(db)
    const prepared = prepareDeveloperAgentRun({
      db,
      developer_run_id: "developer-agent-run-1",
      trace_id: "trace-developer-1",
      idempotency_key: "developer-agent-key-1",
      source_revision: "0123456789abcdef",
      requested_at: "2026-07-23T10:04:00.000Z",
      deadline_at: "2026-07-23T10:34:00.000Z",
      proposal_id: proposal.proposal_id,
      proposal_revision: 1,
      brief_id: "brief-agent-1",
      artifacts,
      data_snapshot_binding: createDeveloperDataSnapshotBinding({
        schema_version: DEVELOPER_DATA_SNAPSHOT_BINDING_SCHEMA_VERSION,
        snapshot_ref: "dataset://btc-4h/discovery/v1",
        snapshot_hash: "a".repeat(64),
        dataset_kinds: ["ohlcv"],
        hypothesis_id: proposal.hypothesis_id,
        symbol: "BTCUSDT",
        exchange: "binanceusdm",
        segment: "discovery",
        timeframe: "4h",
        row_count: 500,
        first_open_at: "2026-01-01T00:00:00.000Z",
        last_open_at: "2026-03-01T00:00:00.000Z",
        report_ref: "tmp/splits/example/report.json",
        report_hash: "b".repeat(64),
        manifest_ref: "data/rd-datasets/example/discovery/manifest.json",
        manifest_hash: "c".repeat(64),
        content_ref: "data/rd-datasets/example/discovery/4h.csv",
        content_hash: "d".repeat(64),
        evidence_ref: "artifact://dataset-manifest/a",
      }),
    })
    const draft = buildDeveloperContractDraftSubmission({
      brief: prepared.context_pack.brief,
      developer_run_id: prepared.request.run_id,
      draft_revision: 1,
      requested_trial_budget: 2,
      draft_json: {
        schema_version: DEVELOPER_EXPERIMENT_CONTRACT_DRAFT_PAYLOAD_SCHEMA_VERSION,
        canonical_node_id: proposal.universe_node_id,
        required_data: proposal.dataset_requirements,
      },
      created_at: "2026-07-23T10:10:00.000Z",
    })
    const submission = createDeveloperAgentSubmission({
      schema_version: DEVELOPER_AGENT_SUBMISSION_SCHEMA,
      developer_run_id: prepared.request.run_id,
      brief_id: prepared.context_pack.brief.brief_id,
      brief_hash: prepared.context_pack.brief.brief_hash,
      source_revision: prepared.request.source_revision,
      draft_revision: 1,
      predecessor_run_id: null,
      capability_assessment: {
        implementation_mode: prepared.context_pack.capability_assessment.required_mode,
        reason_code: prepared.context_pack.capability_assessment.reason_code,
        required_capabilities: prepared.context_pack.capability_assessment.required_capabilities,
      },
      contract_draft: draft,
      workspace_patch: null,
      quality_check_refs: [],
      replay_diagnosis_refs: [],
      created_at: "2026-07-23T10:10:01.000Z",
    })
    const output = artifacts.put(canonicalJson(submission), "application/json")
    const completionValue = completion(prepared.request, [output])
    const admission = admitDeveloperAgentResult({
      db,
      prepared,
      ...completionValue,
      artifacts,
      recorded_at: "2026-07-23T10:11:01.000Z",
    })
    assert.equal(admission.status, "draft_received")
    assert.equal(admission.receipt?.status, "received_unvalidated")
    const replayed = admitDeveloperAgentResult({
      db,
      prepared,
      ...completionValue,
      artifacts,
      recorded_at: "2026-07-23T10:11:01.000Z",
    })
    assert.equal(replayed.receipt?.receipt_hash, admission.receipt?.receipt_hash)
    assert.equal(
      (db.query("SELECT COUNT(*) AS count FROM rd_developer_contract_draft").get() as { count: number }).count,
      1,
    )
    const provenance = db.query(`
      SELECT source_revision, agent_run_request_hash, agent_run_result_hash,
             agent_submission_hash, contract_draft_submission_hash
      FROM rd_developer_agent_draft_provenance
      WHERE developer_run_id = $developer_run_id
    `).get({
      $developer_run_id: prepared.request.run_id,
    }) as {
      source_revision: string
      agent_run_request_hash: string
      agent_run_result_hash: string
      agent_submission_hash: string
      contract_draft_submission_hash: string
    }
    assert.deepEqual(provenance, {
      source_revision: prepared.request.source_revision,
      agent_run_request_hash: prepared.request.request_hash,
      agent_run_result_hash: completionValue.result.result_hash,
      agent_submission_hash: submission.submission_hash,
      contract_draft_submission_hash: draft.submission_hash,
    })
  } finally {
    db.close()
  }
})

test("Developer code-change and blocked modes cannot smuggle incomplete effects", () => {
  const db = new Database(":memory:")
  const artifacts = memoryArtifacts()
  try {
    const proposal = seedProposal(db)
    const prepared = prepareDeveloperAgentRun({
      db,
      developer_run_id: "developer-agent-run-blocked",
      trace_id: "trace-developer-blocked",
      idempotency_key: "developer-agent-key-blocked",
      source_revision: "0123456789abcdef",
      requested_at: "2026-07-23T10:04:00.000Z",
      deadline_at: "2026-07-23T10:34:00.000Z",
      proposal_id: proposal.proposal_id,
      proposal_revision: 1,
      brief_id: "brief-agent-blocked",
      artifacts,
    })
    assert.throws(() => createDeveloperAgentSubmission({
      schema_version: DEVELOPER_AGENT_SUBMISSION_SCHEMA,
      developer_run_id: prepared.request.run_id,
      brief_id: prepared.context_pack.brief.brief_id,
      brief_hash: prepared.context_pack.brief.brief_hash,
      source_revision: prepared.request.source_revision,
      draft_revision: 1,
      predecessor_run_id: null,
      capability_assessment: {
        implementation_mode: "code_change_required",
        reason_code: "family_missing",
        required_capabilities: [],
      },
      contract_draft: null,
      workspace_patch: null,
      quality_check_refs: [],
      replay_diagnosis_refs: [],
      created_at: "2026-07-23T10:10:01.000Z",
    }), /requires a contract draft|requires a patch/)

    const blocked = createDeveloperAgentSubmission({
      schema_version: DEVELOPER_AGENT_SUBMISSION_SCHEMA,
      developer_run_id: prepared.request.run_id,
      brief_id: prepared.context_pack.brief.brief_id,
      brief_hash: prepared.context_pack.brief.brief_hash,
      source_revision: prepared.request.source_revision,
      draft_revision: 1,
      predecessor_run_id: null,
      capability_assessment: {
        implementation_mode: prepared.context_pack.capability_assessment.required_mode,
        reason_code: prepared.context_pack.capability_assessment.reason_code,
        required_capabilities: prepared.context_pack.capability_assessment.required_capabilities,
      },
      contract_draft: null,
      workspace_patch: null,
      quality_check_refs: [],
      replay_diagnosis_refs: [],
      created_at: "2026-07-23T10:10:01.000Z",
    })
    const output = artifacts.put(canonicalJson(blocked), "application/json")
    const admission = admitDeveloperAgentResult({
      db,
      prepared,
      ...completion(prepared.request, [output]),
      artifacts,
      recorded_at: "2026-07-23T10:11:01.000Z",
    })
    assert.equal(admission.status, "blocked")
    assert.equal(admission.receipt, null)
    assert.equal(
      (db.query("SELECT COUNT(*) AS count FROM rd_developer_contract_draft").get() as { count: number }).count,
      0,
    )
  } finally {
    db.close()
  }
})

test("Developer implementation gaps route to workspace Host without semantic MCP instructions", () => {
  const db = new Database(":memory:")
  const artifacts = memoryArtifacts()
  try {
    const universeNodeId =
      "canonical:trend/cross-sectional-momentum/relative-weakness-momentum"
    const proposal = seedProposal(db, {
      universe_node_id: universeNodeId,
      candidate_space: {
        side: ["long"],
        signal_mode: ["momentum"],
        confirmation_mode: ["none"],
        lookback_bars: [20],
      },
    })
    const prepared = prepareDeveloperAgentRun({
      db,
      developer_run_id: "developer-agent-run-code",
      trace_id: "trace-developer-code",
      idempotency_key: "developer-agent-key-code",
      source_revision: "0123456789abcdef",
      requested_at: "2026-07-23T10:04:00.000Z",
      deadline_at: "2026-07-23T10:34:00.000Z",
      proposal_id: proposal.proposal_id,
      proposal_revision: 1,
      brief_id: "brief-agent-code",
      artifacts,
    })

    assert.equal(prepared.execution_route, "workspace_host")
    assert.equal(
      prepared.context_pack.capability_assessment.reason_code,
      "replay_implementation_not_ready",
    )
    assert.deepEqual(prepared.request.capabilities, [
      "owner_read",
      "research_read",
      "workspace_read",
      "workspace_patch",
      "bounded_quality_check",
    ])
    const instruction = artifacts.read(prepared.request.instruction_ref)
    assert.match(instruction, /Do not call research_developer_submission_prepare/)
    assert.match(instruction, /Host—not the model—must capture the patch/)

    const patch = artifacts.put(
      "diff --git a/family.ts b/family.ts\n--- a/family.ts\n+++ b/family.ts\n",
      "text/x-diff",
    )
    const quality = artifacts.put(canonicalJson({
      schema_version: "trade.agent-workspace-quality-evidence.v1",
      exit_code: 0,
      timed_out: false,
    }), "application/json")
    const submission = createDeveloperWorkspaceAgentSubmission({
      prepared,
      workspace_patch: patch,
      quality_check_refs: [quality],
      created_at: "2026-07-23T10:10:01.000Z",
    })
    assert.equal(submission.contract_draft, null)
    assert.deepEqual(
      compileDeveloperAgentContextPack(
        JSON.parse(canonicalJson(prepared.context_pack)),
      ),
      prepared.context_pack,
    )
    const reconstructed = createDeveloperWorkspaceAgentSubmissionFromContextPack({
      request: prepared.request,
      context_pack: prepared.context_pack,
      workspace_patch: patch,
      quality_check_refs: [quality],
      created_at: "2026-07-23T10:10:01.000Z",
    })
    assert.deepEqual(reconstructed, submission)
    assert.throws(() => compileDeveloperAgentContextPack({
      ...prepared.context_pack,
      next_draft_revision: 2,
    }), /hash-drifted/)
    const output = artifacts.put(canonicalJson(submission), "application/json")
    const admission = admitDeveloperAgentResult({
      db,
      prepared,
      ...completion(prepared.request, [output, patch, quality]),
      artifacts,
      recorded_at: "2026-07-23T10:11:01.000Z",
    })
    assert.equal(admission.status, "patch_ready")
    assert.equal(admission.patch_ref, patch.ref)
    assert.equal(admission.receipt, null)
    const draftCount = db.query(
      "SELECT COUNT(*) AS count FROM rd_developer_contract_draft",
    ).get() as { count: number }
    assert.equal(draftCount.count, 0)
  } finally {
    db.close()
  }
})

function seedProposal(
  db: Database,
  overrides: {
    universe_node_id?: string
    candidate_space?: Record<string, unknown>
  } = {},
) {
  ensureResearchStateSchema(db)
  seedDefaultResearchControlPlane(db, "2026-07-23T10:00:00.000Z")
  const context = readPlannerControlPlaneContext(db)
  const universeNodeId = overrides.universe_node_id
    ?? "canonical:trend/time-series-trend/time-series-momentum"
  const protocol = readFamilyEvaluationProtocol(universeNodeId)
  if (!protocol) throw new Error("Developer Agent test protocol is missing")
  const proposal = buildPlannerProposal({
    proposal_id: "proposal-developer-agent",
    hypothesis_id: "hypothesis-developer-agent",
    universe_node_id: universeNodeId,
    objective: "Test one bounded time-series momentum mechanism",
    dataset_requirements: ["ohlcv"],
    candidate_space: overrides.candidate_space ?? { lookback_bars: [20, 40] },
    trial_budget: 2,
    evaluation_protocol_ref: protocol.protocol_ref,
    control_plane_context: context,
    created_at: "2026-07-23T10:01:00.000Z",
  })
  admitPlannerProposal(db, {
    schema_version: PLANNER_PROPOSAL_INTAKE_REQUEST_SCHEMA_VERSION,
    planner_run_id: "planner-before-developer",
    proposal_revision: 1,
    idempotency_key: "planner-before-developer-key",
    submitted_at: "2026-07-23T10:02:00.000Z",
    recorded_at: "2026-07-23T10:03:00.000Z",
    proposal,
  })
  return proposal
}

function completion(request: AgentRunRequest, outputs: AgentArtifactRef[]) {
  const events = [
    buildAgentRunEvent({
      run_id: request.run_id,
      trace_id: request.trace_id,
      request_hash: request.request_hash,
      sequence: 1,
      occurred_at: "2026-07-23T10:04:01.000Z",
      kind: "accepted",
      summary: "Developer run accepted.",
    }),
    buildAgentRunEvent({
      run_id: request.run_id,
      trace_id: request.trace_id,
      request_hash: request.request_hash,
      sequence: 2,
      occurred_at: "2026-07-23T10:04:02.000Z",
      kind: "started",
      summary: "Developer run started.",
    }),
    buildAgentRunEvent({
      run_id: request.run_id,
      trace_id: request.trace_id,
      request_hash: request.request_hash,
      sequence: 3,
      occurred_at: "2026-07-23T10:11:00.000Z",
      kind: "terminal",
      summary: "Developer run completed.",
      status: "completed",
    }),
  ]
  const result = buildAgentRunResult({
    run_id: request.run_id,
    trace_id: request.trace_id,
    request_hash: request.request_hash,
    terminal_sequence: 3,
    finished_at: "2026-07-23T10:11:00.000Z",
    status: "completed",
    output_refs: outputs,
    usage: {
      wall_time_ms: 419_000,
      turns: 2,
      tool_calls: 1,
      input_bytes: request.instruction_ref.bytes
        + request.input_refs.reduce((sum, ref) => sum + ref.bytes, 0),
      output_bytes: outputs.reduce((sum, ref) => sum + ref.bytes, 0),
    },
  })
  return { events, result }
}
