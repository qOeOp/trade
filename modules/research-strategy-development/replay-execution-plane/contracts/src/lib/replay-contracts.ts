import { createHash } from "node:crypto"
import {
  REPLAY_LOCAL_ARTIFACT_STORAGE_POLICY_VERSION,
  REPLAY_OBJECT_ARTIFACT_STORAGE_POLICY_VERSION,
  type ReplayArtifactStoragePolicyVersion,
} from "../../../../../contracts/replay-contract/src/replay-storage-policy"

export {
  REPLAY_LOCAL_ARTIFACT_STORAGE_POLICY_VERSION,
  REPLAY_OBJECT_ARTIFACT_STORAGE_POLICY_VERSION,
}

export const REPLAY_REQUEST_SCHEMA_VERSION = "trade.rd-replay-execution-request.v13" as const
export const REPLAY_RESULT_SCHEMA_VERSION = "trade.rd-replay-result.v20" as const
export const REPLAY_ARTIFACT_SCHEMA_VERSION = "trade.rd-replay-artifact-manifest.v22" as const
export const REPLAY_ARTIFACT_STORE_CAPABILITY_SCHEMA_VERSION = "trade.rd-replay-artifact-store-capability.v1" as const
export const REPLAY_SIMULATOR_POLICY_VERSION = "rd-replay-simulator-v7" as const
export const REPLAY_NUMERIC_POLICY_VERSION = "rd-replay-number-v3" as const
export const REPLAY_DERIVED_DECIMAL_INCREMENT = "0.000000000001" as const
export const REPLAY_JOURNAL_POLICY_VERSION = "rd-replay-journal-v4" as const
export const REPLAY_EQUITY_POLICY_VERSION = "rd-replay-equity-v1" as const
export const REPLAY_MARGIN_POLICY_VERSION = "rd-replay-isolated-margin-v7" as const
export const REPLAY_MAINTENANCE_BREACH_SCHEMA_VERSION = "trade.rd-replay-maintenance-breach-observation.v3" as const
export const REPLAY_LIQUIDATION_EXECUTION_SCHEMA_VERSION = "trade.rd-replay-liquidation-execution.v2" as const
export const REPLAY_INSTRUMENT_ACCOUNTING_SPEC_VERSION = "rd-replay-instrument-accounting-v1" as const
export const REPLAY_DATASET_MANIFEST_SCHEMA_VERSION = "trade.rd-replay-dataset-manifest.v7" as const
export const REPLAY_SUPPLEMENTAL_FACT_SCHEMA_VERSION = "trade.rd-replay-supplemental-fact.v1" as const
export const REPLAY_SUPPLEMENTAL_REQUIREMENT_SET_SCHEMA_VERSION = "trade.rd-replay-supplemental-requirement-set.v1" as const
export const REPLAY_DECISION_INPUT_SNAPSHOT_SCHEMA_VERSION = "trade.rd-replay-decision-input-snapshot.v1" as const
export const REPLAY_DECISION_HARNESS_CAPABILITY_SCHEMA_VERSION = "trade.rd-replay-decision-harness-capability.v1" as const
export const REPLAY_DECISION_HARNESS_RECEIPT_SCHEMA_VERSION = "trade.rd-replay-decision-harness-receipt.v1" as const
export const REPLAY_VENUE_RISK_POLICY_SCHEMA_VERSION = "trade.rd-replay-venue-risk-policy-snapshot.v1" as const
export const REPLAY_INSTRUMENT_SPEC_SNAPSHOT_SCHEMA_VERSION = "trade.rd-replay-instrument-spec-snapshot.v1" as const
export const REPLAY_CERTIFIED_CAPABILITIES = [
  "closed-candle",
  "exact-funding",
  "exact-mark-optional",
  "exact-risk-full-liquidation",
  "isolated-margin",
  "next-open-market-entry",
  "ohlcv",
  "single-position",
  "step",
  "stop-take-profit-market",
] as const
export const REPLAY_REQUIRED_ARTIFACT_ROLES = [
  "request", "trial_reservation", "attempt_lease", "dataset_manifest", "supplemental_facts", "decision_input_snapshot", "decision_harness_receipt", "result",
  "source_events", "order_events", "fills", "positions", "ledger",
  "valuation_snapshot", "equity_bridge", "margin_snapshots", "liquidation",
  "journal", "trial_balance",
] as const

export interface ReplayArtifactStoreCapabilitySnapshot {
  schema_version: typeof REPLAY_ARTIFACT_STORE_CAPABILITY_SCHEMA_VERSION
  backend_kind: "local_filesystem" | "object_store"
  storage_policy_version: ReplayArtifactStoragePolicyVersion
  namespace_scope: "attempt"
  immutable_create: "hard_link_create_if_absent" | "conditional_put_if_none_match_star"
  collision_identity: "sha256_full_content"
  read_after_write: "strong"
  commit_marker: "manifest_last"
  incomplete_write_cleanup: "unlink_temporary" | "abort_or_expire_uncommitted_upload"
}

export const REPLAY_LOCAL_ARTIFACT_STORE_CAPABILITY: ReplayArtifactStoreCapabilitySnapshot = {
  schema_version: REPLAY_ARTIFACT_STORE_CAPABILITY_SCHEMA_VERSION,
  backend_kind: "local_filesystem",
  storage_policy_version: REPLAY_LOCAL_ARTIFACT_STORAGE_POLICY_VERSION,
  namespace_scope: "attempt",
  immutable_create: "hard_link_create_if_absent",
  collision_identity: "sha256_full_content",
  read_after_write: "strong",
  commit_marker: "manifest_last",
  incomplete_write_cleanup: "unlink_temporary",
}

export const REPLAY_OBJECT_ARTIFACT_STORE_REQUIRED_CAPABILITY: ReplayArtifactStoreCapabilitySnapshot = {
  schema_version: REPLAY_ARTIFACT_STORE_CAPABILITY_SCHEMA_VERSION,
  backend_kind: "object_store",
  storage_policy_version: REPLAY_OBJECT_ARTIFACT_STORAGE_POLICY_VERSION,
  namespace_scope: "attempt",
  immutable_create: "conditional_put_if_none_match_star",
  collision_identity: "sha256_full_content",
  read_after_write: "strong",
  commit_marker: "manifest_last",
  incomplete_write_cleanup: "abort_or_expire_uncommitted_upload",
}

export interface ReplayExecutionRequest {
  schema_version: typeof REPLAY_REQUEST_SCHEMA_VERSION
  run_id: string
  idempotency_key: string
  experiment_id: string
  trial_group_id: string
  trial_group_hash: string
  trial_id: string
  candidate_id: string
  candidate_hash: string
  identity_hash_policy_version: string
  experiment_contract_hash: string
  trial_reservation_ref: string
  trial_reservation_hash: string
  dataset_manifest_ref: string
  dataset_hash: string
  supplemental_facts_hash: string
  supplemental_requirement_set: ReplaySupplementalRequirementSet
  supplemental_requirement_set_hash: string
  venue_risk_policy_schedule_hash: string
  instrument_spec_schedule_hash: string
  harness_hash: string
  assumptions_hash: string
  strategy_policy_hash?: string
  symbol: string
  timeframe: string
  initial_cash: number
  order: {
    side: "long" | "short"
    quantity: number
    signal_time: string
    earliest_executable_time: string
    stop_price: number
    target_price: number
  }
  cost_policy: {
    policy_id: string
    version: string
    fee_bps: number
    slippage_bps: number
    liquidation_fee_bps: number
  }
  simulator_policy: {
    version: typeof REPLAY_SIMULATOR_POLICY_VERSION
    signal_visibility: "closed_candle"
    earliest_execution: "next_open"
    same_bar_policy: "stop_first"
    gap_fill_policy: "worse_open"
    position_accounting: "average_cost"
    funding_timing: "exact_event"
    end_of_data: "mark_open"
    margin_evaluation: "before_strategy_orders"
  }
  margin_policy: ReplayIsolatedMarginPolicy
  random_seed: number
}

