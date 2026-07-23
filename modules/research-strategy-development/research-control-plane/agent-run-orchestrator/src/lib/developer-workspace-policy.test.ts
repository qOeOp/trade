import assert from "node:assert/strict"
import test from "node:test"
import type { PreparedDeveloperAgentRun } from "./developer-agent-run"
import { resolveDeveloperWorkspacePolicy } from "./developer-workspace-policy"

test("Developer workspace policy maps family implementation gaps to closed owner packages", () => {
  const prepared = {
    execution_route: "workspace_host",
    context_pack: {
      capability_assessment: {
        required_mode: "code_change_required",
        reason_code: "replay_implementation_not_ready",
      },
    },
  } as PreparedDeveloperAgentRun
  const policy = resolveDeveloperWorkspacePolicy(prepared)
  assert.equal(policy.package_paths.length, 4)
  assert.deepEqual(policy.package_paths, policy.allowed_write_prefixes)
  assert.ok(policy.package_paths.every((path) => path.startsWith("modules/")))
  assert.equal(policy.domain_authority, "none")
  assert.throws(() => resolveDeveloperWorkspacePolicy({
    ...prepared,
    execution_route: "semantic_host",
  }), /no registered owner policy/)
})
