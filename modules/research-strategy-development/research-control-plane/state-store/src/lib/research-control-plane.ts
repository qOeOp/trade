import { Database } from "bun:sqlite"
import type { JSONRecord } from "../../../../../contracts/runtime-core/src/json"
import { RESEARCH_LIFECYCLE_RULE_VERSION } from "./research-control-plane-schema"
import { RESEARCH_CONTRACT_VALIDATOR_VERSION, validateResearchProposal } from "./research-contract-validator"
import { IDENTITY_HASH_POLICY_VERSION, hashIdentityPayload } from "./research-identity-hash"

export interface ProposalRevisionWrite {
  proposal_id: string
  planner_run_id: string
  proposal_kind: "experiment" | "family_backlog"
  revision: number
  proposal_hash: string
  identity_hash_policy_version: string
  proposal_json: JSONRecord
  validation_status: "invalid" | "valid"
  validation_ref: string
  created_at: string
}

export interface TrialGroupCandidateWrite {
  candidate_id: string
  candidate_identity_hash: string
  parameter_assignment_json: JSONRecord
  candidate_ordinal: number
  created_at: string
}

export interface TrialGroupWrite {
  trial_group_id: string
  hypothesis_scope_ref: string
  group_hash: string
  identity_hash_policy_version: string
  candidate_mode: "enumerated" | "generated_from_space"
  candidate_generator_ref?: string
  search_space_json: JSONRecord
  selection_protocol_json: JSONRecord
  max_trials: number
  trial_accounting_policy_version: string
  registered_at: string
  created_at: string
  candidates: TrialGroupCandidateWrite[]
}

export interface ExperimentRegistrationWrite {
  experiment_id: string
  proposal_id: string
  proposal_revision: number
  canonical_node_id: string
  hypothesis_id: string
  code_family_id: string
  trial_group_id: string
  trial_group_hash: string
  parent_experiment_id?: string
  contract_hash: string
  identity_hash_policy_version: string
  contract_validator_version: string
  lifecycle_rule_version: string
  scope_policy_version: string
  contract_json: JSONRecord
  bootstrap_event_id: string
  bootstrap_idempotency_key: string
  registered_at: string
}

export interface ReviewEvidenceLinkWrite {
  result_id: string
  evidence_role: "primary" | "supporting" | "negative_control" | "cost" | "stability" | "holdout"
}

export interface ReviewerDecisionWrite {
  decision_id: string
  experiment_id: string
  reviewer_run_id: string
  idempotency_key: string
  expected_version: number
  stage_id: string
  decision: "reject" | "modify" | "accept_for_draft" | "accept_for_forward" | "accept_for_shadow_candidate"
  rationale_ref: string
  evidence: ReviewEvidenceLinkWrite[]
  lifecycle_event_id: string
  lifecycle_idempotency_key: string
  selected_trial_id?: string
  created_at: string
}

export function candidateIdentityHash(parameterAssignment: JSONRecord): string {
  return hashIdentityPayload(parameterAssignment)
}

export function trialGroupIdentityHash(group: Omit<TrialGroupWrite, "group_hash" | "registered_at" | "created_at">): string {
  return hashIdentityPayload({
    schema_version: "trade-flow.rd-trial-group-identity.v1",
    hypothesis_scope_ref: group.hypothesis_scope_ref,
    candidate_mode: group.candidate_mode,
    candidate_generator_ref: group.candidate_generator_ref ?? null,
    search_space: group.search_space_json,
    selection_protocol: group.selection_protocol_json,
    max_trials: group.max_trials,
    trial_accounting_policy_version: group.trial_accounting_policy_version,
    candidates: [...group.candidates]
      .sort((left, right) => left.candidate_ordinal - right.candidate_ordinal)
      .map((candidate) => ({
        candidate_id: candidate.candidate_id,
        candidate_identity_hash: candidate.candidate_identity_hash,
        candidate_ordinal: candidate.candidate_ordinal,
      })),
  })
}