export interface ReplayIsolatedMarginPolicy {
  policy_id: string
  version: typeof REPLAY_MARGIN_POLICY_VERSION
  mode: "isolated"
  collateral_asset: string
  isolated_collateral: number
  initial_margin_rate: number
  maintenance_tier: {
    tier_id: string
    snapshot_ref: string
    snapshot_hash: string
    notional_floor: number
    notional_cap: number | null
    maintenance_margin_rate: number
    maintenance_amount: number
  }
  cashflow_scope: "position_attributed"
  collateral_transfer: "reserve_at_entry_release_at_terminal_if_flat"
  settled_cashflow_account: "isolated_margin_collateral"
  observation_scope: "source_event_path"
  mark_source_policy: "complete_exact_mark_else_ohlcv_adverse"
  maintenance_trigger: "margin_balance_below_maintenance_requirement"
  breach_terminal_priority: "risk_before_strategy_exit"
  breach_evidence: "first_observed_source_event"
  maintenance_breach_action: "exact_observation_full_liquidation_else_terminal_failure"
  liquidation: "simulated_full_close"
  liquidation_trigger_sources: "mark_or_funding_mark"
  liquidation_execution_price: "trigger_mark_adverse_slippage"
  liquidation_quantity: "full_position"
  liquidation_order_priority: "cancel_strategy_exits_before_forced_fill"
  liquidation_deficit: "fail_without_result"
}

export interface ReplayMarketBar {
  open_time: string
  close_time: string
  open: number
  high: number
  low: number
  close: number
  volume: number
  closed: true
}

export interface ReplayFundingEvent {
  timestamp: string
  rate: number
  mark_price: number
}

export interface ReplayMarkEvent {
  timestamp: string
  available_at: string
  source_sequence: number
  mark_price: number
}

export type ReplaySupplementalValue =
  | null
  | boolean
  | number
  | string
  | ReplaySupplementalValue[]
  | { [key: string]: ReplaySupplementalValue }

export interface ReplaySupplementalFact {
  schema_version: typeof REPLAY_SUPPLEMENTAL_FACT_SCHEMA_VERSION
  record_id: string
  source_id: string
  entity_key: string
  fact_key: string
  event_time: string
  availability_at: string
  received_at: string
  revision_id: string
  source_sequence: number
  payload: ReplaySupplementalValue
  content_hash: string
}

export interface ReplaySupplementalRequirement {
  requirement_id: string
  source_id: string
  entity_key: string
  fact_key: string
  event_time_start_inclusive: string
  event_time_end_inclusive: string
  minimum_visible_event_count: number
  maximum_latest_event_age_ms: number
}

export interface ReplaySupplementalRequirementSet {
  schema_version: typeof REPLAY_SUPPLEMENTAL_REQUIREMENT_SET_SCHEMA_VERSION
  mode: "none" | "signal_time_complete"
  undeclared_input_policy: "reject"
  requirements: ReplaySupplementalRequirement[]
}

export const REPLAY_NO_SUPPLEMENTAL_REQUIREMENTS: ReplaySupplementalRequirementSet = {
  schema_version: REPLAY_SUPPLEMENTAL_REQUIREMENT_SET_SCHEMA_VERSION,
  mode: "none",
  undeclared_input_policy: "reject",
  requirements: [],
}
export const REPLAY_NO_SUPPLEMENTAL_REQUIREMENTS_HASH = canonicalHash(REPLAY_NO_SUPPLEMENTAL_REQUIREMENTS)

export interface ReplaySupplementalRequirementEvaluation {
  requirement_id: string
  selected_event_count: number
  latest_event_time: string
  latest_event_age_ms: number
  status: "satisfied"
}

export interface ReplayDecisionInputSnapshot {
  schema_version: typeof REPLAY_DECISION_INPUT_SNAPSHOT_SCHEMA_VERSION
  run_id: string
  decision_time: string
  supplemental_requirement_set_hash: string
  visibility_policy: "signal_time_snapshot"
  selected_records: ReplaySupplementalFact[]
  selected_records_hash: string
  snapshot_hash: string
}

export type ReplayDecisionInputSnapshotBody = Omit<ReplayDecisionInputSnapshot, "snapshot_hash">

export interface ReplayDecisionHarnessCapability {
  schema_version: typeof REPLAY_DECISION_HARNESS_CAPABILITY_SCHEMA_VERSION
  harness_hash: string
  execution_policy: "in_process_deterministic"
  input_schema_version: typeof REPLAY_DECISION_INPUT_SNAPSHOT_SCHEMA_VERSION
  output_schema_version: typeof REPLAY_DECISION_HARNESS_RECEIPT_SCHEMA_VERSION
}

export interface ReplayDecisionHarnessReceipt {
  schema_version: typeof REPLAY_DECISION_HARNESS_RECEIPT_SCHEMA_VERSION
  run_id: string
  harness_hash: string
  execution_policy: "in_process_deterministic"
  decision_input_snapshot_hash: string
  derived_order: ReplayExecutionRequest["order"]
  trace: ReplaySupplementalValue
  trace_hash: string
  receipt_hash: string
}

export type ReplayDecisionHarnessReceiptBody = Omit<ReplayDecisionHarnessReceipt, "receipt_hash">

export interface ReplaySupplementalEvidence {
  visibility_policy: "signal_time_snapshot"
  requirement_set_hash: string
  undeclared_input_policy: "reject"
  decision_time: string
  supplied_record_count: number
  selected_record_ids: string[]
  selected_records_hash: string
  future_revision_count: number
  requirement_evaluations: ReplaySupplementalRequirementEvaluation[]
  decision_input_snapshot_hash: string
}

export interface ReplayDatasetManifest {
  schema_version: typeof REPLAY_DATASET_MANIFEST_SCHEMA_VERSION
  manifest_id: string
  manifest_ref: string
  data_hash: string
  dataset_kind: "ohlcv"
  symbol: string
  timeframe: string
  interval_ms: number
  row_count: number
  first_open_time: string
  last_close_time: string
  observed_through: string
  closed_candles_only: true
  bar_final_availability: "close_time"
  funding_availability: "event_time"
  mark_availability: "event_time"
  mark_coverage: "none" | "complete_grid"
  mark_interval_ms: number | null
  mark_event_count: number
  supplemental_facts: {
    coverage: "none" | "signal_time_snapshot"
    record_count: number
    source_ids: string[]
    content_hash: string
    requirement_set_hash: string
  }
  venue_risk_policy_epochs: ReplayVenueRiskPolicySnapshot[]
  instrument: {
    listed_at: string
    trading_enabled_at: string
    delisted_at: string | null
    status_history: "complete" | "current_snapshot_only"
    spec_epochs: ReplayInstrumentSpecSnapshot[]
    accounting: ReplayInstrumentAccountingSpec
  }
  universe: {
    selected_at: string
    survivorship: "point_in_time" | "survivor_only"
  }
}

export interface ReplayVenueRiskPolicySnapshot {
  schema_version: typeof REPLAY_VENUE_RISK_POLICY_SCHEMA_VERSION
  snapshot_id: string
  venue_id: string
  symbol: string
  effective_at: string
  valid_until: string | null
  observed_at: string
  source_ref: string
  source_hash: string
  initial_margin_rate: number
  maintenance_tier: ReplayIsolatedMarginPolicy["maintenance_tier"]
  liquidation_fee_bps: number
}

export interface ReplayInstrumentSpecSnapshot {
  schema_version: typeof REPLAY_INSTRUMENT_SPEC_SNAPSHOT_SCHEMA_VERSION
  snapshot_id: string
  venue_id: string
  symbol: string
  effective_at: string
  valid_until: string | null
  observed_at: string
  source_ref: string
  source_hash: string
}

