import type { Database } from "bun:sqlite"
import { canonicalHash } from "../../../../../contracts/runtime-core/src/canonical-json"
import type { JSONRecord } from "../../../../../contracts/runtime-core/src/json"
import {
  CONTROL_PLANE_IDENTITY_SCHEMA_VERSION,
  DRAFT_AUTHORIZATION_SCHEMA_VERSION,
  assertDraftStrategyAuthorization,
  type DraftStrategyAuthorization,
} from "../../../contracts/src/lib/control-plane-contracts"
import { hashIdentityPayload } from "../../../contracts/src/lib/research-identity-hash"
import {
  SOURCE_SCHEMA_VERSION,
  assertStrategyPolicySource,
  type StrategyPolicySource,
} from "../../../strategy-policy-writer/src/lib/strategy-policy-writer"
import type { MaterializeDraftStrategyInput } from "./strategy-registry"

export const DRAFT_STRATEGY_COMPILER_VERSION =
  "trade.rd-draft-strategy-compiler.v1" as const

interface SourceRow {
  decision_id: string
  reviewer_run_id: string
  decision_created_at: string
  rationale_ref: string
  experiment_id: string
  proposal_id: string
  proposal_revision: number
  hypothesis_id: string
  code_family_id: string
  trial_group_id: string
  trial_group_hash: string
  contract_hash: string
  identity_hash_policy_version: string
  lifecycle_state: string
  selected_candidate_id: string | null
  selected_trial_id: string | null
  candidate_hash: string | null
  candidate_frozen_at: string | null
  primary_result_id: string
  result_trial_id: string | null
  result_artifact_ref: string
  result_summary_json: string
  candidate_identity_hash: string
  parameter_assignment_json: string
  proposal_submission_json: string
  replay_request_json: string
}

export interface CompiledDraftStrategyInput extends MaterializeDraftStrategyInput {
  compiler_version: typeof DRAFT_STRATEGY_COMPILER_VERSION
  compiler_input_hash: string
}