export function appendProposalRevision(db: Database, proposal: ProposalRevisionWrite): void {
  validateProposalRevision(proposal)
  const validation = validateResearchProposal(proposal.proposal_kind, proposal.proposal_json)
  const actualStatus = validation.valid ? "valid" : "invalid"
  if (proposal.validation_status !== actualStatus) {
    throw new Error(`proposal validation_status must be ${actualStatus}: ${validation.errors.join("; ")}`)
  }
  if (!proposal.validation_ref.includes(RESEARCH_CONTRACT_VALIDATOR_VERSION)) {
    throw new Error(`validation_ref must identify ${RESEARCH_CONTRACT_VALIDATOR_VERSION}`)
  }
  if (proposal.identity_hash_policy_version !== IDENTITY_HASH_POLICY_VERSION) {
    throw new Error("unsupported identity_hash_policy_version")
  }
  if (proposal.proposal_hash !== hashIdentityPayload(proposal.proposal_json)) {
    throw new Error("proposal_hash does not match canonical proposal_json")
  }
  const write = db.transaction(() => {
    const replay = db.query(`
      SELECT proposal_hash, validation_status FROM rd_proposal_revision
      WHERE proposal_id=$proposal_id AND revision=$revision
    `).get({ $proposal_id: proposal.proposal_id, $revision: proposal.revision }) as {
      proposal_hash: string; validation_status: string
    } | null
    if (replay) {
      if (replay.proposal_hash === proposal.proposal_hash && replay.validation_status === proposal.validation_status) return
      throw new Error("proposal revision identity already exists with different content")
    }
    const header = db.query(`
      SELECT planner_run_id, proposal_kind, materialized_revision
      FROM rd_proposal
      WHERE proposal_id = $proposal_id
    `).get({ $proposal_id: proposal.proposal_id }) as ProposalHeaderRow | null
    if (!header) {
      db.query(`
        INSERT INTO rd_proposal(proposal_id, planner_run_id, proposal_kind, created_at)
        VALUES ($proposal_id, $planner_run_id, $proposal_kind, $created_at)
      `).run({
        $proposal_id: proposal.proposal_id,
        $planner_run_id: proposal.planner_run_id,
        $proposal_kind: proposal.proposal_kind,
        $created_at: proposal.created_at,
      })
    } else {
      if (header.planner_run_id !== proposal.planner_run_id || header.proposal_kind !== proposal.proposal_kind) {
        throw new Error("proposal header identity does not match the existing proposal")
      }
      if (header.materialized_revision !== null) {
        throw new Error("proposal is already materialized")
      }
    }

    const row = db.query(`
      SELECT COALESCE(MAX(revision), 0) AS latest_revision
      FROM rd_proposal_revision
      WHERE proposal_id = $proposal_id
    `).get({ $proposal_id: proposal.proposal_id }) as { latest_revision: number }
    if (proposal.revision !== row.latest_revision + 1) {
      throw new Error(`proposal revision must be ${row.latest_revision + 1}`)
    }
    db.query(`
      INSERT INTO rd_proposal_revision(
        proposal_id, revision, proposal_hash, identity_hash_policy_version,
        proposal_json, validation_status, validation_ref, created_at
      ) VALUES (
        $proposal_id, $revision, $proposal_hash, $identity_hash_policy_version,
        $proposal_json, $validation_status, $validation_ref, $created_at
      )
    `).run({
      $proposal_id: proposal.proposal_id,
      $revision: proposal.revision,
      $proposal_hash: proposal.proposal_hash,
      $identity_hash_policy_version: proposal.identity_hash_policy_version,
      $proposal_json: JSON.stringify(proposal.proposal_json),
      $validation_status: proposal.validation_status,
      $validation_ref: proposal.validation_ref,
      $created_at: proposal.created_at,
    })
  })
  write()
}

export function materializeProposal(
  db: Database,
  input: { proposal_id: string; revision: number; materialization_ref: string; materialized_at: string },
): void {
  if (!input.proposal_id || !input.materialization_ref || !Number.isInteger(input.revision) || input.revision < 1) {
    throw new Error("proposal_id, positive revision, and materialization_ref are required")
  }
  assertUtcTimestamp(input.materialized_at, "materialized_at")
  const write = db.transaction(() => {
    const existing = db.query(`
      SELECT materialized_revision, materialization_ref, materialized_at
      FROM rd_proposal WHERE proposal_id=$proposal_id
    `).get({ $proposal_id: input.proposal_id }) as {
      materialized_revision: number | null; materialization_ref: string | null; materialized_at: string | null
    } | null
    if (existing?.materialized_revision === input.revision
        && existing.materialization_ref === input.materialization_ref
        && existing.materialized_at === input.materialized_at) return
    const revision = db.query(`
      SELECT validation_status
      FROM rd_proposal_revision
      WHERE proposal_id = $proposal_id AND revision = $revision
    `).get({ $proposal_id: input.proposal_id, $revision: input.revision }) as { validation_status: string } | null
    if (!revision || revision.validation_status !== "valid") {
      throw new Error("only a valid proposal revision may be materialized")
    }
    const result = db.query(`
      UPDATE rd_proposal
      SET materialized_revision = $revision,
          materialization_ref = $materialization_ref,
          materialized_at = $materialized_at
      WHERE proposal_id = $proposal_id
        AND materialized_revision IS NULL
    `).run({
      $proposal_id: input.proposal_id,
      $revision: input.revision,
      $materialization_ref: input.materialization_ref,
      $materialized_at: input.materialized_at,
    })
    if (result.changes !== 1) {
      throw new Error("proposal is missing or already materialized")
    }
  })
  write()
}