export interface ReplayInstrumentAccountingSpec {
  spec_version: typeof REPLAY_INSTRUMENT_ACCOUNTING_SPEC_VERSION
  product_type: "linear_derivative"
  base_asset: string
  quote_asset: string
  settlement_asset: string
  contract_multiplier: string
  price_increment: string
  quantity_increment: string
  settlement_increment: string
}

export interface ReplayLimitation {
  code: string
  severity: "info" | "resolution_limited" | "unsupported"
  detail: string
}

export type ReplayOrderSide = "buy" | "sell"
export type ReplayOrderRole = "entry" | "stop" | "target" | "liquidation" | "end_of_data"
export type ReplayOrderType = "market" | "stop_market" | "take_profit_market"
export type ReplayOrderStatus = "submitted" | "active" | "triggered" | "partially_filled" | "filled" | "cancelled" | "rejected"

export type ReplayBoundaryPhase = 0 | 10 | 15 | 20 | 70 | 90 | 100

export interface ReplayEventKey {
  event_time: string
  boundary_phase: ReplayBoundaryPhase
  source_sequence: number
  event_subphase: number
  stable_event_id: string
}

export function compareReplayEventKeys(left: ReplayEventKey, right: ReplayEventKey): number {
  assertReplayEventKey(left)
  assertReplayEventKey(right)
  const leftTime = Date.parse(left.event_time)
  const rightTime = Date.parse(right.event_time)
  if (leftTime !== rightTime) return leftTime < rightTime ? -1 : 1
  for (const field of ["boundary_phase", "source_sequence", "event_subphase"] as const) {
    if (left[field] !== right[field]) return left[field] < right[field] ? -1 : 1
  }
  if (left.stable_event_id === right.stable_event_id) return 0
  return left.stable_event_id < right.stable_event_id ? -1 : 1
}

export function assertReplayEventKey(value: ReplayEventKey): void {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/.test(value.event_time)
      || !Number.isFinite(Date.parse(value.event_time))) throw new Error("event key time must be RFC 3339 UTC")
  if (![0, 10, 15, 20, 70, 90, 100].includes(value.boundary_phase)) throw new Error("unsupported Replay boundary phase")
  if (!Number.isSafeInteger(value.source_sequence) || value.source_sequence < 0) throw new Error("source_sequence must be a non-negative safe integer")
  if (!Number.isSafeInteger(value.event_subphase) || value.event_subphase < 0) throw new Error("event_subphase must be a non-negative safe integer")
  if (typeof value.stable_event_id !== "string" || value.stable_event_id.trim() === "") throw new Error("stable_event_id is required")
}

export interface ReplayOrder {
  order_id: string
  order_role: ReplayOrderRole
  order_type: ReplayOrderType
  side: ReplayOrderSide
  quantity: number
  filled_quantity: number
  remaining_quantity: number
  reduce_only: boolean
  status: ReplayOrderStatus
  submitted_at: string
  active_at: string | null
  trigger_price: number | null
  last_event_sequence: number
  last_event_key: ReplayEventKey
}

export interface ReplayOrderEvent {
  event_id: string
  order_id: string
  sequence: number
  event_key: ReplayEventKey
  timestamp: string
  kind: "submitted" | "activated" | "triggered" | "partially_filled" | "filled" | "cancelled" | "rejected"
  status: ReplayOrderStatus
  fill_quantity: number
  remaining_quantity: number
  signed_position_after: number
  reason: string | null
  trigger_source: "bar_open" | "bar_range" | null
  trigger_observed_price: number | null
}

export interface ReplaySourceEvent {
  source_event_id: string
  kind: "instrument_delisted" | "bar_open" | "bar_range" | "funding" | "mark"
  source_index: number
  event_key: ReplayEventKey
}

export interface ReplayFill {
  fill_id: string
  order_id: string
  order_role: ReplayOrderRole
  event_key: ReplayEventKey
  timestamp: string
  side: ReplayOrderSide
  quantity: number
  price: number
  fee: number
  liquidation_fee?: number
  reduce_only: boolean
}

export interface ReplayLedgerEntry {
  entry_id: string
  event_key: ReplayEventKey
  timestamp: string
  kind: "initial_cash" | "trade_cash" | "fee" | "liquidation_fee" | "funding" | "realized_pnl" | "ending_cash"
  amount: number
  balance_after: number
  ref: string
}

export type ReplayJournalAccount =
  | "wallet_cash"
  | "isolated_margin_collateral"
  | "opening_equity"
  | "realized_pnl_income"
  | "realized_pnl_loss"
  | "fee_expense"
  | "liquidation_fee_expense"
  | "funding_income"
  | "funding_expense"
  | "position_valuation"
  | "unrealized_pnl_income"
  | "unrealized_pnl_loss"

export interface ReplayJournalLeg {
  leg_id: string
  account: ReplayJournalAccount
  side: "debit" | "credit"
  asset: string
  amount: number
}

export interface ReplayJournalEntry {
  journal_entry_id: string
  event_key: ReplayEventKey
  timestamp: string
  kind: "opening_balance" | "collateral_reserve" | "collateral_release" | "fee" | "liquidation_fee" | "funding" | "realized_pnl" | "mark_to_market"
  ref: string
  policy_version: typeof REPLAY_JOURNAL_POLICY_VERSION
  legs: [ReplayJournalLeg, ReplayJournalLeg]
}

export interface ReplayJournalAccountBalance {
  account: ReplayJournalAccount
  debit_total: number
  credit_total: number
  net_debit: number
}

export interface ReplayTrialBalance {
  policy_version: typeof REPLAY_JOURNAL_POLICY_VERSION
  settlement_asset: string
  debit_total: number
  credit_total: number
  account_balances: ReplayJournalAccountBalance[]
  wallet_cash_balance: number
  isolated_margin_collateral_balance: number
  settled_cash_balance: number
  position_valuation_balance: number
  ending_equity: number
  balanced: true
}

export interface ReplayValuationSnapshot {
  valuation_id: string
  event_key: ReplayEventKey
  timestamp: string
  position_event_id: string
  mark_source_ref: string
  mark_source: "fill_price" | "bar_close" | "mark_event"
  symbol: string
  settlement_asset: string
  mark_price: number
  signed_quantity: number
  average_entry_price: number | null
  unrealized_pnl: number
}

export interface ReplayEquityBridge {
  policy_version: typeof REPLAY_EQUITY_POLICY_VERSION
  valuation_id: string
  settlement_asset: string
  terminal_position_state: "open" | "flat"
  cash_balance: number
  position_valuation: number
  ending_equity: number
  reconciled: true
}

export interface ReplayMarginSnapshot {
  policy_version: typeof REPLAY_MARGIN_POLICY_VERSION
  venue_risk_policy_snapshot_id: string
  venue_risk_policy_snapshot_hash: string
  snapshot_id: string
  snapshot_sequence: number
  stage: "post_entry" | "path" | "terminal"
  event_key: ReplayEventKey
  timestamp: string
  position_event_id: string
  mark_source_ref: string
  mark_source: "fill_price" | "funding_mark" | "mark_event" | "bar_open" | "bar_adverse_extreme" | "bar_close"
  resolution: "exact" | "ohlcv_adverse_extreme" | "not_applicable_flat"
  symbol: string
  collateral_asset: string
  signed_quantity: number
  mark_price: number
  notional: number
  isolated_collateral: number
  attributed_settled_cashflow: number
  unrealized_pnl: number
  margin_balance: number
  initial_margin_requirement: number
  maintenance_margin_requirement: number
  initial_margin_headroom: number
  maintenance_margin_headroom: number
  margin_ratio: number | null
  initial_margin_sufficient: boolean
  maintenance_margin_sufficient: boolean
  maintenance_trigger: "margin_balance_below_maintenance_requirement"
  maintenance_breach_observed: boolean
  breach_terminal_priority: "risk_before_strategy_exit"
  state: "flat" | "healthy" | "maintenance_breached" | "nonpositive_balance"
  liquidation_evaluated: boolean
}