export function compileDraftStrategyInput(
  db: Database,
  input: {
    decision_id: string
    strategy_root: string
  },
): CompiledDraftStrategyInput {
  assertDraftStrategyCompilerSourceSchema(db)
  const decisionId = identifier(input.decision_id, "decision_id")
  const strategyRoot = nonEmpty(input.strategy_root, "strategy_root")
  const row = readSource(db, decisionId)
  const selectedTrialId = nonEmpty(row.selected_trial_id, "selected_trial_id")
  const selectedCandidateId = nonEmpty(row.selected_candidate_id, "selected_candidate_id")
  const selectedCandidateHash = digest(row.candidate_hash, "candidate_hash")
  const candidateFrozenAt = utc(row.candidate_frozen_at, "candidate_frozen_at")
  if (row.lifecycle_state !== "draft_frozen"
      || row.result_trial_id !== selectedTrialId
      || row.candidate_identity_hash !== selectedCandidateHash) {
    throw new Error("accept_for_draft owner projection drifted")
  }
  const parameters = record(
    JSON.parse(row.parameter_assignment_json),
    "parameter_assignment_json",
  )
  if (hashIdentityPayload(parameters) !== selectedCandidateHash) {
    throw new Error("selected Candidate parameter identity drifted")
  }
  const summary = record(
    JSON.parse(row.result_summary_json),
    "result_summary_json",
  )
  const replayResult = record(summary.result, "formal Replay Result")
  if (replayResult.status !== "completed") {
    throw new Error("Draft Strategy requires a completed formal Replay Result")
  }
  const fingerprint = record(replayResult.fingerprint, "Replay Result fingerprint")
  const primaryResultHash = digest(
    fingerprint.result_hash,
    "primary_result_hash",
  )
  if (fingerprint.candidate_hash !== selectedCandidateHash
      || fingerprint.experiment_contract_hash !== row.contract_hash) {
    throw new Error("Replay Result fingerprint drifted from selected Candidate")
  }
  const authorization: DraftStrategyAuthorization = {
    schema_version: DRAFT_AUTHORIZATION_SCHEMA_VERSION,
    decision: "accept_for_draft",
    decision_id: row.decision_id,
    reviewer_run_id: row.reviewer_run_id,
    primary_result_id: row.primary_result_id,
    primary_result_hash: primaryResultHash,
    selected_trial_id: selectedTrialId,
    selected_candidate_id: selectedCandidateId,
    candidate_frozen_at: candidateFrozenAt,
    identity: {
      schema_version: CONTROL_PLANE_IDENTITY_SCHEMA_VERSION,
      experiment_id: row.experiment_id,
      trial_group_id: row.trial_group_id,
      trial_group_hash: digest(row.trial_group_hash, "trial_group_hash"),
      trial_id: selectedTrialId,
      candidate_id: selectedCandidateId,
      candidate_hash: selectedCandidateHash,
      identity_hash_policy_version: nonEmpty(
        row.identity_hash_policy_version,
        "identity_hash_policy_version",
      ),
      experiment_contract_hash: digest(row.contract_hash, "contract_hash"),
    },
  }
  assertDraftStrategyAuthorization(authorization)
  const plannerProposal = record(
    JSON.parse(row.proposal_submission_json),
    "Planner Proposal submission",
  )
  const replayRequest = record(
    JSON.parse(row.replay_request_json),
    "registered Replay Request",
  )
  if (plannerProposal.proposal_id !== row.proposal_id
      || plannerProposal.hypothesis_id !== row.hypothesis_id
      || replayRequest.experiment_id !== row.experiment_id
      || replayRequest.trial_id !== selectedTrialId
      || replayRequest.candidate_id !== selectedCandidateId) {
    throw new Error("Draft Strategy source lineage drifted")
  }
  const policySource: StrategyPolicySource = {
    schema_version: SOURCE_SCHEMA_VERSION,
    program_id: `control-plane:${row.experiment_id}`,
    objective: boundedText(plannerProposal.objective, "objective", 8_000),
    drafted_at: row.decision_created_at,
    evidence_refs: [row.result_artifact_ref, row.rationale_ref].sort(),
    candidate: {
      candidate_id: selectedCandidateId,
      family: nonEmpty(row.code_family_id, "code_family_id"),
      timeframe: boundedText(replayRequest.timeframe, "timeframe", 32),
      validation_run_ref: row.result_artifact_ref,
      params: parameters,
    },
  }
  assertStrategyPolicySource(policySource)
  const compilerInput = {
    compiler_version: DRAFT_STRATEGY_COMPILER_VERSION,
    decision_id: row.decision_id,
    reviewer_run_id: row.reviewer_run_id,
    experiment_id: row.experiment_id,
    proposal_id: row.proposal_id,
    proposal_revision: row.proposal_revision,
    primary_result_id: row.primary_result_id,
    selected_trial_id: selectedTrialId,
    selected_candidate_id: selectedCandidateId,
    selected_candidate_hash: selectedCandidateHash,
    authorization,
    policy_source: policySource,
  }
  const compilerInputHash = canonicalHash(compilerInput)
  return {
    compiler_version: DRAFT_STRATEGY_COMPILER_VERSION,
    compiler_input_hash: compilerInputHash,
    draft_id: `draft:${compilerInputHash.slice(0, 32)}`,
    strategy_version: `draft-${compilerInputHash.slice(0, 16)}`,
    idempotency_key: `strategy-registry:${row.decision_id}`,
    strategy_root: strategyRoot,
    created_at: row.decision_created_at,
    authorization,
    policy_source: policySource,
  }
}

export function assertDraftStrategyCompilerSourceSchema(db: Database): void {
  const required: Record<string, string[]> = {
    rd_review_decision: [
      "decision_id",
      "reviewer_run_id",
      "decision",
      "experiment_id",
      "rationale_ref",
      "created_at",
    ],
    rd_review_decision_result: [
      "decision_id",
      "result_id",
      "evidence_role",
    ],
    rd_experiment_contract: [
      "experiment_id",
      "proposal_id",
      "proposal_revision",
      "hypothesis_id",
      "code_family_id",
      "trial_group_id",
      "trial_group_hash",
      "contract_hash",
      "identity_hash_policy_version",
      "lifecycle_state",
      "selected_candidate_id",
      "selected_trial_id",
      "candidate_hash",
      "candidate_frozen_at",
    ],
    rd_experiment_result: [
      "result_id",
      "experiment_id",
      "trial_id",
      "run_id",
      "artifact_ref",
      "summary_json",
    ],
    rd_trial_group_candidate: [
      "trial_group_id",
      "candidate_id",
      "candidate_identity_hash",
      "parameter_assignment_json",
    ],
    rd_planner_proposal_revision: [
      "proposal_id",
      "proposal_revision",
      "submission_json",
    ],
    rd_replay_request_registration: [
      "trial_id",
      "run_id",
      "replay_request_json",
    ],
  }
  for (const [table, columns] of Object.entries(required)) {
    const actual = new Set(
      (db.query(`PRAGMA table_info(${table})`).all() as Array<{
        name: string
      }>).map((column) => column.name),
    )
    const missing = columns.filter((column) => !actual.has(column))
    if (missing.length > 0) {
      throw new Error(
        `Strategy Registry owner schema is missing ${table}.${missing.join(",")}`,
      )
    }
  }
}

