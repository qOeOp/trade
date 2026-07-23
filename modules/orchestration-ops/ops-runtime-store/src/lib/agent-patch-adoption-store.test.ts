import assert from "node:assert/strict"
import test from "node:test"
import { Database } from "bun:sqlite"
import {
  buildAgentRunRequest,
  type AgentArtifactRef,
} from "../../../../contracts/agent-run-contract/src/agent-run-contract"
import {
  admitAgentRun,
  ensureAgentRunStoreSchema,
} from "./agent-run-store"
import {
  admitAgentPatchAdoption,
  completeAgentPatchAdoption,
  listRecoverableAgentPatchAdoptions,
  readAgentPatchAdoption,
  startAgentPatchAdoption,
} from "./agent-patch-adoption-store"

test("Agent patch adoption is restart-readable, idempotent, and terminally bound", () => {
  const db = new Database(":memory:")
  try {
    ensureAgentRunStoreSchema(db)
    const request = buildAgentRunRequest({
      run_id: "developer-run-adoption",
      idempotency_key: "developer-run-adoption-key",
      trace_id: "developer-run-adoption-trace",
      task_profile: "developer",
      objective: "Prepare one bounded implementation patch.",
      source_revision: "0123456789abcdef",
      instruction_ref: artifact("1", "text/markdown"),
      input_refs: [artifact("2", "application/json")],
      output_schema_version: "trade.rd-developer-agent-submission.v1",
      capabilities: [
        "owner_read",
        "research_read",
        "workspace_read",
        "workspace_patch",
        "bounded_quality_check",
      ],
      budget: {
        deadline_at: "2026-07-23T01:30:00.000Z",
        max_wall_time_ms: 1_000,
        max_turns: 2,
        max_tool_calls: 1,
        max_input_bytes: 2,
        max_output_bytes: 10_000,
      },
      data_classification: "project_internal",
    })
    admitAgentRun(db, request, "openclaw-workspace-gateway", "2026-07-23T01:00:00.000Z")
    const patch = artifact("3", "text/x-diff")
    const accepted = admitAgentPatchAdoption(db, {
      adoption_id: "adoption-1",
      run_id: request.run_id,
      request_hash: request.request_hash,
      scope_hash: "4".repeat(64),
      patch,
      accepted_at: "2026-07-23T01:10:00.000Z",
    })
    assert.equal(accepted.status, "accepted")
    assert.equal(listRecoverableAgentPatchAdoptions(db).length, 1)
    assert.equal(
      startAgentPatchAdoption(
        db,
        accepted.adoption_id,
        "2026-07-23T01:11:00.000Z",
      ).attempt_count,
      1,
    )
    const completed = completeAgentPatchAdoption(db, {
      schema_version: "trade.agent-patch-adoption-result.v1",
      adoption_id: accepted.adoption_id,
      run_id: request.run_id,
      request_hash: request.request_hash,
      scope_hash: "4".repeat(64),
      patch_sha256: patch.sha256,
      base_source_revision: request.source_revision,
      candidate_source_revision: "5".repeat(40),
      manifest_ref: "data/release-candidates/manifest.json",
      manifest_sha256: "6".repeat(64),
      certified_at: "2026-07-23T01:12:00.000Z",
      deployment_authority: "none",
    })
    assert.equal(completed.status, "candidate_certified")
    assert.equal(listRecoverableAgentPatchAdoptions(db).length, 0)
    assert.deepEqual(
      completeAgentPatchAdoption(db, completed.result!),
      completed,
    )
    assert.throws(() => admitAgentPatchAdoption(db, {
      adoption_id: "adoption-1",
      run_id: request.run_id,
      request_hash: request.request_hash,
      scope_hash: "7".repeat(64),
      patch,
      accepted_at: "2026-07-23T01:10:00.000Z",
    }), /identity drifted/)
    assert.equal(
      readAgentPatchAdoption(db, "adoption-1")?.result
        ?.candidate_source_revision,
      "5".repeat(40),
    )
  } finally {
    db.close()
  }
})

function artifact(
  digit: string,
  mediaType: AgentArtifactRef["media_type"],
): AgentArtifactRef {
  return {
    ref: `agent-artifact://durable/${digit.repeat(64)}`,
    sha256: digit.repeat(64),
    media_type: mediaType,
    bytes: 1,
  }
}