export interface ReplayMaintenanceBreachObservation {
  schema_version: typeof REPLAY_MAINTENANCE_BREACH_SCHEMA_VERSION
  observation_id: string
  event_key: ReplayEventKey
  timestamp: string
  margin_snapshot_id: string
  venue_risk_policy_snapshot_id: string
  venue_risk_policy_snapshot_hash: string
  position_event_id: string
  mark_source_ref: string
  mark_source: ReplayMarginSnapshot["mark_source"]
  resolution: ReplayMarginSnapshot["resolution"]
  trigger: "margin_balance_below_maintenance_requirement"
  trigger_state: "maintenance_breached" | "nonpositive_balance"
  margin_balance: number
  maintenance_margin_requirement: number
  maintenance_margin_headroom: number
  terminal_priority: "risk_before_strategy_exit"
  execution_status: "not_simulated" | "simulated_full_close"
  authoritative_result: false
}

export interface ReplayLiquidationExecution {
  schema_version: typeof REPLAY_LIQUIDATION_EXECUTION_SCHEMA_VERSION
  liquidation_id: string
  simulator_policy_version: typeof REPLAY_SIMULATOR_POLICY_VERSION
  margin_policy_version: typeof REPLAY_MARGIN_POLICY_VERSION
  venue_risk_policy_snapshot_id: string
  venue_risk_policy_snapshot_hash: string
  cost_policy_id: string
  cost_policy_version: string
  trigger_observation: ReplayMaintenanceBreachObservation
  execution_model: "trigger_mark_adverse_slippage_full_close"
  evidence_grade: "simulated_from_exact_risk_observation"
  strategy_order_action: "cancel_before_forced_order"
  liquidation_order_id: string
  liquidation_fill_id: string
  quantity: number
  trigger_mark_price: number
  slippage_bps: number
  execution_price: number
  trading_fee: number
  liquidation_fee_bps: number
  liquidation_fee: number
  settlement_state: "flat_without_deficit"
}

export interface ReplayPositionProjection {
  position_event_id: string
  position_id: string
  sequence: number
  event_key: ReplayEventKey
  timestamp: string
  cause_fill_id: string
  symbol: string
  accounting_method: "average_cost"
  numeric_policy_version: typeof REPLAY_NUMERIC_POLICY_VERSION
  state: "open" | "flat"
  side: "long" | "short" | null
  signed_quantity: number
  average_entry_price: number | null
  valuation_price: number
  valuation_source: "fill_price"
  realized_pnl_delta: number
  realized_pnl_cumulative: number
  unrealized_pnl: number
}

export interface ReplayEvidenceFingerprint {
  experiment_contract_hash: string
  trial_group_hash: string
  candidate_hash: string
  identity_hash_policy_version: string
  trial_reservation_hash: string
  dataset_manifest_hash: string
  dataset_hash: string
  supplemental_facts_hash: string
  supplemental_requirement_set_hash: string
  decision_input_snapshot_hash: string
  decision_harness_receipt_hash: string | null
  venue_risk_policy_schedule_hash: string
  instrument_spec_schedule_hash: string
  harness_hash: string
  assumptions_hash: string
  cost_policy_hash: string
  simulator_policy_version: string
  numeric_policy_version: typeof REPLAY_NUMERIC_POLICY_VERSION
  journal_policy_version: typeof REPLAY_JOURNAL_POLICY_VERSION
  equity_policy_version: typeof REPLAY_EQUITY_POLICY_VERSION
  margin_policy_version: typeof REPLAY_MARGIN_POLICY_VERSION
  margin_policy_hash: string
  request_hash: string
  result_hash: string
  random_seed: number
}

export interface ReplayResult {
  schema_version: typeof REPLAY_RESULT_SCHEMA_VERSION
  run_id: string
  status: "completed" | "failed" | "cancelled"
  started_at: string
  completed_at: string
  source_events: ReplaySourceEvent[]
  order_events: ReplayOrderEvent[]
  fills: ReplayFill[]
  positions: ReplayPositionProjection[]
  ledger: ReplayLedgerEntry[]
  valuation_snapshot: ReplayValuationSnapshot
  equity_bridge: ReplayEquityBridge
  margin_snapshots: ReplayMarginSnapshot[]
  liquidation: ReplayLiquidationExecution | null
  journal: ReplayJournalEntry[]
  trial_balance: ReplayTrialBalance
  supplemental_evidence: ReplaySupplementalEvidence
  decision_input_snapshot: ReplayDecisionInputSnapshot
  decision_harness_receipt: ReplayDecisionHarnessReceipt | null
  metrics: {
    initial_cash: number
    ending_equity: number
    net_pnl: number
    return_fraction: number
    realized_pnl: number
    unrealized_pnl: number
    total_fees: number
    total_liquidation_fees: number
    total_funding: number
    trade_count: number
    margin_observation_count: number
    peak_observed_margin_ratio: number | null
    terminal_margin_ratio: number | null
    observed_maintenance_breach_count: number
  }
  limitations: ReplayLimitation[]
  fingerprint: ReplayEvidenceFingerprint
}

export interface ReplayArtifactManifest {
  schema_version: typeof REPLAY_ARTIFACT_SCHEMA_VERSION
  artifact_id: string
  run_id: string
  result_hash: string
  producer_attempt_id: string
  producer_attempt_lease_hash: string
  storage_policy_version: string
  files: Array<{ role: string; ref: string; sha256: string }>
  completeness: {
    authoritative_result: true
    required_roles: string[]
    last_committed_event_key: ReplayEventKey | null
    terminal_checkpoint_hash: string
  }
  created_at: string
}

export function assertReplayExecutionRequest(value: ReplayExecutionRequest): void {
  if (value.schema_version !== REPLAY_REQUEST_SCHEMA_VERSION) fail("unsupported Replay request schema")
  for (const field of [
    "run_id", "idempotency_key", "experiment_id", "trial_group_id", "trial_id", "candidate_id",
    "identity_hash_policy_version", "trial_reservation_ref", "dataset_manifest_ref", "symbol", "timeframe",
  ] as const) requireText(value[field], field)
  for (const field of [
    "trial_group_hash", "candidate_hash", "experiment_contract_hash", "dataset_hash", "harness_hash", "assumptions_hash",
    "trial_reservation_hash", "supplemental_facts_hash", "supplemental_requirement_set_hash", "venue_risk_policy_schedule_hash", "instrument_spec_schedule_hash",
  ] as const) requireHash(value[field], field)
  assertReplaySupplementalRequirementSet(value.supplemental_requirement_set, value.order.signal_time)
  if (canonicalHash(value.supplemental_requirement_set) !== value.supplemental_requirement_set_hash) {
    fail("supplemental requirement set hash mismatch")
  }
  if (value.strategy_policy_hash) requireHash(value.strategy_policy_hash, "strategy_policy_hash")
  requirePositive(value.initial_cash, "initial_cash")
  requirePositive(value.order.quantity, "order.quantity")
  requirePositive(value.order.stop_price, "order.stop_price")
  requirePositive(value.order.target_price, "order.target_price")
  requireUtcTimestamp(value.order.signal_time, "order.signal_time")
  requireUtcTimestamp(value.order.earliest_executable_time, "order.earliest_executable_time")
  if (Date.parse(value.order.earliest_executable_time) <= Date.parse(value.order.signal_time)) {
    fail("earliest executable time must be after signal time")
  }
  if (value.order.side === "long" && value.order.stop_price >= value.order.target_price) fail("long stop must be below target")
  if (value.order.side === "short" && value.order.stop_price <= value.order.target_price) fail("short stop must be above target")
  requireNonNegative(value.cost_policy.fee_bps, "cost_policy.fee_bps")
  requireNonNegative(value.cost_policy.slippage_bps, "cost_policy.slippage_bps")
  requireNonNegative(value.cost_policy.liquidation_fee_bps, "cost_policy.liquidation_fee_bps")
  requireText(value.cost_policy.policy_id, "cost_policy.policy_id")
  requireText(value.cost_policy.version, "cost_policy.version")
  const policy = value.simulator_policy
  if (policy.version !== REPLAY_SIMULATOR_POLICY_VERSION
      || policy.signal_visibility !== "closed_candle"
      || policy.earliest_execution !== "next_open"
      || policy.same_bar_policy !== "stop_first"
      || policy.gap_fill_policy !== "worse_open"
      || policy.position_accounting !== "average_cost"
      || policy.funding_timing !== "exact_event"
      || policy.end_of_data !== "mark_open"
      || policy.margin_evaluation !== "before_strategy_orders") fail("unsupported simulator policy")
  assertReplayIsolatedMarginPolicy(value.margin_policy)
  if (value.margin_policy.isolated_collateral > value.initial_cash) fail("isolated collateral cannot exceed initial cash")
  if (!Number.isSafeInteger(value.random_seed) || value.random_seed < 0) fail("random_seed must be a non-negative safe integer")
}

