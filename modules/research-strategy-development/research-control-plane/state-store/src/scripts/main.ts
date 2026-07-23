#!/usr/bin/env bun

import { Database } from "bun:sqlite"
import {
  buildRdHoldoutUse,
  buildRdHypothesis,
  buildRdLesson,
  buildRdProgram,
  buildRdTrial,
  ensureResearchStateSchema,
  readRdProgram,
  recordRdHoldoutUse,
  recordRdLesson,
  recordRdTrial,
  upsertRdHypothesis,
  upsertRdProgram,
} from "../lib/research-state-store"
import { numberField, stringField, type JSONRecord } from "../../../../../contracts/runtime-core/src/json"
import { readDbActionJsonArgs, type DbActionJsonArgs } from "../../../../../contracts/runtime-core/src/script-json"
import { buildDatabaseIdentity, ensureDatabaseIdentity } from "../../../../../contracts/runtime-core/src/database-identity"
import { displayPath } from "../../../../../contracts/runtime-core/src/paths"
import {
  applyReviewerDecision,
  appendProposalRevision,
  materializeProposal,
  materializeGeneratedCandidate,
  registerExperiment,
  registerTrialGroup,
  transitionTrialGroup,
  type ExperimentRegistrationWrite,
  type ProposalRevisionWrite,
  type ReviewerDecisionWrite,
  type TrialGroupWrite,
} from "../lib/research-control-plane"
import {
  appendExperimentResult,
  appendResearchLesson,
  applySystemTransition,
  assertLifecycleProjection,
  linkUniverseDataSurface,
  openBlockerAndTransition,
  readPlannerControlPlaneContext,
  rebuildLifecycleProjection,
  resolveBlockerAndTransition,
  finishTrial,
  reserveTrial,
  seedUniverse,
  upsertDataSurface,
  upsertPipelineRegistryItem,
  upsertUniverseCoverage,
  type ExperimentResultWrite,
  type TrialReservation,
  type UniverseSeed,
} from "../lib/research-control-plane-operations"
import { seedDefaultResearchControlPlane } from "../lib/research-universe-default-seed"
import { admitPlannerProposal, readPlannerProposalAdmission } from "../lib/planner-proposal-intake"
import type { PlannerProposalIntakeRequest } from "../../../contracts/src/lib/planner-proposal-submission"
import {
  issueDeveloperDevelopmentBrief,
  readDeveloperContractDraftReceipt,
  readDeveloperDevelopmentBrief,
  receiveDeveloperContractDraft,
} from "../lib/developer-contract-draft-intake"
import type {
  DeveloperContractDraftIntakeRequest,
  DeveloperDevelopmentBriefIssueRequest,
} from "../../../contracts/src/lib/developer-contract-draft"
import {
  readDeveloperContractDraftValidation,
  validateDeveloperContractDraft,
} from "../lib/developer-contract-draft-validation"
import type { DeveloperContractDraftValidationRequest } from "../../../contracts/src/lib/developer-contract-draft-validation"
import {
  freezeDeveloperExperimentContract,
  readDeveloperContractFreeze,
} from "../lib/developer-contract-freeze"
import type { DeveloperContractFreezeRequest } from "../../../contracts/src/lib/developer-contract-freeze"
import {
  readExperimentTrialPlan,
  startExperimentTrialPlan,
} from "../lib/experiment-trial-plan"
import type { ExperimentTrialPlanRequest } from "../../../contracts/src/lib/experiment-trial-plan"
import {
  admitReplayTrialReservation,
  readReplayTrialReservationAdmission,
} from "../lib/replay-trial-reservation-admission"
import type { ReplayTrialReservationAdmissionRequest } from "../../../contracts/src/lib/replay-trial-reservation-admission"
import {
  readReplayRequestRegistration,
  registerReplayExecutionRequest,
} from "../lib/replay-request-registration"
import type { ReplayRequestRegistrationRequest } from "../../../contracts/src/lib/replay-request-registration"
import {
  executeReplayL2ExperimentAttachmentOwnerAction,
  isReplayL2ExperimentAttachmentOwnerAction,
} from "../lib/replay-l2-experiment-attachment-owner-port"
import {
  readEvaluationEvidenceClassification,
  registerEvaluationEvidenceClassification,
} from "../lib/evaluation-evidence-classification"
import type {
  EvaluationEvidenceClassification,
} from "../../../contracts/src/lib/evaluation-evidence-classification"
import { buildPlannerProposal } from "../../../../agent-roles/planner/src/lib/planner-role"
import { buildDeveloperContractDraftSubmission } from "../../../../agent-roles/developer/src/lib/developer-role"
import {
  createDeveloperAgentSubmission,
  DEVELOPER_AGENT_SUBMISSION_SCHEMA,
  type DeveloperImplementationMode,
} from "../../../contracts/src/lib/developer-agent-submission"

