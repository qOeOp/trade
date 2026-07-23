import type { AgentArtifactRef } from "../../../../../contracts/agent-run-contract/src/agent-run-contract"
import { canonicalNfcJson } from "../../../../../contracts/runtime-core/src/canonical-json"
import { canonicalControlPlaneHash } from "./control-plane-contracts"
import {
  assertDeveloperContractDraftSubmission,
  type DeveloperContractDraftSubmission,
} from "./developer-contract-draft"

export const DEVELOPER_AGENT_SUBMISSION_SCHEMA =
  "trade.rd-developer-agent-submission.v1" as const

export type DeveloperImplementationMode =
  | "existing_implementation"
  | "contract_only"
  | "code_change_required"
  | "data_blocked"
  | "tool_blocked"

export interface DeveloperCapabilityAssessment {
  implementation_mode: DeveloperImplementationMode
  reason_code: string
  required_capabilities: string[]
}

export interface DeveloperAgentSubmissionBody {
  schema_version: typeof DEVELOPER_AGENT_SUBMISSION_SCHEMA
  developer_run_id: string
  brief_id: string
  brief_hash: string
  source_revision: string
  draft_revision: number
  predecessor_run_id: string | null
  capability_assessment: DeveloperCapabilityAssessment
  contract_draft: DeveloperContractDraftSubmission | null
  workspace_patch: AgentArtifactRef | null
  quality_check_refs: AgentArtifactRef[]
  replay_diagnosis_refs: AgentArtifactRef[]
  created_at: string
}

export interface DeveloperAgentSubmission extends DeveloperAgentSubmissionBody {
  submission_hash: string
}

export function createDeveloperAgentSubmission(
  input: DeveloperAgentSubmissionBody,
): DeveloperAgentSubmission {
  if (input.schema_version !== DEVELOPER_AGENT_SUBMISSION_SCHEMA) {
    throw new Error("Developer Agent submission schema is unsupported")
  }
  const mode = implementationMode(input.capability_assessment.implementation_mode)
  const requiredCapabilities = input.capability_assessment.required_capabilities
    .map((item) => required(item, "required capability"))
    .sort()
  if (new Set(requiredCapabilities).size !== requiredCapabilities.length) {
    throw new Error("Developer required capabilities must be unique")
  }
  const assessment: DeveloperCapabilityAssessment = {
    implementation_mode: mode,
    reason_code: identifier(input.capability_assessment.reason_code, "reason_code"),
    required_capabilities: requiredCapabilities,
  }
  const draft = input.contract_draft == null ? null : structuredClone(input.contract_draft)
  if (draft) assertDeveloperContractDraftSubmission(draft)
  const patch = input.workspace_patch == null ? null : artifactRef(input.workspace_patch, "workspace_patch")
  const checks = artifactRefs(input.quality_check_refs, "quality_check_refs")
  const diagnoses = artifactRefs(input.replay_diagnosis_refs, "replay_diagnosis_refs")
  const blocked = mode === "data_blocked" || mode === "tool_blocked"
  if (blocked && (draft || patch || checks.length > 0)) {
    throw new Error("blocked Developer submission cannot carry a draft, patch, or quality checks")
  }
  if (mode === "code_change_required" && (!patch || checks.length === 0)) {
    throw new Error("code_change_required requires a patch and quality check evidence")
  }
  if (mode === "code_change_required" && draft) {
    throw new Error("code_change_required cannot draft a Contract before the patch is landed")
  }
  if (!blocked && mode !== "code_change_required" && !draft) {
    throw new Error("semantic Developer submission requires a contract draft")
  }
  if (mode !== "code_change_required" && patch) {
    throw new Error("only code_change_required may carry a workspace patch")
  }
  if (patch && patch.media_type !== "text/x-diff") throw new Error("workspace patch must be text/x-diff")
  if (checks.some((ref) => ref.media_type !== "application/json")) {
    throw new Error("quality checks must be JSON artifacts")
  }
  if (diagnoses.some((ref) => ref.media_type !== "application/json")) {
    throw new Error("Replay diagnoses must be JSON artifacts")
  }
  const body: DeveloperAgentSubmissionBody = {
    schema_version: DEVELOPER_AGENT_SUBMISSION_SCHEMA,
    developer_run_id: identifier(input.developer_run_id, "developer_run_id"),
    brief_id: identifier(input.brief_id, "brief_id"),
    brief_hash: digest(input.brief_hash, "brief_hash"),
    source_revision: revision(input.source_revision),
    draft_revision: positiveInteger(input.draft_revision, "draft_revision"),
    predecessor_run_id: input.predecessor_run_id == null
      ? null
      : identifier(input.predecessor_run_id, "predecessor_run_id"),
    capability_assessment: assessment,
    contract_draft: draft,
    workspace_patch: patch,
    quality_check_refs: checks,
    replay_diagnosis_refs: diagnoses,
    created_at: utc(input.created_at, "created_at"),
  }
  if (draft && (draft.developer_run_id !== body.developer_run_id
    || draft.brief_id !== body.brief_id
    || draft.brief_hash !== body.brief_hash
    || draft.draft_revision !== body.draft_revision)) {
    throw new Error("Developer contract draft identity drifted from Agent submission")
  }
  return { ...body, submission_hash: canonicalControlPlaneHash(body) }
}