export function assertReplayIsolatedMarginPolicy(policy: ReplayIsolatedMarginPolicy): void {
  requireText(policy.policy_id, "margin_policy.policy_id")
  if (policy.version !== REPLAY_MARGIN_POLICY_VERSION
      || policy.mode !== "isolated"
      || policy.cashflow_scope !== "position_attributed"
      || policy.collateral_transfer !== "reserve_at_entry_release_at_terminal_if_flat"
      || policy.settled_cashflow_account !== "isolated_margin_collateral"
      || policy.observation_scope !== "source_event_path"
      || policy.mark_source_policy !== "complete_exact_mark_else_ohlcv_adverse"
      || policy.maintenance_trigger !== "margin_balance_below_maintenance_requirement"
      || policy.breach_terminal_priority !== "risk_before_strategy_exit"
      || policy.breach_evidence !== "first_observed_source_event"
      || policy.maintenance_breach_action !== "exact_observation_full_liquidation_else_terminal_failure"
      || policy.liquidation !== "simulated_full_close"
      || policy.liquidation_trigger_sources !== "mark_or_funding_mark"
      || policy.liquidation_execution_price !== "trigger_mark_adverse_slippage"
      || policy.liquidation_quantity !== "full_position"
      || policy.liquidation_order_priority !== "cancel_strategy_exits_before_forced_fill"
      || policy.liquidation_deficit !== "fail_without_result") fail("unsupported isolated margin policy")
  const collateralAsset = requireText(policy.collateral_asset, "margin_policy.collateral_asset")
  if (!/^[A-Z0-9]{2,16}$/.test(collateralAsset)) fail("margin_policy.collateral_asset must be an uppercase asset id")
  requirePositive(policy.isolated_collateral, "margin_policy.isolated_collateral")
  requireRate(policy.initial_margin_rate, "margin_policy.initial_margin_rate", false)
  assertReplayMaintenanceTier(policy.maintenance_tier, policy.initial_margin_rate, "margin_policy.maintenance_tier")
}

export function assertReplayMarketBars(bars: ReplayMarketBar[]): void {
  let priorClose = Number.NEGATIVE_INFINITY
  for (const [index, bar] of bars.entries()) {
    requireUtcTimestamp(bar.open_time, `bars[${index}].open_time`)
    requireUtcTimestamp(bar.close_time, `bars[${index}].close_time`)
    const open = Date.parse(bar.open_time)
    const close = Date.parse(bar.close_time)
    if (open >= close || open < priorClose) fail("bars must be non-overlapping and chronologically ordered")
    priorClose = close
    for (const [field, item] of Object.entries({ open: bar.open, high: bar.high, low: bar.low, close: bar.close })) {
      requirePositive(item, `bars[${index}].${field}`)
    }
    requireNonNegative(bar.volume, `bars[${index}].volume`)
    if (bar.closed !== true) fail("Replay only accepts closed bars")
    if (bar.high < Math.max(bar.open, bar.close) || bar.low > Math.min(bar.open, bar.close) || bar.low > bar.high) {
      fail("invalid OHLC envelope")
    }
  }
}

export function assertReplayDatasetManifest(manifest: ReplayDatasetManifest): void {
  if (manifest.schema_version !== REPLAY_DATASET_MANIFEST_SCHEMA_VERSION) fail("unsupported Replay dataset manifest schema")
  for (const [field, value] of Object.entries({
    manifest_id: manifest.manifest_id,
    manifest_ref: manifest.manifest_ref,
    symbol: manifest.symbol,
    timeframe: manifest.timeframe,
  })) requireText(value, field)
  requireHash(manifest.data_hash, "manifest.data_hash")
  if (manifest.dataset_kind !== "ohlcv") fail("certified Replay only accepts OHLCV manifests")
  if (!Number.isSafeInteger(manifest.interval_ms) || manifest.interval_ms <= 0) fail("manifest.interval_ms must be a positive safe integer")
  if (!Number.isSafeInteger(manifest.row_count) || manifest.row_count <= 0) fail("manifest.row_count must be a positive safe integer")
  for (const [field, value] of Object.entries({
    first_open_time: manifest.first_open_time,
    last_close_time: manifest.last_close_time,
    observed_through: manifest.observed_through,
    listed_at: manifest.instrument.listed_at,
    trading_enabled_at: manifest.instrument.trading_enabled_at,
    selected_at: manifest.universe.selected_at,
  })) requireUtcTimestamp(value, `manifest.${field}`)
  if (manifest.instrument.delisted_at !== null) requireUtcTimestamp(manifest.instrument.delisted_at, "manifest.delisted_at")
  if (manifest.instrument.status_history !== "complete" && manifest.instrument.status_history !== "current_snapshot_only") {
    fail("unsupported instrument status history policy")
  }
  assertReplaySnapshotSchedule(manifest.venue_risk_policy_epochs, assertReplayVenueRiskPolicySnapshot, "venue_risk_policy_epochs")
  assertReplaySnapshotSchedule(manifest.instrument.spec_epochs, assertReplayInstrumentSpecSnapshot, "instrument.spec_epochs")
  assertReplayInstrumentAccountingSpec(manifest.instrument.accounting)
  if (manifest.universe.survivorship !== "point_in_time" && manifest.universe.survivorship !== "survivor_only") {
    fail("unsupported universe survivorship policy")
  }
  if (Date.parse(manifest.first_open_time) >= Date.parse(manifest.last_close_time)) fail("manifest window must have positive duration")
  if (Date.parse(manifest.observed_through) < Date.parse(manifest.last_close_time)) fail("manifest observed_through must cover the final closed bar")
  if (Date.parse(manifest.instrument.listed_at) > Date.parse(manifest.instrument.trading_enabled_at)) fail("instrument cannot trade before listing")
  if (manifest.instrument.delisted_at !== null
      && Date.parse(manifest.instrument.delisted_at) <= Date.parse(manifest.instrument.trading_enabled_at)) fail("instrument delisting must follow trading enablement")
  if (manifest.universe.survivorship === "point_in_time"
      && Date.parse(manifest.universe.selected_at) > Date.parse(manifest.first_open_time)) fail("point-in-time universe must be selected no later than the dataset window")
  if (manifest.closed_candles_only !== true
      || manifest.bar_final_availability !== "close_time"
      || manifest.funding_availability !== "event_time"
      || manifest.mark_availability !== "event_time") fail("unsupported Replay dataset availability policy")
  if (!Number.isSafeInteger(manifest.mark_event_count) || manifest.mark_event_count < 0) {
    fail("manifest.mark_event_count must be a non-negative safe integer")
  }
  if (manifest.mark_coverage === "none") {
    if (manifest.mark_interval_ms !== null || manifest.mark_event_count !== 0) fail("mark coverage none cannot declare mark events")
  } else if (manifest.mark_coverage === "complete_grid") {
    if (manifest.mark_interval_ms === null
        || !Number.isSafeInteger(manifest.mark_interval_ms)
        || manifest.mark_interval_ms <= 0
        || manifest.mark_event_count <= 0) {
      fail("complete mark coverage requires a positive interval and event count")
    }
  } else fail("unsupported mark coverage policy")
  assertReplaySupplementalManifest(manifest)
}

