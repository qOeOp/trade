import assert from "node:assert/strict"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { resolve } from "node:path"
import test from "node:test"
import {
  buildAgentRunRequest,
  type AgentArtifactRef,
} from "../../../../contracts/agent-run-contract/src/agent-run-contract"
import {
  parseAgentJsonArtifact,
  writeAgentJsonArtifact,
  writeAgentTextArtifact,
} from "../../../agent-artifact-store/src/lib/agent-artifact-store"
import {
  materializeOpenClawAgentMessage,
  OPENCLAW_AGENT_MESSAGE_SCHEMA,
  storeOpenClawAgentOutput,
  validateOpenClawAgentOutputArtifact,
} from "./openclaw-artifact-materializer"

test("OpenClaw materializer resolves verified refs into one bounded message", () => {
  const root = mkdtempSync(resolve(tmpdir(), "openclaw-materializer-"))
  try {
    const instruction = writeAgentTextArtifact({
      repository_root: root,
      storage: "temporary",
      media_type: "text/markdown",
      text: "Return the typed proposal.",
    })
    const context = writeAgentJsonArtifact({
      repository_root: root,
      storage: "temporary",
      value: { context: "frozen" },
    })
    const request = fixtureRequest(instruction, context)
    const message = JSON.parse(materializeOpenClawAgentMessage(root, request))
    assert.equal(message.schema_version, OPENCLAW_AGENT_MESSAGE_SCHEMA)
    assert.equal(message.run.request_hash, request.request_hash)
    assert.equal(message.instruction.text, "Return the typed proposal.")
    assert.deepEqual(message.inputs[0].text, "{\"context\":\"frozen\"}")

    const output = storeOpenClawAgentOutput({
      repository_root: root,
      request,
      text: "  {\"schema_version\":\"trade.test-output.v1\",\"proposal\":\"bounded\"}  ",
    })
    assert.deepEqual(parseAgentJsonArtifact(root, output), {
      schema_version: "trade.test-output.v1",
      proposal: "bounded",
    })
    const fenced = storeOpenClawAgentOutput({
      repository_root: root,
      request,
      text: "```json\n{\"schema_version\":\"trade.test-output.v1\",\"proposal\":\"bounded\"}\n```",
    })
    assert.deepEqual(fenced, output)
    assert.deepEqual(validateOpenClawAgentOutputArtifact({
      repository_root: root,
      request,
      artifact: output,
    }), output)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test("OpenClaw materializer rejects ref drift and non-object output", () => {
  const root = mkdtempSync(resolve(tmpdir(), "openclaw-materializer-deny-"))
  try {
    const instruction = writeAgentTextArtifact({
      repository_root: root,
      storage: "temporary",
      media_type: "text/plain",
      text: "bounded",
    })
    const context = writeAgentJsonArtifact({
      repository_root: root,
      storage: "temporary",
      value: { context: true },
    })
    const request = fixtureRequest(instruction, context)
    assert.throws(
      () => materializeOpenClawAgentMessage(root, {
        ...request,
        instruction_ref: { ...instruction, bytes: instruction.bytes + 1 },
      }),
      /drifted/,
    )
    assert.throws(
      () => storeOpenClawAgentOutput({
        repository_root: root,
        request,
        text: "[]",
      }),
      /not JSON|one JSON object/,
    )
    assert.throws(
      () => storeOpenClawAgentOutput({
        repository_root: root,
        request,
        text: "Result:\n```json\n{\"proposal\":\"bounded\"}\n```",
      }),
      /not JSON/,
    )
    assert.throws(
      () => storeOpenClawAgentOutput({
        repository_root: root,
        request,
        text: "{\"schema_version\":\"trade.wrong.v1\"}",
      }),
      /schema version drifted/,
    )
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

function fixtureRequest(
  instruction: AgentArtifactRef,
  context: AgentArtifactRef,
) {
  return buildAgentRunRequest({
    run_id: "openclaw-materializer-run",
    idempotency_key: "openclaw-materializer-key",
    trace_id: "openclaw-materializer-trace",
    task_profile: "planner",
    objective: "Return one bounded typed proposal.",
    source_revision: "0123456789abcdef",
    instruction_ref: instruction,
    input_refs: [context],
    output_schema_version: "trade.test-output.v1",
    capabilities: ["owner_read", "research_read"],
    budget: {
      deadline_at: "2026-07-23T13:00:00.000Z",
      max_wall_time_ms: 60_000,
      max_turns: 8,
      max_tool_calls: 12,
      max_input_bytes: 10_000,
      max_output_bytes: 10_000,
    },
    data_classification: "project_internal",
  })
}
