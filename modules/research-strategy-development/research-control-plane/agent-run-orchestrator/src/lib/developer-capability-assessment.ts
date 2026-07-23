import { canonicalHash } from "../../../../../contracts/runtime-core/src/canonical-json"
import type { JSONRecord } from "../../../../../contracts/runtime-core/src/json"
import {
  assessCandidateSpaceCompatibility,
  createDeveloperDataSnapshotBinding,
  readStrategyFamilyCapability,
  type CandidateSpaceCompatibility,
  type DeveloperDataSnapshotBinding,
  type StrategyFamilyCapability,
} from "../../../../../contracts/rd-agent-capability-contract/src/rd-agent-capability-contract"
import type { DeveloperDevelopmentBrief } from "../../../contracts/src/lib/developer-contract-draft"

export {
  createDeveloperDataSnapshotBinding,
  DEVELOPER_DATA_SNAPSHOT_BINDING_SCHEMA_VERSION,
  type DeveloperDataSnapshotBinding,
} from "../../../../../contracts/rd-agent-capability-contract/src/rd-agent-capability-contract"
export const DEVELOPER_CAPABILITY_ASSESSMENT_SCHEMA_VERSION =
  "trade.rd-developer-capability-assessment.v1" as const

export interface DeveloperCapabilityAssessmentBody extends JSONRecord {
  schema_version: typeof DEVELOPER_CAPABILITY_ASSESSMENT_SCHEMA_VERSION
  canonical_node_id: string
  source_revision: string
  family_capability: StrategyFamilyCapability | null
  candidate_space_compatibility: CandidateSpaceCompatibility | null
  data_snapshot_binding: DeveloperDataSnapshotBinding | null
  required_mode: "existing_implementation" | "data_blocked" | "tool_blocked"
  reason_code: string
  required_capabilities: string[]
}

export interface DeveloperCapabilityAssessment extends DeveloperCapabilityAssessmentBody {
  assessment_hash: string
}

export function createDeveloperCapabilityAssessment(input: {
  brief: DeveloperDevelopmentBrief
  source_revision: string
  data_snapshot_binding?: DeveloperDataSnapshotBinding | null
}): DeveloperCapabilityAssessment {
  const family = readStrategyFamilyCapability(input.brief.universe_node_id)
  const compatibility = family
    ? assessCandidateSpaceCompatibility(input.brief.candidate_space, family)
    : null
  const binding = input.data_snapshot_binding ?? null
  if (binding) {
    const rebuilt = createDeveloperDataSnapshotBinding(binding)
    if (rebuilt.binding_hash !== binding.binding_hash) {
      throw new Error("Developer data snapshot binding is non-canonical or hash-drifted")
    }
    if (!sameStrings(binding.dataset_kinds, input.brief.dataset_requirements)) {
      throw new Error("Developer data snapshot binding does not satisfy Brief data requirements")
    }
    if (binding.hypothesis_id !== input.brief.hypothesis_id) {
      throw new Error("Developer data snapshot binding belongs to another hypothesis")
    }
  }

  let requiredMode: DeveloperCapabilityAssessment["required_mode"]
  let reasonCode: string
  let requiredCapabilities: string[]
  if (!family) {
    requiredMode = "tool_blocked"
    reasonCode = "family_implementation_missing"
    requiredCapabilities = ["family_implementation"]
  } else if (family.replay_coverage !== "ready") {
    requiredMode = "tool_blocked"
    reasonCode = "replay_implementation_not_ready"
    requiredCapabilities = [`family:${family.family_id}`, "replay_implementation"]
  } else if (!sameStrings(family.required_data, input.brief.dataset_requirements)) {
    requiredMode = "tool_blocked"
    reasonCode = "family_data_contract_mismatch"
    requiredCapabilities = [`family:${family.family_id}`, "proposal_revision"]
  } else if (!compatibility?.compatible) {
    requiredMode = "tool_blocked"
    reasonCode = "candidate_space_incompatible"
    requiredCapabilities = [`family:${family.family_id}`, "proposal_revision"]
  } else if (!binding) {
    requiredMode = "data_blocked"
    reasonCode = "dataset_snapshot_binding_missing"
    requiredCapabilities = [`family:${family.family_id}`, "dataset_snapshot"]
  } else {
    requiredMode = "existing_implementation"
    reasonCode = "existing_replay_implementation_and_data_ready"
    requiredCapabilities = [`family:${family.family_id}`, "replay_implementation", "dataset_snapshot"]
  }

  const body: DeveloperCapabilityAssessmentBody = {
    schema_version: DEVELOPER_CAPABILITY_ASSESSMENT_SCHEMA_VERSION,
    canonical_node_id: input.brief.universe_node_id,
    source_revision: revision(input.source_revision),
    family_capability: family,
    candidate_space_compatibility: compatibility,
    data_snapshot_binding: binding,
    required_mode: requiredMode,
    reason_code: reasonCode,
    required_capabilities: [...requiredCapabilities].sort(),
  }
  return { ...body, assessment_hash: canonicalHash(body) }
}

function sameStrings(left: string[], right: string[]): boolean {
  return JSON.stringify([...left].sort()) === JSON.stringify([...right].sort())
}

function revision(value: string): string {
  const normalized = nonempty(value, "source_revision")
  if (!/^[A-Za-z0-9][A-Za-z0-9._+-]{0,127}$/.test(normalized)) {
    throw new Error("source_revision is invalid")
  }
  return normalized
}

function nonempty(value: string, field: string): string {
  if (typeof value !== "string" || !value.trim() || value.trim() !== value) {
    throw new Error(`${field} is required`)
  }
  return value
}
