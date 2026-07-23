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
import { DEVELOPER_CONTRACT_FREEZE_REQUEST_SCHEMA_VERSION } from "../../../contracts/src/lib/developer-contract-freeze"
import {
  canonicalControlPlaneHash,
  hashReplayAttemptLeaseSnapshot,
} from "../../../contracts/src/lib/control-plane-contracts"
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
import { freezeDeveloperExperimentContract, readDeveloperContractFreeze } from "./developer-contract-freeze"
import {
  readExperimentTrialPlan,
  startExperimentTrialPlan,
  startFrozenExperimentTrialPlan,
} from "./experiment-trial-plan"
import {
  EXPERIMENT_TRIAL_PLAN_REQUEST_SCHEMA_VERSION,
  FROZEN_EXPERIMENT_TRIAL_PLAN_START_SCHEMA_VERSION,
  type ExperimentTrialPlanRequest,
} from "../../../contracts/src/lib/experiment-trial-plan"
import { admitPlannerProposal } from "./planner-proposal-intake"
import { RESEARCH_CONTRACT_VALIDATOR_VERSION } from "./research-contract-validator"
import { compileDeveloperContractFreezeTrialGroup } from "./developer-contract-freeze-compiler"
import { IDENTITY_HASH_POLICY_VERSION } from "./research-identity-hash"
import { RESEARCH_LIFECYCLE_RULE_VERSION } from "./research-control-plane-schema"
import { readPlannerControlPlaneContext } from "./research-control-plane-operations"
import { ensureResearchStateSchema } from "./research-state-store"
import { seedDefaultResearchControlPlane } from "./research-universe-default-seed"
import {
  REPLAY_INSTRUMENT_STATUS_PROVIDER_CERTIFICATION_SCHEMA_VERSION,
  createReplayInstrumentStatusProviderCertificationSnapshot,
} from "../../../contracts/src/lib/control-plane-contracts"
import {
  REPLAY_CERTIFIED_CAPABILITIES,
  REPLAY_DATASET_MANIFEST_SCHEMA_VERSION,
  REPLAY_INSTRUMENT_ACCOUNTING_SPEC_VERSION,
  REPLAY_INSTRUMENT_SPEC_SNAPSHOT_SCHEMA_VERSION,
  REPLAY_INSTRUMENT_STATUS_SNAPSHOT_SCHEMA_VERSION,
  REPLAY_NO_DECISION_MARKET_INPUT,
  REPLAY_NO_DECISION_MARKET_INPUT_HASH,
  REPLAY_NO_SUPPLEMENTAL_REQUIREMENTS,
  REPLAY_NO_SUPPLEMENTAL_REQUIREMENTS_HASH,
  REPLAY_REQUEST_SCHEMA_VERSION,
  REPLAY_SIMULATOR_POLICY_VERSION,
  REPLAY_VENUE_RISK_POLICY_SCHEMA_VERSION,
  canonicalHash,
  createReplayInstrumentStatusProvenance,
  createReplaySingleDecisionSchedule,
  replayDatasetHash,
  replayDatasetManifestHash,
  replayExecutionSpecHash,
  type ReplayDatasetManifest,
  type ReplayExecutionRequest,
  type ReplayMarketBar,
} from "../../../../replay-execution-plane/contracts/src/lib/replay-contracts"
import { registerReplayInstrumentStatusProviderCertification } from "./instrument-status-provider-certification-registry"
import {
  admitReplayTrialReservation,
  readReplayTrialReservationAdmission,
} from "./replay-trial-reservation-admission"
import { REPLAY_TRIAL_RESERVATION_ADMISSION_REQUEST_SCHEMA_VERSION } from "../../../contracts/src/lib/replay-trial-reservation-admission"
import {
  readRegisteredReplayExecutionRequest,
  readReplayRequestRegistration,
  registerReplayExecutionRequest,
} from "./replay-request-registration"
import { REPLAY_REQUEST_REGISTRATION_REQUEST_SCHEMA_VERSION } from "../../../contracts/src/lib/replay-request-registration"
import {
  claimRegisteredReplayAttempt,
  finalizeReplayAttempt,
  issueReplayRegisteredAttemptDispatchAuthority,
  renewReplayAttemptLease,
} from "./replay-attempt-authority"
import { REPLAY_ATTEMPT_ADMISSION_REQUEST_SCHEMA_VERSION } from "../../../contracts/src/lib/replay-attempt-admission"

const REPLAY_HASH = "2".repeat(64)
const REPLAY_PROVIDER_CERTIFICATION = createReplayInstrumentStatusProviderCertificationSnapshot({
  schema_version: REPLAY_INSTRUMENT_STATUS_PROVIDER_CERTIFICATION_SCHEMA_VERSION,
  certification_id: "trial-plan-status-provider-certification",
  certification_ref: "certification://trial-plan-status-provider/v1",
  status: "certified",
  certified_at: "2026-07-22T08:00:00Z",
  valid_until: "2026-08-01T00:00:00Z",
  certifier_id: "research-control-plane",
  certification_policy_version: "rd-status-provider-certification-v1",
  provider_capability_hash: REPLAY_HASH,
  producer_domain: "market-data-products",
  producer_id: "trial-plan-status-producer",
  producer_version: "v1",
  producer_build_hash: REPLAY_HASH,
  normalization_policy_version: "trial-plan-status-normalization-v1",
  normalization_policy_hash: REPLAY_HASH,
  allowed_source_kind: "venue_status_event_archive",
  allowed_completeness: "complete_history",
})

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
  const group = compileDeveloperContractFreezeTrialGroup({
    trial_group_id: "group-1",
    hypothesis_id: brief.hypothesis_id,
    candidate_space: brief.candidate_space,
    candidate_assignments: candidateAssignments,
    max_trials: 2,
    compiled_at: "2026-07-22T12:05:00Z",
  })
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
        identity_hash_policy: IDENTITY_HASH_POLICY_VERSION,
        validator: RESEARCH_CONTRACT_VALIDATOR_VERSION,
        lifecycle_rule: RESEARCH_LIFECYCLE_RULE_VERSION,
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
        group_hash: group.group_hash,
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

