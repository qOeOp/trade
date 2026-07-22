import { Database } from "bun:sqlite"
import { expect, test } from "bun:test"
import {
  DEVELOPER_CONTRACT_DRAFT_INTAKE_REQUEST_SCHEMA_VERSION,
  DEVELOPER_CONTRACT_DRAFT_SUBMISSION_SCHEMA_VERSION,
  DEVELOPER_DEVELOPMENT_BRIEF_ISSUE_REQUEST_SCHEMA_VERSION,
  DEVELOPER_EXPERIMENT_CONTRACT_DRAFT_PAYLOAD_SCHEMA_VERSION,
  TARGET_EXPERIMENT_CONTRACT_SCHEMA_VERSION,
  createDeveloperContractDraftSubmission,
} from "../../../contracts/src/lib/developer-contract-draft"
import {
  DEVELOPER_CONTRACT_DRAFT_VALIDATION_REQUEST_SCHEMA_VERSION,
} from "../../../contracts/src/lib/developer-contract-draft-validation"
import { canonicalControlPlaneHash } from "../../../contracts/src/lib/control-plane-contracts"
import {
  PLANNER_PROPOSAL_INTAKE_REQUEST_SCHEMA_VERSION,
  PLANNER_PROPOSAL_SUBMISSION_SCHEMA_VERSION,
  createPlannerProposalSubmission,
} from "../../../contracts/src/lib/planner-proposal-submission"
import {
  issueDeveloperDevelopmentBrief,
  readDeveloperContractDraftReceipt,
  readDeveloperDevelopmentBrief,
  receiveDeveloperContractDraft,
} from "./developer-contract-draft-intake"
import {
  readDeveloperContractDraftValidation,
  validateDeveloperContractDraft,
} from "./developer-contract-draft-validation"
import { admitPlannerProposal } from "./planner-proposal-intake"
import { RESEARCH_CONTRACT_VALIDATOR_VERSION } from "./research-contract-validator"
import { readPlannerControlPlaneContext } from "./research-control-plane-operations"
import { ensureResearchStateSchema } from "./research-state-store"
import { seedDefaultResearchControlPlane } from "./research-universe-default-seed"

function openDb(): Database {
  const db = new Database(":memory:")
  ensureResearchStateSchema(db)
  seedDefaultResearchControlPlane(db, "2026-07-22T12:00:00Z")
  return db
}

function admitProposal(db: Database, proposalRevision = 1, objective = "Test one bounded mechanism") {
  const context = readPlannerControlPlaneContext(db)
  const proposal = createPlannerProposalSubmission({
    schema_version: PLANNER_PROPOSAL_SUBMISSION_SCHEMA_VERSION,
    revision: 2,
    proposal_id: "proposal-1",
    hypothesis_id: "hypothesis-1",
    universe_node_id: "canonical:trend/time-series-trend/time-series-momentum",
    objective,
    dataset_requirements: ["ohlcv"],
    candidate_space: proposalRevision === 1 ? { lookback: [20, 40] } : { lookback: [20] },
    trial_budget: 2,
    evaluation_protocol_ref: "protocol://historical-v1",
    control_plane_context_hash: context.context_hash,
    created_at: proposalRevision === 1 ? "2026-07-22T12:01:00Z" : "2026-07-22T12:07:00Z",
  })
  admitPlannerProposal(db, {
    schema_version: PLANNER_PROPOSAL_INTAKE_REQUEST_SCHEMA_VERSION,
    planner_run_id: `planner-run-${proposalRevision}`,
    proposal_revision: proposalRevision,
    idempotency_key: `planner-intake-${proposalRevision}`,
    submitted_at: proposalRevision === 1 ? "2026-07-22T12:02:00Z" : "2026-07-22T12:08:00Z",
    recorded_at: proposalRevision === 1 ? "2026-07-22T12:03:00Z" : "2026-07-22T12:09:00Z",
    proposal,
  })
  return proposal
}

function issueBrief(db: Database, proposalRevision = 1, overrides: Record<string, unknown> = {}) {
  return issueDeveloperDevelopmentBrief(db, {
    schema_version: DEVELOPER_DEVELOPMENT_BRIEF_ISSUE_REQUEST_SCHEMA_VERSION,
    brief_id: `brief-${proposalRevision}`,
    proposal_id: "proposal-1",
    proposal_revision: proposalRevision,
    idempotency_key: `brief-issue-${proposalRevision}`,
    issued_at: proposalRevision === 1 ? "2026-07-22T12:04:00Z" : "2026-07-22T12:10:00Z",
    ...overrides,
  })
}