function assertReplaySupplementalManifest(manifest: ReplayDatasetManifest): void {
  const supplemental = manifest.supplemental_facts
  requireHash(supplemental.content_hash, "manifest.supplemental_facts.content_hash")
  requireHash(supplemental.requirement_set_hash, "manifest.supplemental_facts.requirement_set_hash")
  if (!Number.isSafeInteger(supplemental.record_count) || supplemental.record_count < 0) {
    fail("manifest.supplemental_facts.record_count must be a non-negative safe integer")
  }
  const normalizedSources = supplemental.source_ids.map((source, index) => (
    requireText(source, `manifest.supplemental_facts.source_ids[${index}]`)
  ))
  const canonicalSources = [...new Set(normalizedSources)].sort()
  if (canonicalJson(normalizedSources) !== canonicalJson(canonicalSources)) {
    fail("manifest.supplemental_facts.source_ids must be unique and sorted")
  }
  if (supplemental.coverage === "none") {
    if (supplemental.record_count !== 0 || supplemental.source_ids.length !== 0 || supplemental.content_hash !== canonicalHash([])) {
      fail("supplemental coverage none requires an empty canonical record set")
    }
  } else if (supplemental.coverage === "signal_time_snapshot") {
    if (supplemental.record_count <= 0 || supplemental.source_ids.length === 0) {
      fail("signal-time supplemental coverage requires records and source ids")
    }
  } else fail("unsupported supplemental fact coverage policy")
}

export function assertReplaySupplementalRequirementSet(
  requirementSet: ReplaySupplementalRequirementSet,
  decisionTime: string,
): void {
  if (requirementSet.schema_version !== REPLAY_SUPPLEMENTAL_REQUIREMENT_SET_SCHEMA_VERSION) {
    fail("unsupported Replay supplemental requirement set schema")
  }
  if (requirementSet.undeclared_input_policy !== "reject") fail("supplemental undeclared input policy must reject")
  requireUtcTimestamp(decisionTime, "supplemental_requirement_set.decision_time")
  if (!Array.isArray(requirementSet.requirements)) fail("supplemental requirements must be an array")
  if (requirementSet.mode === "none") {
    if (requirementSet.requirements.length !== 0) fail("supplemental requirement mode none requires an empty requirement list")
    return
  }
  if (requirementSet.mode !== "signal_time_complete" || requirementSet.requirements.length === 0) {
    fail("signal-time-complete supplemental requirements must not be empty")
  }
  let priorId = ""
  for (const [index, requirement] of requirementSet.requirements.entries()) {
    for (const [field, value] of Object.entries({
      requirement_id: requirement.requirement_id,
      source_id: requirement.source_id,
      entity_key: requirement.entity_key,
      fact_key: requirement.fact_key,
    })) {
      const identifier = requireText(value, `supplemental_requirement[${index}].${field}`)
      if (!/^[A-Za-z0-9][A-Za-z0-9._:/-]{0,255}$/.test(identifier)) {
        fail(`supplemental_requirement[${index}].${field} must be an ASCII evidence identifier`)
      }
    }
    if (requirement.requirement_id <= priorId) fail("supplemental requirements must have unique sorted requirement_id values")
    priorId = requirement.requirement_id
    requireUtcTimestamp(requirement.event_time_start_inclusive, `supplemental_requirement[${index}].event_time_start_inclusive`)
    requireUtcTimestamp(requirement.event_time_end_inclusive, `supplemental_requirement[${index}].event_time_end_inclusive`)
    const start = Date.parse(requirement.event_time_start_inclusive)
    const end = Date.parse(requirement.event_time_end_inclusive)
    if (start > end) fail("supplemental requirement event window must not be inverted")
    if (end > Date.parse(decisionTime)) fail("supplemental requirement event window cannot extend beyond decision time")
    if (!Number.isSafeInteger(requirement.minimum_visible_event_count) || requirement.minimum_visible_event_count < 1) {
      fail("supplemental requirement minimum_visible_event_count must be a positive safe integer")
    }
    if (!Number.isSafeInteger(requirement.maximum_latest_event_age_ms) || requirement.maximum_latest_event_age_ms < 0) {
      fail("supplemental requirement maximum_latest_event_age_ms must be a non-negative safe integer")
    }
    const overlapping = requirementSet.requirements.slice(0, index).some((prior) => (
      prior.source_id === requirement.source_id
      && prior.entity_key === requirement.entity_key
      && prior.fact_key === requirement.fact_key
      && Date.parse(prior.event_time_start_inclusive) <= end
      && start <= Date.parse(prior.event_time_end_inclusive)
    ))
    if (overlapping) fail("supplemental requirement scopes must not overlap")
  }
}

export function assertReplaySupplementalFact(fact: ReplaySupplementalFact): void {
  if (fact.schema_version !== REPLAY_SUPPLEMENTAL_FACT_SCHEMA_VERSION) fail("unsupported Replay supplemental fact schema")
  for (const [field, value] of Object.entries({
    record_id: fact.record_id,
    source_id: fact.source_id,
    entity_key: fact.entity_key,
    fact_key: fact.fact_key,
    revision_id: fact.revision_id,
  })) {
    const identifier = requireText(value, `supplemental_fact.${field}`)
    if (!/^[A-Za-z0-9][A-Za-z0-9._:/-]{0,255}$/.test(identifier)) {
      fail(`supplemental_fact.${field} must be an ASCII evidence identifier`)
    }
  }
  requireUtcTimestamp(fact.event_time, "supplemental_fact.event_time")
  requireUtcTimestamp(fact.availability_at, "supplemental_fact.availability_at")
  requireUtcTimestamp(fact.received_at, "supplemental_fact.received_at")
  if (Date.parse(fact.availability_at) < Date.parse(fact.event_time)) {
    fail("supplemental fact cannot be available before its event time")
  }
  if (Date.parse(fact.received_at) < Date.parse(fact.availability_at)) {
    fail("supplemental fact cannot be received before its availability time")
  }
  if (!Number.isSafeInteger(fact.source_sequence) || fact.source_sequence < 0) {
    fail("supplemental fact source_sequence must be a non-negative safe integer")
  }
  requireHash(fact.content_hash, "supplemental_fact.content_hash")
  if (canonicalHash(fact.payload) !== fact.content_hash) fail("supplemental fact payload hash mismatch")
}

export function createReplayDecisionInputSnapshot(
  request: ReplayExecutionRequest,
  selectedRecords: ReplaySupplementalFact[],
): ReplayDecisionInputSnapshot {
  const records = structuredClone(selectedRecords)
  records.forEach(assertReplaySupplementalFact)
  const body: ReplayDecisionInputSnapshotBody = {
    schema_version: REPLAY_DECISION_INPUT_SNAPSHOT_SCHEMA_VERSION,
    run_id: request.run_id,
    decision_time: request.order.signal_time,
    supplemental_requirement_set_hash: request.supplemental_requirement_set_hash,
    visibility_policy: "signal_time_snapshot",
    selected_records: records,
    selected_records_hash: canonicalHash(records),
  }
  const snapshot = { ...body, snapshot_hash: canonicalHash(body) }
  assertReplayDecisionInputSnapshot(snapshot, request)
  return snapshot
}