type Args = DbActionJsonArgs

export function parseArgs(argv: string[]): Args {
  return readDbActionJsonArgs(argv, { dbPath: "data/rd_state.db" }, printHelp)
}

export function run(args: Args): JSONRecord {
  const db = new Database(args.dbPath)
  try {
    ensureDatabaseIdentity(db, buildDatabaseIdentity(args.environmentId, "research_state_store"), { allowLegacyMigration: args.migrateIdentity })
    ensureResearchStateSchema(db)
    if (args.action === "init") {
      return { ok: true, action: "init", db: displayPath(args.dbPath), environment_id: args.environmentId, store_id: "research_state_store" }
    }
    if (args.action === "upsert_program") {
      const program = buildRdProgram(args.json)
      upsertRdProgram(db, program)
      return { ok: true, action: args.action, program }
    }
    if (args.action === "upsert_hypothesis") {
      const hypothesis = buildRdHypothesis(args.json)
      upsertRdHypothesis(db, hypothesis)
      return { ok: true, action: args.action, hypothesis }
    }
    if (args.action === "record_trial") {
      const trial = buildRdTrial(args.json)
      recordRdTrial(db, trial)
      return { ok: true, action: args.action, trial }
    }
    if (args.action === "record_holdout_use") {
      const holdout_use = buildRdHoldoutUse(args.json)
      recordRdHoldoutUse(db, holdout_use)
      return { ok: true, action: args.action, holdout_use }
    }
    if (args.action === "record_lesson") {
      const lesson = buildRdLesson(args.json)
      recordRdLesson(db, lesson)
      return { ok: true, action: args.action, lesson }
    }
    if (args.action === "read_program") {
      return { ok: true, action: args.action, program: readRdProgram(db, stringField(args.json.program_id)) }
    }
    if (args.action === "append_proposal_revision") {
      appendProposalRevision(db, args.json as unknown as ProposalRevisionWrite)
      return { ok: true, action: args.action, proposal_id: args.json.proposal_id, revision: args.json.revision }
    }
    if (args.action === "admit_planner_proposal") {
      const admission = admitPlannerProposal(db, args.json as unknown as PlannerProposalIntakeRequest)
      return { ok: true, action: args.action, admission }
    }
    if (args.action === "prepare_planner_proposal") {
      const proposal = buildPlannerProposal({
        proposal_id: stringField(args.json.proposal_id),
        hypothesis_id: stringField(args.json.hypothesis_id),
        universe_node_id: stringField(args.json.universe_node_id),
        objective: stringField(args.json.objective),
        dataset_requirements: stringArray(args.json.dataset_requirements),
        candidate_space: asRecord(args.json.candidate_space),
        trial_budget: numberField(args.json.trial_budget),
        evaluation_protocol_ref: stringField(args.json.evaluation_protocol_ref),
        control_plane_context: readPlannerControlPlaneContext(db),
        created_at: stringField(args.json.created_at),
      })
      return { ok: true, action: args.action, proposal }
    }
    if (args.action === "prepare_developer_agent_submission") {
      const mode = stringField(args.json.implementation_mode) as DeveloperImplementationMode
      const brief = readDeveloperDevelopmentBrief(db, stringField(args.json.brief_id))
      const blocked = mode === "data_blocked" || mode === "tool_blocked"
      const developerRunId = stringField(args.json.developer_run_id)
      const draftRevision = numberField(args.json.draft_revision)
      const createdAt = stringField(args.json.requested_at)
      const proposedDraft = asRecord(args.json.draft_json)
      const ownerBoundDraft: JSONRecord = {
        ...proposedDraft,
        schema_version: "trade.rd-experiment-contract-draft-payload.v1",
        canonical_node_id: brief.universe_node_id,
        required_data: brief.dataset_requirements,
        candidate_space: brief.candidate_space,
      }
      const contractDraft = blocked
        ? null
        : buildDeveloperContractDraftSubmission({
            brief,
            developer_run_id: developerRunId,
            draft_revision: draftRevision,
            requested_trial_budget: numberField(args.json.requested_trial_budget),
            draft_json: ownerBoundDraft,
            created_at: createdAt,
          })
      const submission = createDeveloperAgentSubmission({
        schema_version: DEVELOPER_AGENT_SUBMISSION_SCHEMA,
        developer_run_id: developerRunId,
        brief_id: brief.brief_id,
        brief_hash: brief.brief_hash,
        source_revision: stringField(args.json.source_revision),
        draft_revision: draftRevision,
        predecessor_run_id: nullableString(args.json.predecessor_run_id),
        capability_assessment: {
          implementation_mode: mode,
          reason_code: stringField(args.json.reason_code),
          required_capabilities: stringArray(args.json.required_capabilities),
        },
        contract_draft: contractDraft,
        workspace_patch: null,
        quality_check_refs: [],
        replay_diagnosis_refs: [],
        created_at: createdAt,
      })
      return { ok: true, action: args.action, submission }
    }
    if (args.action === "read_planner_proposal_admission") {
      const admission = readPlannerProposalAdmission(
        db,
        stringField(args.json.proposal_id),
        numberField(args.json.proposal_revision),
      )
      return { ok: true, action: args.action, admission }
    }
    if (args.action === "issue_developer_development_brief") {
      const brief = issueDeveloperDevelopmentBrief(
        db,
        args.json as unknown as DeveloperDevelopmentBriefIssueRequest,
      )
      return { ok: true, action: args.action, brief }
    }
    if (args.action === "read_developer_development_brief") {
      const brief = readDeveloperDevelopmentBrief(db, stringField(args.json.brief_id))
      return { ok: true, action: args.action, brief }
    }
    if (args.action === "receive_developer_contract_draft") {
      const receipt = receiveDeveloperContractDraft(
        db,
        args.json as unknown as DeveloperContractDraftIntakeRequest,
      )
      return { ok: true, action: args.action, receipt }
    }
    if (args.action === "read_developer_contract_draft_receipt") {
      const receipt = readDeveloperContractDraftReceipt(
        db,
        stringField(args.json.brief_id),
        numberField(args.json.draft_revision),
      )
      return { ok: true, action: args.action, receipt }
    }
    if (args.action === "validate_developer_contract_draft") {
      const validation = validateDeveloperContractDraft(
        db,
        args.json as unknown as DeveloperContractDraftValidationRequest,
      )
      return { ok: true, action: args.action, validation }
    }
    if (args.action === "read_developer_contract_draft_validation") {
      const validation = readDeveloperContractDraftValidation(db, stringField(args.json.validation_id))
      return { ok: true, action: args.action, validation }
    }
    if (args.action === "freeze_developer_experiment_contract") {
      const freeze = freezeDeveloperExperimentContract(
        db,
        args.json as unknown as DeveloperContractFreezeRequest,
      )
      return { ok: true, action: args.action, freeze }
    }
    if (args.action === "read_developer_contract_freeze") {
      const freeze = readDeveloperContractFreeze(db, stringField(args.json.freeze_id))
      return { ok: true, action: args.action, freeze }
    }
    if (args.action === "start_experiment_trial_plan") {
      const plan = startExperimentTrialPlan(db, args.json as unknown as ExperimentTrialPlanRequest)
      return { ok: true, action: args.action, plan }
    }
    if (args.action === "read_experiment_trial_plan") {
      const plan = readExperimentTrialPlan(db, stringField(args.json.plan_id))
      return { ok: true, action: args.action, plan }
    }
    if (args.action === "admit_replay_trial_reservation") {
      const admission = admitReplayTrialReservation(
        db,
        args.json as unknown as ReplayTrialReservationAdmissionRequest,
      )
      return { ok: true, action: args.action, admission }
    }
    if (args.action === "read_replay_trial_reservation_admission") {
      const admission = readReplayTrialReservationAdmission(db, stringField(args.json.admission_id))
      return { ok: true, action: args.action, admission }
    }
    if (args.action === "register_replay_execution_request") {
      const registration = registerReplayExecutionRequest(
        db,
        args.json as unknown as ReplayRequestRegistrationRequest,
      )
      return { ok: true, action: args.action, registration }
    }
    if (args.action === "read_replay_request_registration") {
      const registration = readReplayRequestRegistration(db, stringField(args.json.registration_id))
      return { ok: true, action: args.action, registration }
    }
    if (args.action === "seed_universe") {
      seedUniverse(db, args.json as unknown as UniverseSeed)
      return { ok: true, action: args.action, node_count: Array.isArray(args.json.nodes) ? args.json.nodes.length : 0 }
    }
    if (args.action === "seed_default_control_plane") {
      const now = stringField(args.json.now)
      const counts = seedDefaultResearchControlPlane(db, now)
      return { ok: true, action: args.action, ...counts }
    }
    if (args.action === "upsert_data_surface") {
      upsertDataSurface(db, args.json as unknown as Parameters<typeof upsertDataSurface>[1])
      return { ok: true, action: args.action, surface_id: args.json.surface_id }
    }
    if (args.action === "link_universe_data_surface") {
      linkUniverseDataSurface(db, args.json as unknown as Parameters<typeof linkUniverseDataSurface>[1])
      return { ok: true, action: args.action, node_id: args.json.node_id, surface_id: args.json.surface_id }
    }
    if (args.action === "upsert_pipeline_registry_item") {
      upsertPipelineRegistryItem(db, args.json as unknown as Parameters<typeof upsertPipelineRegistryItem>[1])
      return { ok: true, action: args.action, item_id: args.json.item_id }
    }
    if (args.action === "upsert_universe_coverage") {
      upsertUniverseCoverage(db, args.json as unknown as Parameters<typeof upsertUniverseCoverage>[1])
      return { ok: true, action: args.action, coverage_id: args.json.coverage_id }
    }
    if (args.action === "read_planning_context") {
      return { ok: true, action: args.action, context: readPlannerControlPlaneContext(db) }
    }
    if (isReplayL2ExperimentAttachmentOwnerAction(args.action)) {
      return executeReplayL2ExperimentAttachmentOwnerAction(db, args.action, args.json)
    }
    if (args.action === "materialize_proposal") {
      materializeProposal(db, args.json as unknown as Parameters<typeof materializeProposal>[1])
      return { ok: true, action: args.action, proposal_id: args.json.proposal_id }
    }
    if (args.action === "register_trial_group") {
      registerTrialGroup(db, args.json as unknown as TrialGroupWrite)
      return { ok: true, action: args.action, trial_group_id: args.json.trial_group_id }
    }
    if (args.action === "materialize_generated_candidate") {
      materializeGeneratedCandidate(db, args.json as unknown as Parameters<typeof materializeGeneratedCandidate>[1])
      return { ok: true, action: args.action, candidate_id: (args.json.candidate as JSONRecord)?.candidate_id }
    }
    if (args.action === "transition_trial_group") {
      transitionTrialGroup(db, args.json as unknown as Parameters<typeof transitionTrialGroup>[1])
      return { ok: true, action: args.action, trial_group_id: args.json.trial_group_id }
    }
    if (args.action === "register_experiment") {
      registerExperiment(db, args.json as unknown as ExperimentRegistrationWrite)
      return { ok: true, action: args.action, experiment_id: args.json.experiment_id }
    }
    if (args.action === "reserve_trial") {
      reserveTrial(db, args.json as unknown as TrialReservation)
      return { ok: true, action: args.action, trial_id: args.json.trial_id }
    }
    if (args.action === "finish_trial") {
      finishTrial(db, args.json as unknown as Parameters<typeof finishTrial>[1])
      return { ok: true, action: args.action, trial_id: args.json.trial_id }
    }
    if (args.action === "append_result") {
      appendExperimentResult(db, args.json as unknown as ExperimentResultWrite)
      return { ok: true, action: args.action, result_id: args.json.result_id }
    }
    if (args.action === "register_evaluation_evidence_classification") {
      const classification = registerEvaluationEvidenceClassification(
        db,
        args.json as unknown as EvaluationEvidenceClassification,
      )
      return { ok: true, action: args.action, classification }
    }
    if (args.action === "read_evaluation_evidence_classification") {
      const classification = readEvaluationEvidenceClassification(
        db,
        stringField(args.json.result_id),
      )
      return { ok: true, action: args.action, classification }
    }
    if (args.action === "append_lesson") {
      appendResearchLesson(db, args.json as unknown as Parameters<typeof appendResearchLesson>[1])
      return { ok: true, action: args.action, lesson_id: args.json.lesson_id }
    }
    if (args.action === "apply_reviewer_decision") {
      applyReviewerDecision(db, args.json as unknown as ReviewerDecisionWrite)
      return { ok: true, action: args.action, decision_id: args.json.decision_id }
    }
    if (args.action === "apply_system_transition") {
      applySystemTransition(db, args.json as unknown as Parameters<typeof applySystemTransition>[1])
      return { ok: true, action: args.action, event_id: args.json.event_id }
    }
    if (args.action === "open_blocker") {
      openBlockerAndTransition(db, args.json as unknown as Parameters<typeof openBlockerAndTransition>[1])
      return { ok: true, action: args.action, blocker_id: args.json.blocker_id }
    }
    if (args.action === "close_blocker") {
      resolveBlockerAndTransition(db, args.json as unknown as Parameters<typeof resolveBlockerAndTransition>[1])
      return { ok: true, action: args.action, blocker_id: args.json.blocker_id }
    }
    if (args.action === "check_lifecycle_projection") {
      const experimentId = stringField(args.json.experiment_id)
      assertLifecycleProjection(db, experimentId)
      return { ok: true, action: args.action, experiment_id: experimentId }
    }
    if (args.action === "rebuild_lifecycle_projection") {
      const experimentId = stringField(args.json.experiment_id)
      rebuildLifecycleProjection(db, experimentId, stringField(args.json.rebuilt_at))
      return { ok: true, action: args.action, experiment_id: experimentId }
    }
    throw new Error(`unsupported action: ${args.action}`)
  } finally {
    db.close()
  }
}