export function assertDeveloperAgentSubmission(value: DeveloperAgentSubmission): void {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Developer Agent submission must be an object")
  }
  const { submission_hash: _submissionHash, ...body } = value
  const expected = createDeveloperAgentSubmission(body)
  if (canonicalNfcJson(value) !== canonicalNfcJson(expected)) {
    throw new Error("Developer Agent submission is non-canonical or hash-drifted")
  }
}

function artifactRefs(values: AgentArtifactRef[], field: string): AgentArtifactRef[] {
  if (!Array.isArray(values) || values.length > 32) throw new Error(`${field} must be a bounded array`)
  const refs = values.map((value, index) => artifactRef(value, `${field}[${index}]`))
  if (new Set(refs.map((ref) => `${ref.ref}:${ref.sha256}`)).size !== refs.length) {
    throw new Error(`${field} must be unique`)
  }
  return refs.sort((left, right) => left.ref.localeCompare(right.ref))
}

function artifactRef(value: AgentArtifactRef, field: string): AgentArtifactRef {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`${field} must be an artifact ref`)
  if (!/^[a-f0-9]{64}$/.test(value.sha256)) throw new Error(`${field}.sha256 is invalid`)
  if (!Number.isSafeInteger(value.bytes) || value.bytes < 0 || value.bytes > 16 * 1024 * 1024) {
    throw new Error(`${field}.bytes is invalid`)
  }
  if (!["application/json", "text/markdown", "text/x-diff", "text/plain"].includes(value.media_type)) {
    throw new Error(`${field}.media_type is invalid`)
  }
  const ref = required(value.ref, `${field}.ref`)
  if (ref.startsWith("/") || ref.split("/").includes("..")) throw new Error(`${field}.ref is unsafe`)
  return { ref, sha256: value.sha256, media_type: value.media_type, bytes: value.bytes }
}

function implementationMode(value: string): DeveloperImplementationMode {
  if (!["existing_implementation", "contract_only", "code_change_required", "data_blocked", "tool_blocked"].includes(value)) {
    throw new Error("Developer implementation mode is unsupported")
  }
  return value as DeveloperImplementationMode
}

function required(value: string, field: string): string {
  const normalized = value?.trim()
  if (!normalized) throw new Error(`${field} is required`)
  return normalized
}

function identifier(value: string, field: string): string {
  const normalized = required(value, field)
  if (!/^[A-Za-z0-9][A-Za-z0-9._:-]{0,159}$/.test(normalized)) throw new Error(`${field} is invalid`)
  return normalized
}

function digest(value: string, field: string): string {
  const normalized = required(value, field)
  if (!/^[a-f0-9]{64}$/.test(normalized)) throw new Error(`${field} must be lowercase SHA-256`)
  return normalized
}

function revision(value: string): string {
  const normalized = required(value, "source_revision")
  if (!/^[A-Za-z0-9][A-Za-z0-9._+-]{0,127}$/.test(normalized)) throw new Error("source_revision is invalid")
  return normalized
}

function positiveInteger(value: number, field: string): number {
  if (!Number.isSafeInteger(value) || value < 1) throw new Error(`${field} must be a positive integer`)
  return value
}

function utc(value: string, field: string): string {
  const date = new Date(value)
  if (!Number.isFinite(date.getTime()) || date.toISOString() !== value) throw new Error(`${field} must be canonical UTC`)
  return value
}
