import type { AgentArtifactRef } from "../../../../../contracts/agent-run-contract/src/agent-run-contract"
import type { JSONRecord } from "../../../../../contracts/runtime-core/src/json"
import {
  boundedInteger,
  identifier,
  nullableIdentifier,
  parseAgentCycleCommon,
  stringValue,
  type AgentCycleCommonInput,
} from "./agent-cycle-cli"
import {
  createDeveloperDataSnapshotBinding,
  type DeveloperDataSnapshotBinding,
} from "./developer-capability-assessment"

export interface DeveloperAgentCycleInput extends AgentCycleCommonInput {
  proposal_id: string
  proposal_revision: number
  brief_id: string
  predecessor_run_id: string | null
  replay_result_refs: AgentArtifactRef[]
  data_snapshot_binding: DeveloperDataSnapshotBinding | null
}

export function parseDeveloperAgentCycleInput(
  value: JSONRecord,
): DeveloperAgentCycleInput {
  return {
    ...parseAgentCycleCommon(value, 30),
    proposal_id: identifier(value.proposal_id, "proposal_id"),
    proposal_revision: boundedInteger(
      value.proposal_revision,
      1,
      1_000_000,
      "proposal_revision",
    ),
    brief_id: identifier(value.brief_id, "brief_id"),
    predecessor_run_id: nullableIdentifier(
      value.predecessor_run_id,
      "predecessor_run_id",
    ),
    replay_result_refs: artifactRefs(value.replay_result_refs),
    data_snapshot_binding: dataSnapshotBinding(value.data_snapshot_binding),
  }
}

function dataSnapshotBinding(value: unknown): DeveloperDataSnapshotBinding | null {
  if (value == null) return null
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("data_snapshot_binding must be an object")
  }
  return createDeveloperDataSnapshotBinding(value as DeveloperDataSnapshotBinding)
}

function artifactRefs(value: unknown): AgentArtifactRef[] {
  if (value == null) return []
  if (!Array.isArray(value) || value.length > 32) {
    throw new Error("replay_result_refs must be a bounded array")
  }
  return value.map((item, index) => {
    if (!item || typeof item !== "object" || Array.isArray(item)) {
      throw new Error(`replay_result_refs[${index}] is invalid`)
    }
    const ref = item as Record<string, unknown>
    const path = stringValue(ref.ref)
    const sha256 = stringValue(ref.sha256)
    const mediaType = stringValue(ref.media_type)
    const bytes = Number(ref.bytes)
    if (!path || path.startsWith("/") || path.split("/").includes("..")
      || !/^[a-f0-9]{64}$/.test(sha256)
      || !["application/json", "text/markdown", "text/x-diff", "text/plain"].includes(mediaType)
      || !Number.isSafeInteger(bytes) || bytes < 0 || bytes > 16 * 1024 * 1024) {
      throw new Error(`replay_result_refs[${index}] is invalid`)
    }
    return {
      ref: path,
      sha256,
      media_type: mediaType as AgentArtifactRef["media_type"],
      bytes,
    }
  })
}