function printHelp(): void {
  console.log([
    "usage: bun src/scripts/main.ts --db data/rd_state.db --action init",
    "actions: init | upsert_program | upsert_hypothesis | record_trial | record_holdout_use | record_lesson | read_program",
    "control-plane: seed_default_control_plane | seed_universe | upsert_data_surface | link_universe_data_surface | upsert_pipeline_registry_item | upsert_universe_coverage | read_planning_context | prepare_planner_proposal | admit_planner_proposal | read_planner_proposal_admission | issue_developer_development_brief | read_developer_development_brief | prepare_developer_agent_submission | receive_developer_contract_draft | read_developer_contract_draft_receipt | validate_developer_contract_draft | read_developer_contract_draft_validation | freeze_developer_experiment_contract | read_developer_contract_freeze | start_experiment_trial_plan | read_experiment_trial_plan | admit_replay_trial_reservation | read_replay_trial_reservation_admission | register_replay_execution_request | read_replay_request_registration | issue_replay_l2_experiment_attachment | read_replay_l2_experiment_attachment | append_proposal_revision | materialize_proposal | register_trial_group | materialize_generated_candidate | transition_trial_group | register_experiment | reserve_trial | finish_trial | append_result | register_evaluation_evidence_classification | read_evaluation_evidence_classification | append_lesson | apply_reviewer_decision | apply_system_transition | open_blocker | close_blocker | check_lifecycle_projection | rebuild_lifecycle_projection",
  ].join("\n"))
}

function stringArray(value: unknown): string[] {
  if (!Array.isArray(value) || value.some((item) => typeof item !== "string")) {
    throw new Error("dataset_requirements must be a string array")
  }
  return value as string[]
}

function asRecord(value: unknown): JSONRecord {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("candidate_space must be an object")
  }
  return value as JSONRecord
}

function nullableString(value: unknown): string | null {
  return value == null ? null : stringField(value)
}

if (import.meta.main) {
  try {
    console.log(JSON.stringify(run(parseArgs(Bun.argv.slice(2))), null, 2))
  } catch (error) {
    console.error(JSON.stringify({ ok: false, error: error instanceof Error ? error.message : String(error) }))
    process.exit(1)
  }
}