export function assertReplayDecisionInputSnapshot(
  snapshot: ReplayDecisionInputSnapshot,
  request?: ReplayExecutionRequest,
): void {
  if (snapshot.schema_version !== REPLAY_DECISION_INPUT_SNAPSHOT_SCHEMA_VERSION) {
    fail("unsupported Replay decision input snapshot schema")
  }
  requireText(snapshot.run_id, "decision_input_snapshot.run_id")
  requireUtcTimestamp(snapshot.decision_time, "decision_input_snapshot.decision_time")
  requireHash(snapshot.supplemental_requirement_set_hash, "decision_input_snapshot.supplemental_requirement_set_hash")
  if (snapshot.visibility_policy !== "signal_time_snapshot") fail("unsupported decision input visibility policy")
  let priorGroupKey = ""
  for (const fact of snapshot.selected_records) {
    assertReplaySupplementalFact(fact)
    if (Date.parse(fact.availability_at) > Date.parse(snapshot.decision_time)) {
      fail("decision input snapshot contains a future-visible supplemental fact")
    }
    const groupKey = `${fact.source_id}\u0000${fact.entity_key}\u0000${fact.fact_key}\u0000${fact.event_time}`
    if (groupKey <= priorGroupKey) fail("decision input selected records must have unique canonical fact-group order")
    priorGroupKey = groupKey
  }
  requireHash(snapshot.selected_records_hash, "decision_input_snapshot.selected_records_hash")
  requireHash(snapshot.snapshot_hash, "decision_input_snapshot.snapshot_hash")
  if (canonicalHash(snapshot.selected_records) !== snapshot.selected_records_hash) {
    fail("decision input selected records hash mismatch")
  }
  const { snapshot_hash: _snapshotHash, ...body } = snapshot
  if (canonicalHash(body) !== snapshot.snapshot_hash) fail("decision input snapshot hash mismatch")
  if (request && (
    snapshot.run_id !== request.run_id
    || snapshot.decision_time !== request.order.signal_time
    || snapshot.supplemental_requirement_set_hash !== request.supplemental_requirement_set_hash
  )) fail("decision input snapshot does not match Replay request")
  if (request?.supplemental_requirement_set.mode === "none" && snapshot.selected_records.length !== 0) {
    fail("decision input snapshot without supplemental requirements must be empty")
  }
}

export function assertReplayDecisionHarnessCapability(
  capability: ReplayDecisionHarnessCapability,
  request?: ReplayExecutionRequest,
): void {
  if (capability.schema_version !== REPLAY_DECISION_HARNESS_CAPABILITY_SCHEMA_VERSION
      || capability.execution_policy !== "in_process_deterministic"
      || capability.input_schema_version !== REPLAY_DECISION_INPUT_SNAPSHOT_SCHEMA_VERSION
      || capability.output_schema_version !== REPLAY_DECISION_HARNESS_RECEIPT_SCHEMA_VERSION) {
    fail("unsupported Replay decision harness capability")
  }
  requireHash(capability.harness_hash, "decision_harness_capability.harness_hash")
  if (request && capability.harness_hash !== request.harness_hash) {
    fail("decision harness capability hash does not match Replay request")
  }
}

export function createReplayDecisionHarnessReceipt(input: {
  request: ReplayExecutionRequest
  decision_input_snapshot: ReplayDecisionInputSnapshot
  derived_order: ReplayExecutionRequest["order"]
  trace: ReplaySupplementalValue
}): ReplayDecisionHarnessReceipt {
  assertReplayDecisionInputSnapshot(input.decision_input_snapshot, input.request)
  const trace = structuredClone(input.trace)
  const body: ReplayDecisionHarnessReceiptBody = {
    schema_version: REPLAY_DECISION_HARNESS_RECEIPT_SCHEMA_VERSION,
    run_id: input.request.run_id,
    harness_hash: input.request.harness_hash,
    execution_policy: "in_process_deterministic",
    decision_input_snapshot_hash: input.decision_input_snapshot.snapshot_hash,
    derived_order: structuredClone(input.derived_order),
    trace,
    trace_hash: canonicalHash(trace),
  }
  const receipt = { ...body, receipt_hash: canonicalHash(body) }
  assertReplayDecisionHarnessReceipt(receipt, input.request, input.decision_input_snapshot)
  return receipt
}

export function assertReplayDecisionHarnessReceipt(
  receipt: ReplayDecisionHarnessReceipt,
  request?: ReplayExecutionRequest,
  snapshot?: ReplayDecisionInputSnapshot,
): void {
  if (receipt.schema_version !== REPLAY_DECISION_HARNESS_RECEIPT_SCHEMA_VERSION
      || receipt.execution_policy !== "in_process_deterministic") {
    fail("unsupported Replay decision harness receipt")
  }
  requireText(receipt.run_id, "decision_harness_receipt.run_id")
  requireHash(receipt.harness_hash, "decision_harness_receipt.harness_hash")
  requireHash(receipt.decision_input_snapshot_hash, "decision_harness_receipt.decision_input_snapshot_hash")
  requireHash(receipt.trace_hash, "decision_harness_receipt.trace_hash")
  requireHash(receipt.receipt_hash, "decision_harness_receipt.receipt_hash")
  if (canonicalHash(receipt.trace) !== receipt.trace_hash) fail("decision harness trace hash mismatch")
  const { receipt_hash: _receiptHash, ...body } = receipt
  if (canonicalHash(body) !== receipt.receipt_hash) fail("decision harness receipt hash mismatch")
  if (request && (
    receipt.run_id !== request.run_id
    || receipt.harness_hash !== request.harness_hash
    || canonicalJson(receipt.derived_order) !== canonicalJson(request.order)
  )) fail("decision harness receipt does not match Replay request")
  if (snapshot && receipt.decision_input_snapshot_hash !== snapshot.snapshot_hash) {
    fail("decision harness receipt does not match decision input snapshot")
  }
}

export function assertReplayVenueRiskPolicySnapshot(snapshot: ReplayVenueRiskPolicySnapshot): void {
  if (snapshot.schema_version !== REPLAY_VENUE_RISK_POLICY_SCHEMA_VERSION) fail("unsupported venue risk policy snapshot schema")
  for (const [field, value] of Object.entries({
    snapshot_id: snapshot.snapshot_id,
    venue_id: snapshot.venue_id,
    symbol: snapshot.symbol,
    source_ref: snapshot.source_ref,
  })) requireText(value, `venue_risk_policy.${field}`)
  requireHash(snapshot.source_hash, "venue_risk_policy.source_hash")
  assertReplaySnapshotInterval(snapshot, "venue_risk_policy")
  requireRate(snapshot.initial_margin_rate, "venue_risk_policy.initial_margin_rate", false)
  requireNonNegative(snapshot.liquidation_fee_bps, "venue_risk_policy.liquidation_fee_bps")
  assertReplayMaintenanceTier(snapshot.maintenance_tier, snapshot.initial_margin_rate, "venue_risk_policy.maintenance_tier")
}

export function assertReplayInstrumentSpecSnapshot(snapshot: ReplayInstrumentSpecSnapshot): void {
  if (snapshot.schema_version !== REPLAY_INSTRUMENT_SPEC_SNAPSHOT_SCHEMA_VERSION) fail("unsupported instrument spec snapshot schema")
  for (const [field, value] of Object.entries({
    snapshot_id: snapshot.snapshot_id,
    venue_id: snapshot.venue_id,
    symbol: snapshot.symbol,
    source_ref: snapshot.source_ref,
  })) requireText(value, `instrument.spec_snapshot.${field}`)
  requireHash(snapshot.source_hash, "instrument.spec_snapshot.source_hash")
  assertReplaySnapshotInterval(snapshot, "instrument.spec_snapshot")
}