export function registerTrialGroup(db: Database, group: TrialGroupWrite): void {
  validateTrialGroup(group)
  const write = db.transaction(() => {
    const replay = db.query(`SELECT group_hash FROM rd_trial_group WHERE trial_group_id=$id`).get({ $id: group.trial_group_id }) as { group_hash: string } | null
    if (replay) {
      if (replay.group_hash === group.group_hash) return
      throw new Error("trial_group_id already exists with a different identity")
    }
    db.query(`
      INSERT INTO rd_trial_group(
        trial_group_id, hypothesis_scope_ref, group_hash,
        identity_hash_policy_version, candidate_mode, candidate_generator_ref,
        search_space_json, selection_protocol_json, max_trials,
        trial_accounting_policy_version, status, registered_at, created_at
      ) VALUES (
        $trial_group_id, $hypothesis_scope_ref, $group_hash,
        $identity_hash_policy_version, $candidate_mode, $candidate_generator_ref,
        $search_space_json, $selection_protocol_json, $max_trials,
        $trial_accounting_policy_version, 'registered', $registered_at, $created_at
      )
    `).run({
      $trial_group_id: group.trial_group_id,
      $hypothesis_scope_ref: group.hypothesis_scope_ref,
      $group_hash: group.group_hash,
      $identity_hash_policy_version: group.identity_hash_policy_version,
      $candidate_mode: group.candidate_mode,
      $candidate_generator_ref: group.candidate_generator_ref ?? null,
      $search_space_json: JSON.stringify(group.search_space_json),
      $selection_protocol_json: JSON.stringify(group.selection_protocol_json),
      $max_trials: group.max_trials,
      $trial_accounting_policy_version: group.trial_accounting_policy_version,
      $registered_at: group.registered_at,
      $created_at: group.created_at,
    })
    const insertCandidate = db.query(`
      INSERT INTO rd_trial_group_candidate(
        trial_group_id, candidate_id, candidate_identity_hash,
        identity_hash_policy_version, parameter_assignment_json,
        candidate_ordinal, created_at
      ) VALUES (
        $trial_group_id, $candidate_id, $candidate_identity_hash,
        $identity_hash_policy_version, $parameter_assignment_json,
        $candidate_ordinal, $created_at
      )
    `)
    for (const candidate of group.candidates) {
      insertCandidate.run({
        $trial_group_id: group.trial_group_id,
        $candidate_id: candidate.candidate_id,
        $candidate_identity_hash: candidate.candidate_identity_hash,
        $identity_hash_policy_version: group.identity_hash_policy_version,
        $parameter_assignment_json: JSON.stringify(candidate.parameter_assignment_json),
        $candidate_ordinal: candidate.candidate_ordinal,
        $created_at: candidate.created_at,
      })
    }
  })
  write()
}

export function materializeGeneratedCandidate(db: Database, input: {
  trial_group_id: string; candidate_generator_ref: string
  candidate: TrialGroupCandidateWrite; identity_hash_policy_version: string
}): void {
  const group = db.query(`
    SELECT status, candidate_mode, candidate_generator_ref, identity_hash_policy_version
    FROM rd_trial_group WHERE trial_group_id=$id
  `).get({ $id: input.trial_group_id }) as {
    status: string; candidate_mode: string; candidate_generator_ref: string | null; identity_hash_policy_version: string
  } | null
  if (!group || group.status !== "running" || group.candidate_mode !== "generated_from_space"
      || group.candidate_generator_ref !== input.candidate_generator_ref
      || group.identity_hash_policy_version !== input.identity_hash_policy_version) {
    throw new Error("candidate generation must use the registered running group generator and identity policy")
  }
  if (input.candidate.candidate_identity_hash !== candidateIdentityHash(input.candidate.parameter_assignment_json)) {
    throw new Error("generated candidate identity hash does not match its parameter assignment")
  }
  assertUtcTimestamp(input.candidate.created_at, "candidate.created_at")
  const replay = db.query(`
    SELECT candidate_identity_hash FROM rd_trial_group_candidate
    WHERE trial_group_id=$group AND candidate_id=$candidate
  `).get({ $group: input.trial_group_id, $candidate: input.candidate.candidate_id }) as { candidate_identity_hash: string } | null
  if (replay) {
    if (replay.candidate_identity_hash === input.candidate.candidate_identity_hash) return
    throw new Error("generated candidate id already exists with another identity")
  }
  db.query(`
    INSERT INTO rd_trial_group_candidate(
      trial_group_id, candidate_id, candidate_identity_hash,
      identity_hash_policy_version, parameter_assignment_json,
      candidate_ordinal, created_at
    ) VALUES ($group, $candidate, $hash, $policy, $parameters, $ordinal, $created)
  `).run({
    $group: input.trial_group_id, $candidate: input.candidate.candidate_id,
    $hash: input.candidate.candidate_identity_hash, $policy: input.identity_hash_policy_version,
    $parameters: JSON.stringify(input.candidate.parameter_assignment_json),
    $ordinal: input.candidate.candidate_ordinal, $created: input.candidate.created_at,
  })
}

export function transitionTrialGroup(db: Database, input: {
  trial_group_id: string; action: "start" | "seal" | "close"; occurred_at: string
}): void {
  assertUtcTimestamp(input.occurred_at, "occurred_at")
  const transitions = {
    start: { current: "registered", next: "running" },
    seal: { current: "running", next: "sealed" },
    close: { current: "sealed", next: "closed" },
  } as const
  const transition = transitions[input.action]
  const row = db.query("SELECT status, sealed_at, closed_at FROM rd_trial_group WHERE trial_group_id=$id").get({ $id: input.trial_group_id }) as {
    status: string; sealed_at: string | null; closed_at: string | null
  } | null
  if (row?.status === transition.next) return
  const result = input.action === "start"
    ? db.query("UPDATE rd_trial_group SET status='running' WHERE trial_group_id=$id AND status='registered'").run({ $id: input.trial_group_id })
    : input.action === "seal"
      ? db.query("UPDATE rd_trial_group SET status='sealed', sealed_at=$at WHERE trial_group_id=$id AND status='running'").run({ $id: input.trial_group_id, $at: input.occurred_at })
      : db.query("UPDATE rd_trial_group SET status='closed', closed_at=$at WHERE trial_group_id=$id AND status='sealed'").run({ $id: input.trial_group_id, $at: input.occurred_at })
  if (result.changes !== 1) throw new Error(`Trial Group cannot ${input.action} from its current state`)
}