function readSource(db: Database, decisionId: string): SourceRow {
  const row = db.query(`
    SELECT decision.decision_id, decision.reviewer_run_id,
           decision.created_at AS decision_created_at, decision.rationale_ref,
           experiment.experiment_id, experiment.proposal_id,
           experiment.proposal_revision, experiment.hypothesis_id,
           experiment.code_family_id, experiment.trial_group_id,
           experiment.trial_group_hash, experiment.contract_hash,
           experiment.identity_hash_policy_version, experiment.lifecycle_state,
           experiment.selected_candidate_id, experiment.selected_trial_id,
           experiment.candidate_hash, experiment.candidate_frozen_at,
           binding.result_id AS primary_result_id,
           result.trial_id AS result_trial_id,
           result.artifact_ref AS result_artifact_ref,
           result.summary_json AS result_summary_json,
           candidate.candidate_identity_hash,
           candidate.parameter_assignment_json,
           planner.submission_json AS proposal_submission_json,
           registration.replay_request_json
    FROM rd_review_decision AS decision
    JOIN rd_experiment_contract AS experiment
      ON experiment.experiment_id=decision.experiment_id
    JOIN rd_review_decision_result AS binding
      ON binding.decision_id=decision.decision_id
      AND binding.evidence_role='primary'
    JOIN rd_experiment_result AS result
      ON result.result_id=binding.result_id
      AND result.experiment_id=decision.experiment_id
    JOIN rd_trial_group_candidate AS candidate
      ON candidate.trial_group_id=experiment.trial_group_id
      AND candidate.candidate_id=experiment.selected_candidate_id
    JOIN rd_planner_proposal_revision AS planner
      ON planner.proposal_id=experiment.proposal_id
      AND planner.proposal_revision=experiment.proposal_revision
    JOIN rd_replay_request_registration AS registration
      ON registration.trial_id=experiment.selected_trial_id
      AND registration.run_id=result.run_id
    WHERE decision.decision_id=$decision_id
      AND decision.decision='accept_for_draft'
  `).get({ $decision_id: decisionId }) as SourceRow | null
  if (!row) throw new Error("accept_for_draft Registry source is missing")
  return row
}

function record(value: unknown, field: string): JSONRecord {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${field} must be an object`)
  }
  return value as JSONRecord
}

function identifier(value: unknown, field: string): string {
  if (typeof value !== "string"
      || !/^[A-Za-z0-9][A-Za-z0-9:._-]{0,159}$/.test(value)) {
    throw new Error(`${field} is invalid`)
  }
  return value
}

function nonEmpty(value: unknown, field: string): string {
  if (typeof value !== "string" || !value.trim()) {
    throw new Error(`${field} is required`)
  }
  return value.trim()
}

function boundedText(value: unknown, field: string, maximum: number): string {
  const text = nonEmpty(value, field)
  if (text.length > maximum) throw new Error(`${field} is too long`)
  return text
}

function digest(value: unknown, field: string): string {
  const text = nonEmpty(value, field)
  if (!/^[a-f0-9]{64}$/.test(text)) throw new Error(`${field} must be sha256`)
  return text
}

function utc(value: unknown, field: string): string {
  const text = nonEmpty(value, field)
  const date = new Date(text)
  if (!Number.isFinite(date.getTime()) || date.toISOString() !== text) {
    throw new Error(`${field} must be canonical UTC`)
  }
  return text
}