function draft(brief: ReturnType<typeof issueBrief>, overrides: Record<string, unknown> = {}) {
  return createDeveloperContractDraftSubmission({
    schema_version: DEVELOPER_CONTRACT_DRAFT_SUBMISSION_SCHEMA_VERSION,
    brief_id: brief.brief_id,
    brief_hash: brief.brief_hash,
    proposal_id: brief.proposal_id,
    proposal_revision: brief.proposal_revision,
    proposal_hash: brief.proposal_hash,
    developer_run_id: "developer-run-1",
    draft_revision: 1,
    allowed_candidate_space_hash: brief.allowed_candidate_space_hash,
    requested_trial_budget: 2,
    target_contract_schema_version: TARGET_EXPERIMENT_CONTRACT_SCHEMA_VERSION,
    draft_json: {
      schema_version: DEVELOPER_EXPERIMENT_CONTRACT_DRAFT_PAYLOAD_SCHEMA_VERSION,
      canonical_node_id: brief.universe_node_id,
      required_data: ["ohlcv"],
    },
    created_at: "2026-07-22T12:05:00Z",
    ...overrides,
  })
}

function receive(db: Database, submission: ReturnType<typeof draft>, overrides: Record<string, unknown> = {}) {
  return receiveDeveloperContractDraft(db, {
    schema_version: DEVELOPER_CONTRACT_DRAFT_INTAKE_REQUEST_SCHEMA_VERSION,
    idempotency_key: `draft-intake-${submission.draft_revision}`,
    recorded_at: "2026-07-22T12:06:00Z",
    submission,
    ...overrides,
  })
}

function validDraftPayload(brief: ReturnType<typeof issueBrief>, lookback = 20) {
  const candidateAssignments = [{ candidate_id: "candidate-1", parameters: { lookback } }]
  const candidateAssignmentSetHash = canonicalControlPlaneHash(candidateAssignments)
  return {
    schema_version: DEVELOPER_EXPERIMENT_CONTRACT_DRAFT_PAYLOAD_SCHEMA_VERSION,
    canonical_node_id: brief.universe_node_id,
    required_data: ["ohlcv"],
    candidate_space: brief.candidate_space,
    candidate_assignments: candidateAssignments,
    contract: {
      schema_version: TARGET_EXPERIMENT_CONTRACT_SCHEMA_VERSION,
      canonical_node_id: brief.universe_node_id,
      code_family_id: "time_series_momentum_v1",
      implementation_version: "v1",
      contract_versions: {
        identity_hash_policy: "identity-v1",
        validator: RESEARCH_CONTRACT_VALIDATOR_VERSION,
        lifecycle_rule: "lifecycle-v1",
        scope_policy: "scope-v1",
      },
      hypothesis: { falsifiable_claim: "trend persistence exceeds costs" },
      economic_rationale: { why_exists: "slow positioning adjustment" },
      asset_universe_definition: { venue: "binance-usdm", selection_timestamp_rule: "point_in_time" },
      timeframe: { signal: "4h", execution: "4h" },
      sampling_and_alignment: { closed_candle_only: true },
      required_data: ["ohlcv"],
      feature_definition: {}, target_definition: {}, forecast_definition: {}, signal_definition: {},
      position_rule: {}, portfolio_construction: {}, risk_rule: {}, execution_rule: {},
      transaction_cost_model: {}, expected_holding_period: {}, benchmark: {},
      validation_plan: { evaluation_protocol_ref: brief.evaluation_protocol_ref },
      rejection_criteria: ["net return does not exceed cost"],
      trial_group_ref: {
        trial_group_id: "group-1",
        group_hash: "f".repeat(64),
        search_space_hash: brief.allowed_candidate_space_hash,
        max_trials: 2,
      },
      candidate_registration: {
        candidate_ids: ["candidate-1"],
        candidate_space_hash: brief.allowed_candidate_space_hash,
        candidate_assignment_set_hash: candidateAssignmentSetHash,
      },
      parent_experiment_id: null,
      random_seed: 1,
      code_commit_ref: "git://code",
      harness_commit_ref: "git://harness",
      data_snapshot_ref: "data://snapshot",
      assumptions_ref: "assumptions://v1",
      replay_execution_input: {
        supplemental_requirement_set_schema_version: "trade.rd-replay-supplemental-requirement-set.v1",
        supplemental_requirement_set_hash: "f126b641e1c2e55c174e3505e15232b466e50c3fd764f30968a925821c31d144",
      },
    },
  }
}