export function registerExperiment(db: Database, experiment: ExperimentRegistrationWrite): void {
  validateExperimentRegistration(experiment)
  const write = db.transaction(() => {
    const replay = db.query(`SELECT contract_hash FROM rd_experiment_contract WHERE experiment_id=$id`).get({ $id: experiment.experiment_id }) as { contract_hash: string } | null
    if (replay) {
      if (replay.contract_hash === experiment.contract_hash) return
      throw new Error("experiment_id already exists with a different contract identity")
    }
    const proposal = db.query(`
      SELECT p.proposal_kind, p.materialized_revision, r.validation_status,
             r.proposal_hash, r.proposal_json
      FROM rd_proposal p
      JOIN rd_proposal_revision r
        ON r.proposal_id = p.proposal_id AND r.revision = $proposal_revision
      WHERE p.proposal_id = $proposal_id
    `).get({
      $proposal_id: experiment.proposal_id,
      $proposal_revision: experiment.proposal_revision,
    }) as {
      proposal_kind: string; materialized_revision: number | null; validation_status: string
      proposal_hash: string; proposal_json: string
    } | null
    if (!proposal || proposal.proposal_kind !== "experiment" || proposal.validation_status !== "valid") {
      throw new Error("experiment registration requires a valid experiment proposal revision")
    }
    if (proposal.materialized_revision !== null) {
      throw new Error("proposal is already materialized")
    }
    if (proposal.proposal_hash !== experiment.contract_hash) {
      throw new Error("registered contract must exactly materialize the validated proposal revision")
    }
    const group = db.query(`
      SELECT group_hash, identity_hash_policy_version, status
      FROM rd_trial_group
      WHERE trial_group_id = $trial_group_id
    `).get({ $trial_group_id: experiment.trial_group_id }) as {
      group_hash: string
      identity_hash_policy_version: string
      status: string
    } | null
    if (
      !group || group.status !== "registered"
      || group.group_hash !== experiment.trial_group_hash
      || group.identity_hash_policy_version !== experiment.identity_hash_policy_version
    ) {
      throw new Error("experiment registration requires the matching registered Trial Group identity")
    }
    const canonical = db.query(`
      SELECT level, node_type, research_scope_status, implementation_scope_status
      FROM rd_universe_node WHERE node_id=$id
    `).get({ $id: experiment.canonical_node_id }) as {
      level: number; node_type: string; research_scope_status: string; implementation_scope_status: string
    } | null
    if (!canonical || canonical.level !== 3 || canonical.node_type !== "canonical_strategy"
        || canonical.research_scope_status !== "active" || canonical.implementation_scope_status !== "ready") {
      throw new Error("experiment registration requires an active, implementation-ready L3 canonical node")
    }
    const contractGroup = experiment.contract_json.trial_group_ref as JSONRecord
    const contractCandidates = (experiment.contract_json.candidate_registration as JSONRecord).candidate_ids as unknown[]
    const registeredCandidates = db.query(`
      SELECT candidate_id FROM rd_trial_group_candidate
      WHERE trial_group_id=$id ORDER BY candidate_ordinal
    `).all({ $id: experiment.trial_group_id }) as Array<{ candidate_id: string }>
    const registeredIds = new Set(registeredCandidates.map((candidate) => candidate.candidate_id))
    if (contractGroup.trial_group_id !== experiment.trial_group_id
        || contractGroup.group_hash !== experiment.trial_group_hash
        || contractCandidates.some((candidate) => !registeredIds.has(String(candidate)))) {
      throw new Error("contract Trial Group and candidates must match registered relational facts")
    }
    const versions = experiment.contract_json.contract_versions as JSONRecord
    if (experiment.contract_json.canonical_node_id !== experiment.canonical_node_id
        || experiment.contract_json.code_family_id !== experiment.code_family_id
        || versions.identity_hash_policy !== experiment.identity_hash_policy_version
        || versions.validator !== experiment.contract_validator_version
        || versions.lifecycle_rule !== experiment.lifecycle_rule_version
        || versions.scope_policy !== experiment.scope_policy_version) {
      throw new Error("contract identity fields must match experiment registration columns")
    }

    db.query(`
      INSERT INTO rd_experiment_contract(
        experiment_id, proposal_id, proposal_revision, canonical_node_id,
        hypothesis_id, code_family_id, trial_group_id, trial_group_hash,
        parent_experiment_id, contract_hash, identity_hash_policy_version,
        contract_validator_version, lifecycle_rule_version, scope_policy_version,
        registered_at, lifecycle_state, lifecycle_version, contract_json,
        created_at, updated_at
      ) VALUES (
        $experiment_id, $proposal_id, $proposal_revision, $canonical_node_id,
        $hypothesis_id, $code_family_id, $trial_group_id, $trial_group_hash,
        $parent_experiment_id, $contract_hash, $identity_hash_policy_version,
        $contract_validator_version, $lifecycle_rule_version, $scope_policy_version,
        $registered_at, 'proposed', 0, $contract_json, $registered_at, $registered_at
      )
    `).run({
      $experiment_id: experiment.experiment_id,
      $proposal_id: experiment.proposal_id,
      $proposal_revision: experiment.proposal_revision,
      $canonical_node_id: experiment.canonical_node_id,
      $hypothesis_id: experiment.hypothesis_id,
      $code_family_id: experiment.code_family_id,
      $trial_group_id: experiment.trial_group_id,
      $trial_group_hash: experiment.trial_group_hash,
      $parent_experiment_id: experiment.parent_experiment_id ?? null,
      $contract_hash: experiment.contract_hash,
      $identity_hash_policy_version: experiment.identity_hash_policy_version,
      $contract_validator_version: experiment.contract_validator_version,
      $lifecycle_rule_version: experiment.lifecycle_rule_version,
      $scope_policy_version: experiment.scope_policy_version,
      $registered_at: experiment.registered_at,
      $contract_json: JSON.stringify(experiment.contract_json),
    })
    projectExperimentRegistrationKnowledge(db, experiment)
    const bootstrapRuleId = `${experiment.lifecycle_rule_version}:register`
    db.query(`
      INSERT INTO rd_lifecycle_event(
        event_id, experiment_id, sequence_no, transition_rule_id, trigger_ref,
        current_state, next_state, idempotency_key, created_at
      ) VALUES (
        $event_id, $experiment_id, 1, $rule_id, 'system://register',
        '__unregistered__', 'proposed', $idempotency_key, $created_at
      )
    `).run({
      $event_id: experiment.bootstrap_event_id,
      $experiment_id: experiment.experiment_id,
      $rule_id: bootstrapRuleId,
      $idempotency_key: experiment.bootstrap_idempotency_key,
      $created_at: experiment.registered_at,
    })
    db.query(`
      UPDATE rd_experiment_contract
      SET lifecycle_version = 1,
          last_lifecycle_event_id = $event_id,
          updated_at = $updated_at
      WHERE experiment_id = $experiment_id AND lifecycle_version = 0
    `).run({
      $event_id: experiment.bootstrap_event_id,
      $updated_at: experiment.registered_at,
      $experiment_id: experiment.experiment_id,
    })
    const materialized = db.query(`
      UPDATE rd_proposal
      SET materialized_revision = $proposal_revision,
          materialization_ref = $experiment_id,
          materialized_at = $registered_at
      WHERE proposal_id = $proposal_id AND materialized_revision IS NULL
    `).run({
      $proposal_revision: experiment.proposal_revision,
      $experiment_id: experiment.experiment_id,
      $registered_at: experiment.registered_at,
      $proposal_id: experiment.proposal_id,
    })
    if (materialized.changes !== 1) {
      throw new Error("proposal materialization conflict")
    }
  })
  write()
}