function replayFixture(plan: ReturnType<typeof startExperimentTrialPlan>): {
  manifest: ReplayDatasetManifest
  request: ReplayExecutionRequest
} {
  const bar: ReplayMarketBar = {
    open_time: "2026-07-22T04:00:00Z", close_time: "2026-07-22T08:00:00Z",
    open: 100, high: 111, low: 99, close: 110, volume: 10, closed: true,
  }
  const dataHash = replayDatasetHash([bar])
  const maintenanceTier = {
    tier_id: "tier-1", snapshot_ref: "fixture:margin-tier-1", snapshot_hash: REPLAY_HASH,
    notional_floor: 0, notional_cap: 50_000, maintenance_margin_rate: 0.005,
    maintenance_amount: 0,
  }
  const risk = {
    schema_version: REPLAY_VENUE_RISK_POLICY_SCHEMA_VERSION,
    snapshot_id: "trial-plan-risk-1", venue_id: "binance-usdm", symbol: "BTCUSDT",
    effective_at: "2020-01-01T00:00:00Z", valid_until: null,
    observed_at: "2026-07-22T08:00:00Z", source_ref: "fixture:trial-plan-risk",
    source_hash: REPLAY_HASH, initial_margin_rate: 0.1, maintenance_tier: maintenanceTier,
    liquidation_fee_bps: 50,
  }
  const instrumentSpec = {
    schema_version: REPLAY_INSTRUMENT_SPEC_SNAPSHOT_SCHEMA_VERSION,
    snapshot_id: "trial-plan-spec-1", venue_id: "binance-usdm", symbol: "BTCUSDT",
    effective_at: "2020-01-01T00:00:00Z", valid_until: null,
    observed_at: "2026-07-22T08:00:00Z", source_ref: "fixture:trial-plan-spec",
    source_hash: REPLAY_HASH,
  }
  const status = {
    schema_version: REPLAY_INSTRUMENT_STATUS_SNAPSHOT_SCHEMA_VERSION,
    snapshot_id: "trial-plan-status-1", venue_id: "binance-usdm", symbol: "BTCUSDT",
    status: "trading" as const, effective_at: "2020-01-01T00:00:00Z", valid_until: null,
    observed_at: "2026-07-22T08:00:00Z", source_ref: "fixture:trial-plan-status",
    source_hash: REPLAY_HASH,
  }
  const provenance = createReplayInstrumentStatusProvenance({
    producer_domain: REPLAY_PROVIDER_CERTIFICATION.producer_domain,
    producer_id: REPLAY_PROVIDER_CERTIFICATION.producer_id,
    producer_version: REPLAY_PROVIDER_CERTIFICATION.producer_version,
    producer_build_hash: REPLAY_PROVIDER_CERTIFICATION.producer_build_hash,
    provider_capability_hash: REPLAY_PROVIDER_CERTIFICATION.provider_capability_hash,
    provider_certification_ref: REPLAY_PROVIDER_CERTIFICATION.certification_ref,
    provider_certification_hash: REPLAY_PROVIDER_CERTIFICATION.certification_hash,
    source_owner: "binance-usdm", source_kind: "venue_status_event_archive",
    normalization_policy_version: REPLAY_PROVIDER_CERTIFICATION.normalization_policy_version,
    normalization_policy_hash: REPLAY_PROVIDER_CERTIFICATION.normalization_policy_hash,
    completeness: "complete_history", coverage_start: "2020-01-01T00:00:00Z",
    coverage_end: "2026-07-22T08:00:00Z", source_observed_through: "2026-07-22T08:00:00Z",
    produced_at: "2026-07-22T08:00:00Z", source_ref: "fixture:trial-plan-status-source",
    source_hash: REPLAY_HASH, source_record_count: 1, status_epochs: [status],
  })
  const accounting = {
    spec_version: REPLAY_INSTRUMENT_ACCOUNTING_SPEC_VERSION,
    product_type: "linear_derivative" as const, base_asset: "BTC", quote_asset: "USDT",
    settlement_asset: "USDT", contract_multiplier: "1", price_increment: "0.01",
    quantity_increment: "0.001", settlement_increment: "0.00000001",
  }
  const manifest: ReplayDatasetManifest = {
    schema_version: REPLAY_DATASET_MANIFEST_SCHEMA_VERSION,
    manifest_id: "trial-plan-manifest-1", manifest_ref: "dataset://trial-plan-replay-1",
    data_hash: dataHash, dataset_kind: "ohlcv", symbol: "BTCUSDT", timeframe: "4h",
    interval_ms: 14_400_000, row_count: 1, first_open_time: bar.open_time,
    last_close_time: bar.close_time, observed_through: bar.close_time,
    closed_candles_only: true, bar_final_availability: "close_time",
    funding_availability: "event_time", mark_availability: "event_time",
    mark_coverage: "none", mark_interval_ms: null, mark_event_count: 0,
    supplemental_facts: {
      coverage: "none", record_count: 0, source_ids: [], content_hash: canonicalHash([]),
      requirement_set_hash: REPLAY_NO_SUPPLEMENTAL_REQUIREMENTS_HASH,
    },
    venue_risk_policy_epochs: [risk],
    instrument: {
      listed_at: "2020-01-01T00:00:00Z", trading_enabled_at: "2020-01-01T00:00:00Z",
      delisted_at: null, status_history: "complete", status_epochs: [status],
      status_provenance: provenance, spec_epochs: [instrumentSpec], accounting,
    },
    universe: { selected_at: "2026-07-22T00:00:00Z", survivorship: "point_in_time" },
  }
  const trial = plan.trials[0]!
  const order: ReplayExecutionRequest["order"] = {
    side: "long", quantity: 1, signal_time: "2026-07-22T00:00:00Z",
    earliest_executable_time: bar.open_time, stop_price: 95, target_price: 110,
    entry_execution: { order_type: "market" },
  }
  const decisionSchedule = createReplaySingleDecisionSchedule(order)
  const request: ReplayExecutionRequest = {
    schema_version: REPLAY_REQUEST_SCHEMA_VERSION,
    run_id: trial.run_id, idempotency_key: "trial-plan-replay-request-key-1",
    experiment_id: plan.experiment_id, trial_group_id: plan.trial_group_id,
    trial_group_hash: plan.trial_group_hash, trial_id: trial.trial_id,
    candidate_id: trial.candidate_id, candidate_hash: trial.candidate_identity_hash,
    identity_hash_policy_version: plan.identity_hash_policy_version,
    experiment_contract_hash: plan.experiment_contract_hash,
    trial_reservation_ref: "reservation://pre-admission-placeholder",
    trial_reservation_hash: "0".repeat(64), dataset_manifest_ref: manifest.manifest_ref,
    dataset_hash: manifest.data_hash, supplemental_facts_hash: manifest.supplemental_facts.content_hash,
    supplemental_requirement_set: structuredClone(REPLAY_NO_SUPPLEMENTAL_REQUIREMENTS),
    supplemental_requirement_set_hash: REPLAY_NO_SUPPLEMENTAL_REQUIREMENTS_HASH,
    decision_market_input_requirement: structuredClone(REPLAY_NO_DECISION_MARKET_INPUT),
    decision_market_input_requirement_hash: REPLAY_NO_DECISION_MARKET_INPUT_HASH,
    decision_schedule: decisionSchedule, decision_schedule_hash: canonicalHash(decisionSchedule),
    venue_risk_policy_schedule_hash: canonicalHash(manifest.venue_risk_policy_epochs),
    instrument_spec_schedule_hash: canonicalHash({ epochs: manifest.instrument.spec_epochs, accounting }),
    instrument_status_schedule_hash: canonicalHash(manifest.instrument.status_epochs),
    instrument_status_provenance_hash: canonicalHash(manifest.instrument.status_provenance),
    instrument_status_provider_capability_hash: provenance.provider_capability_hash,
    instrument_status_provider_certification_hash: provenance.provider_certification_hash,
    harness_hash: REPLAY_HASH, assumptions_hash: REPLAY_HASH, symbol: manifest.symbol,
    timeframe: manifest.timeframe, initial_cash: 1000, order,
    cost_policy: { policy_id: "fixture", version: "1", fee_bps: 0, slippage_bps: 0, liquidation_fee_bps: 50 },
    simulator_policy: {
      version: REPLAY_SIMULATOR_POLICY_VERSION, signal_visibility: "closed_candle",
      earliest_execution: "next_open", same_bar_policy: "stop_first", gap_fill_policy: "worse_open",
      position_accounting: "average_cost", funding_timing: "exact_event", end_of_data: "mark_open",
      margin_evaluation: "before_strategy_orders",
    },
    margin_policy: {
      policy_id: "fixture", version: "rd-replay-isolated-margin-v7", mode: "isolated",
      collateral_asset: "USDT", isolated_collateral: 1000, initial_margin_rate: 0.1,
      maintenance_tier: maintenanceTier, cashflow_scope: "position_attributed",
      collateral_transfer: "reserve_at_entry_release_at_terminal_if_flat",
      settled_cashflow_account: "isolated_margin_collateral", observation_scope: "source_event_path",
      mark_source_policy: "complete_exact_mark_else_ohlcv_adverse",
      maintenance_trigger: "margin_balance_below_maintenance_requirement",
      breach_terminal_priority: "risk_before_strategy_exit",
      breach_evidence: "first_observed_source_event",
      maintenance_breach_action: "exact_observation_full_liquidation_else_terminal_failure",
      liquidation: "simulated_full_close", liquidation_trigger_sources: "mark_or_funding_mark",
      liquidation_execution_price: "trigger_mark_adverse_slippage", liquidation_quantity: "full_position",
      liquidation_order_priority: "cancel_strategy_exits_before_forced_fill",
      liquidation_deficit: "fail_without_result",
    },
    random_seed: 1,
  }
  return { manifest, request }
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

  const groupDriftDb = openDb()
  try {
    admitProposal(groupDriftDb)
    const brief = issueBrief(groupDriftDb)
    const payload = validDraftPayload(brief)
    payload.contract.trial_group_ref.group_hash = "a".repeat(64)
    receive(groupDriftDb, draft(brief, { draft_json: payload }))
    const invalid = validateDeveloperContractDraft(groupDriftDb, {
      schema_version: DEVELOPER_CONTRACT_DRAFT_VALIDATION_REQUEST_SCHEMA_VERSION,
      validation_id: "validation-group-drift",
      brief_id: brief.brief_id,
      draft_revision: 1,
      idempotency_key: "draft-validation-group-drift",
      validated_at: "2026-07-22T12:07:00Z",
    })
    expect(invalid.status).toBe("invalid")
    expect(invalid.errors).toContain("contract.trial_group_ref.group_hash must match the freeze compiler output")
  } finally {
    groupDriftDb.close()
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

test("Control Plane atomically freezes one valid Draft into formal Contract facts without a Trial", () => {
  const db = openDb()
  try {
    admitProposal(db)
    const brief = issueBrief(db)
    receive(db, draft(brief, { draft_json: validDraftPayload(brief) }))
    const validation = validateDeveloperContractDraft(db, {
      schema_version: DEVELOPER_CONTRACT_DRAFT_VALIDATION_REQUEST_SCHEMA_VERSION,
      validation_id: "validation-freeze",
      brief_id: brief.brief_id,
      draft_revision: 1,
      idempotency_key: "draft-validation-freeze",
      validated_at: "2026-07-22T12:07:00Z",
    })
    const request = {
      schema_version: DEVELOPER_CONTRACT_FREEZE_REQUEST_SCHEMA_VERSION,
      freeze_id: "freeze-1",
      validation_id: validation.validation_id,
      validation_hash: validation.validation_hash,
      experiment_id: "experiment-1",
      bootstrap_lifecycle_event_id: "event-freeze-register-1",
      bootstrap_lifecycle_idempotency_key: "event-freeze-register-key-1",
      idempotency_key: "contract-freeze-key-1",
      frozen_at: "2026-07-22T12:08:00Z",
    } as const
    const frozen = freezeDeveloperExperimentContract(db, request)
    expect(freezeDeveloperExperimentContract(db, request)).toEqual(frozen)
    expect(readDeveloperContractFreeze(db, frozen.freeze_id)).toEqual(frozen)
    expect(frozen.status).toBe("frozen")
    expect(frozen.contract_hash).toBe(validation.contract_candidate_hash)
    expect(count(db, "rd_developer_contract_freeze")).toBe(1)
    expect(count(db, "rd_trial_group")).toBe(1)
    expect(count(db, "rd_trial_group_candidate")).toBe(1)
    expect(count(db, "rd_experiment_contract")).toBe(1)
    expect(count(db, "rd_lifecycle_event")).toBe(1)
    expect(count(db, "rd_trial")).toBe(0)
    expect(db.query(`
      SELECT lifecycle_state, lifecycle_version FROM rd_experiment_contract WHERE experiment_id='experiment-1'
    `).get()).toEqual({ lifecycle_state: "proposed", lifecycle_version: 1 })
    expect(() => db.query("UPDATE rd_developer_contract_freeze SET freeze_compiler_version='drift'").run())
      .toThrow("immutable")
    expect(() => freezeDeveloperExperimentContract(db, { ...request, experiment_id: "experiment-drift" }))
      .toThrow("idempotency key already exists")
  } finally {
    db.close()
  }
})

test("Control Plane starts one frozen Experiment and reserves its complete Trial Plan atomically", () => {
  const db = openDb()
  try {
    admitProposal(db)
    const brief = issueBrief(db)
    receive(db, draft(brief, { draft_json: validDraftPayload(brief) }))
    const validation = validateDeveloperContractDraft(db, {
      schema_version: DEVELOPER_CONTRACT_DRAFT_VALIDATION_REQUEST_SCHEMA_VERSION,
      validation_id: "validation-trial-plan", brief_id: brief.brief_id, draft_revision: 1,
      idempotency_key: "draft-validation-trial-plan", validated_at: "2026-07-22T12:07:00Z",
    })
    const freeze = freezeDeveloperExperimentContract(db, {
      schema_version: DEVELOPER_CONTRACT_FREEZE_REQUEST_SCHEMA_VERSION,
      freeze_id: "freeze-trial-plan", validation_id: validation.validation_id,
      validation_hash: validation.validation_hash, experiment_id: "experiment-trial-plan",
      bootstrap_lifecycle_event_id: "event-trial-plan-register",
      bootstrap_lifecycle_idempotency_key: "event-trial-plan-register-key",
      idempotency_key: "freeze-trial-plan-key", frozen_at: "2026-07-22T12:08:00Z",
    })
    const request = {
      schema_version: EXPERIMENT_TRIAL_PLAN_REQUEST_SCHEMA_VERSION,
      plan_id: "trial-plan-1", freeze_id: freeze.freeze_id, freeze_hash: freeze.freeze_hash,
      experiment_id: freeze.experiment_id, trial_group_id: freeze.trial_group_id,
      trial_group_hash: freeze.trial_group_hash,
      trials: [{
        trial_id: "trial-plan-trial-1", trial_ordinal: 1,
        candidate_id: freeze.candidates[0]!.candidate_id,
        candidate_identity_hash: freeze.candidates[0]!.candidate_identity_hash,
        run_id: "trial-plan-run-1", trial_idempotency_key: "trial-plan-trial-key-1",
      }],
      discovery_lifecycle_event_id: "event-trial-plan-discovery",
      discovery_lifecycle_idempotency_key: "event-trial-plan-discovery-key",
      idempotency_key: "trial-plan-key-1", planned_at: "2026-07-22T12:09:00Z",
    } satisfies ExperimentTrialPlanRequest
    const plan = startExperimentTrialPlan(db, request)
    expect(startExperimentTrialPlan(db, request)).toEqual(plan)
    expect(readExperimentTrialPlan(db, plan.plan_id)).toEqual(plan)
    expect(plan.status).toBe("started_and_reserved")
    expect(plan.replay_execution_authority).toBe("none_until_replay_trial_reservation_snapshot")
    expect(count(db, "rd_experiment_trial_plan")).toBe(1)
    expect(count(db, "rd_experiment_trial_plan_item")).toBe(1)
    expect(count(db, "rd_trial")).toBe(1)
    expect(db.query(`SELECT status FROM rd_trial_group WHERE trial_group_id=$id`)
      .get({ $id: freeze.trial_group_id })).toEqual({ status: "running" })
    expect(db.query(`SELECT lifecycle_state, lifecycle_version FROM rd_experiment_contract WHERE experiment_id=$id`)
      .get({ $id: freeze.experiment_id })).toEqual({ lifecycle_state: "discovery", lifecycle_version: 2 })
    expect(db.query(`SELECT status, counts_against_budget FROM rd_trial WHERE trial_id='trial-plan-trial-1'`)
      .get()).toEqual({ status: "reserved", counts_against_budget: 1 })
    expect(() => db.query("UPDATE rd_experiment_trial_plan SET trial_count=2").run()).toThrow("immutable")
    expect(() => startExperimentTrialPlan(db, { ...request, planned_at: "2026-07-22T12:10:00Z" }))
      .toThrow("idempotency key already exists")
  } finally {
    db.close()
  }
})

test("Control Plane compiles a complete Trial Plan from the immutable Freeze without caller identities", () => {
  const db = openDb()
  try {
    admitProposal(db)
    const brief = issueBrief(db)
    receive(db, draft(brief, { draft_json: validDraftPayload(brief) }))
    const validation = validateDeveloperContractDraft(db, {
      schema_version: DEVELOPER_CONTRACT_DRAFT_VALIDATION_REQUEST_SCHEMA_VERSION,
      validation_id: "validation-owner-trial-plan", brief_id: brief.brief_id, draft_revision: 1,
      idempotency_key: "validation-owner-trial-plan-key", validated_at: "2026-07-22T12:07:00Z",
    })
    const freeze = freezeDeveloperExperimentContract(db, {
      schema_version: DEVELOPER_CONTRACT_FREEZE_REQUEST_SCHEMA_VERSION,
      freeze_id: "freeze-owner-trial-plan", validation_id: validation.validation_id,
      validation_hash: validation.validation_hash, experiment_id: "experiment-owner-trial-plan",
      bootstrap_lifecycle_event_id: "event-owner-trial-plan-register",
      bootstrap_lifecycle_idempotency_key: "event-owner-trial-plan-register-key",
      idempotency_key: "freeze-owner-trial-plan-key", frozen_at: "2026-07-22T12:08:00Z",
    })
    const plan = startFrozenExperimentTrialPlan(db, {
      schema_version: FROZEN_EXPERIMENT_TRIAL_PLAN_START_SCHEMA_VERSION,
      freeze_id: freeze.freeze_id,
      planned_at: "2026-07-22T12:09:00Z",
    })
    const replay = startFrozenExperimentTrialPlan(db, {
      schema_version: FROZEN_EXPERIMENT_TRIAL_PLAN_START_SCHEMA_VERSION,
      freeze_id: freeze.freeze_id,
      planned_at: "2026-07-22T12:10:00Z",
    })

    expect(replay).toEqual(plan)
    expect(plan.freeze_hash).toBe(freeze.freeze_hash)
    expect(plan.trials).toHaveLength(freeze.candidates.length)
    expect(plan.trials.map((trial) => [
      trial.trial_ordinal,
      trial.candidate_id,
      trial.candidate_identity_hash,
    ])).toEqual(freeze.candidates.map((candidate) => [
      candidate.candidate_ordinal,
      candidate.candidate_id,
      candidate.candidate_identity_hash,
    ]))
    expect(plan.plan_id).toContain(freeze.freeze_hash.slice(0, 16))
    expect(plan.trials[0]!.trial_id).toContain(
      freeze.candidates[0]!.candidate_identity_hash.slice(0, 12),
    )
    expect(count(db, "rd_experiment_trial_plan")).toBe(1)
    expect(count(db, "rd_trial")).toBe(freeze.candidates.length)
  } finally {
    db.close()
  }
})

test("Control Plane derives one Reservation Admission and registers its exact Replay Request", () => {
  const db = openDb()
  try {
    registerReplayInstrumentStatusProviderCertification(db, REPLAY_PROVIDER_CERTIFICATION)
    admitProposal(db)
    const brief = issueBrief(db)
    receive(db, draft(brief, { draft_json: validDraftPayload(brief) }))
    const validation = validateDeveloperContractDraft(db, {
      schema_version: DEVELOPER_CONTRACT_DRAFT_VALIDATION_REQUEST_SCHEMA_VERSION,
      validation_id: "validation-replay-reservation", brief_id: brief.brief_id, draft_revision: 1,
      idempotency_key: "validation-replay-reservation-key", validated_at: "2026-07-22T12:07:00Z",
    })
    const freeze = freezeDeveloperExperimentContract(db, {
      schema_version: DEVELOPER_CONTRACT_FREEZE_REQUEST_SCHEMA_VERSION,
      freeze_id: "freeze-replay-reservation", validation_id: validation.validation_id,
      validation_hash: validation.validation_hash, experiment_id: "experiment-replay-reservation",
      bootstrap_lifecycle_event_id: "event-replay-reservation-register",
      bootstrap_lifecycle_idempotency_key: "event-replay-reservation-register-key",
      idempotency_key: "freeze-replay-reservation-key", frozen_at: "2026-07-22T12:08:00Z",
    })
    const plan = startExperimentTrialPlan(db, {
      schema_version: EXPERIMENT_TRIAL_PLAN_REQUEST_SCHEMA_VERSION,
      plan_id: "replay-reservation-plan-1", freeze_id: freeze.freeze_id, freeze_hash: freeze.freeze_hash,
      experiment_id: freeze.experiment_id, trial_group_id: freeze.trial_group_id,
      trial_group_hash: freeze.trial_group_hash,
      trials: [{
        trial_id: "replay-reservation-trial-1", trial_ordinal: 1,
        candidate_id: freeze.candidates[0]!.candidate_id,
        candidate_identity_hash: freeze.candidates[0]!.candidate_identity_hash,
        run_id: "replay-reservation-run-1", trial_idempotency_key: "replay-reservation-trial-key-1",
      }],
      discovery_lifecycle_event_id: "event-replay-reservation-discovery",
      discovery_lifecycle_idempotency_key: "event-replay-reservation-discovery-key",
      idempotency_key: "replay-reservation-plan-key-1", planned_at: "2026-07-22T12:09:00Z",
    })
    const fixture = replayFixture(plan)
    const { trial_reservation_ref: _reservationRef, trial_reservation_hash: _reservationHash,
      ...executionSpec } = fixture.request
    const request = {
      schema_version: REPLAY_TRIAL_RESERVATION_ADMISSION_REQUEST_SCHEMA_VERSION,
      admission_id: "replay-reservation-admission-1", plan_id: plan.plan_id, plan_hash: plan.plan_hash,
      trial_id: plan.trials[0]!.trial_id, reservation_id: "replay-reservation-1",
      reservation_ref: "reservation://replay-reservation-trial-1/v1",
      execution_spec: executionSpec, dataset_manifest: fixture.manifest,
      idempotency_key: "replay-reservation-admission-key-1",
      issued_at: "2026-07-22T12:10:00Z", expires_at: "2026-07-22T13:10:00Z",
    } as const
    const admission = admitReplayTrialReservation(db, request)
    expect(admitReplayTrialReservation(db, request)).toEqual(admission)
    expect(readReplayTrialReservationAdmission(db, admission.admission_id)).toEqual(admission)
    expect(admission.status).toBe("admitted")
    expect(admission.reservation_snapshot.bindings.execution_spec_hash)
      .toBe(replayExecutionSpecHash(fixture.request))
    expect(admission.dataset_manifest_hash).toBe(replayDatasetManifestHash(fixture.manifest))
    expect(admission.reservation_snapshot.required_capabilities).toEqual([...REPLAY_CERTIFIED_CAPABILITIES])
    expect(admission.replay_request_authority).toBe("none_until_exact_reservation_binding")
    expect(count(db, "rd_replay_trial_reservation_admission")).toBe(1)
    expect(count(db, "rd_replay_attempt")).toBe(0)
    const registrationRequest = {
      schema_version: REPLAY_REQUEST_REGISTRATION_REQUEST_SCHEMA_VERSION,
      registration_id: "replay-request-registration-1",
      reservation_admission_id: admission.admission_id,
      reservation_admission_hash: admission.admission_hash,
      idempotency_key: "replay-request-registration-key-1",
      registered_at: "2026-07-22T12:11:00Z",
    } as const
    const registration = registerReplayExecutionRequest(db, registrationRequest)
    expect(registerReplayExecutionRequest(db, registrationRequest)).toEqual(registration)
    expect(readReplayRequestRegistration(db, registration.registration_id)).toEqual(registration)
    const registeredRequest = readRegisteredReplayExecutionRequest(db, registration.registration_id)
    expect(registeredRequest.trial_reservation_ref).toBe(admission.reservation_ref)
    expect(registeredRequest.trial_reservation_hash).toBe(admission.reservation_hash)
    expect(replayExecutionSpecHash(registeredRequest)).toBe(admission.execution_spec_hash)
    expect(registration.request_hash).toBe(canonicalHash(registeredRequest))
    expect(registration.assembly_policy).toBe("exact_admitted_spec_plus_admitted_reservation_only")
    expect(registration.replay_attempt_authority).toBe("none_until_attempt_admission")
    expect(count(db, "rd_replay_request_registration")).toBe(1)
    expect(count(db, "rd_replay_attempt")).toBe(0)
    const attemptAdmission = {
      schema_version: REPLAY_ATTEMPT_ADMISSION_REQUEST_SCHEMA_VERSION,
      attempt_id: "replay-attempt-registered-1",
      worker_id: "replay-worker-registered-1",
      idempotency_key: "replay-attempt-registered-key-1",
      request_registration_id: registration.registration_id,
      request_registration_hash: registration.registration_hash,
      claimed_at: "2026-07-22T12:12:00Z",
      lease_expires_at: "2026-07-22T12:20:00Z",
    } as const
    const lease = claimRegisteredReplayAttempt(db, attemptAdmission)
    expect(claimRegisteredReplayAttempt(db, attemptAdmission)).toEqual(lease)
    expect(lease.request_hash).toBe(registration.request_hash)
    expect(lease.reservation_hash).toBe(registration.reservation_hash)
    expect(lease.trial_id).toBe(registration.trial_id)
    const dispatchAuthorityInput = {
      attempt_id: lease.attempt_id,
      worker_id: lease.worker_id,
      expected_lease_generation: lease.lease_generation,
      issued_at: "2026-07-22T12:13:00Z",
    }
    const dispatchAuthority = issueReplayRegisteredAttemptDispatchAuthority(db, dispatchAuthorityInput)
    expect(issueReplayRegisteredAttemptDispatchAuthority(db, dispatchAuthorityInput))
      .toEqual(dispatchAuthority)
    expect(dispatchAuthority.request_registration_hash).toBe(registration.registration_hash)
    expect(dispatchAuthority.replay_execution_request_hash).toBe(registration.request_hash)
    expect(dispatchAuthority.attempt_lease_hash).toBe(hashReplayAttemptLeaseSnapshot(lease))
    expect(dispatchAuthority.request_registration.replay_request).toEqual(registeredRequest)
    expect(() => issueReplayRegisteredAttemptDispatchAuthority(db, {
      ...dispatchAuthorityInput,
      worker_id: "foreign-worker",
    })).toThrow("current Lease owner or generation")
    expect(() => issueReplayRegisteredAttemptDispatchAuthority(db, {
      ...dispatchAuthorityInput,
      expected_lease_generation: lease.lease_generation + 1,
    })).toThrow("current Lease owner or generation")
    expect(() => issueReplayRegisteredAttemptDispatchAuthority(db, {
      ...dispatchAuthorityInput,
      issued_at: lease.lease_expires_at,
    })).toThrow("inside the current Lease window")
    expect(db.query(`
      SELECT request_registration_id, request_registration_hash
      FROM rd_replay_attempt WHERE attempt_id=$attempt_id
    `).get({ $attempt_id: lease.attempt_id })).toEqual({
      request_registration_id: registration.registration_id,
      request_registration_hash: registration.registration_hash,
    })
    expect(() => db.query(`
      UPDATE rd_replay_attempt SET request_registration_hash=$hash WHERE attempt_id=$attempt_id
    `).run({ $attempt_id: lease.attempt_id, $hash: "8".repeat(64) })).toThrow("identity is immutable")
    expect(() => claimRegisteredReplayAttempt(db, {
      ...attemptAdmission,
      attempt_id: "replay-attempt-registration-drift",
      idempotency_key: "replay-attempt-registration-drift-key",
      request_registration_hash: "9".repeat(64),
    })).toThrow("does not match the registered Request hash")
    expect(count(db, "rd_replay_attempt")).toBe(1)
    expect(() => db.query(`
      UPDATE rd_replay_request_registration SET request_hash=$hash
    `).run({ $hash: "9".repeat(64) })).toThrow("immutable")
    expect(() => registerReplayExecutionRequest(db, {
      ...registrationRequest,
      registered_at: "2026-07-22T12:12:00Z",
    })).toThrow("idempotency key already exists")
    expect(() => registerReplayExecutionRequest(db, {
      ...registrationRequest,
      registration_id: "replay-request-registration-expired",
      idempotency_key: "replay-request-registration-expired-key",
      registered_at: admission.reservation_snapshot.expires_at,
    })).toThrow("inside the admitted Reservation window")
    expect(() => db.query(`
      UPDATE rd_replay_trial_reservation_admission SET dataset_hash=$hash
    `).run({ $hash: "9".repeat(64) })).toThrow("immutable")
    expect(() => admitReplayTrialReservation(db, {
      ...request,
      execution_spec: { ...executionSpec, harness_hash: "8".repeat(64) },
    })).toThrow("idempotency key already exists")
    expect(() => admitReplayTrialReservation(db, {
      ...request,
      admission_id: "replay-reservation-admission-manifest-drift",
      reservation_id: "replay-reservation-manifest-drift",
      reservation_ref: "reservation://replay-reservation-trial-1/manifest-drift",
      idempotency_key: "replay-reservation-admission-manifest-drift-key",
      execution_spec: { ...executionSpec, venue_risk_policy_schedule_hash: "8".repeat(64) },
      issued_at: "2026-07-22T13:10:00Z", expires_at: "2026-07-22T14:10:00Z",
    })).toThrow("venue_risk_policy_schedule_hash does not match")
    expect(() => admitReplayTrialReservation(db, {
      ...request,
      admission_id: "replay-reservation-admission-overlap",
      reservation_id: "replay-reservation-overlap",
      reservation_ref: "reservation://replay-reservation-trial-1/overlap",
      idempotency_key: "replay-reservation-admission-overlap-key",
    })).toThrow("overlapping active Reservations")
    const renewedLease = renewReplayAttemptLease(db, {
      attempt_id: lease.attempt_id,
      worker_id: lease.worker_id,
      expected_lease_generation: lease.lease_generation,
      heartbeat_at: "2026-07-22T12:14:00Z",
      lease_expires_at: "2026-07-22T12:22:00Z",
    })
    const renewedDispatchAuthority = issueReplayRegisteredAttemptDispatchAuthority(db, {
      attempt_id: renewedLease.attempt_id,
      worker_id: renewedLease.worker_id,
      expected_lease_generation: renewedLease.lease_generation,
      issued_at: renewedLease.heartbeat_at,
    })
    expect(renewedDispatchAuthority.request_registration_id)
      .toBe(dispatchAuthority.request_registration_id)
    expect(renewedDispatchAuthority.request_registration_hash)
      .toBe(dispatchAuthority.request_registration_hash)
    expect(renewedDispatchAuthority.attempt_lease_hash).not.toBe(dispatchAuthority.attempt_lease_hash)
    expect(() => issueReplayRegisteredAttemptDispatchAuthority(db, dispatchAuthorityInput))
      .toThrow("current Lease owner or generation")
    finalizeReplayAttempt(db, {
      attempt_id: renewedLease.attempt_id,
      worker_id: renewedLease.worker_id,
      expected_lease_generation: renewedLease.lease_generation,
      status: "cancelled",
      finalized_at: "2026-07-22T12:15:00Z",
      failure_class: "resource",
    })
    expect(() => issueReplayRegisteredAttemptDispatchAuthority(db, {
      attempt_id: renewedLease.attempt_id,
      worker_id: renewedLease.worker_id,
      expected_lease_generation: renewedLease.lease_generation,
      issued_at: "2026-07-22T12:15:00Z",
    })).toThrow("requires an active Attempt")
    expect(count(db, "rd_replay_trial_reservation_admission")).toBe(1)
    expect(count(db, "rd_replay_request_registration")).toBe(1)
  } finally {
    db.close()
  }
})

test("Trial Plan rolls back Group, lifecycle, and every Trial after a late reservation failure", () => {
  const db = openDb()
  try {
    admitProposal(db)
    const brief = issueBrief(db)
    receive(db, draft(brief, { draft_json: validDraftPayload(brief) }))
    const validation = validateDeveloperContractDraft(db, {
      schema_version: DEVELOPER_CONTRACT_DRAFT_VALIDATION_REQUEST_SCHEMA_VERSION,
      validation_id: "validation-trial-plan-rollback", brief_id: brief.brief_id, draft_revision: 1,
      idempotency_key: "draft-validation-trial-plan-rollback", validated_at: "2026-07-22T12:07:00Z",
    })
    const freeze = freezeDeveloperExperimentContract(db, {
      schema_version: DEVELOPER_CONTRACT_FREEZE_REQUEST_SCHEMA_VERSION,
      freeze_id: "freeze-trial-plan-rollback", validation_id: validation.validation_id,
      validation_hash: validation.validation_hash, experiment_id: "experiment-trial-plan-rollback",
      bootstrap_lifecycle_event_id: "event-trial-plan-rollback-register",
      bootstrap_lifecycle_idempotency_key: "event-trial-plan-rollback-register-key",
      idempotency_key: "freeze-trial-plan-rollback-key", frozen_at: "2026-07-22T12:08:00Z",
    })
    db.query(`
      CREATE TRIGGER fail_second_trial_for_atomicity
      BEFORE INSERT ON rd_trial WHEN NEW.trial_ordinal=2
      BEGIN SELECT RAISE(ABORT, 'injected second Trial failure'); END
    `).run()
    expect(() => startExperimentTrialPlan(db, {
      schema_version: EXPERIMENT_TRIAL_PLAN_REQUEST_SCHEMA_VERSION,
      plan_id: "trial-plan-rollback", freeze_id: freeze.freeze_id, freeze_hash: freeze.freeze_hash,
      experiment_id: freeze.experiment_id, trial_group_id: freeze.trial_group_id,
      trial_group_hash: freeze.trial_group_hash,
      trials: [1, 2].map((ordinal) => ({
        trial_id: `trial-plan-rollback-${ordinal}`, trial_ordinal: ordinal,
        candidate_id: freeze.candidates[0]!.candidate_id,
        candidate_identity_hash: freeze.candidates[0]!.candidate_identity_hash,
        run_id: `trial-plan-rollback-run-${ordinal}`,
        trial_idempotency_key: `trial-plan-rollback-trial-key-${ordinal}`,
      })),
      discovery_lifecycle_event_id: "event-trial-plan-rollback-discovery",
      discovery_lifecycle_idempotency_key: "event-trial-plan-rollback-discovery-key",
      idempotency_key: "trial-plan-rollback-key", planned_at: "2026-07-22T12:09:00Z",
    })).toThrow("injected second Trial failure")
    expect(count(db, "rd_experiment_trial_plan")).toBe(0)
    expect(count(db, "rd_experiment_trial_plan_item")).toBe(0)
    expect(count(db, "rd_trial")).toBe(0)
    expect(db.query(`SELECT status FROM rd_trial_group WHERE trial_group_id=$id`)
      .get({ $id: freeze.trial_group_id })).toEqual({ status: "registered" })
    expect(db.query(`SELECT lifecycle_state, lifecycle_version FROM rd_experiment_contract WHERE experiment_id=$id`)
      .get({ $id: freeze.experiment_id })).toEqual({ lifecycle_state: "proposed", lifecycle_version: 1 })
    expect(count(db, "rd_lifecycle_event")).toBe(1)
  } finally {
    db.close()
  }
})

test("Contract Freeze rejects invalid evidence and rolls back every formal fact on registration failure", () => {
  const invalidDb = openDb()
  try {
    admitProposal(invalidDb)
    const brief = issueBrief(invalidDb)
    receive(invalidDb, draft(brief))
    const validation = validateDeveloperContractDraft(invalidDb, {
      schema_version: DEVELOPER_CONTRACT_DRAFT_VALIDATION_REQUEST_SCHEMA_VERSION,
      validation_id: "validation-invalid-freeze",
      brief_id: brief.brief_id,
      draft_revision: 1,
      idempotency_key: "draft-validation-invalid-freeze",
      validated_at: "2026-07-22T12:07:00Z",
    })
    expect(() => freezeDeveloperExperimentContract(invalidDb, {
      schema_version: DEVELOPER_CONTRACT_FREEZE_REQUEST_SCHEMA_VERSION,
      freeze_id: "freeze-invalid",
      validation_id: validation.validation_id,
      validation_hash: validation.validation_hash,
      experiment_id: "experiment-invalid",
      bootstrap_lifecycle_event_id: "event-invalid",
      bootstrap_lifecycle_idempotency_key: "event-invalid-key",
      idempotency_key: "freeze-invalid-key",
      frozen_at: "2026-07-22T12:08:00Z",
    })).toThrow("only a valid")
    expect(count(invalidDb, "rd_developer_contract_freeze")).toBe(0)
    expect(count(invalidDb, "rd_trial_group")).toBe(0)
  } finally {
    invalidDb.close()
  }

  const rollbackDb = openDb()
  try {
    admitProposal(rollbackDb)
    const brief = issueBrief(rollbackDb)
    receive(rollbackDb, draft(brief, { draft_json: validDraftPayload(brief) }))
    const validation = validateDeveloperContractDraft(rollbackDb, {
      schema_version: DEVELOPER_CONTRACT_DRAFT_VALIDATION_REQUEST_SCHEMA_VERSION,
      validation_id: "validation-rollback",
      brief_id: brief.brief_id,
      draft_revision: 1,
      idempotency_key: "draft-validation-rollback",
      validated_at: "2026-07-22T12:07:00Z",
    })
    rollbackDb.query(`
      UPDATE rd_universe_node SET implementation_scope_status='backlog' WHERE node_id=$node_id
    `).run({ $node_id: brief.universe_node_id })
    expect(() => freezeDeveloperExperimentContract(rollbackDb, {
      schema_version: DEVELOPER_CONTRACT_FREEZE_REQUEST_SCHEMA_VERSION,
      freeze_id: "freeze-rollback",
      validation_id: validation.validation_id,
      validation_hash: validation.validation_hash,
      experiment_id: "experiment-rollback",
      bootstrap_lifecycle_event_id: "event-rollback",
      bootstrap_lifecycle_idempotency_key: "event-rollback-key",
      idempotency_key: "freeze-rollback-key",
      frozen_at: "2026-07-22T12:08:00Z",
    })).toThrow("implementation-ready")
    expect(count(rollbackDb, "rd_developer_contract_freeze")).toBe(0)
    expect(count(rollbackDb, "rd_trial_group")).toBe(0)
    expect(count(rollbackDb, "rd_trial_group_candidate")).toBe(0)
    expect(count(rollbackDb, "rd_experiment_contract")).toBe(0)
    expect(count(rollbackDb, "rd_proposal")).toBe(0)
  } finally {
    rollbackDb.close()
  }
})

function count(db: Database, table: string): number {
  return (db.query(`SELECT COUNT(*) AS count FROM ${table}`).get() as { count: number }).count
}