test("Control Plane issues one immutable Brief and receives an unvalidated Draft idempotently", () => {
  const db = openDb()
  try {
    admitProposal(db)
    const brief = issueBrief(db)
    expect(issueBrief(db)).toEqual(brief)
    expect(readDeveloperDevelopmentBrief(db, brief.brief_id)).toEqual(brief)
    expect(brief.authority_scope).toBe("contract_draft_only")

    const submission = draft(brief)
    const receipt = receive(db, submission)
    expect(receive(db, submission)).toEqual(receipt)
    expect(readDeveloperContractDraftReceipt(db, brief.brief_id, 1)).toEqual(receipt)
    expect(receipt.status).toBe("received_unvalidated")
    expect(count(db, "rd_developer_development_brief")).toBe(1)
    expect(count(db, "rd_developer_contract_draft")).toBe(1)
    expect(count(db, "rd_experiment_contract")).toBe(0)
    expect(count(db, "rd_trial_group")).toBe(0)
    expect(count(db, "rd_trial")).toBe(0)
    expect(() => db.query("UPDATE rd_developer_contract_draft SET developer_run_id='drift'").run())
      .toThrow("append-only")
    expect(() => db.query("DELETE FROM rd_developer_development_brief WHERE brief_id='brief-1'").run())
      .toThrow("immutable")
  } finally {
    db.close()
  }
})

test("Control Plane rejects Draft declared-scope drift, excess budget, and revision gaps", () => {
  const db = openDb()
  try {
    admitProposal(db)
    const brief = issueBrief(db)
    expect(() => receive(db, draft(brief, { allowed_candidate_space_hash: "a".repeat(64) })))
      .toThrow("exact Brief candidate-space hash")
    expect(() => receive(db, draft(brief, { requested_trial_budget: 3 })))
      .toThrow("cannot exceed")
    expect(() => receive(db, draft(brief, {
      draft_revision: 2,
      developer_run_id: "developer-run-2",
      created_at: "2026-07-22T12:05:30Z",
    }), { idempotency_key: "draft-intake-gap" })).toThrow("revision must be 1")
    expect(count(db, "rd_developer_contract_draft")).toBe(0)
  } finally {
    db.close()
  }
})

test("a newer Proposal revision makes an unconsumed Brief stale without rewriting history", () => {
  const db = openDb()
  try {
    admitProposal(db)
    const oldBrief = issueBrief(db)
    const oldDraft = draft(oldBrief)
    admitProposal(db, 2, "Narrow the same mechanism")
    expect(() => receive(db, oldDraft)).toThrow("Brief is stale")
    expect(() => issueBrief(db, 1, {
      brief_id: "brief-old-retry",
      idempotency_key: "brief-old-retry",
      issued_at: "2026-07-22T12:10:00Z",
    })).toThrow("latest Proposal revision")
    const currentBrief = issueBrief(db, 2)
    expect(currentBrief.proposal_revision).toBe(2)
    expect(readDeveloperDevelopmentBrief(db, oldBrief.brief_id)).toEqual(oldBrief)
    expect(count(db, "rd_developer_contract_draft")).toBe(0)
  } finally {
    db.close()
  }
})