export function applyReviewerDecision(db: Database, decision: ReviewerDecisionWrite): void {
  validateReviewerDecision(decision)
  const write = db.transaction(() => {
    const replay = db.query(`
      SELECT decision_id, experiment_id FROM rd_review_decision WHERE idempotency_key=$key
    `).get({ $key: decision.idempotency_key }) as { decision_id: string; experiment_id: string } | null
    if (replay) {
      if (replay.decision_id === decision.decision_id && replay.experiment_id === decision.experiment_id) return
      throw new Error("review idempotency key was already used for a different decision")
    }
    const experiment = db.query(`
      SELECT lifecycle_state, lifecycle_version, lifecycle_rule_version, hypothesis_id
      FROM rd_experiment_contract
      WHERE experiment_id = $experiment_id
    `).get({ $experiment_id: decision.experiment_id }) as {
      lifecycle_state: string
      lifecycle_version: number
      lifecycle_rule_version: string
      hypothesis_id: string
    } | null
    if (!experiment || experiment.lifecycle_version !== decision.expected_version) {
      throw new Error("experiment lifecycle version conflict")
    }
    const rule = db.query(`
      SELECT rule_id, next_state, requires_result_stage_id
      FROM rd_lifecycle_transition_rule
      WHERE rule_version = $rule_version
        AND current_state = $current_state
        AND trigger_type = 'reviewer'
        AND trigger_value = $decision
        AND requires_result_stage_id = $stage_id
    `).get({
      $rule_version: experiment.lifecycle_rule_version,
      $current_state: experiment.lifecycle_state,
      $decision: decision.decision,
      $stage_id: decision.stage_id,
    }) as { rule_id: string; next_state: string; requires_result_stage_id: string } | null
    if (!rule) {
      throw new Error("review decision does not resolve to one lifecycle transition rule")
    }
    const primary = decision.evidence.filter((link) => link.evidence_role === "primary")
    if (primary.length !== 1) {
      throw new Error("review decision requires exactly one primary result")
    }
    const resultQuery = db.query(`
      SELECT result_id, experiment_id, result_scope, trial_id, stage_id, artifact_ref
      FROM rd_experiment_result
      WHERE result_id = $result_id
    `)
    const results = decision.evidence.map((link) => {
      const result = resultQuery.get({ $result_id: link.result_id }) as ReviewResultRow | null
      if (!result || result.experiment_id !== decision.experiment_id) {
        throw new Error("review evidence must belong to the reviewed experiment")
      }
      return { ...result, evidence_role: link.evidence_role }
    })
    const primaryResult = results.find((result) => result.evidence_role === "primary")
    if (primaryResult?.stage_id !== rule.requires_result_stage_id) {
      throw new Error("primary review evidence does not satisfy the transition result stage")
    }

    let frozenCandidate: FrozenCandidateRow | null = null
    if (decision.decision === "accept_for_draft") {
      if (!decision.selected_trial_id || primaryResult?.result_scope !== "trial"
          || primaryResult.trial_id !== decision.selected_trial_id) {
        throw new Error("accept_for_draft primary result must bind the selected Trial")
      }
      frozenCandidate = db.query(`
        SELECT candidate_id, candidate_identity_hash
        FROM rd_trial
        WHERE trial_id = $trial_id
          AND experiment_id = $experiment_id
          AND status = 'completed'
      `).get({
        $trial_id: decision.selected_trial_id,
        $experiment_id: decision.experiment_id,
      }) as FrozenCandidateRow | null
      if (!frozenCandidate) {
        throw new Error("accept_for_draft requires a completed selected Trial")
      }
    } else if (decision.selected_trial_id) {
      throw new Error("selected_trial_id is only valid for accept_for_draft")
    }

    db.query(`
      INSERT INTO rd_review_decision(
        decision_id, experiment_id, reviewer_run_id, idempotency_key,
        transition_rule_id, stage_id, decision, observed_current_state,
        applied_next_state, rationale_ref, created_at
      ) VALUES (
        $decision_id, $experiment_id, $reviewer_run_id, $idempotency_key,
        $transition_rule_id, $stage_id, $decision, $observed_current_state,
        $applied_next_state, $rationale_ref, $created_at
      )
    `).run({
      $decision_id: decision.decision_id,
      $experiment_id: decision.experiment_id,
      $reviewer_run_id: decision.reviewer_run_id,
      $idempotency_key: decision.idempotency_key,
      $transition_rule_id: rule.rule_id,
      $stage_id: decision.stage_id,
      $decision: decision.decision,
      $observed_current_state: experiment.lifecycle_state,
      $applied_next_state: rule.next_state,
      $rationale_ref: decision.rationale_ref,
      $created_at: decision.created_at,
    })
    const insertLink = db.query(`
      INSERT INTO rd_review_decision_result(
        decision_id, result_id, experiment_id, evidence_role, created_at
      ) VALUES ($decision_id, $result_id, $experiment_id, $evidence_role, $created_at)
    `)
    for (const link of decision.evidence) {
      insertLink.run({
        $decision_id: decision.decision_id,
        $result_id: link.result_id,
        $experiment_id: decision.experiment_id,
        $evidence_role: link.evidence_role,
        $created_at: decision.created_at,
      })
    }
    projectReviewerDecisionKnowledge(db, decision, experiment.hypothesis_id, results)
    const nextVersion = experiment.lifecycle_version + 1
    db.query(`
      INSERT INTO rd_lifecycle_event(
        event_id, experiment_id, sequence_no, transition_rule_id, trigger_ref,
        current_state, next_state, idempotency_key, created_at
      ) VALUES (
        $event_id, $experiment_id, $sequence_no, $transition_rule_id, $trigger_ref,
        $current_state, $next_state, $idempotency_key, $created_at
      )
    `).run({
      $event_id: decision.lifecycle_event_id,
      $experiment_id: decision.experiment_id,
      $sequence_no: nextVersion,
      $transition_rule_id: rule.rule_id,
      $trigger_ref: `review-decision://${decision.decision_id}`,
      $current_state: experiment.lifecycle_state,
      $next_state: rule.next_state,
      $idempotency_key: decision.lifecycle_idempotency_key,
      $created_at: decision.created_at,
    })
    const projection = frozenCandidate
      ? db.query(`
          UPDATE rd_experiment_contract
          SET lifecycle_state = $next_state,
              lifecycle_version = $next_version,
              last_lifecycle_event_id = $event_id,
              selected_candidate_id = $selected_candidate_id,
              selected_trial_id = $selected_trial_id,
              candidate_hash = $candidate_hash,
              candidate_frozen_at = $candidate_frozen_at,
              updated_at = $updated_at
          WHERE experiment_id = $experiment_id
            AND lifecycle_version = $expected_version
        `).run({
          $next_state: rule.next_state,
          $next_version: nextVersion,
          $event_id: decision.lifecycle_event_id,
          $selected_candidate_id: frozenCandidate.candidate_id,
          $selected_trial_id: decision.selected_trial_id ?? null,
          $candidate_hash: frozenCandidate.candidate_identity_hash,
          $candidate_frozen_at: decision.created_at,
          $updated_at: decision.created_at,
          $experiment_id: decision.experiment_id,
          $expected_version: decision.expected_version,
        })
      : db.query(`
          UPDATE rd_experiment_contract
          SET lifecycle_state = $next_state,
              lifecycle_version = $next_version,
              last_lifecycle_event_id = $event_id,
              updated_at = $updated_at
          WHERE experiment_id = $experiment_id
            AND lifecycle_version = $expected_version
        `).run({
          $next_state: rule.next_state,
          $next_version: nextVersion,
          $event_id: decision.lifecycle_event_id,
          $updated_at: decision.created_at,
          $experiment_id: decision.experiment_id,
          $expected_version: decision.expected_version,
        })
    if (projection.changes !== 1) {
      throw new Error("experiment lifecycle version conflict")
    }
  })
  write()
}