function assertReplaySnapshotSchedule<T extends { effective_at: string; valid_until: string | null }>(
  snapshots: T[],
  assertSnapshot: (snapshot: T) => void,
  field: string,
): void {
  if (!Array.isArray(snapshots) || snapshots.length === 0) fail(`${field} must not be empty`)
  for (const [index, snapshot] of snapshots.entries()) {
    assertSnapshot(snapshot)
    if (index === 0) continue
    const previous = snapshots[index - 1]
    if (previous.valid_until === null || previous.valid_until !== snapshot.effective_at) {
      fail(`${field} must be ordered, non-overlapping, and contiguous`)
    }
  }
}

function assertReplaySnapshotInterval(
  snapshot: { effective_at: string; valid_until: string | null; observed_at: string },
  field: string,
): void {
  requireUtcTimestamp(snapshot.effective_at, `${field}.effective_at`)
  requireUtcTimestamp(snapshot.observed_at, `${field}.observed_at`)
  if (snapshot.valid_until !== null) {
    requireUtcTimestamp(snapshot.valid_until, `${field}.valid_until`)
    if (Date.parse(snapshot.valid_until) <= Date.parse(snapshot.effective_at)) fail(`${field} validity interval must have positive duration`)
  }
}

function assertReplayMaintenanceTier(
  tier: ReplayIsolatedMarginPolicy["maintenance_tier"],
  initialMarginRate: number,
  field: string,
): void {
  requireText(tier.tier_id, `${field}.tier_id`)
  requireText(tier.snapshot_ref, `${field}.snapshot_ref`)
  requireHash(tier.snapshot_hash, `${field}.snapshot_hash`)
  requireNonNegative(tier.notional_floor, `${field}.notional_floor`)
  if (tier.notional_cap !== null) {
    requirePositive(tier.notional_cap, `${field}.notional_cap`)
    if (tier.notional_cap <= tier.notional_floor) fail(`${field} cap must exceed its floor`)
  }
  requireRate(tier.maintenance_margin_rate, `${field}.maintenance_margin_rate`, true)
  if (tier.maintenance_margin_rate >= initialMarginRate) fail(`${field} rate must be below initial margin rate`)
  requireNonNegative(tier.maintenance_amount, `${field}.maintenance_amount`)
}

export function assertReplayInstrumentAccountingSpec(spec: ReplayInstrumentAccountingSpec): void {
  if (spec.spec_version !== REPLAY_INSTRUMENT_ACCOUNTING_SPEC_VERSION) fail("unsupported instrument accounting spec")
  if (spec.product_type !== "linear_derivative") fail("certified Replay only supports linear derivatives")
  for (const [field, asset] of Object.entries({
    base_asset: spec.base_asset,
    quote_asset: spec.quote_asset,
    settlement_asset: spec.settlement_asset,
  })) {
    const normalized = requireText(asset, `instrument.accounting.${field}`)
    if (!/^[A-Z0-9]{2,16}$/.test(normalized)) fail(`instrument.accounting.${field} must be an uppercase asset id`)
  }
  if (spec.base_asset === spec.quote_asset) fail("instrument base and quote assets must differ")
  if (spec.quote_asset !== spec.settlement_asset) fail("certified linear Replay requires quote-asset settlement")
  if (spec.contract_multiplier !== "1") fail("certified Replay currently requires a unit contract multiplier")
  for (const [field, value] of Object.entries({
    contract_multiplier: spec.contract_multiplier,
    price_increment: spec.price_increment,
    quantity_increment: spec.quantity_increment,
    settlement_increment: spec.settlement_increment,
  })) requireCanonicalPositiveDecimal(value, `instrument.accounting.${field}`)
  for (const [field, value] of Object.entries({
    price_increment: spec.price_increment,
    quantity_increment: spec.quantity_increment,
    settlement_increment: spec.settlement_increment,
  })) {
    if ((value.split(".")[1]?.length ?? 0) > 12) fail(`instrument.accounting.${field} exceeds Numeric Policy v3 scale`)
  }
}

export function replayDatasetHash(
  bars: ReplayMarketBar[],
  fundingEvents: ReplayFundingEvent[] = [],
  markEvents: ReplayMarkEvent[] = [],
  supplementalFacts: ReplaySupplementalFact[] = [],
): string {
  return canonicalHash({ bars, funding_events: fundingEvents, mark_events: markEvents, supplemental_facts: supplementalFacts })
}

export function replayDatasetManifestHash(manifest: ReplayDatasetManifest): string {
  assertReplayDatasetManifest(manifest)
  return canonicalHash(manifest)
}

export function replayExecutionSpecHash(request: ReplayExecutionRequest): string {
  const authorized = { ...request } as Partial<ReplayExecutionRequest>
  delete authorized.trial_reservation_ref
  delete authorized.trial_reservation_hash
  return canonicalHash(authorized)
}

export function assertReplayArtifactStoreCapability(
  capability: ReplayArtifactStoreCapabilitySnapshot,
): void {
  if (capability.schema_version !== REPLAY_ARTIFACT_STORE_CAPABILITY_SCHEMA_VERSION) {
    fail("unsupported Replay Artifact Store capability schema")
  }
  const expected = capability.backend_kind === "local_filesystem"
    ? REPLAY_LOCAL_ARTIFACT_STORE_CAPABILITY
    : capability.backend_kind === "object_store"
      ? REPLAY_OBJECT_ARTIFACT_STORE_REQUIRED_CAPABILITY
      : undefined
  if (!expected || canonicalJson(capability) !== canonicalJson(expected)) {
    fail("Replay Artifact Store capability does not match its backend contract")
  }
}

export function canonicalHash(value: unknown): string {
  return createHash("sha256").update(canonicalJson(value)).digest("hex")
}

export function canonicalJson(value: unknown): string {
  if (value === null || typeof value === "string" || typeof value === "boolean") return JSON.stringify(value)
  if (typeof value === "number") {
    if (!Number.isFinite(value)) fail("canonical JSON rejects non-finite numbers")
    return JSON.stringify(Object.is(value, -0) ? 0 : value)
  }
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`
  if (value && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, item]) => item !== undefined)
      .sort(([a], [b]) => a.localeCompare(b))
    return `{${entries.map(([key, item]) => `${JSON.stringify(key)}:${canonicalJson(item)}`).join(",")}}`
  }
  fail("canonical JSON rejects unsupported values")
}

function requireHash(value: unknown, field: string): void {
  const text = requireText(value, field)
  if (!/^[a-f0-9]{64}$/.test(text)) fail(`${field} must be a lowercase sha256 hex digest`)
}

function requireUtcTimestamp(value: unknown, field: string): void {
  const text = requireText(value, field)
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/.test(text) || !Number.isFinite(Date.parse(text))) {
    fail(`${field} must be an RFC 3339 UTC timestamp`)
  }
}

function requirePositive(value: unknown, field: string): void {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) fail(`${field} must be positive`)
}

function requireNonNegative(value: unknown, field: string): void {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) fail(`${field} must be non-negative`)
}

function requireRate(value: unknown, field: string, allowZero: boolean): void {
  if (typeof value !== "number" || !Number.isFinite(value)
      || (allowZero ? value < 0 : value <= 0) || value > 1) fail(`${field} must be ${allowZero ? "between zero and one" : "greater than zero and at most one"}`)
}

function requireText(value: unknown, field: string): string {
  if (typeof value !== "string" || value.trim() === "") fail(`${field} is required`)
  return value.trim()
}

function requireCanonicalPositiveDecimal(value: unknown, field: string): string {
  const text = requireText(value, field)
  if (!/^(?:0|[1-9]\d*)(?:\.\d*[1-9])?$/.test(text) || Number(text) <= 0 || !Number.isFinite(Number(text))) {
    fail(`${field} must be a canonical positive decimal string`)
  }
  return text
}

function fail(message: string): never {
  throw new Error(message)
}