test("Control Plane records a fully reconciled latest Draft as valid without freezing Contract", () => {
  const db = openDb()
  try {
    admitProposal(db)
    const brief = issueBrief(db)
    const submission = draft(brief, { draft_json: validDraftPayload(brief) })
    receive(db, submission)
    const request = {
      schema_version: DEVELOPER_CONTRACT_DRAFT_VALIDATION_REQUEST_SCHEMA_VERSION,
      validation_id: "validation-1",
      brief_id: brief.brief_id,
      draft_revision: 1,
      idempotency_key: "draft-validation-1",
      validated_at: "2026-07-22T12:07:00Z",
    } as const
    const validation = validateDeveloperContractDraft(db, request)
    expect(validateDeveloperContractDraft(db, request)).toEqual(validation)
    expect(readDeveloperContractDraftValidation(db, validation.validation_id)).toEqual(validation)
    expect(validation.status).toBe("valid")
    expect(validation.errors).toEqual([])
    expect(count(db, "rd_developer_contract_draft_validation")).toBe(1)
    expect(count(db, "rd_experiment_contract")).toBe(0)
    expect(count(db, "rd_trial_group")).toBe(0)
    expect(() => db.query("UPDATE rd_developer_contract_draft_validation SET validation_status='invalid'").run())
      .toThrow("immutable")
  } finally {
    db.close()
  }
})

test("Control Plane persists invalid Draft evidence for incomplete and out-of-space content", () => {
  const incompleteDb = openDb()
  try {
    admitProposal(incompleteDb)
    const brief = issueBrief(incompleteDb)
    receive(incompleteDb, draft(brief))
    const invalid = validateDeveloperContractDraft(incompleteDb, {
      schema_version: DEVELOPER_CONTRACT_DRAFT_VALIDATION_REQUEST_SCHEMA_VERSION,
      validation_id: "validation-incomplete",
      brief_id: brief.brief_id,
      draft_revision: 1,
      idempotency_key: "draft-validation-incomplete",
      validated_at: "2026-07-22T12:07:00Z",
    })
    expect(invalid.status).toBe("invalid")
    expect(invalid.errors.some((error) => error.includes("contract.schema_version"))).toBe(true)
    expect(count(incompleteDb, "rd_experiment_contract")).toBe(0)
  } finally {
    incompleteDb.close()
  }

  const outOfSpaceDb = openDb()
  try {
    admitProposal(outOfSpaceDb)
    const brief = issueBrief(outOfSpaceDb)
    const submission = draft(brief, { draft_json: validDraftPayload(brief, 99) })
    receive(outOfSpaceDb, submission)
    const invalid = validateDeveloperContractDraft(outOfSpaceDb, {
      schema_version: DEVELOPER_CONTRACT_DRAFT_VALIDATION_REQUEST_SCHEMA_VERSION,
      validation_id: "validation-out-of-space",
      brief_id: brief.brief_id,
      draft_revision: 1,
      idempotency_key: "draft-validation-out-of-space",
      validated_at: "2026-07-22T12:07:00Z",
    })
    expect(invalid.status).toBe("invalid")
    expect(invalid.errors).toContain("candidate candidate-1 parameter lookback is outside candidate_space")
  } finally {
    outOfSpaceDb.close()
  }
})

test("Draft validation rejects superseded revisions and idempotency-key drift", () => {
  const db = openDb()
  try {
    admitProposal(db)
    const brief = issueBrief(db)
    receive(db, draft(brief))
    receive(db, draft(brief, {
      developer_run_id: "developer-run-2",
      draft_revision: 2,
      draft_json: validDraftPayload(brief),
      created_at: "2026-07-22T12:05:30Z",
    }))
    expect(() => validateDeveloperContractDraft(db, {
      schema_version: DEVELOPER_CONTRACT_DRAFT_VALIDATION_REQUEST_SCHEMA_VERSION,
      validation_id: "validation-superseded",
      brief_id: brief.brief_id,
      draft_revision: 1,
      idempotency_key: "draft-validation-superseded",
      validated_at: "2026-07-22T12:07:00Z",
    })).toThrow("latest received")
    const request = {
      schema_version: DEVELOPER_CONTRACT_DRAFT_VALIDATION_REQUEST_SCHEMA_VERSION,
      validation_id: "validation-current",
      brief_id: brief.brief_id,
      draft_revision: 2,
      idempotency_key: "draft-validation-current",
      validated_at: "2026-07-22T12:07:00Z",
    } as const
    expect(validateDeveloperContractDraft(db, request).status).toBe("valid")
    expect(() => validateDeveloperContractDraft(db, {
      ...request,
      validation_id: "validation-drift",
    })).toThrow("idempotency key already exists")
    expect(count(db, "rd_developer_contract_draft_validation")).toBe(1)
  } finally {
    db.close()
  }
})

function count(db: Database, table: string): number {
  return (db.query(`SELECT COUNT(*) AS count FROM ${table}`).get() as { count: number }).count
}