function validateProposalRevision(proposal: ProposalRevisionWrite): void {
  if (
    !proposal.proposal_id || !proposal.planner_run_id || !proposal.proposal_hash
    || !proposal.identity_hash_policy_version || !proposal.validation_ref
    || !Number.isInteger(proposal.revision) || proposal.revision < 1
  ) {
    throw new Error("proposal revision identity and validation fields are required")
  }
  if (typeof proposal.proposal_json.schema_version !== "string") {
    throw new Error("proposal_json.schema_version is required")
  }
  assertUtcTimestamp(proposal.created_at, "created_at")
}

function validateTrialGroup(group: TrialGroupWrite): void {
  if (
    !group.trial_group_id || !group.hypothesis_scope_ref || !group.group_hash
    || !group.identity_hash_policy_version || !group.trial_accounting_policy_version
    || !Number.isInteger(group.max_trials) || group.max_trials < 1
  ) {
    throw new Error("trial group identity, policy, and positive max_trials are required")
  }
  if (typeof group.search_space_json.schema_version !== "string"
      || typeof group.selection_protocol_json.schema_version !== "string") {
    throw new Error("search and selection payloads must carry schema_version")
  }
  if (group.identity_hash_policy_version !== IDENTITY_HASH_POLICY_VERSION) {
    throw new Error("unsupported identity_hash_policy_version")
  }
  if (group.candidate_mode === "enumerated" && group.candidates.length === 0) {
    throw new Error("enumerated trial groups must register candidates atomically")
  }
  if (group.candidate_mode === "generated_from_space" && !group.candidate_generator_ref) {
    throw new Error("generated trial groups require candidate_generator_ref")
  }
  const ordinals = [...group.candidates].map((candidate) => candidate.candidate_ordinal).sort((a, b) => a - b)
  if (ordinals.some((ordinal, index) => ordinal !== index + 1)) {
    throw new Error("candidate ordinals must be contiguous from 1")
  }
  for (const candidate of group.candidates) {
    if (!candidate.candidate_id || !candidate.candidate_identity_hash) {
      throw new Error("candidate identity is required")
    }
    if (candidate.candidate_identity_hash !== candidateIdentityHash(candidate.parameter_assignment_json)) {
      throw new Error(`candidate_identity_hash does not match candidate ${candidate.candidate_id}`)
    }
    assertUtcTimestamp(candidate.created_at, "candidate.created_at")
  }
  if (group.group_hash !== trialGroupIdentityHash(group)) {
    throw new Error("group_hash does not match the frozen Trial Group identity")
  }
  assertUtcTimestamp(group.registered_at, "registered_at")
  assertUtcTimestamp(group.created_at, "created_at")
}

