import type { PreparedDeveloperAgentRun } from "./developer-agent-run"

export interface DeveloperWorkspacePolicy {
  schema_version: "trade.rd-developer-workspace-policy.v1"
  policy_id: "rd-family-capability-implementation-v1"
  allowed_write_prefixes: string[]
  package_paths: string[]
  domain_authority: "none"
}

const FAMILY_ENGINE =
  "modules/research-strategy-development/agent-roles/developer/strategy-family-engine"
const CAPABILITY_CONTRACT =
  "modules/contracts/rd-agent-capability-contract"
const STATE_STORE =
  "modules/research-strategy-development/research-control-plane/state-store"
const INTEGRATION_SUITE =
  "modules/research-strategy-development/research-control-plane/certification/legacy-integration-suite"

export function resolveDeveloperWorkspacePolicy(
  prepared: PreparedDeveloperAgentRun,
): DeveloperWorkspacePolicy {
  const assessment = prepared.context_pack.capability_assessment
  if (prepared.execution_route !== "workspace_host"
    || assessment.required_mode !== "code_change_required"
    || ![
      "family_implementation_missing",
      "replay_implementation_not_ready",
    ].includes(assessment.reason_code)) {
    throw new Error("Developer workspace gap has no registered owner policy")
  }
  return {
    schema_version: "trade.rd-developer-workspace-policy.v1",
    policy_id: "rd-family-capability-implementation-v1",
    allowed_write_prefixes: [
      CAPABILITY_CONTRACT,
      FAMILY_ENGINE,
      INTEGRATION_SUITE,
      STATE_STORE,
    ].sort(),
    package_paths: [
      CAPABILITY_CONTRACT,
      FAMILY_ENGINE,
      INTEGRATION_SUITE,
      STATE_STORE,
    ].sort(),
    domain_authority: "none",
  }
}
