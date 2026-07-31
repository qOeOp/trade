import { createHash } from "node:crypto"
import assert from "node:assert/strict"
import test from "node:test"
import { buildAgentRunRequest } from "../../../../contracts/agent-run-contract/src/agent-run-contract"
import {
  buildCodexAgentRunWirePlan,
  normalizeCodexNotification,
  type MaterializedAgentArtifact,
} from "./codex-agent-run-mapping"

test("Agent Run maps to ephemeral Codex thread with profile sandbox and no provider pin", () => {
  const fixture = runFixture("developer")
  const plan = buildCodexAgentRunWirePlan(fixture.request, fixture.materialization)
  assert.equal(plan.thread_start.sandbox, "workspace-write")
  assert.equal(plan.thread_start.approvalPolicy, "never")
  assert.equal(plan.thread_start.ephemeral, true)
  assert.equal(Object.hasOwn(plan.thread_start, "model"), false)
  assert.equal(Object.hasOwn(plan.thread_start, "modelProvider"), false)
  const turn = plan.turn_start("thread-1")
  assert.deepEqual((turn.sandboxPolicy as Record<string, unknown>).writableRoots, [fixture.materialization.workspace_root])
  assert.equal((turn.sandboxPolicy as Record<string, unknown>).networkAccess, false)
})

test("Host framing is bounded separately from immutable input artifact bytes", () => {
  const fixture = runFixture("planner")
  const {
    schema_version: _schemaVersion,
    request_hash: _requestHash,
    domain_authority: _domainAuthority,
    ...source
  } = fixture.request
  const exact = buildAgentRunRequest({
    ...source,
    budget: {
      ...fixture.request.budget,
      max_input_bytes: fixture.request.instruction_ref.bytes
        + fixture.request.input_refs.reduce((sum, ref) => sum + ref.bytes, 0),
    },
  })
  const plan = buildCodexAgentRunWirePlan(exact, fixture.materialization)
  assert.equal(plan.turn_start("thread-exact").threadId, "thread-exact")
})

test("read-only roles cannot receive workspace-write and Developer must use isolated workspace", () => {
  const planner = runFixture("planner")
  const plan = buildCodexAgentRunWirePlan(planner.request, planner.materialization)
  assert.equal(plan.thread_start.sandbox, "read-only")
  assert.equal((plan.turn_start("thread-1").sandboxPolicy as Record<string, unknown>).type, "readOnly")
  const developer = runFixture("developer")
  assert.throws(() => buildCodexAgentRunWirePlan(developer.request, {
    ...developer.materialization,
    workspace_root: "/repo/snapshot",
  }), /requires tmp\/agent-workspaces/)
})

test("materialized refs verify bytes, hash, count, and secret-like content", () => {
  const fixture = runFixture("planner")
  assert.throws(() => buildCodexAgentRunWirePlan(fixture.request, {
    ...fixture.materialization,
    instruction: { ...fixture.materialization.instruction, text: "drift" },
  }), /bytes or hash drifted/)
  assert.throws(() => buildCodexAgentRunWirePlan(fixture.request, {
    ...fixture.materialization,
    inputs: [],
  }), /input count drifted/)
})

test("Codex notifications become sanitized Agent Run events and reasoning is dropped", () => {
  const { request } = runFixture("planner")
  const started = normalizeCodexNotification({
    request,
    sequence: 2,
    observed_at: "2026-07-23T08:00:00.000Z",
    method: "item/started",
    params: { item: { type: "commandExecution", id: "item-1", command: "secret command" } },
  })
  assert.equal(started?.kind, "tool_started")
  assert.equal(started?.operation_ref, "codex-item://item-1")
  assert.equal(JSON.stringify(started).includes("secret command"), false)
  assert.equal(normalizeCodexNotification({
    request,
    sequence: 3,
    observed_at: "2026-07-23T08:00:00.000Z",
    method: "item/reasoning/textDelta",
    params: { delta: "private reasoning" },
  }), null)
  const terminal = normalizeCodexNotification({
    request,
    sequence: 3,
    observed_at: "2026-07-23T08:00:02.000Z",
    method: "turn/completed",
    params: { turn: { status: "failed", error: { codexErrorInfo: "serverOverloaded", message: "raw" } } },
  })
  assert.equal(terminal?.status, "failed")
  assert.equal(terminal?.failure_class, "provider_unavailable")
  assert.equal(JSON.stringify(terminal).includes("raw"), false)
})

function runFixture(profile: "planner" | "developer") {
  const instruction = materialized("artifact://instruction", "Follow the typed role contract.")
  const context = materialized("artifact://context", "{\"program\":\"rd-program\"}", "application/json")
  const request = buildAgentRunRequest({
    run_id: `agent-run-${profile}`,
    idempotency_key: `rd:${profile}:1`,
    trace_id: `trace-${profile}-1`,
    task_profile: profile,
    objective: "Return one bounded typed proposal.",
    source_revision: "a2089f8197d3",
    instruction_ref: instruction.artifact,
    input_refs: [context.artifact],
    output_schema_version: "trade.test-output.v1",
    capabilities: profile === "developer"
      ? ["owner_read", "research_read", "workspace_read", "workspace_patch", "bounded_quality_check"]
      : ["owner_read", "research_read"],
    budget: {
      deadline_at: "2026-07-23T09:00:00.000Z",
      max_wall_time_ms: 60_000,
      max_turns: 8,
      max_tool_calls: 12,
      max_input_bytes: 10_000,
      max_output_bytes: 10_000,
    },
    data_classification: "project_internal",
  })
  const workspace = profile === "developer" ? `/repo/tmp/agent-workspaces/${request.run_id}` : "/repo/tmp/agent-snapshots/read-only"
  return {
    request,
    materialization: {
      repo_root: "/repo",
      workspace_root: workspace,
      instruction,
      inputs: [context],
    },
  }
}

function materialized(
  ref: string,
  text: string,
  media_type: MaterializedAgentArtifact["artifact"]["media_type"] = "text/markdown",
): MaterializedAgentArtifact {
  const bytes = Buffer.from(text)
  return {
    artifact: {
      ref,
      sha256: createHash("sha256").update(bytes).digest("hex"),
      media_type,
      bytes: bytes.byteLength,
    },
    text,
  }
}