function validateExperimentRegistration(experiment: ExperimentRegistrationWrite): void {
  if (
    !experiment.experiment_id || !experiment.proposal_id || !experiment.canonical_node_id
    || !experiment.hypothesis_id || !experiment.code_family_id || !experiment.trial_group_id
    || !experiment.trial_group_hash || !experiment.contract_hash
    || !experiment.identity_hash_policy_version || !experiment.contract_validator_version
    || !experiment.scope_policy_version || !experiment.bootstrap_event_id
    || !experiment.bootstrap_idempotency_key || !Number.isInteger(experiment.proposal_revision)
    || experiment.proposal_revision < 1
  ) {
    throw new Error("complete experiment registration identity is required")
  }
  if (experiment.lifecycle_rule_version !== RESEARCH_LIFECYCLE_RULE_VERSION) {
    throw new Error("unsupported lifecycle_rule_version")
  }
  if (experiment.identity_hash_policy_version !== IDENTITY_HASH_POLICY_VERSION) {
    throw new Error("unsupported identity_hash_policy_version")
  }
  if (experiment.contract_validator_version !== RESEARCH_CONTRACT_VALIDATOR_VERSION) {
    throw new Error("unsupported contract_validator_version")
  }
  const validation = validateResearchProposal("experiment", experiment.contract_json)
  if (!validation.valid) {
    throw new Error(`contract_json is invalid: ${validation.errors.join("; ")}`)
  }
  if (experiment.contract_hash !== hashIdentityPayload(experiment.contract_json)) {
    throw new Error("contract_hash does not match canonical contract_json")
  }
  assertUtcTimestamp(experiment.registered_at, "registered_at")
}

function validateReviewerDecision(decision: ReviewerDecisionWrite): void {
  if (
    !decision.decision_id || !decision.experiment_id || !decision.reviewer_run_id
    || !decision.idempotency_key || !decision.stage_id || !decision.rationale_ref
    || !decision.lifecycle_event_id || !decision.lifecycle_idempotency_key
    || !Number.isInteger(decision.expected_version) || decision.expected_version < 1
    || decision.evidence.length === 0
  ) {
    throw new Error("complete reviewer decision identity, evidence, and expected_version are required")
  }
  if (decision.stage_id === "__any__") {
    throw new Error("review decisions cannot use the __any__ stage sentinel")
  }
  assertUtcTimestamp(decision.created_at, "created_at")
}

function assertUtcTimestamp(value: string, field: string): void {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z$/.test(value) || Number.isNaN(Date.parse(value))) {
    throw new Error(`${field} must be RFC 3339 UTC`)
  }
}

interface ProposalHeaderRow {
  planner_run_id: string
  proposal_kind: string
  materialized_revision: number | null
}

interface ReviewResultRow {
  result_id: string
  experiment_id: string
  result_scope: string
  trial_id: string | null
  stage_id: string
  artifact_ref: string
}

interface FrozenCandidateRow {
  candidate_id: string
  candidate_identity_hash: string
}

function projectReviewerDecisionKnowledge(
  db: Database,
  decision: ReviewerDecisionWrite,
  hypothesisId: string,
  results: Array<ReviewResultRow & { evidence_role: ReviewEvidenceLinkWrite["evidence_role"] }>,
): void {
  const insertNode = db.query(`
    INSERT INTO rd_knowledge_node(
      kg_node_id, node_type, ref_id, slug, name, metadata_json, created_at, updated_at
    ) VALUES ($id, $type, $ref, $slug, $name, NULL, $now, $now)
    ON CONFLICT(kg_node_id) DO NOTHING
  `)
  insertNode.run({ $id: `kg:hypothesis:${hypothesisId}`, $type: "hypothesis", $ref: hypothesisId, $slug: hypothesisId, $name: hypothesisId, $now: decision.created_at })
  insertNode.run({ $id: `kg:review-decision:${decision.decision_id}`, $type: "review_decision", $ref: decision.decision_id, $slug: decision.decision_id, $name: decision.decision_id, $now: decision.created_at })
  const polarity = decision.decision === "reject" || decision.decision === "modify" ? "refutes" : "supports"
  for (const result of results) {
    insertNode.run({ $id: `kg:result:${result.result_id}`, $type: "result", $ref: result.result_id, $slug: result.result_id, $name: result.result_id, $now: decision.created_at })
    db.query(`
      INSERT INTO rd_knowledge_edge(edge_id, from_kg_node_id, to_kg_node_id, edge_type, metadata_json, created_at)
      VALUES ($id, $from, $to, 'evaluates', $metadata, $now)
      ON CONFLICT(from_kg_node_id, to_kg_node_id, edge_type) DO NOTHING
    `).run({
      $id: `kg-edge:decision-evaluates:${decision.decision_id}:${result.result_id}`,
      $from: `kg:review-decision:${decision.decision_id}`, $to: `kg:result:${result.result_id}`,
      $metadata: JSON.stringify({ evidence_role: result.evidence_role }), $now: decision.created_at,
    })
    const edgeId = `kg-edge:result-${polarity}:${result.result_id}:${hypothesisId}`
    db.query(`
      INSERT INTO rd_knowledge_edge(edge_id, from_kg_node_id, to_kg_node_id, edge_type, metadata_json, created_at)
      VALUES ($id, $from, $to, $type, NULL, $now)
      ON CONFLICT(from_kg_node_id, to_kg_node_id, edge_type) DO NOTHING
    `).run({
      $id: edgeId, $from: `kg:result:${result.result_id}`, $to: `kg:hypothesis:${hypothesisId}`,
      $type: polarity, $now: decision.created_at,
    })
    db.query(`
      INSERT INTO rd_knowledge_edge_evidence(
        edge_evidence_id, edge_id, evidence_ref, evidence_type, observed_at,
        idempotency_key, metadata_json, created_at
      ) VALUES ($id, $edge, $ref, 'review_decision', $now, $key, $metadata, $now)
    `).run({
      $id: `kg-evidence:${decision.decision_id}:${result.result_id}`,
      $edge: edgeId, $ref: decision.rationale_ref,
      $key: `kg-evidence:${decision.idempotency_key}:${result.result_id}`,
      $metadata: JSON.stringify({ result_ref: result.artifact_ref, evidence_role: result.evidence_role }),
      $now: decision.created_at,
    })
  }
}

function projectExperimentRegistrationKnowledge(db: Database, experiment: ExperimentRegistrationWrite): void {
  const insertNode = db.query(`
    INSERT INTO rd_knowledge_node(
      kg_node_id, node_type, ref_id, slug, name, metadata_json, created_at, updated_at
    ) VALUES ($id, $type, $ref, $slug, $name, NULL, $now, $now)
    ON CONFLICT(kg_node_id) DO NOTHING
  `)
  const nodes = [
    [`kg:canonical:${experiment.canonical_node_id}`, "canonical_strategy", experiment.canonical_node_id],
    [`kg:hypothesis:${experiment.hypothesis_id}`, "hypothesis", experiment.hypothesis_id],
    [`kg:trial-group:${experiment.trial_group_id}`, "trial_group", experiment.trial_group_id],
    [`kg:experiment:${experiment.experiment_id}`, "experiment", experiment.experiment_id],
  ] as const
  for (const [id, type, ref] of nodes) insertNode.run({ $id: id, $type: type, $ref: ref, $slug: ref, $name: ref, $now: experiment.registered_at })
  const edges: Array<readonly [string, string, string, string]> = [
    [`kg-edge:hypothesis-derived:${experiment.hypothesis_id}`, `kg:hypothesis:${experiment.hypothesis_id}`, `kg:canonical:${experiment.canonical_node_id}`, "derived_from"],
    [`kg-edge:experiment-tests:${experiment.experiment_id}`, `kg:experiment:${experiment.experiment_id}`, `kg:hypothesis:${experiment.hypothesis_id}`, "tests"],
    [`kg-edge:experiment-group:${experiment.experiment_id}`, `kg:experiment:${experiment.experiment_id}`, `kg:trial-group:${experiment.trial_group_id}`, "member_of"],
  ]
  if (experiment.parent_experiment_id) {
    insertNode.run({
      $id: `kg:experiment:${experiment.parent_experiment_id}`, $type: "experiment",
      $ref: experiment.parent_experiment_id, $slug: experiment.parent_experiment_id,
      $name: experiment.parent_experiment_id, $now: experiment.registered_at,
    })
    edges.push([
      `kg-edge:experiment-child:${experiment.experiment_id}`,
      `kg:experiment:${experiment.experiment_id}`,
      `kg:experiment:${experiment.parent_experiment_id}`,
      "child_of",
    ])
  }
  const insertEdge = db.query(`
    INSERT INTO rd_knowledge_edge(edge_id, from_kg_node_id, to_kg_node_id, edge_type, metadata_json, created_at)
    VALUES ($id, $from, $to, $type, NULL, $now)
    ON CONFLICT(from_kg_node_id, to_kg_node_id, edge_type) DO NOTHING
  `)
  for (const [id, from, to, type] of edges) insertEdge.run({ $id: id, $from: from, $to: to, $type: type, $now: experiment.registered_at })
}
