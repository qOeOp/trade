import { createHash } from "node:crypto"
import { canonicalHash, canonicalJson } from "../../../../../contracts/runtime-core/src/canonical-json"
import {
  REPLAY_LOCAL_ARTIFACT_STORAGE_POLICY_VERSION,
  REPLAY_OBJECT_ARTIFACT_STORAGE_POLICY_VERSION,
  type ReplayArtifactStoragePolicyVersion,
} from "../../../../../contracts/replay-contract/src/replay-storage-policy"
import {
  REPLAY_AGGREGATE_TRADE_COVERAGE_ATTESTATION_SCHEMA_VERSION,
  REPLAY_AGGREGATE_TRADE_EVENT_SCHEMA_VERSION,
  REPLAY_INSTRUMENT_STATUS_PROVENANCE_SCHEMA_VERSION,
  REPLAY_INSTRUMENT_STATUS_SNAPSHOT_SCHEMA_VERSION,
  assertReplayAggregateTradeCoverageAttestation,
  assertReplayAggregateTradeCoverageBinding,
  assertReplayAggregateTradeEvents,
  assertReplayInstrumentStatusSnapshot,
  createReplayAggregateTradeCoverageAttestation,
  createReplayInstrumentStatusProvenance,
  replayAggregateTradeCoverageAttestationHash,
  replayAggregateTradeEventsHash,
  type ReplayAggregateTradeCoverageAttestation,
  type ReplayAggregateTradeEvent,
  type ReplayInstrumentStatusProvenance,
  type ReplayInstrumentStatusSnapshot,
} from "../../../../../contracts/replay-contract/src/replay-market-data-contract"

export {
  canonicalHash,
  canonicalJson,
  REPLAY_LOCAL_ARTIFACT_STORAGE_POLICY_VERSION,
  REPLAY_OBJECT_ARTIFACT_STORAGE_POLICY_VERSION,
  REPLAY_AGGREGATE_TRADE_COVERAGE_ATTESTATION_SCHEMA_VERSION,
  REPLAY_AGGREGATE_TRADE_EVENT_SCHEMA_VERSION,
  REPLAY_INSTRUMENT_STATUS_PROVENANCE_SCHEMA_VERSION,
  REPLAY_INSTRUMENT_STATUS_SNAPSHOT_SCHEMA_VERSION,
  assertReplayAggregateTradeCoverageAttestation,
  assertReplayAggregateTradeCoverageBinding,
  assertReplayAggregateTradeEvents,
  assertReplayInstrumentStatusSnapshot,
  createReplayAggregateTradeCoverageAttestation,
  createReplayInstrumentStatusProvenance,
  replayAggregateTradeCoverageAttestationHash,
  replayAggregateTradeEventsHash,
  type ReplayAggregateTradeCoverageAttestation,
  type ReplayAggregateTradeEvent,
  type ReplayInstrumentStatusProvenance,
  type ReplayInstrumentStatusSnapshot,
}

export const REPLAY_REQUEST_SCHEMA_VERSION = "trade.rd-replay-execution-request.v38" as const
export const REPLAY_RESULT_SCHEMA_VERSION = "trade.rd-replay-result.v53" as const
export const REPLAY_ARTIFACT_SCHEMA_VERSION = "trade.rd-replay-artifact-manifest.v55" as const
export const REPLAY_ARTIFACT_STORE_CAPABILITY_SCHEMA_VERSION = "trade.rd-replay-artifact-store-capability.v1" as const
export const REPLAY_SIMULATOR_POLICY_VERSION = "rd-replay-simulator-v24" as const
export const REPLAY_NUMERIC_POLICY_VERSION = "rd-replay-number-v3" as const
export const REPLAY_DERIVED_DECIMAL_INCREMENT = "0.000000000001" as const
export const REPLAY_JOURNAL_POLICY_VERSION = "rd-replay-journal-v5" as const
export const REPLAY_EQUITY_POLICY_VERSION = "rd-replay-equity-v3" as const
export const REPLAY_MARGIN_POLICY_VERSION = "rd-replay-isolated-margin-v7" as const
export const REPLAY_MAINTENANCE_BREACH_SCHEMA_VERSION = "trade.rd-replay-maintenance-breach-observation.v3" as const
export const REPLAY_LIQUIDATION_EXECUTION_SCHEMA_VERSION = "trade.rd-replay-liquidation-execution.v2" as const
export const REPLAY_OHLCV_RESOLUTION_EVIDENCE_SCHEMA_VERSION = "trade.rd-replay-ohlcv-resolution-evidence.v5" as const
export const REPLAY_PENDING_ORDER_RESOLUTION_SCHEMA_VERSION = "trade.rd-replay-pending-order-resolution.v4" as const
export const REPLAY_ORDER_STATE_SNAPSHOT_SCHEMA_VERSION = "trade.rd-replay-order-state-snapshot.v1" as const
export const REPLAY_STOP_ENTRY_SAME_BAR_PATH_AMBIGUITY_SCHEMA_VERSION = "trade.rd-replay-stop-entry-same-bar-path-ambiguity.v1" as const
export const REPLAY_EXACT_TRADE_STOP_RESOLUTION_SCHEMA_VERSION = "trade.rd-replay-exact-trade-stop-resolution.v1" as const
export const REPLAY_AUTHORIZED_STOP_ENTRY_PATH_STEP_SCHEMA_VERSION = "trade.rd-replay-authorized-stop-entry-path-step.v1" as const
export const REPLAY_ENTRY_CANCEL_INTENT_SCHEMA_VERSION = "trade.rd-replay-entry-cancel-intent.v1" as const
export const REPLAY_STOP_ENTRY_CANCEL_INTENT_SCHEMA_VERSION = "trade.rd-replay-entry-cancel-intent.v2" as const
export const REPLAY_INSTRUMENT_ACCOUNTING_SPEC_VERSION = "rd-replay-instrument-accounting-v1" as const
export const REPLAY_DATASET_MANIFEST_SCHEMA_VERSION = "trade.rd-replay-dataset-manifest.v11" as const
export const REPLAY_LIQUIDITY_CAPACITY_ATTESTATION_SCHEMA_VERSION = "trade.rd-replay-liquidity-capacity-attestation.v1" as const
export const REPLAY_SUPPLEMENTAL_FACT_SCHEMA_VERSION = "trade.rd-replay-supplemental-fact.v1" as const
export const REPLAY_SUPPLEMENTAL_REQUIREMENT_SET_SCHEMA_VERSION = "trade.rd-replay-supplemental-requirement-set.v1" as const
export const REPLAY_DECISION_INPUT_SNAPSHOT_SCHEMA_VERSION = "trade.rd-replay-decision-input-snapshot.v1" as const
export const REPLAY_DECISION_MARKET_INPUT_REQUIREMENT_SCHEMA_VERSION = "trade.rd-replay-decision-market-input-requirement.v1" as const
export const REPLAY_DECISION_MARKET_INPUT_SNAPSHOT_SCHEMA_VERSION = "trade.rd-replay-decision-market-input-snapshot.v1" as const
export const REPLAY_DECISION_SCHEDULE_SCHEMA_VERSION = "trade.rd-replay-decision-schedule.v13" as const
export const REPLAY_REDUCE_ONLY_EXIT_INTENT_SCHEMA_VERSION = "trade.rd-replay-reduce-only-exit-intent.v1" as const
export const REPLAY_STRATEGY_EXIT_CANCEL_INTENT_SCHEMA_VERSION = "trade.rd-replay-strategy-exit-cancel-intent.v1" as const
export const REPLAY_TAKE_PROFIT_CANCEL_INTENT_SCHEMA_VERSION = "trade.rd-replay-take-profit-cancel-intent.v1" as const
export const REPLAY_PROTECTIVE_STOP_CANCEL_INTENT_SCHEMA_VERSION = "trade.rd-replay-protective-stop-cancel-intent.v1" as const
export const REPLAY_PROTECTIVE_STOP_REPLACE_INTENT_SCHEMA_VERSION = "trade.rd-replay-protective-stop-replace-intent.v2" as const
export const REPLAY_TAKE_PROFIT_REPLACE_INTENT_SCHEMA_VERSION = "trade.rd-replay-take-profit-replace-intent.v1" as const
export const REPLAY_PARTIAL_REDUCE_INTENT_SCHEMA_VERSION = "trade.rd-replay-partial-reduce-intent.v3" as const
export const REPLAY_PARTIAL_REDUCE_PROTECTION_POLICY_VERSION = "rd-replay-partial-reduce-protection-v1" as const
export const REPLAY_PARTIAL_REDUCE_CAPABILITY = "next-open-fixed-quantity-partial-reduce" as const
export const REPLAY_TWO_PARTIAL_REDUCE_CAPABILITY = "up-to-two-next-open-fixed-quantity-partial-reduces" as const
export const REPLAY_POST_PARTIAL_STOP_REPLACE_CAPABILITY = "post-final-partial-tighten-only-protective-stop-replace" as const
export const REPLAY_DECISION_STATE_SNAPSHOT_SCHEMA_VERSION = "trade.rd-replay-decision-state-snapshot.v3" as const
export const REPLAY_DECISION_HARNESS_CONTEXT_SCHEMA_VERSION = "trade.rd-replay-decision-harness-context.v9" as const
export const REPLAY_DECISION_HARNESS_SOURCE_BUNDLE_SCHEMA_VERSION = "trade.rd-replay-decision-harness-source-bundle.v1" as const
export const REPLAY_DECISION_HARNESS_BUILD_ATTESTATION_SCHEMA_VERSION = "trade.rd-replay-decision-harness-build-attestation.v2" as const
export const REPLAY_DECISION_HARNESS_WORKER_REQUEST_SCHEMA_VERSION = "trade.rd-replay-decision-harness-worker-request.v9" as const
export const REPLAY_DECISION_HARNESS_WORKER_RESPONSE_SCHEMA_VERSION = "trade.rd-replay-decision-harness-worker-response.v9" as const
export const REPLAY_DECISION_HARNESS_REGISTRY_CAPABILITY_SCHEMA_VERSION = "trade.rd-replay-decision-harness-registry-capability.v9" as const
export const REPLAY_DECISION_HARNESS_CAPABILITY_SCHEMA_VERSION = "trade.rd-replay-decision-harness-capability.v11" as const
export const REPLAY_DECISION_HARNESS_RECEIPT_SCHEMA_VERSION = "trade.rd-replay-decision-harness-receipt.v11" as const
export const REPLAY_DECISION_HARNESS_CUTOVER_RECEIPT_SCHEMA_VERSION = "trade.rd-replay-decision-harness-receipt.v12" as const
export const REPLAY_DECISION_BOUNDARY_SCHEMA_VERSION = "trade.rd-replay-decision-boundary.v10" as const
export const REPLAY_DECISION_EVIDENCE_TIMELINE_SCHEMA_VERSION = "trade.rd-replay-decision-evidence-timeline.v13" as const
export const REPLAY_DECISION_HARNESS_REGISTRY_POLICY_VERSION = "rd-replay-decision-harness-registry-v9" as const
export const REPLAY_DECISION_HARNESS_BUILD_POLICY_VERSION = "rd-replay-bun-single-file-build-v2" as const
export const REPLAY_DECISION_HARNESS_LOADER_POLICY_VERSION = "rd-replay-attested-fresh-subprocess-loader-v1" as const
export const REPLAY_DECISION_HARNESS_WORKER_PROTOCOL_VERSION = "rd-replay-harness-worker-stdio-v9" as const
export const REPLAY_DECISION_HARNESS_CUTOVER_WORKER_PROTOCOL_VERSION = "rd-replay-harness-worker-stdio-v10" as const
export const REPLAY_DECISION_HARNESS_BUILD_ARGUMENTS = [
  "--target=bun",
  "--format=esm",
  "--sourcemap=none",
  "--packages=bundle",
  "--reject-unresolved",
] as const
export const REPLAY_VENUE_RISK_POLICY_SCHEMA_VERSION = "trade.rd-replay-venue-risk-policy-snapshot.v1" as const
export const REPLAY_INSTRUMENT_SPEC_SNAPSHOT_SCHEMA_VERSION = "trade.rd-replay-instrument-spec-snapshot.v1" as const
export const REPLAY_CERTIFIED_CAPABILITIES = [
  "closed-bar-protective-stop-tighten",
  "closed-candle",
  "decision-harness-pending-entry-cancel",
  "exact-funding",
  "exact-mark-optional",
  "exact-risk-full-liquidation",
  "isolated-margin",
  REPLAY_PARTIAL_REDUCE_CAPABILITY,
  "next-open-market-entry",
  "next-open-reduce-only-strategy-exit",
  "ohlcv",
  "pending-strategy-exit-contract-cancel",
  "pit-instrument-status-epochs",
  REPLAY_POST_PARTIAL_STOP_REPLACE_CAPABILITY,
  "pre-entry-gtc-limit-contract-cancel",
  "pre-entry-gtc-limit-ohlcv-bounded-full-fill",
  "pre-entry-gtc-stop-market-contract-cancel",
  "pre-entry-gtc-stop-market-ohlcv-bounded-full-fill",
  "pre-entry-gtd-limit-closed-bar-expiry",
  "pre-entry-gtd-stop-market-closed-bar-expiry",
  "pre-entry-ioc-limit-next-open-bounded-full-fill",
  "protective-stop-contract-cancel-target-preserved",
  "protective-target-contract-cancel-stop-preserved",
  "protective-target-contract-replace-stop-preserved",
  "single-position",
  "step",
  "stop-take-profit-market",
  REPLAY_TWO_PARTIAL_REDUCE_CAPABILITY,
] as const
export const REPLAY_REQUIRED_ARTIFACT_ROLES = [
  "request", "trial_reservation", "attempt_lease", "dataset_manifest", "liquidity_capacity_attestation", "supplemental_facts", "decision_market_input_snapshot", "decision_evidence_timeline", "result",
  "source_events", "order_events", "order_state_snapshot", "fills", "positions", "ledger", "ohlcv_resolution_evidence", "pending_order_resolutions", "bar_linked_stop_entry_path_step",
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
  decision_market_input_requirement: ReplayDecisionMarketInputRequirement
  decision_market_input_requirement_hash: string
  decision_schedule: ReplayDecisionSchedule
  decision_schedule_hash: string
  venue_risk_policy_schedule_hash: string
  instrument_spec_schedule_hash: string
  instrument_status_schedule_hash: string
  instrument_status_provenance_hash: string
  instrument_status_provider_capability_hash: string
  instrument_status_provider_certification_hash: string
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
    entry_cancel_intent?: ReplayEntryCancelIntent
    entry_execution:
      | { order_type: "market" }
      | {
        order_type: "limit"
        limit_price: number
        time_in_force: "gtc" | "ioc" | "gtd"
        expires_at?: string
        liquidity_model: "ohlcv-cross-through-full-fill-bounded-v1"
        full_fill_capacity: number
        liquidity_capacity_attestation_hash: string
      }
      | {
        order_type: "stop_market"
        trigger_price: number
        trigger_source: "last_trade_ohlcv"
        time_in_force: "gtc" | "gtd"
        expires_at?: string
        liquidity_model: "ohlcv-cross-through-full-fill-bounded-v1"
        full_fill_capacity: number
        liquidity_capacity_attestation_hash: string
      }
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

export interface ReplayLimitEntryCancelIntent {
  schema_version: typeof REPLAY_ENTRY_CANCEL_INTENT_SCHEMA_VERSION
  intent_id: string
  authority: "experiment_contract"
  target_order_role: "entry"
  target_order_type: "limit"
  target_time_in_force: "gtc"
  requested_at: string
  effective_at: string
  effective_boundary: "after_bar_range"
  reason_code: "experiment_contract_cancel"
  intent_hash: string
}

export interface ReplayStopEntryCancelIntent {
  schema_version: typeof REPLAY_STOP_ENTRY_CANCEL_INTENT_SCHEMA_VERSION
  intent_id: string
  authority: "experiment_contract"
  target_order_role: "entry"
  target_order_type: "stop_market"
  target_time_in_force: "gtc"
  requested_at: string
  effective_at: string
  effective_boundary: "after_bar_range"
  reason_code: "experiment_contract_cancel"
  intent_hash: string
}

export type ReplayEntryCancelIntent = ReplayLimitEntryCancelIntent | ReplayStopEntryCancelIntent

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

export type ReplayDecisionMarketInputRequirement = {
  schema_version: typeof REPLAY_DECISION_MARKET_INPUT_REQUIREMENT_SCHEMA_VERSION
  mode: "none"
  undeclared_input_policy: "reject"
} | {
  schema_version: typeof REPLAY_DECISION_MARKET_INPUT_REQUIREMENT_SCHEMA_VERSION
  mode: "closed_bar_lookback"
  source_kind: "ohlcv"
  fields: readonly ["open", "high", "low", "close", "volume"]
  lookback_bars: number
  visibility_policy: "close_time_at_or_before_decision_time"
  terminal_bar_policy: "close_time_equals_decision_time"
  continuity_policy: "strict_interval_grid"
  undeclared_input_policy: "reject"
}

export const REPLAY_NO_DECISION_MARKET_INPUT: ReplayDecisionMarketInputRequirement = {
  schema_version: REPLAY_DECISION_MARKET_INPUT_REQUIREMENT_SCHEMA_VERSION,
  mode: "none",
  undeclared_input_policy: "reject",
}
export const REPLAY_NO_DECISION_MARKET_INPUT_HASH = canonicalHash(REPLAY_NO_DECISION_MARKET_INPUT)

export interface ReplayReduceOnlyExitIntent {
  schema_version: typeof REPLAY_REDUCE_ONLY_EXIT_INTENT_SCHEMA_VERSION
  side: ReplayOrderSide
  order_type: "market"
  reduce_only: true
  quantity_policy: "full_open_position"
  signal_time: string
  earliest_executable_time: string
}

export interface ReplayStrategyExitCancelIntent {
  schema_version: typeof REPLAY_STRATEGY_EXIT_CANCEL_INTENT_SCHEMA_VERSION
  target_order_role: "strategy_exit"
  target_exit_decision_sequence: number
  cancel_policy: "cancel_submitted_before_earliest_executable_time"
  effective_at: string
  reason_code: "strategy_exit_condition_revoked"
}

export interface ReplayTakeProfitCancelIntent {
  schema_version: typeof REPLAY_TAKE_PROFIT_CANCEL_INTENT_SCHEMA_VERSION
  target_order_role: "target"
  target_order_type: "take_profit_market"
  target_order_id: string
  cancel_policy: "cancel_active_target_preserve_stop"
  stop_preservation_policy: "require_active_full_position_stop"
  schedule_combination_policy: "initial_bracket_only_no_other_position_mutation"
  effective_at: string
  reason_code: "take_profit_condition_revoked"
}

export interface ReplayProtectiveStopCancelIntent {
  schema_version: typeof REPLAY_PROTECTIVE_STOP_CANCEL_INTENT_SCHEMA_VERSION
  target_order_role: "stop"
  target_order_type: "stop_market"
  target_order_id: string
  cancel_policy: "cancel_active_stop_preserve_target"
  target_preservation_policy: "require_active_full_position_target"
  schedule_combination_policy: "initial_bracket_only_no_other_position_mutation"
  effective_at: string
  reason_code: "protective_stop_condition_revoked"
}

export interface ReplayProtectiveStopReplaceIntent {
  schema_version: typeof REPLAY_PROTECTIVE_STOP_REPLACE_INTENT_SCHEMA_VERSION
  side: ReplayOrderSide
  order_type: "stop_market"
  reduce_only: true
  quantity_policy: "full_open_position"
  replace_policy: "tighten_only_cancel_then_submit"
  schedule_combination_policy?: "initial_bracket_then_optional_full_exit_no_other_position_mutation"
    | "after_final_partial_then_optional_full_exit_no_other_position_mutation"
  signal_time: string
  previous_stop_price: number
  new_stop_price: number
}

export interface ReplayTakeProfitReplaceIntent {
  schema_version: typeof REPLAY_TAKE_PROFIT_REPLACE_INTENT_SCHEMA_VERSION
  side: ReplayOrderSide
  order_type: "take_profit_market"
  reduce_only: true
  quantity_policy: "full_open_position"
  target_order_id: string
  replace_policy: "cancel_then_submit_not_already_triggered"
  stop_preservation_policy: "require_active_full_position_stop"
  schedule_combination_policy: "initial_bracket_only_no_other_position_mutation"
  signal_time: string
  previous_target_price: number
  new_target_price: number
  reason_code: "take_profit_repriced"
}

export interface ReplayPartialReduceIntent {
  schema_version: typeof REPLAY_PARTIAL_REDUCE_INTENT_SCHEMA_VERSION
  side: ReplayOrderSide
  order_type: "market"
  reduce_only: true
  quantity_policy: "fixed_quantity"
  quantity: number
  signal_time: string
  earliest_executable_time: string
  post_fill_position_policy: "must_remain_open"
  protection_resize_policy: "after_fill_cancel_both_then_replace_remaining_at_same_source_boundary"
  protection_policy_version: typeof REPLAY_PARTIAL_REDUCE_PROTECTION_POLICY_VERSION
  replacement_trigger_policy: "preserve_current_stop_and_target_prices"
  remaining_quantity_authority: "absolute_post_fill_position"
  schedule_combination_policy: "one_partial_reduce_then_optional_final_full_exit_no_stop_replace"
    | "up_to_two_partial_reduces_then_optional_final_full_exit_no_other_mutation"
    | "one_partial_reduce_then_one_tighten_only_stop_replace_then_optional_final_full_exit"
    | "up_to_two_partial_reduces_then_one_tighten_only_stop_replace_then_optional_final_full_exit"
}

export interface ReplayDecisionScheduleEntry {
  decision_sequence: number
  decision_time: string
  expected_effect: "no_action" | "authorized_initial_order" | "authorized_entry_cancel" | "authorized_protective_stop_replace" | "authorized_take_profit_replace" | "authorized_partial_reduce" | "authorized_reduce_only_exit" | "authorized_strategy_exit_cancel" | "authorized_take_profit_cancel" | "authorized_protective_stop_cancel"
  authorized_entry_cancel?: ReplayEntryCancelIntent | null
  authorized_strategy_exit_cancel?: ReplayStrategyExitCancelIntent | null
  authorized_take_profit_cancel?: ReplayTakeProfitCancelIntent | null
  authorized_protective_stop_cancel?: ReplayProtectiveStopCancelIntent | null
  authorized_reduce_only_exit: ReplayReduceOnlyExitIntent | null
  authorized_protective_stop_replace: ReplayProtectiveStopReplaceIntent | null
  authorized_take_profit_replace?: ReplayTakeProfitReplaceIntent | null
  authorized_partial_reduce: ReplayPartialReduceIntent | null
  authorized_order_hash: string | null
}

export interface ReplayDecisionSchedule {
  schema_version: typeof REPLAY_DECISION_SCHEDULE_SCHEMA_VERSION
  schedule_policy: "frozen_closed_bar_schedule"
  entries: ReplayDecisionScheduleEntry[]
}

export type ReplayDecisionOutput = {
  action: "no_action"
} | {
  action: "submit_partial_reduce"
  order: ReplayPartialReduceIntent
} | {
  action: "submit_initial_order"
  order: ReplayExecutionRequest["order"]
} | {
  action: "cancel_entry_order"
  order: ReplayEntryCancelIntent
} | {
  action: "submit_reduce_only_exit"
  order: ReplayReduceOnlyExitIntent
} | {
  action: "cancel_strategy_exit"
  order: ReplayStrategyExitCancelIntent
} | {
  action: "cancel_take_profit"
  order: ReplayTakeProfitCancelIntent
} | {
  action: "cancel_protective_stop"
  order: ReplayProtectiveStopCancelIntent
} | {
  action: "replace_protective_stop"
  order: ReplayProtectiveStopReplaceIntent
} | {
  action: "replace_take_profit"
  order: ReplayTakeProfitReplaceIntent
}

export interface ReplayDecisionMarketInputSnapshot {
  schema_version: typeof REPLAY_DECISION_MARKET_INPUT_SNAPSHOT_SCHEMA_VERSION
  run_id: string
  decision_time: string
  symbol: string
  timeframe: string
  interval_ms: number
  requirement_hash: string
  visibility_policy: "closed_candle"
  bars: ReplayMarketBar[]
  bars_hash: string
  snapshot_hash: string
}

export type ReplayDecisionMarketInputSnapshotBody = Omit<ReplayDecisionMarketInputSnapshot, "snapshot_hash">

export interface ReplayDecisionStateSnapshot {
  schema_version: typeof REPLAY_DECISION_STATE_SNAPSHOT_SCHEMA_VERSION
  run_id: string
  decision_sequence: number
  decision_time: string
  observation_event_key: ReplayEventKey
  source_prefix_hash: string
  position: {
    state: "open"
    side: "long" | "short"
    signed_quantity: number
    average_entry_price: number
  }
  active_protection: {
    stop: { order_id: string; status: "active"; trigger_price: number; remaining_quantity: number }
    target: { order_id: string; status: "active"; trigger_price: number; remaining_quantity: number }
  }
  mark_price: number
  cash_balance: number
  total_fees: number
  total_funding: number
  unrealized_pnl: number
  equity: number
  snapshot_hash: string
}

export type ReplayDecisionStateSnapshotBody = Omit<ReplayDecisionStateSnapshot, "snapshot_hash">

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

export interface ReplayDecisionHarnessContext {
  schema_version: typeof REPLAY_DECISION_HARNESS_CONTEXT_SCHEMA_VERSION
  run_id: string
  experiment_id: string
  trial_group_id: string
  trial_id: string
  candidate_id: string
  candidate_hash: string
  strategy_policy_hash: string | null
  symbol: string
  timeframe: string
  decision_sequence: number
  decision_time: string
  decision_phase: "pre_entry" | "initial_entry" | "pending_entry" | "position_open"
  earliest_executable_time: string | null
  random_seed: number
}

export interface ReplayDecisionHarnessSourceFile {
  path: string
  content_utf8: string
  sha256: string
}

export interface ReplayDecisionHarnessSourceBundle {
  schema_version: typeof REPLAY_DECISION_HARNESS_SOURCE_BUNDLE_SCHEMA_VERSION
  bundle_ref: string
  format: "utf8_source_set"
  entrypoint: { file_path: string; export_name: string }
  files: ReplayDecisionHarnessSourceFile[]
  bundle_hash: string
}

export interface ReplayDecisionHarnessBuildAttestation {
  schema_version: typeof REPLAY_DECISION_HARNESS_BUILD_ATTESTATION_SCHEMA_VERSION
  source_bundle_hash: string
  build_policy_version: typeof REPLAY_DECISION_HARNESS_BUILD_POLICY_VERSION
  worker_protocol_version: typeof REPLAY_DECISION_HARNESS_WORKER_PROTOCOL_VERSION
  dependency_policy: "metafile_exact_source_closure_no_external_imports"
  build_arguments: typeof REPLAY_DECISION_HARNESS_BUILD_ARGUMENTS
  runtime: {
    runtime_id: "bun"
    runtime_version: string
    executable_sha256: string
  }
  artifact: {
    format: "bun_esm_bundle_utf8"
    content_utf8: string
    sha256: string
  }
  attestation_hash: string
}

export type ReplayDecisionHarnessBuildAttestationBody = Omit<ReplayDecisionHarnessBuildAttestation, "attestation_hash">

export interface ReplayDecisionHarnessWorkerRequest {
  schema_version: typeof REPLAY_DECISION_HARNESS_WORKER_REQUEST_SCHEMA_VERSION
  invocation_id: string
  source_bundle_hash: string
  artifact_hash: string
  request_context: ReplayDecisionHarnessContext
  decision_input_snapshot: ReplayDecisionInputSnapshot
  decision_market_input_snapshot: ReplayDecisionMarketInputSnapshot
  decision_state_snapshot: ReplayDecisionStateSnapshot | null
}

export interface ReplayDecisionHarnessWorkerResponse {
  schema_version: typeof REPLAY_DECISION_HARNESS_WORKER_RESPONSE_SCHEMA_VERSION
  invocation_id: string
  source_bundle_hash: string
  artifact_hash: string
  decision_output: ReplayDecisionOutput
  trace: ReplaySupplementalValue
}

export interface ReplayDecisionHarnessRegistryCapability {
  schema_version: typeof REPLAY_DECISION_HARNESS_REGISTRY_CAPABILITY_SCHEMA_VERSION
  registry_policy_version: typeof REPLAY_DECISION_HARNESS_REGISTRY_POLICY_VERSION
  build_policy_version: typeof REPLAY_DECISION_HARNESS_BUILD_POLICY_VERSION
  loader_policy_version: typeof REPLAY_DECISION_HARNESS_LOADER_POLICY_VERSION
  worker_protocol_version: typeof REPLAY_DECISION_HARNESS_WORKER_PROTOCOL_VERSION
  lookup_key: "bundle_hash"
  registration_policy: "immutable_for_process_lifetime"
  entrypoint_binding: "attested_build_artifact"
  execution_boundary: "fresh_subprocess_stdio_reproducibility_pair"
  environment_policy: "fixed_minimal_environment"
  resource_policy: "timeout_and_output_cap"
  timeout_ms: 5000
  max_output_bytes: 1048576
}

export const REPLAY_DECISION_HARNESS_REGISTRY_CAPABILITY: ReplayDecisionHarnessRegistryCapability = Object.freeze({
  schema_version: REPLAY_DECISION_HARNESS_REGISTRY_CAPABILITY_SCHEMA_VERSION,
  registry_policy_version: REPLAY_DECISION_HARNESS_REGISTRY_POLICY_VERSION,
  build_policy_version: REPLAY_DECISION_HARNESS_BUILD_POLICY_VERSION,
  loader_policy_version: REPLAY_DECISION_HARNESS_LOADER_POLICY_VERSION,
  worker_protocol_version: REPLAY_DECISION_HARNESS_WORKER_PROTOCOL_VERSION,
  lookup_key: "bundle_hash",
  registration_policy: "immutable_for_process_lifetime",
  entrypoint_binding: "attested_build_artifact",
  execution_boundary: "fresh_subprocess_stdio_reproducibility_pair",
  environment_policy: "fixed_minimal_environment",
  resource_policy: "timeout_and_output_cap",
  timeout_ms: 5000,
  max_output_bytes: 1048576,
})

export interface ReplayDecisionHarnessCapability {
  schema_version: typeof REPLAY_DECISION_HARNESS_CAPABILITY_SCHEMA_VERSION
  harness_hash: string
  source_bundle_ref: string
  source_bundle_hash: string
  build_attestation_hash: string
  build_artifact_hash: string
  runtime_executable_hash: string
  registry_policy_version: typeof REPLAY_DECISION_HARNESS_REGISTRY_POLICY_VERSION
  build_policy_version: typeof REPLAY_DECISION_HARNESS_BUILD_POLICY_VERSION
  loader_policy_version: typeof REPLAY_DECISION_HARNESS_LOADER_POLICY_VERSION
  worker_protocol_version: typeof REPLAY_DECISION_HARNESS_WORKER_PROTOCOL_VERSION
  execution_policy: "fresh_subprocess_stdio_reproducibility_pair"
  context_schema_version: typeof REPLAY_DECISION_HARNESS_CONTEXT_SCHEMA_VERSION
  supplemental_input_schema_version: typeof REPLAY_DECISION_INPUT_SNAPSHOT_SCHEMA_VERSION
  market_input_schema_version: typeof REPLAY_DECISION_MARKET_INPUT_SNAPSHOT_SCHEMA_VERSION
  state_input_schema_version: typeof REPLAY_DECISION_STATE_SNAPSHOT_SCHEMA_VERSION
  output_schema_version: typeof REPLAY_DECISION_HARNESS_RECEIPT_SCHEMA_VERSION
}

export interface ReplayDecisionHarnessReceiptV11 {
  schema_version: typeof REPLAY_DECISION_HARNESS_RECEIPT_SCHEMA_VERSION
  run_id: string
  harness_hash: string
  source_bundle_ref: string
  source_bundle_hash: string
  build_attestation_hash: string
  build_artifact_hash: string
  runtime_executable_hash: string
  registry_policy_version: typeof REPLAY_DECISION_HARNESS_REGISTRY_POLICY_VERSION
  build_policy_version: typeof REPLAY_DECISION_HARNESS_BUILD_POLICY_VERSION
  loader_policy_version: typeof REPLAY_DECISION_HARNESS_LOADER_POLICY_VERSION
  worker_protocol_version: typeof REPLAY_DECISION_HARNESS_WORKER_PROTOCOL_VERSION
  execution_policy: "fresh_subprocess_stdio_reproducibility_pair"
  decision_input_snapshot_hash: string
  decision_market_input_snapshot_hash: string
  decision_state_snapshot_hash: string | null
  request_context_hash: string
  worker_request_hash: string
  worker_response_hash: string
  worker_verification_response_hash: string
  decision_output: ReplayDecisionOutput
  trace: ReplaySupplementalValue
  trace_hash: string
  receipt_hash: string
}

export interface ReplayDecisionHarnessReceiptV12 {
  schema_version: typeof REPLAY_DECISION_HARNESS_CUTOVER_RECEIPT_SCHEMA_VERSION
  run_id: string
  harness_hash: string
  source_bundle_ref: string
  source_bundle_hash: string
  build_attestation_hash: string
  build_artifact_hash: string
  runtime_executable_hash: string
  registry_policy_version: typeof REPLAY_DECISION_HARNESS_REGISTRY_POLICY_VERSION
  build_policy_version: typeof REPLAY_DECISION_HARNESS_BUILD_POLICY_VERSION
  loader_policy_version: typeof REPLAY_DECISION_HARNESS_LOADER_POLICY_VERSION
  worker_protocol_version: typeof REPLAY_DECISION_HARNESS_CUTOVER_WORKER_PROTOCOL_VERSION
  execution_policy: "two_fresh_authority_subprocesses_exact_schedule_cutover"
  decision_input_snapshot_hash: string
  decision_market_input_snapshot_hash: string
  decision_state_snapshot_hash: string | null
  request_context_hash: string
  worker_request_hash: string
  worker_response_hash: string
  worker_verification_response_hash: string
  decision_output: ReplayDecisionOutput
  trace: ReplaySupplementalValue
  trace_hash: string
  receipt_hash: string
}

export type ReplayDecisionHarnessReceipt = ReplayDecisionHarnessReceiptV11 | ReplayDecisionHarnessReceiptV12
export type ReplayDecisionHarnessReceiptBody = Omit<ReplayDecisionHarnessReceiptV11, "receipt_hash">

export interface ReplayDecisionBoundary {
  schema_version: typeof REPLAY_DECISION_BOUNDARY_SCHEMA_VERSION
  boundary_sequence: number
  boundary_kind: "frozen_decision_schedule_entry"
  decision_origin: "frozen_request_order" | "attested_harness_verified_schedule_effect"
  evaluation_time: string
  market_data_cutoff: string
  supplemental_data_cutoff: string
  earliest_executable_time: string | null
  signal_visibility: "closed_candle"
  supplemental_visibility: "signal_time_snapshot"
  execution_policy: "next_open"
  order_transition_policy: "none" | "submit_at_decision" | "cancel_at_decision" | "cancel_replace_at_decision"
  market_input_evidence: "not_required_compatibility" | "materialized_closed_bar_lookback"
  market_input_snapshot_hash: string
  boundary_hash: string
}

export type ReplayDecisionBoundaryBody = Omit<ReplayDecisionBoundary, "boundary_hash">

export interface ReplayDecisionEvidenceEntry {
  decision_sequence: number
  decision_time: string
  decision_kind: "scheduled_evaluation" | "initial_order" | "entry_cancel" | "protective_stop_replace" | "take_profit_replace" | "partial_reduce" | "reduce_only_exit" | "strategy_exit_cancel" | "take_profit_cancel" | "protective_stop_cancel"
  evaluation_status: "evaluated" | "pending_runtime" | "not_reached_terminal"
  execution_effect: "no_action" | "authorized_order" | "authorized_entry_cancel" | "authorized_protective_stop_replace" | "authorized_take_profit_replace" | "authorized_partial_reduce" | "authorized_reduce_only_exit" | "authorized_strategy_exit_cancel" | "authorized_take_profit_cancel" | "authorized_protective_stop_cancel" | "not_reached"
  evidence_mode: "precomputed_order_compatibility" | "attested_harness" | "pending_runtime" | "not_reached_terminal"
  authorized_order_hash: string | null
  decision_output_hash: string | null
  decision_boundary: ReplayDecisionBoundary
  decision_input_snapshot: ReplayDecisionInputSnapshot
  decision_market_input_snapshot: ReplayDecisionMarketInputSnapshot
  decision_state_snapshot: ReplayDecisionStateSnapshot | null
  decision_harness_bundle: ReplayDecisionHarnessSourceBundle | null
  decision_harness_build: ReplayDecisionHarnessBuildAttestation | null
  decision_harness_receipt: ReplayDecisionHarnessReceipt | null
  terminal_event_key: ReplayEventKey | null
  entry_hash: string
}

export type ReplayDecisionEvidenceEntryBody = Omit<ReplayDecisionEvidenceEntry, "entry_hash">

export interface ReplayDecisionEvidenceTimeline {
  schema_version: typeof REPLAY_DECISION_EVIDENCE_TIMELINE_SCHEMA_VERSION
  run_id: string
  ordering_policy: "decision_time_then_sequence"
  cardinality_policy: "frozen_decision_schedule"
  entries: ReplayDecisionEvidenceEntry[]
  timeline_hash: string
}

export type ReplayDecisionEvidenceTimelineBody = Omit<ReplayDecisionEvidenceTimeline, "timeline_hash">

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
  liquidity_capacity_attestation?: ReplayLiquidityCapacityAttestation
  venue_risk_policy_epochs: ReplayVenueRiskPolicySnapshot[]
  instrument: {
    listed_at: string
    trading_enabled_at: string
    delisted_at: string | null
    status_history: "complete" | "current_snapshot_only"
    status_epochs: ReplayInstrumentStatusSnapshot[]
    status_provenance: ReplayInstrumentStatusProvenance
    spec_epochs: ReplayInstrumentSpecSnapshot[]
    accounting: ReplayInstrumentAccountingSpec
  }
  universe: {
    selected_at: string
    survivorship: "point_in_time" | "survivor_only"
  }
}

export interface ReplayLiquidityCapacityAttestation {
  schema_version: typeof REPLAY_LIQUIDITY_CAPACITY_ATTESTATION_SCHEMA_VERSION
  attestation_id: string
  attestation_ref: string
  symbol: string
  quantity_unit: "base_asset"
  capacity_scope: "static_order_quantity_ceiling"
  full_fill_capacity: number
  calibration_window_start: string
  calibration_window_end: string
  observed_through: string
  available_at: string
  source_ref: string
  source_hash: string
  derivation_policy_id: string
  derivation_policy_version: string
  derivation_policy_hash: string
  evidence_limitation: "not_event_depth_or_queue_position_proof"
  attestation_hash: string
}

export type ReplayLiquidityCapacityAttestationBody = Omit<ReplayLiquidityCapacityAttestation, "attestation_hash">

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

export interface ReplayDataGapFailureEvidence {
  gap_kind: "missing_earliest_executable_bar" | "open_position_grid_gap"
  gap_start: string
  next_observed_open: string
  missing_bar_count: number
  interval_ms: number
  policy: "fail_before_unobserved_interval_effects"
}

export function assertReplayDataGapFailureEvidence(evidence: ReplayDataGapFailureEvidence): void {
  if (evidence.gap_kind !== "missing_earliest_executable_bar"
      && evidence.gap_kind !== "open_position_grid_gap") fail("unsupported Replay data-gap kind")
  requireUtcTimestamp(evidence.gap_start, "data_gap.gap_start")
  requireUtcTimestamp(evidence.next_observed_open, "data_gap.next_observed_open")
  if (!Number.isSafeInteger(evidence.missing_bar_count) || evidence.missing_bar_count <= 0
      || !Number.isSafeInteger(evidence.interval_ms) || evidence.interval_ms <= 0) {
    fail("Replay data-gap count and interval must be positive safe integers")
  }
  if (Date.parse(evidence.next_observed_open) - Date.parse(evidence.gap_start)
      !== evidence.missing_bar_count * evidence.interval_ms) {
    fail("Replay data-gap bounds do not match the missing interval count")
  }
  if (evidence.policy !== "fail_before_unobserved_interval_effects") {
    fail("unsupported Replay data-gap policy")
  }
}

export type ReplayOhlcvPathId = "open_high_low_close" | "open_low_high_close"

export interface ReplayOhlcvResolutionPath {
  path_id: ReplayOhlcvPathId
  first_terminal_role: "stop" | "target"
  trigger_price: number
  simulated_execution_price: number
  gross_realized_pnl: number
  exit_fee: number
  net_terminal_contribution: number
  path_digest: string
}

export interface ReplayOhlcvEconomicImpactEnvelope {
  scope: "terminal_fill_contribution_excludes_common_cashflows"
  settlement_asset: string
  cost_policy_id: string
  cost_policy_version: string
  numeric_policy_version: typeof REPLAY_NUMERIC_POLICY_VERSION
  fee_bps: number
  slippage_bps: number
  price_increment: string
  settlement_increment: string
  entry_basis_price: number
  quantity: number
  min_net_terminal_contribution: number
  max_net_terminal_contribution: number
  net_terminal_contribution_span: number
  canonical_net_terminal_contribution: number
  canonical_shortfall_to_best: number
  impact_hash: string
}

export function replayOhlcvEconomicImpactHash(
  impact: Omit<ReplayOhlcvEconomicImpactEnvelope, "impact_hash"> | ReplayOhlcvEconomicImpactEnvelope,
): string {
  const { impact_hash: _impactHash, ...body } = impact as ReplayOhlcvEconomicImpactEnvelope
  return canonicalHash(body)
}

export interface ReplayOhlcvActiveProtectionEvidence {
  protection_mode: "bracket" | "stop_only" | "target_only"
  protection_generation: number
  remaining_quantity: number
  stop_order_id: string
  stop_trigger_price: number
  stop_order_status: "active" | "cancelled"
  target_order_id: string
  target_trigger_price: number
  target_order_status: "active" | "cancelled"
  protection_hash: string
}

export function replayOhlcvActiveProtectionHash(
  protection: Omit<ReplayOhlcvActiveProtectionEvidence, "protection_hash"> | ReplayOhlcvActiveProtectionEvidence,
): string {
  const { protection_hash: _protectionHash, ...body } = protection as ReplayOhlcvActiveProtectionEvidence
  return canonicalHash(body)
}

export interface ReplayOhlcvResolutionEvidence {
  schema_version: typeof REPLAY_OHLCV_RESOLUTION_EVIDENCE_SCHEMA_VERSION
  resolution_id: string
  source_event_id: string
  source_event_key: ReplayEventKey
  bar_index: number
  bar: Pick<ReplayMarketBar, "open_time" | "close_time" | "open" | "high" | "low" | "close">
  position_side: "long" | "short"
  active_protection: ReplayOhlcvActiveProtectionEvidence
  observation_kind: "bar_open_gap" | "bar_range_touch"
  status: "exact_under_ohlc" | "resolution_limited"
  resolution_reason: "open_gap_observed" | "single_terminal_touch" | "stop_target_order_ambiguous"
  paths: [ReplayOhlcvResolutionPath, ReplayOhlcvResolutionPath]
  economic_impact: ReplayOhlcvEconomicImpactEnvelope
  canonical: {
    path_id: ReplayOhlcvPathId
    terminal_role: "stop" | "target"
    selection_policy: "equivalent_paths_stable_id" | "lower_terminal_equity_then_realized_pnl_then_path_id"
  }
  evidence_hash: string
}

export function replayOhlcvResolutionEvidenceHash(
  evidence: Omit<ReplayOhlcvResolutionEvidence, "evidence_hash"> | ReplayOhlcvResolutionEvidence,
): string {
  const { evidence_hash: _evidenceHash, ...body } = evidence as ReplayOhlcvResolutionEvidence
  return canonicalHash(body)
}

export function assertReplayOhlcvResolutionEvidence(evidence: ReplayOhlcvResolutionEvidence): void {
  if (evidence.schema_version !== REPLAY_OHLCV_RESOLUTION_EVIDENCE_SCHEMA_VERSION) {
    fail("unsupported Replay OHLCV resolution evidence schema")
  }
  requireText(evidence.resolution_id, "ohlcv_resolution.resolution_id")
  requireText(evidence.source_event_id, "ohlcv_resolution.source_event_id")
  assertReplayEventKey(evidence.source_event_key)
  if (evidence.source_event_id !== evidence.source_event_key.stable_event_id) {
    fail("ohlcv resolution source id does not match its EventKey")
  }
  if (!Number.isSafeInteger(evidence.bar_index) || evidence.bar_index < 0) {
    fail("ohlcv resolution bar_index must be a non-negative safe integer")
  }
  requireUtcTimestamp(evidence.bar.open_time, "ohlcv_resolution.bar.open_time")
  requireUtcTimestamp(evidence.bar.close_time, "ohlcv_resolution.bar.close_time")
  if (Date.parse(evidence.bar.open_time) >= Date.parse(evidence.bar.close_time)) {
    fail("ohlcv resolution bar interval is invalid")
  }
  for (const field of ["open", "high", "low", "close"] as const) {
    requirePositive(evidence.bar[field], `ohlcv_resolution.bar.${field}`)
  }
  if (evidence.bar.low > Math.min(evidence.bar.open, evidence.bar.close)
      || evidence.bar.high < Math.max(evidence.bar.open, evidence.bar.close)
      || evidence.bar.low > evidence.bar.high) {
    fail("ohlcv resolution bar geometry is invalid")
  }
  const protection = evidence.active_protection
  const validProtectionMode = protection.protection_mode === "bracket"
    ? protection.stop_order_status === "active" && protection.target_order_status === "active"
    : protection.protection_mode === "stop_only"
      ? protection.stop_order_status === "active" && protection.target_order_status === "cancelled"
      : protection.protection_mode === "target_only"
        && protection.stop_order_status === "cancelled" && protection.target_order_status === "active"
  if (!validProtectionMode) {
    fail("ohlcv resolution protection mode and Order statuses are inconsistent")
  }
  if (!Number.isSafeInteger(protection.protection_generation) || protection.protection_generation < 1) {
    fail("ohlcv resolution protection generation must be a positive safe integer")
  }
  requirePositive(protection.remaining_quantity, "ohlcv_resolution.active_protection.remaining_quantity")
  requireText(protection.stop_order_id, "ohlcv_resolution.active_protection.stop_order_id")
  requireText(protection.target_order_id, "ohlcv_resolution.active_protection.target_order_id")
  if (protection.stop_order_id === protection.target_order_id) {
    fail("ohlcv resolution protection Order ids must be distinct")
  }
  requirePositive(protection.stop_trigger_price, "ohlcv_resolution.active_protection.stop_trigger_price")
  requirePositive(protection.target_trigger_price, "ohlcv_resolution.active_protection.target_trigger_price")
  requireHash(protection.protection_hash, "ohlcv_resolution.active_protection.protection_hash")
  if (replayOhlcvActiveProtectionHash(protection) !== protection.protection_hash) {
    fail("ohlcv resolution active protection hash mismatch")
  }
  if ((evidence.position_side !== "long" && evidence.position_side !== "short")
      || (evidence.observation_kind !== "bar_open_gap" && evidence.observation_kind !== "bar_range_touch")
      || (evidence.status !== "exact_under_ohlc" && evidence.status !== "resolution_limited")) {
    fail("ohlcv resolution enum value is invalid")
  }
  if ((evidence.position_side === "long" && protection.stop_trigger_price >= protection.target_trigger_price)
      || (evidence.position_side === "short" && protection.stop_trigger_price <= protection.target_trigger_price)) {
    fail("ohlcv resolution active bracket is invalid")
  }
  const expectedTime = evidence.observation_kind === "bar_open_gap"
    ? evidence.bar.open_time
    : evidence.bar.close_time
  if (evidence.source_event_key.event_time !== expectedTime || evidence.source_event_key.boundary_phase !== 20) {
    fail("ohlcv resolution source EventKey does not match its observation boundary")
  }
  const expectedPathIds: ReplayOhlcvPathId[] = ["open_high_low_close", "open_low_high_close"]
  for (const [index, path] of evidence.paths.entries()) {
    if (path.path_id !== expectedPathIds[index]) fail("ohlcv resolution paths must use canonical order")
    requirePositive(path.trigger_price, `ohlcv_resolution.paths[${index}].trigger_price`)
    requirePositive(path.simulated_execution_price, `ohlcv_resolution.paths[${index}].simulated_execution_price`)
    if (!Number.isFinite(path.gross_realized_pnl)
        || !Number.isFinite(path.net_terminal_contribution)) {
      fail("ohlcv resolution path economic contribution must be finite")
    }
    requireNonNegative(path.exit_fee, `ohlcv_resolution.paths[${index}].exit_fee`)
    requireHash(path.path_digest, `ohlcv_resolution.paths[${index}].path_digest`)
    if (path.path_digest !== canonicalHash({
      path_id: path.path_id,
      first_terminal_role: path.first_terminal_role,
      trigger_price: path.trigger_price,
      simulated_execution_price: path.simulated_execution_price,
      gross_realized_pnl: path.gross_realized_pnl,
      exit_fee: path.exit_fee,
      net_terminal_contribution: path.net_terminal_contribution,
    })) fail("ohlcv resolution path digest mismatch")
  }
  const [highFirst, lowFirst] = evidence.paths
  const pathsEquivalent = highFirst.first_terminal_role === lowFirst.first_terminal_role
    && highFirst.trigger_price === lowFirst.trigger_price
  const stopTouched = protection.protection_mode !== "target_only" && (evidence.position_side === "long"
    ? evidence.bar.low <= protection.stop_trigger_price
    : evidence.bar.high >= protection.stop_trigger_price)
  const targetTouched = protection.protection_mode !== "stop_only" && (evidence.position_side === "long"
    ? evidence.bar.high >= protection.target_trigger_price
    : evidence.bar.low <= protection.target_trigger_price)
  const expectedTrigger = (role: "stop" | "target"): number => role === "stop"
    ? protection.stop_trigger_price
    : protection.target_trigger_price
  if (evidence.observation_kind === "bar_open_gap") {
    const observedOpenRole = evidence.position_side === "long"
      ? protection.protection_mode !== "target_only" && evidence.bar.open <= protection.stop_trigger_price
        ? "stop" : protection.protection_mode !== "stop_only" && evidence.bar.open >= protection.target_trigger_price ? "target" : null
      : protection.protection_mode !== "target_only" && evidence.bar.open >= protection.stop_trigger_price
        ? "stop" : protection.protection_mode !== "stop_only" && evidence.bar.open <= protection.target_trigger_price ? "target" : null
    if (evidence.status !== "exact_under_ohlc" || evidence.resolution_reason !== "open_gap_observed"
        || !observedOpenRole || !pathsEquivalent || highFirst.first_terminal_role !== observedOpenRole
        || highFirst.trigger_price !== evidence.bar.open) {
      fail("ohlcv open-gap resolution evidence is inconsistent")
    }
  } else if (evidence.status === "exact_under_ohlc") {
    const singleRole = stopTouched !== targetTouched ? stopTouched ? "stop" : "target" : null
    if (evidence.resolution_reason !== "single_terminal_touch" || !pathsEquivalent || !singleRole
        || highFirst.first_terminal_role !== singleRole || highFirst.trigger_price !== expectedTrigger(singleRole)) {
      fail("ohlcv single-touch resolution evidence is inconsistent")
    }
  } else if (evidence.resolution_reason !== "stop_target_order_ambiguous" || pathsEquivalent
      || !stopTouched || !targetTouched
      || highFirst.first_terminal_role !== (evidence.position_side === "long" ? "target" : "stop")
      || lowFirst.first_terminal_role !== (evidence.position_side === "long" ? "stop" : "target")
      || highFirst.trigger_price !== expectedTrigger(highFirst.first_terminal_role)
      || lowFirst.trigger_price !== expectedTrigger(lowFirst.first_terminal_role)) {
    fail("ohlcv ambiguous-path resolution evidence is inconsistent")
  }
  const expectedSelectionPolicy = evidence.status === "resolution_limited"
    ? "lower_terminal_equity_then_realized_pnl_then_path_id"
    : "equivalent_paths_stable_id"
  const canonicalPath = evidence.paths.find((path) => path.path_id === evidence.canonical.path_id)
  if (evidence.canonical.selection_policy !== expectedSelectionPolicy
      || !canonicalPath || canonicalPath.first_terminal_role !== evidence.canonical.terminal_role
      || evidence.status === "resolution_limited" && evidence.canonical.terminal_role !== "stop"
      || evidence.status === "exact_under_ohlc" && (
        evidence.canonical.path_id !== "open_high_low_close"
        || evidence.canonical.terminal_role !== highFirst.first_terminal_role
      )) {
    fail("ohlcv canonical resolution selection is inconsistent")
  }
  if (protection.protection_mode === "stop_only" && (
    evidence.status !== "exact_under_ohlc" || evidence.resolution_reason === "stop_target_order_ambiguous"
    || evidence.paths.some((path) => path.first_terminal_role !== "stop")
    || evidence.canonical.terminal_role !== "stop"
  )) {
    fail("stop-only OHLCV resolution cannot expose a reachable target path")
  }
  if (protection.protection_mode === "target_only" && (
    evidence.status !== "exact_under_ohlc" || evidence.resolution_reason === "stop_target_order_ambiguous"
    || evidence.paths.some((path) => path.first_terminal_role !== "target")
    || evidence.canonical.terminal_role !== "target"
  )) {
    fail("target-only OHLCV resolution cannot expose a reachable stop path")
  }
  const impact = evidence.economic_impact
  requireText(impact.settlement_asset, "ohlcv_resolution.economic_impact.settlement_asset")
  requireText(impact.cost_policy_id, "ohlcv_resolution.economic_impact.cost_policy_id")
  requireText(impact.cost_policy_version, "ohlcv_resolution.economic_impact.cost_policy_version")
  if (impact.numeric_policy_version !== REPLAY_NUMERIC_POLICY_VERSION) {
    fail("ohlcv resolution economic impact numeric policy is invalid")
  }
  requireNonNegative(impact.fee_bps, "ohlcv_resolution.economic_impact.fee_bps")
  requireNonNegative(impact.slippage_bps, "ohlcv_resolution.economic_impact.slippage_bps")
  requireCanonicalPositiveDecimal(impact.price_increment, "ohlcv_resolution.economic_impact.price_increment")
  requireCanonicalPositiveDecimal(impact.settlement_increment, "ohlcv_resolution.economic_impact.settlement_increment")
  requirePositive(impact.entry_basis_price, "ohlcv_resolution.economic_impact.entry_basis_price")
  requirePositive(impact.quantity, "ohlcv_resolution.economic_impact.quantity")
  for (const field of [
    "min_net_terminal_contribution", "max_net_terminal_contribution",
    "net_terminal_contribution_span", "canonical_net_terminal_contribution",
    "canonical_shortfall_to_best",
  ] as const) {
    if (!Number.isFinite(impact[field])) fail(`ohlcv resolution economic impact ${field} must be finite`)
  }
  const pathContributions = evidence.paths.map((path) => path.net_terminal_contribution)
  const minimum = Math.min(...pathContributions)
  const maximum = Math.max(...pathContributions)
  if (impact.scope !== "terminal_fill_contribution_excludes_common_cashflows"
      || impact.quantity !== protection.remaining_quantity
      || impact.min_net_terminal_contribution !== minimum
      || impact.max_net_terminal_contribution !== maximum
      || impact.canonical_net_terminal_contribution !== canonicalPath.net_terminal_contribution
      || impact.net_terminal_contribution_span < 0
      || impact.canonical_shortfall_to_best < 0) {
    fail("ohlcv resolution economic impact envelope is inconsistent")
  }
  requireHash(impact.impact_hash, "ohlcv_resolution.economic_impact.impact_hash")
  if (replayOhlcvEconomicImpactHash(impact) !== impact.impact_hash) {
    fail("ohlcv resolution economic impact hash mismatch")
  }
  requireHash(evidence.evidence_hash, "ohlcv_resolution.evidence_hash")
  if (replayOhlcvResolutionEvidenceHash(evidence) !== evidence.evidence_hash) {
    fail("ohlcv resolution evidence hash mismatch")
  }
}

export type ReplayOrderSide = "buy" | "sell"
export type ReplayOrderRole = "entry" | "stop" | "target" | "strategy_partial_reduce" | "strategy_exit" | "liquidation" | "end_of_data"
export type ReplayOrderType = "market" | "limit" | "stop_market" | "take_profit_market"
export type ReplayOrderStatus = "submitted" | "active" | "triggered" | "partially_filled" | "filled" | "cancelled" | "expired" | "rejected"

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
  limit_price?: number
  time_in_force?: "gtc" | "ioc" | "gtd"
  expires_at?: string
  last_event_sequence: number
  last_event_key: ReplayEventKey
}

export interface ReplayOrderEvent {
  event_id: string
  order_id: string
  sequence: number
  event_key: ReplayEventKey
  timestamp: string
  kind: "submitted" | "activated" | "triggered" | "partially_filled" | "filled" | "cancelled" | "expired" | "rejected"
  status: ReplayOrderStatus
  fill_quantity: number
  remaining_quantity: number
  signed_position_after: number
  reason: string | null
  trigger_source: "bar_open" | "bar_range" | null
  trigger_observed_price: number | null
}

export interface ReplayOrderStateSnapshot {
  schema_version: typeof REPLAY_ORDER_STATE_SNAPSHOT_SCHEMA_VERSION
  run_id: string
  ordering_policy: "submission_event_sequence_then_order_id"
  order_count: number
  nonterminal_order_count: number
  terminal_order_count: number
  nonterminal_order_ids: string[]
  terminal_order_ids: string[]
  orders: ReplayOrder[]
  orders_hash: string
  snapshot_hash: string
}

export function createReplayOrderStateSnapshot(input: {
  run_id: string
  orders: ReplayOrder[]
  order_events: ReplayOrderEvent[]
}): ReplayOrderStateSnapshot {
  requireText(input.run_id, "order_state_snapshot.run_id")
  const firstSequenceByOrder = new Map<string, number>()
  for (const event of input.order_events) {
    if (!firstSequenceByOrder.has(event.order_id)) firstSequenceByOrder.set(event.order_id, event.sequence)
  }
  const orders = structuredClone(input.orders).sort((left, right) => {
    const leftSequence = firstSequenceByOrder.get(left.order_id) ?? Number.MAX_SAFE_INTEGER
    const rightSequence = firstSequenceByOrder.get(right.order_id) ?? Number.MAX_SAFE_INTEGER
    return leftSequence === rightSequence ? left.order_id.localeCompare(right.order_id) : leftSequence - rightSequence
  })
  const nonterminalStatuses: ReplayOrderStatus[] = ["submitted", "active", "triggered", "partially_filled"]
  const nonterminalOrderIds = orders
    .filter((order) => nonterminalStatuses.includes(order.status))
    .map((order) => order.order_id)
  const terminalOrderIds = orders
    .filter((order) => !nonterminalStatuses.includes(order.status))
    .map((order) => order.order_id)
  const body: Omit<ReplayOrderStateSnapshot, "snapshot_hash"> = {
    schema_version: REPLAY_ORDER_STATE_SNAPSHOT_SCHEMA_VERSION,
    run_id: input.run_id,
    ordering_policy: "submission_event_sequence_then_order_id",
    order_count: orders.length,
    nonterminal_order_count: nonterminalOrderIds.length,
    terminal_order_count: terminalOrderIds.length,
    nonterminal_order_ids: nonterminalOrderIds,
    terminal_order_ids: terminalOrderIds,
    orders,
    orders_hash: canonicalHash(orders),
  }
  const snapshot = { ...body, snapshot_hash: canonicalHash(body) }
  assertReplayOrderStateSnapshot(snapshot, input.order_events)
  return snapshot
}

export function assertReplayOrderStateSnapshot(
  snapshot: ReplayOrderStateSnapshot,
  orderEvents: ReplayOrderEvent[],
): void {
  if (snapshot.schema_version !== REPLAY_ORDER_STATE_SNAPSHOT_SCHEMA_VERSION
      || snapshot.ordering_policy !== "submission_event_sequence_then_order_id") {
    fail("unsupported Replay Order State Snapshot contract")
  }
  requireText(snapshot.run_id, "order_state_snapshot.run_id")
  if (!Array.isArray(snapshot.orders) || !Array.isArray(snapshot.nonterminal_order_ids)
      || !Array.isArray(snapshot.terminal_order_ids)) fail("Replay Order State Snapshot arrays are required")
  const eventsByOrder = new Map<string, ReplayOrderEvent[]>()
  let previousSequence = 0
  const eventIds = new Set<string>()
  for (const event of orderEvents) {
    if (!Number.isSafeInteger(event.sequence) || event.sequence <= previousSequence) {
      fail("Replay Order State Snapshot OrderEvent sequence is not strictly increasing")
    }
    if (eventIds.has(event.event_id)) fail("Replay Order State Snapshot contains duplicate OrderEvent ids")
    previousSequence = event.sequence
    eventIds.add(event.event_id)
    const events = eventsByOrder.get(event.order_id) ?? []
    events.push(event)
    eventsByOrder.set(event.order_id, events)
  }
  const orderIds = new Set<string>()
  let previousSubmissionSequence = -1
  for (const order of snapshot.orders) {
    requireText(order.order_id, "order_state_snapshot.order.order_id")
    if (orderIds.has(order.order_id)) fail("Replay Order State Snapshot contains duplicate Order ids")
    orderIds.add(order.order_id)
    requirePositive(order.quantity, "order_state_snapshot.order.quantity")
    requireNonNegative(order.filled_quantity, "order_state_snapshot.order.filled_quantity")
    requireNonNegative(order.remaining_quantity, "order_state_snapshot.order.remaining_quantity")
    if (Math.abs(order.filled_quantity + order.remaining_quantity - order.quantity) > 1e-12) {
      fail("Replay Order State Snapshot quantity conservation failed")
    }
    const events = eventsByOrder.get(order.order_id)
    const first = events?.[0]
    const last = events?.at(-1)
    if (!first || first.kind !== "submitted" || !last
        || last.sequence !== order.last_event_sequence
        || canonicalHash(last.event_key) !== canonicalHash(order.last_event_key)
        || last.status !== order.status
        || last.remaining_quantity !== order.remaining_quantity) {
      fail("Replay Order State Snapshot does not match OrderEvent terminal state")
    }
    if (first.sequence < previousSubmissionSequence) {
      fail("Replay Order State Snapshot ordering policy drift")
    }
    previousSubmissionSequence = first.sequence
  }
  if (eventsByOrder.size !== orderIds.size
      || [...eventsByOrder.keys()].some((orderId) => !orderIds.has(orderId))) {
    fail("Replay Order State Snapshot does not cover every OrderEvent order")
  }
  const nonterminalStatuses: ReplayOrderStatus[] = ["submitted", "active", "triggered", "partially_filled"]
  const expectedNonterminal = snapshot.orders.filter((order) => nonterminalStatuses.includes(order.status)).map((order) => order.order_id)
  const expectedTerminal = snapshot.orders.filter((order) => !nonterminalStatuses.includes(order.status)).map((order) => order.order_id)
  if (snapshot.order_count !== snapshot.orders.length
      || snapshot.nonterminal_order_count !== expectedNonterminal.length
      || snapshot.terminal_order_count !== expectedTerminal.length
      || canonicalHash(snapshot.nonterminal_order_ids) !== canonicalHash(expectedNonterminal)
      || canonicalHash(snapshot.terminal_order_ids) !== canonicalHash(expectedTerminal)
      || snapshot.orders_hash !== canonicalHash(snapshot.orders)) {
    fail("Replay Order State Snapshot aggregate binding drift")
  }
  const { snapshot_hash: _snapshotHash, ...body } = snapshot
  if (snapshot.snapshot_hash !== canonicalHash(body)) fail("Replay Order State Snapshot hash mismatch")
}

export interface ReplaySourceEvent {
  source_event_id: string
  kind: "instrument_delisted" | "instrument_halted" | "instrument_resumed" | "bar_open" | "bar_range" | "funding" | "mark"
  source_index: number
  event_key: ReplayEventKey
  instrument_status_snapshot_id?: string
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

export type ReplayPendingOrderType = "limit" | "stop_market"
export type ReplayPendingOrderTimeInForce = "gtc" | "ioc" | "gtd"
export type ReplayPendingOrderResolutionStatus = "exact_under_ohlc" | "resolution_limited"
export type ReplayPendingOrderOutcomeStatus = "resting" | "filled" | "triggered_and_filled" | "cancelled" | "expired" | "unresolved"
export type ReplayPendingOrderOutcomeReason =
  | "limit_open_marketable"
  | "limit_strict_cross"
  | "limit_touch_queue_unproven"
  | "limit_not_reached"
  | "stop_open_gap"
  | "stop_range_trigger"
  | "stop_not_triggered"
  | "cancel_precedes_observation"
  | "cancel_after_non_fill"
  | "ioc_unfilled_at_first_open"
  | "gtd_unfilled_at_expiry_close"
  | "same_ordinal_cancel_race"
  | "limit_touch_before_cancel_unresolved"
  | "limit_touch_before_gtd_expiry_unresolved"

export interface ReplayPendingOrderSpec {
  order_id: string
  order_type: ReplayPendingOrderType
  side: ReplayOrderSide
  quantity: number
  time_in_force: ReplayPendingOrderTimeInForce
  expires_at: string | null
  activation_event_key: ReplayEventKey
  limit_price: number | null
  trigger_price: number | null
  trigger_source: "last_trade_ohlcv" | null
  liquidity_model: "ohlcv-cross-through-full-fill-bounded-v1"
  full_fill_capacity: number
}

export interface ReplayPendingOrderObservation {
  observation_kind: "bar_open" | "bar_range"
  source_event_key: ReplayEventKey
  bar: ReplayMarketBar
}

export interface ReplayPendingOrderResolution {
  schema_version: typeof REPLAY_PENDING_ORDER_RESOLUTION_SCHEMA_VERSION
  order: ReplayPendingOrderSpec
  observation: ReplayPendingOrderObservation
  cancel_effective_key: ReplayEventKey | null
  outcome: {
    status: ReplayPendingOrderOutcomeStatus
    reason: ReplayPendingOrderOutcomeReason
    decisive_event_key: ReplayEventKey | null
    fill_reference_price: number | null
    fill_quantity: number
    remaining_quantity: number
  }
  resolution_status: ReplayPendingOrderResolutionStatus
  limitations: Array<"ohlcv-limit-queue-unobserved" | "same-event-order-unproven">
  resolution_hash: string
}

export interface ReplayStopEntrySameBarPathAmbiguity {
  schema_version: typeof REPLAY_STOP_ENTRY_SAME_BAR_PATH_AMBIGUITY_SCHEMA_VERSION
  run_id: string
  position_side: "long" | "short"
  source_event_key: ReplayEventKey
  bar: ReplayMarketBar
  entry_trigger_price: number
  protective_stop_price: number
  target_price: number
  stop_touched: boolean
  target_touched: boolean
  policy: "fail_without_result_when_post_trigger_path_is_unprovable"
  evidence_hash: string
}

export interface ReplayExactTradeTriggerReference {
  aggregate_trade_id: number
  trade_time: string
  reference_price: number
}

export interface ReplayExactTradeStopResolution {
  schema_version: typeof REPLAY_EXACT_TRADE_STOP_RESOLUTION_SCHEMA_VERSION
  run_id: string
  position_side: "long" | "short"
  entry_trigger_price: number
  protective_stop_price: number
  target_price: number
  coverage_attestation_hash: string
  events_hash: string
  outcome: "untriggered" | "entry_triggered_position_open" | "entry_triggered_then_protection_triggered"
  entry_trigger: ReplayExactTradeTriggerReference | null
  terminal_trigger: (ReplayExactTradeTriggerReference & { role: "stop" | "target" }) | null
  consumed_through_aggregate_trade_id: number
  resolution_scope: "price-trigger-order-only"
  limitations: [
    "external-archive-completeness-not-verified",
    "insurance-and-adl-trades-not-represented",
    "not-fill-queue-slippage-or-market-impact-evidence",
  ]
  resolution_hash: string
}

export interface ReplayAuthorizedStopEntryPathStep {
  schema_version: typeof REPLAY_AUTHORIZED_STOP_ENTRY_PATH_STEP_SCHEMA_VERSION
  run_id: string
  request_hash: string
  dataset_hash: string
  market_bar_hash: string
  path_authority_hash: string
  bar_link_attestation_hash: string
  aggregate_trade_coverage_attestation_hash: string
  aggregate_trade_events_hash: string
  exact_trade_stop_resolution: ReplayExactTradeStopResolution
  resolution_scope: "initial_stop_market_same_bar_terminal_owner_ordering_only"
  economic_fill_policy: "frozen_request_not_aggregate_trade_evidence"
  fill_quantity_authority: "none"
  cost_authority: "none"
  external_completeness: "not_verified"
  publication_state: "blocked_until_checkpoint_result_artifact_binding"
  step_hash: string
}

export function assertReplayAuthorizedStopEntryPathStepEvidence(
  value: ReplayAuthorizedStopEntryPathStep,
): void {
  if (value.schema_version !== REPLAY_AUTHORIZED_STOP_ENTRY_PATH_STEP_SCHEMA_VERSION
      || value.resolution_scope !== "initial_stop_market_same_bar_terminal_owner_ordering_only"
      || value.economic_fill_policy !== "frozen_request_not_aggregate_trade_evidence"
      || value.fill_quantity_authority !== "none" || value.cost_authority !== "none"
      || value.external_completeness !== "not_verified"
      || value.publication_state !== "blocked_until_checkpoint_result_artifact_binding") {
    fail("unsupported authorized Stop-entry path Step evidence")
  }
  requireText(value.run_id, "authorized_stop_entry_path.run_id")
  for (const [field, item] of Object.entries({
    request_hash: value.request_hash,
    dataset_hash: value.dataset_hash,
    market_bar_hash: value.market_bar_hash,
    path_authority_hash: value.path_authority_hash,
    bar_link_attestation_hash: value.bar_link_attestation_hash,
    aggregate_trade_coverage_attestation_hash: value.aggregate_trade_coverage_attestation_hash,
    aggregate_trade_events_hash: value.aggregate_trade_events_hash,
    step_hash: value.step_hash,
  })) requireHash(item, `authorized_stop_entry_path.${field}`)
  const resolution = value.exact_trade_stop_resolution
  if (resolution.schema_version !== REPLAY_EXACT_TRADE_STOP_RESOLUTION_SCHEMA_VERSION
      || resolution.run_id !== value.run_id
      || resolution.resolution_scope !== "price-trigger-order-only"
      || resolution.coverage_attestation_hash !== value.aggregate_trade_coverage_attestation_hash
      || resolution.events_hash !== value.aggregate_trade_events_hash) {
    fail("authorized Stop-entry path exact resolution lineage mismatch")
  }
  const { resolution_hash: _resolutionHash, ...resolutionBody } = resolution
  if (canonicalHash(resolutionBody) !== resolution.resolution_hash) {
    fail("authorized Stop-entry path exact resolution hash mismatch")
  }
  const { step_hash: _stepHash, ...stepBody } = value
  if (canonicalHash(stepBody) !== value.step_hash) fail("authorized Stop-entry path Step hash mismatch")
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
  position_event_id: string | null
  mark_source_ref: string
  mark_source: "fill_price" | "bar_open" | "bar_close" | "mark_event"
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
  terminal_position_state: "open" | "flat" | "never_opened"
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
  liquidity_capacity_attestation_hash: string | null
  supplemental_facts_hash: string
  supplemental_requirement_set_hash: string
  decision_market_input_requirement_hash: string
  decision_schedule_hash: string
  decision_market_input_snapshot_hash: string
  decision_evidence_timeline_hash: string
  decision_state_snapshot_hashes: Array<string | null>
  decision_boundary_hash: string
  decision_input_snapshot_hash: string
  decision_harness_receipt_hash: string | null
  decision_harness_bundle_hash: string | null
  decision_harness_build_attestation_hash: string | null
  decision_harness_build_artifact_hash: string | null
  decision_harness_runtime_executable_hash: string | null
  decision_harness_registry_policy_version: typeof REPLAY_DECISION_HARNESS_REGISTRY_POLICY_VERSION | null
  decision_harness_loader_policy_version: typeof REPLAY_DECISION_HARNESS_LOADER_POLICY_VERSION | null
  decision_harness_worker_protocol_version:
    | typeof REPLAY_DECISION_HARNESS_WORKER_PROTOCOL_VERSION
    | typeof REPLAY_DECISION_HARNESS_CUTOVER_WORKER_PROTOCOL_VERSION
    | null
  ohlcv_resolution_evidence_hash: string
  pending_order_resolutions_hash: string
  bar_linked_stop_entry_path_step_hash: string | null
  order_state_snapshot_hash: string
  venue_risk_policy_schedule_hash: string
  instrument_spec_schedule_hash: string
  instrument_status_schedule_hash: string
  instrument_status_provenance_hash: string
  instrument_status_provider_capability_hash: string
  instrument_status_provider_certification_hash: string
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
  entry_outcome: "filled" | "unfilled_at_data_end" | "expired_unfilled" | "cancelled_unfilled"
  started_at: string
  completed_at: string
  source_events: ReplaySourceEvent[]
  order_events: ReplayOrderEvent[]
  order_state_snapshot: ReplayOrderStateSnapshot
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
  decision_evidence_timeline: ReplayDecisionEvidenceTimeline
  ohlcv_resolution_evidence: ReplayOhlcvResolutionEvidence[]
  pending_order_resolutions: ReplayPendingOrderResolution[]
  bar_linked_stop_entry_path_step: ReplayAuthorizedStopEntryPathStep | null
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
    ohlcv_resolution_limited_count: number
    pending_order_resolution_limited_count: number
    ohlcv_net_terminal_contribution_span: number
    ohlcv_canonical_shortfall_to_best: number
  }
  limitations: ReplayLimitation[]
  fingerprint: ReplayEvidenceFingerprint
}

export function assertReplayResultOhlcvResolutionBindings(
  result: ReplayResult,
  request: ReplayExecutionRequest,
): void {
  if (result.run_id !== request.run_id) fail("Replay Result OHLCV resolution Request identity is invalid")
  const terminalFills = result.fills.filter((fill) => fill.order_role === "stop" || fill.order_role === "target")
  const exactPathTerminalCount = result.bar_linked_stop_entry_path_step?.exact_trade_stop_resolution.terminal_trigger
    ? 1 : 0
  if (terminalFills.length !== result.ohlcv_resolution_evidence.length + exactPathTerminalCount) {
    fail("Replay Result OHLCV resolution evidence cardinality does not match terminal protection Fills")
  }
  for (const evidence of result.ohlcv_resolution_evidence) {
    assertReplayOhlcvResolutionEvidence(evidence)
    const protection = evidence.active_protection
    const source = result.source_events.find((event) => event.source_event_id === evidence.source_event_id)
    if (!source || canonicalHash(source.event_key) !== canonicalHash(evidence.source_event_key)) {
      fail("Replay Result OHLCV resolution source binding is invalid")
    }
    const terminalOrderId = evidence.canonical.terminal_role === "stop"
      ? protection.stop_order_id
      : protection.target_order_id
    const fill = terminalFills.find((candidate) => candidate.order_id === terminalOrderId)
    const canonicalPath = evidence.paths.find((path) => path.path_id === evidence.canonical.path_id)
    if (!fill || fill.order_role !== evidence.canonical.terminal_role
        || fill.quantity !== protection.remaining_quantity
        || !canonicalPath
        || fill.price !== canonicalPath.simulated_execution_price
        || fill.fee !== canonicalPath.exit_fee) {
      fail("Replay Result OHLCV resolution terminal Fill binding is invalid")
    }
    for (const orderId of [protection.stop_order_id, protection.target_order_id]) {
      const events = result.order_events.filter((event) => event.order_id === orderId)
      const submitted = events.find((event) => event.kind === "submitted")
      const activated = events.find((event) => event.kind === "activated")
      if (!submitted || !activated
          || submitted.remaining_quantity !== protection.remaining_quantity
          || activated.remaining_quantity !== protection.remaining_quantity) {
        fail("Replay Result OHLCV resolution active protection Order binding is invalid")
      }
    }
    const targetCancel = result.order_events.find(
      (event) => event.order_id === protection.target_order_id && event.kind === "cancelled",
    )
    const stopCancel = result.order_events.find(
      (event) => event.order_id === protection.stop_order_id && event.kind === "cancelled",
    )
    if (protection.protection_mode === "stop_only") {
      const cancelSchedule = request.decision_schedule.entries.find(
        (entry) => entry.expected_effect === "authorized_take_profit_cancel",
      )
      const cancelIntent = cancelSchedule?.authorized_take_profit_cancel
      const cancelEvidence = result.decision_evidence_timeline.entries.find(
        (entry) => entry.decision_sequence === cancelSchedule?.decision_sequence,
      )
      if (!targetCancel || !cancelIntent || cancelEvidence?.execution_effect !== "authorized_take_profit_cancel"
          || cancelEvidence.evaluation_status !== "evaluated"
          || cancelIntent.target_order_id !== protection.target_order_id
          || targetCancel.event_key.event_time !== cancelIntent.effective_at
          || compareReplayEventKeys(targetCancel.event_key, evidence.source_event_key) >= 0
          || targetCancel.reason !== "take_profit_condition_revoked") {
        fail("Replay stop-only OHLCV resolution lacks an earlier authoritative target cancellation")
      }
    } else if (protection.protection_mode === "target_only") {
      const cancelSchedule = request.decision_schedule.entries.find(
        (entry) => entry.expected_effect === "authorized_protective_stop_cancel",
      )
      const cancelIntent = cancelSchedule?.authorized_protective_stop_cancel
      const cancelEvidence = result.decision_evidence_timeline.entries.find(
        (entry) => entry.decision_sequence === cancelSchedule?.decision_sequence,
      )
      if (!stopCancel || !cancelIntent || cancelEvidence?.execution_effect !== "authorized_protective_stop_cancel"
          || cancelEvidence.evaluation_status !== "evaluated"
          || cancelIntent.target_order_id !== protection.stop_order_id
          || stopCancel.event_key.event_time !== cancelIntent.effective_at
          || compareReplayEventKeys(stopCancel.event_key, evidence.source_event_key) >= 0
          || stopCancel.reason !== "protective_stop_condition_revoked") {
        fail("Replay target-only OHLCV resolution lacks an earlier authoritative protective-stop cancellation")
      }
    } else if ((targetCancel && compareReplayEventKeys(targetCancel.event_key, evidence.source_event_key) < 0)
        || (stopCancel && compareReplayEventKeys(stopCancel.event_key, evidence.source_event_key) < 0)) {
      fail("Replay bracket OHLCV resolution cannot use a previously cancelled protection Order")
    }
    const triggered = result.order_events.find(
      (event) => event.order_id === terminalOrderId && event.kind === "triggered",
    )
    const expectedTriggerSource = evidence.observation_kind === "bar_open_gap" ? "bar_open" : "bar_range"
    const expectedObservedPrice = evidence.observation_kind === "bar_open_gap"
      ? evidence.bar.open
      : evidence.canonical.terminal_role === "stop"
        ? protection.stop_trigger_price
        : protection.target_trigger_price
    if (!triggered || triggered.trigger_source !== expectedTriggerSource
        || triggered.trigger_observed_price !== expectedObservedPrice) {
      fail("Replay Result OHLCV resolution trigger binding is invalid")
    }
    const initialStop = `${result.run_id}:order:stop`
    const initialTarget = `${result.run_id}:order:target`
    const partialSchedules = request.decision_schedule.entries.filter(
      (entry) => entry.expected_effect === "authorized_partial_reduce",
    )
    const partialFills = result.fills.filter((fill) => fill.order_role === "strategy_partial_reduce")
    const appliedPartialSchedules = partialSchedules.filter((schedule) => {
      const intent = schedule.authorized_partial_reduce
      const expectedOrderId = intent?.schedule_combination_policy
          === "one_partial_reduce_then_optional_final_full_exit_no_stop_replace"
        ? `${result.run_id}:order:partial-reduce`
        : `${result.run_id}:order:partial-reduce:${schedule.decision_sequence}`
      return partialFills.some((fill) => fill.order_id === expectedOrderId)
    })
    const latestPartialSchedule = appliedPartialSchedules.at(-1)
    const remainingAfterPartials = request.order.quantity - appliedPartialSchedules.reduce(
      (total, schedule) => total + schedule.authorized_partial_reduce!.quantity, 0,
    )
    const replacementSchedule = request.decision_schedule.entries.find(
      (entry) => entry.expected_effect === "authorized_protective_stop_replace",
    )
    const replacementIntent = replacementSchedule?.authorized_protective_stop_replace
    const replacementGeneration = protection.protection_generation === 2 + appliedPartialSchedules.length
      && Boolean(replacementSchedule && replacementIntent)
      && protection.stop_order_id === `${result.run_id}:order:stop-replacement:${replacementSchedule!.decision_sequence}`
      && protection.target_order_id === (latestPartialSchedule
        ? `${result.run_id}:order:target-after-partial:${latestPartialSchedule.decision_sequence}`
        : initialTarget)
      && protection.stop_trigger_price === replacementIntent!.new_stop_price
      && protection.target_trigger_price === request.order.target_price
      && protection.remaining_quantity === remainingAfterPartials
    const targetReplacementSchedule = request.decision_schedule.entries.find(
      (entry) => entry.expected_effect === "authorized_take_profit_replace",
    )
    const targetReplacementIntent = targetReplacementSchedule?.authorized_take_profit_replace
    const targetReplacementEvidence = result.decision_evidence_timeline.entries.find(
      (entry) => entry.decision_sequence === targetReplacementSchedule?.decision_sequence,
    )
    const replacedTargetCancel = result.order_events.find(
      (event) => event.order_id === initialTarget && event.kind === "cancelled" && event.reason === "take-profit-repriced",
    )
    const targetReplacementGeneration = protection.protection_generation === 2
      && Boolean(targetReplacementSchedule && targetReplacementIntent)
      && targetReplacementEvidence?.evaluation_status === "evaluated"
      && targetReplacementEvidence.execution_effect === "authorized_take_profit_replace"
      && replacedTargetCancel?.event_key.event_time === targetReplacementIntent!.signal_time
      && protection.stop_order_id === initialStop
      && protection.target_order_id === `${result.run_id}:order:target-replacement:${targetReplacementSchedule!.decision_sequence}`
      && protection.stop_trigger_price === request.order.stop_price
      && protection.target_trigger_price === targetReplacementIntent!.new_target_price
      && protection.remaining_quantity === request.order.quantity
    const partialGeneration = appliedPartialSchedules.length > 0
      && protection.protection_generation === 1 + appliedPartialSchedules.length
      && protection.stop_order_id === `${result.run_id}:order:stop-after-partial:${latestPartialSchedule!.decision_sequence}`
      && protection.target_order_id === `${result.run_id}:order:target-after-partial:${latestPartialSchedule!.decision_sequence}`
      && protection.stop_trigger_price === request.order.stop_price
      && protection.target_trigger_price === request.order.target_price
      && protection.remaining_quantity === remainingAfterPartials
    const initialGeneration = protection.protection_generation === 1
      && protection.stop_order_id === initialStop
      && protection.target_order_id === initialTarget
      && protection.stop_trigger_price === request.order.stop_price
      && protection.target_trigger_price === request.order.target_price
      && protection.remaining_quantity === request.order.quantity
    if (!initialGeneration && !replacementGeneration && !targetReplacementGeneration && !partialGeneration) {
      fail("Replay Result OHLCV resolution protection generation binding is invalid")
    }
  }
}

export function assertReplayResultBarLinkedStopEntryPathBindings(
  result: ReplayResult,
  request: ReplayExecutionRequest,
  datasetManifest: ReplayDatasetManifest,
): void {
  const step = result.bar_linked_stop_entry_path_step
  if (step === null) {
    if (result.fingerprint.bar_linked_stop_entry_path_step_hash !== null) {
      fail("Replay Result has a bar-linked path fingerprint without evidence")
    }
    return
  }
  assertReplayAuthorizedStopEntryPathStepEvidence(step)
  if (step.run_id !== request.run_id || step.request_hash !== canonicalHash(request)
      || step.dataset_hash !== datasetManifest.data_hash
      || result.fingerprint.bar_linked_stop_entry_path_step_hash !== step.step_hash) {
    fail("Replay Result bar-linked Stop-entry path authority binding mismatch")
  }
  const resolution = step.exact_trade_stop_resolution
  if (resolution.entry_trigger === null || resolution.outcome === "untriggered") {
    fail("Replay Result cannot publish an untriggered authorized Stop-entry path")
  }
  const pending = result.pending_order_resolutions.find(
    (candidate) => canonicalHash(candidate.observation.bar) === step.market_bar_hash,
  )
  if (!pending || pending.outcome.status !== "triggered_and_filled") {
    fail("Replay Result authorized Stop-entry path lacks its pending-entry Fill observation")
  }
  const terminal = resolution.terminal_trigger
  if (!terminal) return
  const fill = result.fills.find((candidate) => candidate.order_role === terminal.role)
  const trigger = result.order_events.find(
    (candidate) => candidate.order_id === fill?.order_id && candidate.kind === "triggered",
  )
  const expectedPrice = terminal.role === "stop" ? request.order.stop_price : request.order.target_price
  if (!fill || !trigger || fill.timestamp !== pending.observation.bar.close_time
      || result.completed_at !== pending.observation.bar.close_time
      || trigger.trigger_source !== "bar_range" || trigger.trigger_observed_price !== expectedPrice
      || Date.parse(terminal.trade_time) <= Date.parse(resolution.entry_trigger.trade_time)
      || Date.parse(terminal.trade_time) >= Date.parse(pending.observation.bar.close_time)) {
    fail("Replay Result authorized Stop-entry path terminal binding mismatch")
  }
}

export function assertReplayResultPositionRiskBindings(result: ReplayResult): void {
  const positionById = new Map(result.positions.map((position) => [position.position_event_id, position]))
  for (const snapshot of result.margin_snapshots) {
    const position = positionById.get(snapshot.position_event_id)
    if (!position
        || snapshot.signed_quantity !== position.signed_quantity
        || (position.state === "flat") !== (snapshot.state === "flat")) {
      fail("Replay Result Margin Snapshot does not bind its Position quantity")
    }
    const positionAtSnapshot = [...result.positions].reverse().find(
      (candidate) => compareReplayEventKeys(candidate.event_key, snapshot.event_key) <= 0,
    )
    if (!positionAtSnapshot || positionAtSnapshot.position_event_id !== position.position_event_id) {
      fail("Replay Result Margin Snapshot does not bind the latest causal Position")
    }
  }

  const fundingEntries = result.ledger.filter((entry) => entry.kind === "funding")
  for (const funding of fundingEntries) {
    const source = result.source_events.find((candidate) => candidate.source_event_id === funding.ref)
    if (!source || source.kind !== "funding"
        || canonicalHash(source.event_key) !== canonicalHash(funding.event_key)) {
      fail("Replay Result Funding ledger entry does not bind its source event")
    }
    const position = [...result.positions].reverse().find(
      (candidate) => compareReplayEventKeys(candidate.event_key, funding.event_key) <= 0,
    )
    const margin = result.margin_snapshots.find(
      (snapshot) => snapshot.mark_source === "funding_mark"
        && canonicalHash(snapshot.event_key) === canonicalHash(funding.event_key),
    )
    if (!position || position.state !== "open" || !margin
        || margin.position_event_id !== position.position_event_id
        || margin.signed_quantity !== position.signed_quantity) {
      fail("Replay Result Funding evidence does not use the t-minus Position quantity")
    }
  }

  if (result.liquidation) {
    const liquidationFill = result.fills.find(
      (fill) => fill.fill_id === result.liquidation!.liquidation_fill_id,
    )
    const triggerMargin = [...result.margin_snapshots].reverse().find(
      (snapshot) => snapshot.maintenance_breach_observed
        && canonicalHash(snapshot.event_key)
          === canonicalHash(result.liquidation!.trigger_observation.event_key),
    )
    const triggerPosition = triggerMargin && positionById.get(triggerMargin.position_event_id)
    if (!liquidationFill || liquidationFill.order_role !== "liquidation"
        || !triggerMargin || !triggerPosition || triggerPosition.state !== "open"
        || liquidationFill.event_key.event_time !== result.liquidation.trigger_observation.event_key.event_time
        || compareReplayEventKeys(
          liquidationFill.event_key, result.liquidation.trigger_observation.event_key,
        ) <= 0
        || liquidationFill.quantity !== result.liquidation.quantity
        || result.liquidation.quantity !== Math.abs(triggerPosition.signed_quantity)
        || triggerMargin.signed_quantity !== triggerPosition.signed_quantity) {
      fail("Replay Result Liquidation does not consume the exact breached Position quantity")
    }
  }
}

export function assertReplayResultPendingOrderBindings(
  result: ReplayResult,
  request: ReplayExecutionRequest,
  datasetManifest: ReplayDatasetManifest,
): void {
  const resolutions = result.pending_order_resolutions
  const expectedAttestationHash = request.order.entry_execution.order_type === "market"
    ? null
    : request.order.entry_execution.liquidity_capacity_attestation_hash
  if (result.fingerprint.liquidity_capacity_attestation_hash !== expectedAttestationHash) {
    fail("Replay Result liquidity capacity attestation fingerprint mismatch")
  }
  if (request.order.entry_execution.order_type === "market") {
    if (result.entry_outcome !== "filled" || resolutions.length !== 0) {
      fail("market entry must be filled without pending-order resolutions")
    }
    return
  }
  if (resolutions.length === 0) fail("pending entry requires pending-order resolution evidence")
  const entry = request.order.entry_execution
  const attestation = datasetManifest.liquidity_capacity_attestation
  if (!attestation
      || attestation.attestation_hash !== entry.liquidity_capacity_attestation_hash
      || attestation.full_fill_capacity !== entry.full_fill_capacity) {
    fail("pending-order resolution lacks its frozen liquidity capacity attestation")
  }
  const expectedSide: ReplayOrderSide = request.order.side === "long" ? "buy" : "sell"
  const orderId = `${request.run_id}:order:entry`
  const activation = result.order_events.find((event) => event.order_id === orderId && event.kind === "activated")
  if (!activation) fail("pending entry lacks an activation OrderEvent")
  const entryOrderState = result.order_state_snapshot.orders.find((order) => order.order_id === orderId)
  const stateExecutionMatches = entry.order_type === "limit"
    ? entryOrderState?.order_type === "limit"
      && entryOrderState.limit_price === entry.limit_price
      && entryOrderState.time_in_force === entry.time_in_force
      && entryOrderState.expires_at === (entry.time_in_force === "gtd" ? entry.expires_at : undefined)
    : entryOrderState?.order_type === "stop_market"
      && entryOrderState.trigger_price === entry.trigger_price
      && entryOrderState.time_in_force === entry.time_in_force
      && entryOrderState.expires_at === (entry.time_in_force === "gtd" ? entry.expires_at : undefined)
  if (!entryOrderState || entryOrderState.order_role !== "entry" || entryOrderState.side !== expectedSide
      || entryOrderState.quantity !== request.order.quantity || entryOrderState.reduce_only
      || entryOrderState.submitted_at !== request.order.signal_time || !stateExecutionMatches) {
    fail("pending entry Order State Snapshot does not match frozen execution authority")
  }
  let previousKey: ReplayEventKey | null = null
  for (const [index, resolution] of resolutions.entries()) {
    assertReplayPendingOrderResolution(resolution)
    const executionFieldsMatch = entry.order_type === "limit"
      ? resolution.order.limit_price === entry.limit_price
        && resolution.order.trigger_price === null
        && resolution.order.trigger_source === null
      : resolution.order.limit_price === null
        && resolution.order.trigger_price === entry.trigger_price
        && resolution.order.trigger_source === entry.trigger_source
    if (resolution.order.order_id !== orderId
        || resolution.order.order_type !== entry.order_type
        || resolution.order.side !== expectedSide
        || resolution.order.quantity !== request.order.quantity
        || resolution.order.time_in_force !== entry.time_in_force
        || resolution.order.expires_at !== (entry.time_in_force === "gtd" ? entry.expires_at : null)
        || resolution.order.liquidity_model !== entry.liquidity_model
        || resolution.order.full_fill_capacity !== attestation.full_fill_capacity
        || !executionFieldsMatch) {
      fail("pending-order resolution does not match frozen entry")
    }
    if (canonicalHash(resolution.order.activation_event_key) !== canonicalHash(activation.event_key)) {
      fail("pending-order resolution activation binding is invalid")
    }
    const source = result.source_events.find(
      (candidate) => canonicalHash(candidate.event_key) === canonicalHash(resolution.observation.source_event_key),
    )
    if (!source || (source.kind !== "bar_open" && source.kind !== "bar_range")) {
      fail("pending-order resolution source binding is invalid")
    }
    if (previousKey && compareReplayEventKeys(previousKey, resolution.observation.source_event_key) >= 0) {
      fail("pending-order resolutions are not strictly ordered")
    }
    previousKey = resolution.observation.source_event_key
    const terminal = index === resolutions.length - 1
    if ((!terminal || result.entry_outcome === "unfilled_at_data_end") && resolution.outcome.status !== "resting") {
      fail("non-terminal pending-order resolution must remain resting")
    }
    const expectedFilledStatus = entry.order_type === "limit" ? "filled" : "triggered_and_filled"
    if (terminal && result.entry_outcome === "filled" && resolution.outcome.status !== expectedFilledStatus) {
      fail("successful Replay pending entry must terminate with a full Fill resolution")
    }
  }
  if (entry.time_in_force === "ioc"
      && (resolutions.length !== 1
        || resolutions[0]!.observation.observation_kind !== "bar_open"
        || resolutions[0]!.observation.source_event_key.event_time !== request.order.earliest_executable_time)) {
    fail("IOC Limit must have exactly one earliest-executable bar_open resolution")
  }
  if (entry.time_in_force === "gtd") {
    const terminal = resolutions.at(-1)!
    if (terminal.observation.source_event_key.event_time !== entry.expires_at
        && terminal.outcome.status !== "filled") {
      fail("unfilled GTD pending entry must terminate exactly at its frozen expiry boundary")
    }
  }
  const entryCancelIntent = request.order.entry_cancel_intent
  if (entryCancelIntent && result.entry_outcome === "filled") {
    const terminal = resolutions.at(-1)!
    const observationTime = Date.parse(terminal.observation.source_event_key.event_time)
    const cancelTime = Date.parse(entryCancelIntent.effective_at)
    if (observationTime > cancelTime
        || (observationTime < cancelTime && terminal.cancel_effective_key !== null)
        || (observationTime === cancelTime && (
          terminal.observation.observation_kind !== "bar_range"
          || !terminal.cancel_effective_key
          || terminal.cancel_effective_key.event_time !== entryCancelIntent.effective_at
          || terminal.cancel_effective_key.boundary_phase !== 90
          || terminal.cancel_effective_key.source_sequence !== terminal.observation.source_event_key.source_sequence
          || terminal.cancel_effective_key.event_subphase !== 0
          || terminal.cancel_effective_key.stable_event_id !== `${request.run_id}:entry-cancel:${entryCancelIntent.intent_hash}`
        ))) {
      fail("filled GTC pending entry does not respect its frozen cancel EventKey ordering")
    }
  }
  if (result.entry_outcome === "unfilled_at_data_end") {
    if (entry.time_in_force !== "gtc" || request.order.entry_cancel_intent) {
      fail("only a GTC pending entry without a frozen cancel boundary may remain active at the data boundary")
    }
    const entryEvents = result.order_events
      .filter((event) => event.order_id === orderId)
      .sort((left, right) => left.sequence - right.sequence)
    const lastEntryEvent = entryEvents.at(-1)
    if (result.fills.length !== 0 || result.positions.length !== 0 || result.margin_snapshots.length !== 0
        || result.liquidation !== null || result.equity_bridge.terminal_position_state !== "never_opened"
        || result.valuation_snapshot.position_event_id !== null
        || result.metrics.trade_count !== 0 || result.metrics.net_pnl !== 0
        || !lastEntryEvent || lastEntryEvent.status !== "active" || lastEntryEvent.remaining_quantity !== request.order.quantity) {
      fail("unfilled pending entry must preserve an active full-quantity Order and zero-execution accounting")
    }
    return
  }
  if (result.entry_outcome === "expired_unfilled") {
    const terminal = resolutions.at(-1)!
    const entryEvents = result.order_events
      .filter((event) => event.order_id === orderId)
      .sort((left, right) => left.sequence - right.sequence)
    const lastEntryEvent = entryEvents.at(-1)
    const isIocExpiry = entry.time_in_force === "ioc" && resolutions.length === 1
      && terminal.observation.observation_kind === "bar_open"
      && terminal.outcome.reason === "ioc_unfilled_at_first_open"
      && result.valuation_snapshot.mark_source === "bar_open"
    const isGtdExpiry = entry.time_in_force === "gtd"
      && terminal.observation.observation_kind === "bar_range"
      && terminal.observation.source_event_key.event_time === entry.expires_at
      && terminal.outcome.reason === "gtd_unfilled_at_expiry_close"
      && result.valuation_snapshot.mark_source === "bar_close"
    if ((!isIocExpiry && !isGtdExpiry)
        || terminal.outcome.status !== "expired"
        || result.fills.length !== 0 || result.positions.length !== 0 || result.margin_snapshots.length !== 0
        || result.liquidation !== null || result.equity_bridge.terminal_position_state !== "never_opened"
        || result.valuation_snapshot.position_event_id !== null
        || result.metrics.trade_count !== 0 || result.metrics.net_pnl !== 0
        || !lastEntryEvent || lastEntryEvent.kind !== "expired" || lastEntryEvent.status !== "expired"
        || lastEntryEvent.fill_quantity !== 0 || lastEntryEvent.remaining_quantity !== request.order.quantity
        || lastEntryEvent.reason !== terminal.outcome.reason
        || !terminal.outcome.decisive_event_key
        || compareReplayEventKeys(lastEntryEvent.event_key, terminal.outcome.decisive_event_key) <= 0) {
      fail("unfilled expiring pending entry must bind its TIF boundary and zero-execution accounting")
    }
    return
  }
  if (result.entry_outcome === "cancelled_unfilled") {
    const intent = request.order.entry_cancel_intent
    const terminal = resolutions.at(-1)!
    const entryEvents = result.order_events
      .filter((event) => event.order_id === orderId)
      .sort((left, right) => left.sequence - right.sequence)
    const lastEntryEvent = entryEvents.at(-1)
    const cancelKey = terminal.cancel_effective_key
    const terminalSource = result.source_events.find(
      (source) => canonicalHash(source.event_key) === canonicalHash(terminal.observation.source_event_key),
    )
    if (!intent || entry.time_in_force !== "gtc"
        || terminal.observation.observation_kind !== "bar_range"
        || terminal.observation.source_event_key.event_time !== intent.effective_at
        || terminal.outcome.status !== "cancelled" || terminal.outcome.reason !== "cancel_after_non_fill"
        || !cancelKey || !terminal.outcome.decisive_event_key
        || canonicalHash(cancelKey) !== canonicalHash(terminal.outcome.decisive_event_key)
        || cancelKey.event_time !== intent.effective_at || cancelKey.boundary_phase !== 90
        || cancelKey.source_sequence !== terminal.observation.source_event_key.source_sequence
        || cancelKey.event_subphase !== 0
        || cancelKey.stable_event_id !== `${request.run_id}:entry-cancel:${intent.intent_hash}`
        || result.fills.length !== 0 || result.positions.length !== 0 || result.margin_snapshots.length !== 0
        || result.liquidation !== null || result.equity_bridge.terminal_position_state !== "never_opened"
        || result.valuation_snapshot.position_event_id !== null || result.valuation_snapshot.mark_source !== "bar_close"
        || !terminalSource || terminalSource.kind !== "bar_range"
        || result.valuation_snapshot.mark_source_ref !== terminalSource.source_event_id
        || result.metrics.trade_count !== 0 || result.metrics.net_pnl !== 0
        || !lastEntryEvent || lastEntryEvent.kind !== "cancelled" || lastEntryEvent.status !== "cancelled"
        || lastEntryEvent.fill_quantity !== 0 || lastEntryEvent.remaining_quantity !== request.order.quantity
        || lastEntryEvent.reason !== intent.reason_code
        || canonicalHash(lastEntryEvent.event_key) !== canonicalHash(cancelKey)) {
      fail("unfilled GTC pending-entry contract cancel must bind one post-range Cancel EventKey and zero-execution accounting")
    }
    return
  }
  const terminal = resolutions.at(-1)!
  const fill = result.fills.find((candidate) => candidate.order_id === orderId && candidate.order_role === "entry")
  if (!fill || !terminal.outcome.decisive_event_key
      || canonicalHash(fill.event_key) === canonicalHash(terminal.outcome.decisive_event_key)
      || compareReplayEventKeys(fill.event_key, terminal.outcome.decisive_event_key) <= 0
      || fill.quantity !== terminal.outcome.fill_quantity
      || (entry.order_type === "limit" && expectedSide === "buy" && fill.price > entry.limit_price)
      || (entry.order_type === "limit" && expectedSide === "sell" && fill.price < entry.limit_price)) {
    fail("pending-order terminal resolution does not bind its entry Fill")
  }
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
    "trial_reservation_hash", "supplemental_facts_hash", "supplemental_requirement_set_hash", "decision_market_input_requirement_hash", "decision_schedule_hash", "venue_risk_policy_schedule_hash", "instrument_spec_schedule_hash", "instrument_status_schedule_hash", "instrument_status_provenance_hash", "instrument_status_provider_capability_hash", "instrument_status_provider_certification_hash",
  ] as const) requireHash(value[field], field)
  assertReplaySupplementalRequirementSet(value.supplemental_requirement_set, value.order.signal_time)
  if (canonicalHash(value.supplemental_requirement_set) !== value.supplemental_requirement_set_hash) {
    fail("supplemental requirement set hash mismatch")
  }
  assertReplayDecisionMarketInputRequirement(value.decision_market_input_requirement)
  if (canonicalHash(value.decision_market_input_requirement) !== value.decision_market_input_requirement_hash) {
    fail("decision market input requirement hash mismatch")
  }
  assertReplayDecisionSchedule(value.decision_schedule, value)
  if (canonicalHash(value.decision_schedule) !== value.decision_schedule_hash) {
    fail("decision schedule hash mismatch")
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
  const entryExecution = value.order.entry_execution
  if (!entryExecution || typeof entryExecution !== "object") fail("order.entry_execution is required")
  const entryCancelIntent = value.order.entry_cancel_intent
  if (entryExecution.order_type === "limit") {
    const expectedLimitFields = entryExecution.time_in_force === "gtd"
      ? ["expires_at", "full_fill_capacity", "limit_price", "liquidity_capacity_attestation_hash", "liquidity_model", "order_type", "time_in_force"]
      : ["full_fill_capacity", "limit_price", "liquidity_capacity_attestation_hash", "liquidity_model", "order_type", "time_in_force"]
    if (canonicalJson(Object.keys(entryExecution).sort()) !== canonicalJson(expectedLimitFields)) {
      fail("executable Limit entry carries unsupported fields")
    }
    requirePositive(entryExecution.limit_price, "order.entry_execution.limit_price")
    requirePositive(entryExecution.full_fill_capacity, "order.entry_execution.full_fill_capacity")
    requireHash(entryExecution.liquidity_capacity_attestation_hash, "order.entry_execution.liquidity_capacity_attestation_hash")
    if (!(["gtc", "ioc", "gtd"] as const).includes(entryExecution.time_in_force)
        || entryExecution.liquidity_model !== "ohlcv-cross-through-full-fill-bounded-v1") {
      fail("unsupported executable Limit entry policy")
    }
    if (entryExecution.time_in_force === "gtd") {
      requireUtcTimestamp(entryExecution.expires_at!, "order.entry_execution.expires_at")
      if (Date.parse(entryExecution.expires_at!) <= Date.parse(value.order.earliest_executable_time)) {
        fail("GTD Limit expiry must follow the earliest executable time")
      }
    }
    if (value.order.quantity > entryExecution.full_fill_capacity) {
      fail("Limit entry quantity exceeds frozen full-fill capacity")
    }
    if (value.decision_schedule.entries.some(
      (entry) => entry.expected_effect !== "authorized_initial_order"
        && entry.expected_effect !== "authorized_entry_cancel",
    )) {
      fail("executable Limit entry supports only its initial decision and optional entry cancel")
    }
  } else if (entryExecution.order_type === "stop_market") {
    const expectedStopFields = entryExecution.time_in_force === "gtd"
      ? ["expires_at", "full_fill_capacity", "liquidity_capacity_attestation_hash", "liquidity_model", "order_type", "time_in_force", "trigger_price", "trigger_source"]
      : ["full_fill_capacity", "liquidity_capacity_attestation_hash", "liquidity_model", "order_type", "time_in_force", "trigger_price", "trigger_source"]
    if (canonicalJson(Object.keys(entryExecution).sort()) !== canonicalJson(expectedStopFields)) {
      fail("executable Stop-market entry carries unsupported fields")
    }
    requirePositive(entryExecution.trigger_price, "order.entry_execution.trigger_price")
    requirePositive(entryExecution.full_fill_capacity, "order.entry_execution.full_fill_capacity")
    requireHash(entryExecution.liquidity_capacity_attestation_hash, "order.entry_execution.liquidity_capacity_attestation_hash")
    if (!(entryExecution.time_in_force === "gtc" || entryExecution.time_in_force === "gtd")
        || entryExecution.trigger_source !== "last_trade_ohlcv"
        || entryExecution.liquidity_model !== "ohlcv-cross-through-full-fill-bounded-v1") {
      fail("unsupported executable Stop-market entry policy")
    }
    if (entryExecution.time_in_force === "gtd") {
      requireUtcTimestamp(entryExecution.expires_at!, "order.entry_execution.expires_at")
      if (Date.parse(entryExecution.expires_at!) <= Date.parse(value.order.earliest_executable_time)) {
        fail("GTD Stop-market expiry must follow the earliest executable time")
      }
    }
    if (value.order.quantity > entryExecution.full_fill_capacity) {
      fail("Stop-market entry quantity exceeds frozen full-fill capacity")
    }
    if (value.order.side === "long"
      ? value.order.stop_price >= entryExecution.trigger_price || entryExecution.trigger_price >= value.order.target_price
      : value.order.target_price >= entryExecution.trigger_price || entryExecution.trigger_price >= value.order.stop_price) {
      fail("Stop-market entry trigger must remain strictly inside its protective stop/target bounds")
    }
    if (value.decision_schedule.entries.some(
      (entry) => entry.expected_effect !== "authorized_initial_order"
        && entry.expected_effect !== "authorized_entry_cancel",
    )) {
      fail("executable Stop-market entry supports only its initial decision and optional entry cancel")
    }
  } else if (entryExecution.order_type !== "market") {
    fail("unsupported entry execution order type")
  } else if (canonicalJson(Object.keys(entryExecution).sort()) !== canonicalJson(["order_type"])) {
    fail("market entry carries unsupported execution fields")
  }
  if (entryCancelIntent !== undefined) {
    if (!entryCancelIntent || typeof entryCancelIntent !== "object") {
      fail("order.entry_cancel_intent must be an object")
    }
    assertReplayEntryCancelIntent(entryCancelIntent)
    if (entryExecution.order_type === "market" || entryExecution.time_in_force !== "gtc"
        || entryCancelIntent.target_order_type !== entryExecution.order_type
        || entryCancelIntent.requested_at !== value.order.signal_time
        || Date.parse(entryCancelIntent.effective_at) <= Date.parse(value.order.earliest_executable_time)) {
      fail("entry cancel intent requires one matching GTC pending entry and a later closed-bar effective boundary")
    }
  }
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

export function assertReplayDecisionMarketInputRequirement(
  requirement: ReplayDecisionMarketInputRequirement,
): void {
  if (requirement.schema_version !== REPLAY_DECISION_MARKET_INPUT_REQUIREMENT_SCHEMA_VERSION
      || requirement.undeclared_input_policy !== "reject") {
    fail("unsupported Replay decision market input requirement")
  }
  if (requirement.mode === "none") {
    if (canonicalJson(requirement) !== canonicalJson(REPLAY_NO_DECISION_MARKET_INPUT)) {
      fail("decision market input mode none cannot declare market inputs")
    }
    return
  }
  if (requirement.mode !== "closed_bar_lookback"
      || requirement.source_kind !== "ohlcv"
      || canonicalJson(requirement.fields) !== canonicalJson(["open", "high", "low", "close", "volume"])
      || !Number.isSafeInteger(requirement.lookback_bars)
      || requirement.lookback_bars <= 0
      || requirement.visibility_policy !== "close_time_at_or_before_decision_time"
      || requirement.terminal_bar_policy !== "close_time_equals_decision_time"
      || requirement.continuity_policy !== "strict_interval_grid") {
    fail("unsupported closed-bar lookback requirement")
  }
}

export function assertReplayPartialReduceIntent(
  intent: ReplayPartialReduceIntent,
  initialOrder: ReplayExecutionRequest["order"],
): void {
  if (intent.schema_version !== REPLAY_PARTIAL_REDUCE_INTENT_SCHEMA_VERSION
      || intent.side !== (initialOrder.side === "long" ? "sell" : "buy")
      || intent.order_type !== "market"
      || intent.reduce_only !== true
      || intent.quantity_policy !== "fixed_quantity"
      || intent.post_fill_position_policy !== "must_remain_open"
      || intent.protection_resize_policy !== "after_fill_cancel_both_then_replace_remaining_at_same_source_boundary"
      || intent.protection_policy_version !== REPLAY_PARTIAL_REDUCE_PROTECTION_POLICY_VERSION
      || intent.replacement_trigger_policy !== "preserve_current_stop_and_target_prices"
      || intent.remaining_quantity_authority !== "absolute_post_fill_position"
      || !["one_partial_reduce_then_optional_final_full_exit_no_stop_replace",
        "up_to_two_partial_reduces_then_optional_final_full_exit_no_other_mutation",
        "one_partial_reduce_then_one_tighten_only_stop_replace_then_optional_final_full_exit",
        "up_to_two_partial_reduces_then_one_tighten_only_stop_replace_then_optional_final_full_exit",
      ].includes(intent.schedule_combination_policy)) {
    fail("unsupported Replay partial-reduce contract")
  }
  requirePositive(intent.quantity, "partial_reduce_intent.quantity")
  requireUtcTimestamp(intent.signal_time, "partial_reduce_intent.signal_time")
  requireUtcTimestamp(intent.earliest_executable_time, "partial_reduce_intent.earliest_executable_time")
  if (intent.quantity >= initialOrder.quantity) {
    fail("partial-reduce quantity must leave an open position")
  }
  if (Date.parse(intent.signal_time) <= Date.parse(initialOrder.earliest_executable_time)) {
    fail("partial-reduce signal must follow initial entry eligibility")
  }
  if (Date.parse(intent.earliest_executable_time) <= Date.parse(intent.signal_time)) {
    fail("partial-reduce earliest executable time must follow signal time")
  }
}

export function assertReplayDecisionSchedule(
  schedule: ReplayDecisionSchedule,
  request: Pick<ReplayExecutionRequest, "run_id" | "order" | "supplemental_requirement_set" | "decision_market_input_requirement">,
): void {
  if (schedule.schema_version !== REPLAY_DECISION_SCHEDULE_SCHEMA_VERSION
      || schedule.schedule_policy !== "frozen_closed_bar_schedule"
      || !Array.isArray(schedule.entries)
      || schedule.entries.length === 0) {
    fail("unsupported or empty Replay decision schedule")
  }
  let priorTime = Number.NEGATIVE_INFINITY
  let authorizedCount = 0
  let authorizedEntryCancelCount = 0
  let authorizedExitCount = 0
  let authorizedStrategyExitCancelCount = 0
  let authorizedTakeProfitCancelCount = 0
  let authorizedProtectiveStopCancelCount = 0
  let authorizedStopReplaceCount = 0
  let authorizedTakeProfitReplaceCount = 0
  let authorizedPartialReduceCount = 0
  const partialReduceIndexes: number[] = []
  let exitIndex = -1
  let frozenExitIntent: ReplayReduceOnlyExitIntent | null = null
  for (const [index, entry] of schedule.entries.entries()) {
    const entryCancel = entry.authorized_entry_cancel ?? null
    const strategyExitCancel = entry.authorized_strategy_exit_cancel ?? null
    const takeProfitCancel = entry.authorized_take_profit_cancel ?? null
    const protectiveStopCancel = entry.authorized_protective_stop_cancel ?? null
    const takeProfitReplace = entry.authorized_take_profit_replace ?? null
    if (takeProfitCancel !== null && entry.expected_effect !== "authorized_take_profit_cancel") {
      fail("take-profit cancel authority cannot accompany another decision effect")
    }
    if (protectiveStopCancel !== null && entry.expected_effect !== "authorized_protective_stop_cancel") {
      fail("protective-stop cancel authority cannot accompany another decision effect")
    }
    if (takeProfitReplace !== null && entry.expected_effect !== "authorized_take_profit_replace") {
      fail("take-profit replacement authority cannot accompany another decision effect")
    }
    if (entry.decision_sequence !== index + 1) fail("decision schedule sequence must be contiguous from one")
    requireUtcTimestamp(entry.decision_time, `decision_schedule.entries[${index}].decision_time`)
    const decisionTime = Date.parse(entry.decision_time)
    if (decisionTime <= priorTime) fail("decision schedule times must be strictly increasing")
    priorTime = decisionTime
    if (entry.expected_effect === "no_action") {
      if (entry.authorized_order_hash !== null || entryCancel !== null || strategyExitCancel !== null || entry.authorized_reduce_only_exit !== null
          || entry.authorized_protective_stop_replace !== null || entry.authorized_partial_reduce !== null) {
        fail("no-action decision cannot authorize an Order")
      }
      if (decisionTime > Date.parse(request.order.signal_time)
          && decisionTime <= Date.parse(request.order.earliest_executable_time)) {
        fail("post-entry decision must occur after earliest executable time")
      }
      continue
    }
    if (entry.expected_effect === "authorized_initial_order") {
      if (entryCancel !== null || strategyExitCancel !== null || entry.authorized_reduce_only_exit !== null || entry.authorized_protective_stop_replace !== null
          || entry.authorized_partial_reduce !== null
          || entry.authorized_order_hash !== canonicalHash(request.order)
          || entry.decision_time !== request.order.signal_time) {
        fail("decision schedule authorized initial Order must match the frozen Order signal")
      }
      authorizedCount += 1
      continue
    }
    if (entry.expected_effect === "authorized_entry_cancel") {
      const intent = request.order.entry_cancel_intent
      if (!intent || !entryCancel
          || strategyExitCancel !== null || entry.authorized_reduce_only_exit !== null || entry.authorized_protective_stop_replace !== null
          || entry.authorized_partial_reduce !== null
          || canonicalHash(entryCancel) !== canonicalHash(intent)
          || entry.decision_time !== intent.effective_at
          || entry.authorized_order_hash !== canonicalHash(intent)) {
        fail("authorized entry cancel must match the frozen GTC pending-entry cancel intent")
      }
      assertReplayEntryCancelIntent(entryCancel)
      authorizedEntryCancelCount += 1
      continue
    }
    if (entry.expected_effect === "authorized_protective_stop_replace") {
      const replace = entry.authorized_protective_stop_replace
      if (!replace || entryCancel !== null || strategyExitCancel !== null || entry.authorized_reduce_only_exit !== null || entry.authorized_partial_reduce !== null
          || replace.schema_version !== REPLAY_PROTECTIVE_STOP_REPLACE_INTENT_SCHEMA_VERSION
          || replace.side !== (request.order.side === "long" ? "sell" : "buy")
          || replace.order_type !== "stop_market" || replace.reduce_only !== true
          || replace.quantity_policy !== "full_open_position"
          || replace.replace_policy !== "tighten_only_cancel_then_submit"
          || ![undefined, "initial_bracket_then_optional_full_exit_no_other_position_mutation",
            "after_final_partial_then_optional_full_exit_no_other_position_mutation",
          ].includes(replace.schedule_combination_policy)
          || replace.signal_time !== entry.decision_time
          || replace.previous_stop_price !== request.order.stop_price
          || (request.order.side === "long" && (
            replace.new_stop_price <= replace.previous_stop_price || replace.new_stop_price >= request.order.target_price
          ))
          || (request.order.side === "short" && (
            replace.new_stop_price >= replace.previous_stop_price || replace.new_stop_price <= request.order.target_price
          ))
          || entry.authorized_order_hash !== canonicalHash(replace)) {
        fail("authorized protective stop replacement must tighten the frozen full-position stop")
      }
      requireUtcTimestamp(replace.signal_time, `decision_schedule.entries[${index}].authorized_protective_stop_replace.signal_time`)
      requirePositive(replace.previous_stop_price, "authorized_protective_stop_replace.previous_stop_price")
      requirePositive(replace.new_stop_price, "authorized_protective_stop_replace.new_stop_price")
      authorizedStopReplaceCount += 1
      continue
    }
    if (entry.expected_effect === "authorized_take_profit_replace") {
      const replace = takeProfitReplace
      if (!replace || entryCancel !== null || strategyExitCancel !== null || takeProfitCancel !== null
          || protectiveStopCancel !== null || entry.authorized_reduce_only_exit !== null
          || entry.authorized_protective_stop_replace !== null || entry.authorized_partial_reduce !== null
          || replace.schema_version !== REPLAY_TAKE_PROFIT_REPLACE_INTENT_SCHEMA_VERSION
          || replace.side !== (request.order.side === "long" ? "sell" : "buy")
          || replace.order_type !== "take_profit_market" || replace.reduce_only !== true
          || replace.quantity_policy !== "full_open_position"
          || replace.target_order_id !== `${request.run_id}:order:target`
          || replace.replace_policy !== "cancel_then_submit_not_already_triggered"
          || replace.stop_preservation_policy !== "require_active_full_position_stop"
          || replace.schedule_combination_policy !== "initial_bracket_only_no_other_position_mutation"
          || replace.signal_time !== entry.decision_time
          || replace.previous_target_price !== request.order.target_price
          || replace.new_target_price === replace.previous_target_price
          || replace.reason_code !== "take_profit_repriced"
          || (request.order.side === "long" && replace.new_target_price <= request.order.stop_price)
          || (request.order.side === "short" && replace.new_target_price >= request.order.stop_price)
          || Date.parse(replace.signal_time) <= Date.parse(request.order.earliest_executable_time)
          || entry.authorized_order_hash !== canonicalHash(replace)
          || index !== schedule.entries.length - 1) {
        fail("authorized take-profit replacement must reprice the final initial-bracket target and preserve its stop")
      }
      requireUtcTimestamp(replace.signal_time, `decision_schedule.entries[${index}].authorized_take_profit_replace.signal_time`)
      requirePositive(replace.previous_target_price, "authorized_take_profit_replace.previous_target_price")
      requirePositive(replace.new_target_price, "authorized_take_profit_replace.new_target_price")
      authorizedTakeProfitReplaceCount += 1
      continue
    }
    if (entry.expected_effect === "authorized_partial_reduce") {
      const partial = entry.authorized_partial_reduce
      if (!partial || entryCancel !== null || strategyExitCancel !== null || entry.authorized_reduce_only_exit !== null
          || entry.authorized_protective_stop_replace !== null
          || partial.signal_time !== entry.decision_time
          || entry.authorized_order_hash !== canonicalHash(partial)) {
        fail("authorized partial reduce must match its frozen fixed-quantity intent")
      }
      assertReplayPartialReduceIntent(partial, request.order)
      authorizedPartialReduceCount += 1
      partialReduceIndexes.push(index)
      continue
    }
    if (entry.expected_effect === "authorized_take_profit_cancel") {
      if (!takeProfitCancel || entryCancel !== null || strategyExitCancel !== null
          || entry.authorized_reduce_only_exit !== null || entry.authorized_protective_stop_replace !== null
          || entry.authorized_partial_reduce !== null
          || takeProfitCancel.schema_version !== REPLAY_TAKE_PROFIT_CANCEL_INTENT_SCHEMA_VERSION
          || takeProfitCancel.target_order_role !== "target"
          || takeProfitCancel.target_order_type !== "take_profit_market"
          || takeProfitCancel.target_order_id !== `${request.run_id}:order:target`
          || takeProfitCancel.cancel_policy !== "cancel_active_target_preserve_stop"
          || takeProfitCancel.stop_preservation_policy !== "require_active_full_position_stop"
          || takeProfitCancel.schedule_combination_policy !== "initial_bracket_only_no_other_position_mutation"
          || takeProfitCancel.reason_code !== "take_profit_condition_revoked"
          || takeProfitCancel.effective_at !== entry.decision_time
          || Date.parse(takeProfitCancel.effective_at) <= Date.parse(request.order.earliest_executable_time)
          || entry.authorized_order_hash !== canonicalHash(takeProfitCancel)
          || index !== schedule.entries.length - 1) {
        fail("authorized take-profit cancel must be the final initial-bracket target cancellation with active stop preserved")
      }
      requireUtcTimestamp(takeProfitCancel.effective_at, `decision_schedule.entries[${index}].authorized_take_profit_cancel.effective_at`)
      authorizedTakeProfitCancelCount += 1
      continue
    }
    if (entry.expected_effect === "authorized_protective_stop_cancel") {
      if (!protectiveStopCancel || entryCancel !== null || strategyExitCancel !== null
          || entry.authorized_reduce_only_exit !== null || entry.authorized_protective_stop_replace !== null
          || entry.authorized_partial_reduce !== null
          || protectiveStopCancel.schema_version !== REPLAY_PROTECTIVE_STOP_CANCEL_INTENT_SCHEMA_VERSION
          || protectiveStopCancel.target_order_role !== "stop"
          || protectiveStopCancel.target_order_type !== "stop_market"
          || protectiveStopCancel.target_order_id !== `${request.run_id}:order:stop`
          || protectiveStopCancel.cancel_policy !== "cancel_active_stop_preserve_target"
          || protectiveStopCancel.target_preservation_policy !== "require_active_full_position_target"
          || protectiveStopCancel.schedule_combination_policy !== "initial_bracket_only_no_other_position_mutation"
          || protectiveStopCancel.reason_code !== "protective_stop_condition_revoked"
          || protectiveStopCancel.effective_at !== entry.decision_time
          || Date.parse(protectiveStopCancel.effective_at) <= Date.parse(request.order.earliest_executable_time)
          || entry.authorized_order_hash !== canonicalHash(protectiveStopCancel)
          || index !== schedule.entries.length - 1) {
        fail("authorized protective-stop cancel must be the final initial-bracket stop cancellation with active target preserved")
      }
      requireUtcTimestamp(protectiveStopCancel.effective_at, `decision_schedule.entries[${index}].authorized_protective_stop_cancel.effective_at`)
      authorizedProtectiveStopCancelCount += 1
      continue
    }
    if (entry.expected_effect === "authorized_strategy_exit_cancel") {
      if (!strategyExitCancel || entryCancel !== null || entry.authorized_reduce_only_exit !== null
          || entry.authorized_protective_stop_replace !== null || entry.authorized_partial_reduce !== null
          || strategyExitCancel.schema_version !== REPLAY_STRATEGY_EXIT_CANCEL_INTENT_SCHEMA_VERSION
          || strategyExitCancel.target_order_role !== "strategy_exit"
          || strategyExitCancel.cancel_policy !== "cancel_submitted_before_earliest_executable_time"
          || strategyExitCancel.reason_code !== "strategy_exit_condition_revoked"
          || strategyExitCancel.effective_at !== entry.decision_time
          || entry.authorized_order_hash !== canonicalHash(strategyExitCancel)
          || index !== schedule.entries.length - 1) {
        fail("authorized strategy-exit cancel must be the final frozen pending-exit cancellation")
      }
      requireUtcTimestamp(strategyExitCancel.effective_at, `decision_schedule.entries[${index}].authorized_strategy_exit_cancel.effective_at`)
      if (!Number.isSafeInteger(strategyExitCancel.target_exit_decision_sequence)
          || strategyExitCancel.target_exit_decision_sequence <= 0
          || exitIndex < 0 || !frozenExitIntent
          || strategyExitCancel.target_exit_decision_sequence !== schedule.entries[exitIndex]!.decision_sequence
          || Date.parse(strategyExitCancel.effective_at) <= Date.parse(frozenExitIntent.signal_time)
          || Date.parse(strategyExitCancel.effective_at) >= Date.parse(frozenExitIntent.earliest_executable_time)) {
        fail("strategy-exit cancel must target an earlier submitted exit before its executable boundary")
      }
      authorizedStrategyExitCancelCount += 1
      continue
    }
    if (entry.expected_effect !== "authorized_reduce_only_exit" || !entry.authorized_reduce_only_exit) {
      fail("unsupported decision schedule effect")
    }
    const exit = entry.authorized_reduce_only_exit
    if (entryCancel !== null || strategyExitCancel !== null || entry.authorized_protective_stop_replace !== null || entry.authorized_partial_reduce !== null
        || exit.schema_version !== REPLAY_REDUCE_ONLY_EXIT_INTENT_SCHEMA_VERSION
        || exit.order_type !== "market" || exit.reduce_only !== true
        || exit.quantity_policy !== "full_open_position"
        || exit.side !== (request.order.side === "long" ? "sell" : "buy")
        || exit.signal_time !== entry.decision_time
        || Date.parse(exit.signal_time) <= Date.parse(request.order.earliest_executable_time)
        || entry.authorized_order_hash !== canonicalHash(exit)) {
      fail("authorized reduce-only exit must be a frozen full-position opposite-side market intent")
    }
    requireUtcTimestamp(exit.signal_time, `decision_schedule.entries[${index}].authorized_reduce_only_exit.signal_time`)
    requireUtcTimestamp(exit.earliest_executable_time, `decision_schedule.entries[${index}].authorized_reduce_only_exit.earliest_executable_time`)
    if (Date.parse(exit.earliest_executable_time) <= Date.parse(exit.signal_time)) {
      fail("authorized reduce-only exit earliest executable time must be after signal time")
    }
    authorizedExitCount += 1
    exitIndex = index
    frozenExitIntent = exit
  }
  if (authorizedCount !== 1) fail("decision schedule requires exactly one authorized initial Order")
  if (authorizedEntryCancelCount > 1) fail("decision schedule permits at most one authorized entry cancel")
  if (authorizedExitCount > 1) fail("decision schedule permits at most one authorized reduce-only exit")
  if (authorizedStrategyExitCancelCount > 1) fail("decision schedule permits at most one authorized strategy-exit cancel")
  if (authorizedTakeProfitCancelCount > 1) fail("decision schedule permits at most one authorized take-profit cancel")
  if (authorizedProtectiveStopCancelCount > 1) fail("decision schedule permits at most one authorized protective-stop cancel")
  if (authorizedTakeProfitReplaceCount > 1) fail("decision schedule permits at most one take-profit replacement")
  if (authorizedTakeProfitCancelCount > 0 && (
    authorizedEntryCancelCount > 0 || authorizedExitCount > 0 || authorizedStrategyExitCancelCount > 0
    || authorizedStopReplaceCount > 0 || authorizedPartialReduceCount > 0
  )) {
    fail("take-profit cancel cannot be combined with another Order mutation")
  }
  if (authorizedProtectiveStopCancelCount > 0 && (
    authorizedEntryCancelCount > 0 || authorizedExitCount > 0 || authorizedStrategyExitCancelCount > 0
    || authorizedTakeProfitCancelCount > 0 || authorizedStopReplaceCount > 0 || authorizedPartialReduceCount > 0
  )) {
    fail("protective-stop cancel cannot be combined with another Order mutation")
  }
  if (authorizedTakeProfitReplaceCount > 0 && (
    authorizedEntryCancelCount > 0 || authorizedExitCount > 0 || authorizedStrategyExitCancelCount > 0
    || authorizedTakeProfitCancelCount > 0 || authorizedProtectiveStopCancelCount > 0
    || authorizedStopReplaceCount > 0 || authorizedPartialReduceCount > 0
  )) {
    fail("take-profit replacement cannot be combined with another Order mutation")
  }
  if (authorizedStrategyExitCancelCount > 0 && authorizedExitCount !== 1) {
    fail("strategy-exit cancel requires exactly one earlier authorized reduce-only exit")
  }
  if (authorizedExitCount === 1 && authorizedStrategyExitCancelCount === 0 && exitIndex !== schedule.entries.length - 1) {
    fail("uncancelled authorized reduce-only exit must be the final full-position frozen decision")
  }
  if (authorizedStopReplaceCount > 1) fail("decision schedule permits at most one protective stop replacement")
  if (authorizedPartialReduceCount > 2) fail("decision schedule permits at most two partial reduces")
  if (partialReduceIndexes.length > 0) {
    const partials = partialReduceIndexes.map((index) => schedule.entries[index]!.authorized_partial_reduce!)
    const postPartialReplacement = authorizedStopReplaceCount === 1
    const expectedPolicy = postPartialReplacement
      ? partials.length === 1
        ? "one_partial_reduce_then_one_tighten_only_stop_replace_then_optional_final_full_exit"
        : "up_to_two_partial_reduces_then_one_tighten_only_stop_replace_then_optional_final_full_exit"
      : partials.length === 1
        ? "one_partial_reduce_then_optional_final_full_exit_no_stop_replace"
        : "up_to_two_partial_reduces_then_optional_final_full_exit_no_other_mutation"
    if (partials.some((partial) => partial.schedule_combination_policy !== expectedPolicy)) {
      fail("partial-reduce schedule policy does not match its frozen bounded count")
    }
    if (partials.reduce((total, partial) => total + partial.quantity, 0) >= request.order.quantity) {
      fail("cumulative partial-reduce quantity must leave an open position")
    }
    for (const index of partialReduceIndexes) {
      const partial = schedule.entries[index]!.authorized_partial_reduce!
      const nextDecision = schedule.entries[index + 1]
      if (nextDecision && Date.parse(partial.earliest_executable_time) >= Date.parse(nextDecision.decision_time)) {
        fail("partial reduce must execute before the next frozen decision")
      }
    }
    if (postPartialReplacement) {
      const replacementIndex = schedule.entries.findIndex(
        (entry) => entry.expected_effect === "authorized_protective_stop_replace",
      )
      const replacement = schedule.entries[replacementIndex]?.authorized_protective_stop_replace
      if (!replacement || replacementIndex <= partialReduceIndexes.at(-1)!
          || replacement.schedule_combination_policy
            !== "after_final_partial_then_optional_full_exit_no_other_position_mutation"
          || authorizedEntryCancelCount > 0 || authorizedStrategyExitCancelCount > 0
          || authorizedTakeProfitCancelCount > 0 || authorizedProtectiveStopCancelCount > 0
          || authorizedTakeProfitReplaceCount > 0
          || (authorizedExitCount === 1 && exitIndex <= replacementIndex)) {
        fail("post-partial protective stop replacement must follow the final bounded partial and precede only an optional full exit")
      }
    }
  } else if (authorizedStopReplaceCount === 1) {
    const replacement = schedule.entries.find(
      (entry) => entry.expected_effect === "authorized_protective_stop_replace",
    )?.authorized_protective_stop_replace
    if (replacement?.schedule_combination_policy
        === "after_final_partial_then_optional_full_exit_no_other_position_mutation") {
      fail("post-partial protective stop replacement requires a frozen partial reduce")
    }
  }
  if (schedule.entries.length > 1 && (
    request.supplemental_requirement_set.mode !== "none"
    || request.decision_market_input_requirement.mode !== "closed_bar_lookback"
  )) {
    fail("multi-decision schedule requires market-only closed-bar lookback inputs")
  }
}

export function createReplaySingleDecisionSchedule(
  order: ReplayExecutionRequest["order"],
): ReplayDecisionSchedule {
  return {
    schema_version: REPLAY_DECISION_SCHEDULE_SCHEMA_VERSION,
    schedule_policy: "frozen_closed_bar_schedule",
    entries: [{
      decision_sequence: 1,
      decision_time: order.signal_time,
      expected_effect: "authorized_initial_order",
      authorized_entry_cancel: null,
      authorized_strategy_exit_cancel: null,
      authorized_take_profit_cancel: null,
      authorized_protective_stop_cancel: null,
      authorized_reduce_only_exit: null,
      authorized_protective_stop_replace: null,
      authorized_partial_reduce: null,
      authorized_order_hash: canonicalHash(order),
    }],
  }
}

export function createReplayEntryCancelDecisionSchedule(
  order: ReplayExecutionRequest["order"],
): ReplayDecisionSchedule {
  const intent = order.entry_cancel_intent
  if (!intent) fail("entry cancel decision schedule requires a frozen cancel intent")
  const schedule = createReplaySingleDecisionSchedule(order)
  schedule.entries.push({
    decision_sequence: 2,
    decision_time: intent.effective_at,
    expected_effect: "authorized_entry_cancel",
    authorized_entry_cancel: structuredClone(intent),
    authorized_strategy_exit_cancel: null,
    authorized_take_profit_cancel: null,
    authorized_protective_stop_cancel: null,
    authorized_reduce_only_exit: null,
    authorized_protective_stop_replace: null,
    authorized_partial_reduce: null,
    authorized_order_hash: canonicalHash(intent),
  })
  return schedule
}

export function replayDecisionOutputFor(
  request: ReplayExecutionRequest,
  scheduleEntry: ReplayDecisionScheduleEntry,
): ReplayDecisionOutput {
  if (scheduleEntry.expected_effect === "no_action") return { action: "no_action" }
  if (scheduleEntry.expected_effect === "authorized_initial_order") {
    return { action: "submit_initial_order", order: structuredClone(request.order) }
  }
  if (scheduleEntry.expected_effect === "authorized_entry_cancel") {
    if (!scheduleEntry.authorized_entry_cancel) fail("authorized entry cancel intent is missing")
    return { action: "cancel_entry_order", order: structuredClone(scheduleEntry.authorized_entry_cancel) }
  }
  if (scheduleEntry.expected_effect === "authorized_protective_stop_replace") {
    if (!scheduleEntry.authorized_protective_stop_replace) fail("authorized protective stop replacement intent is missing")
    return { action: "replace_protective_stop", order: structuredClone(scheduleEntry.authorized_protective_stop_replace) }
  }
  if (scheduleEntry.expected_effect === "authorized_take_profit_replace") {
    if (!scheduleEntry.authorized_take_profit_replace) fail("authorized take-profit replacement intent is missing")
    return { action: "replace_take_profit", order: structuredClone(scheduleEntry.authorized_take_profit_replace) }
  }
  if (scheduleEntry.expected_effect === "authorized_partial_reduce") {
    if (!scheduleEntry.authorized_partial_reduce) fail("authorized partial-reduce intent is missing")
    return { action: "submit_partial_reduce", order: structuredClone(scheduleEntry.authorized_partial_reduce) }
  }
  if (scheduleEntry.expected_effect === "authorized_strategy_exit_cancel") {
    if (!scheduleEntry.authorized_strategy_exit_cancel) fail("authorized strategy-exit cancel intent is missing")
    return { action: "cancel_strategy_exit", order: structuredClone(scheduleEntry.authorized_strategy_exit_cancel) }
  }
  if (scheduleEntry.expected_effect === "authorized_take_profit_cancel") {
    if (!scheduleEntry.authorized_take_profit_cancel) fail("authorized take-profit cancel intent is missing")
    return { action: "cancel_take_profit", order: structuredClone(scheduleEntry.authorized_take_profit_cancel) }
  }
  if (scheduleEntry.expected_effect === "authorized_protective_stop_cancel") {
    if (!scheduleEntry.authorized_protective_stop_cancel) fail("authorized protective-stop cancel intent is missing")
    return { action: "cancel_protective_stop", order: structuredClone(scheduleEntry.authorized_protective_stop_cancel) }
  }
  if (!scheduleEntry.authorized_reduce_only_exit) fail("authorized reduce-only exit intent is missing")
  return { action: "submit_reduce_only_exit", order: structuredClone(scheduleEntry.authorized_reduce_only_exit) }
}

export function replayDecisionScheduleEntryAt(
  request: ReplayExecutionRequest,
  decisionTime: string,
): ReplayDecisionScheduleEntry {
  const entry = request.decision_schedule.entries.find((candidate) => candidate.decision_time === decisionTime)
  if (!entry) fail("decision time is not authorized by the frozen schedule")
  return entry
}

export function replayDecisionPhaseFor(
  request: Pick<ReplayExecutionRequest, "order">,
  scheduleEntry: ReplayDecisionScheduleEntry,
): "pre_entry" | "initial_entry" | "pending_entry" | "position_open" {
  if (scheduleEntry.expected_effect === "authorized_initial_order") return "initial_entry"
  if (scheduleEntry.expected_effect === "authorized_entry_cancel") return "pending_entry"
  return Date.parse(scheduleEntry.decision_time) < Date.parse(request.order.signal_time) ? "pre_entry" : "position_open"
}

export function replayDecisionEarliestExecutableTimeFor(
  request: Pick<ReplayExecutionRequest, "order">,
  scheduleEntry: ReplayDecisionScheduleEntry,
): string | null {
  if (scheduleEntry.expected_effect === "authorized_initial_order") return request.order.earliest_executable_time
  if (scheduleEntry.expected_effect === "authorized_entry_cancel") return scheduleEntry.decision_time
  if (scheduleEntry.expected_effect === "authorized_strategy_exit_cancel") return scheduleEntry.decision_time
  if (scheduleEntry.expected_effect === "authorized_take_profit_cancel") return scheduleEntry.decision_time
  if (scheduleEntry.expected_effect === "authorized_protective_stop_cancel") return scheduleEntry.decision_time
  if (scheduleEntry.expected_effect === "authorized_reduce_only_exit") {
    if (!scheduleEntry.authorized_reduce_only_exit) fail("authorized reduce-only exit intent is missing")
    return scheduleEntry.authorized_reduce_only_exit.earliest_executable_time
  }
  if (scheduleEntry.expected_effect === "authorized_partial_reduce") {
    if (!scheduleEntry.authorized_partial_reduce) fail("authorized partial-reduce intent is missing")
    return scheduleEntry.authorized_partial_reduce.earliest_executable_time
  }
  return null
}

export function replayDecisionOrderTransitionPolicyFor(
  scheduleEntry: ReplayDecisionScheduleEntry,
): ReplayDecisionBoundary["order_transition_policy"] {
  if (scheduleEntry.expected_effect === "no_action") return "none"
  if (scheduleEntry.expected_effect === "authorized_entry_cancel") return "cancel_at_decision"
  if (scheduleEntry.expected_effect === "authorized_strategy_exit_cancel") return "cancel_at_decision"
  if (scheduleEntry.expected_effect === "authorized_take_profit_cancel") return "cancel_at_decision"
  if (scheduleEntry.expected_effect === "authorized_protective_stop_cancel") return "cancel_at_decision"
  if (scheduleEntry.expected_effect === "authorized_protective_stop_replace") return "cancel_replace_at_decision"
  if (scheduleEntry.expected_effect === "authorized_take_profit_replace") return "cancel_replace_at_decision"
  return "submit_at_decision"
}

export function replayAuthorizedInitialDecisionScheduleEntry(
  request: Pick<ReplayExecutionRequest, "decision_schedule">,
): ReplayDecisionScheduleEntry {
  const entries = request.decision_schedule.entries.filter((entry) => entry.expected_effect === "authorized_initial_order")
  if (entries.length !== 1) fail("Replay decision schedule must contain exactly one authorized initial Order")
  return entries[0]!
}

export function replayAuthorizedInitialDecisionEvidenceEntry(
  timeline: ReplayDecisionEvidenceTimeline,
): ReplayDecisionEvidenceEntry {
  const entries = timeline.entries.filter((entry) => entry.execution_effect === "authorized_order")
  if (entries.length !== 1) fail("Replay decision evidence timeline must contain exactly one authorized Order")
  return entries[0]!
}

export function createReplayDecisionMarketInputSnapshot(input: {
  request: ReplayExecutionRequest
  decision_time?: string
  interval_ms: number
  bars: ReplayMarketBar[]
}): ReplayDecisionMarketInputSnapshot {
  const bars = structuredClone(input.bars)
  const body: ReplayDecisionMarketInputSnapshotBody = {
    schema_version: REPLAY_DECISION_MARKET_INPUT_SNAPSHOT_SCHEMA_VERSION,
    run_id: input.request.run_id,
    decision_time: input.decision_time ?? input.request.order.signal_time,
    symbol: input.request.symbol,
    timeframe: input.request.timeframe,
    interval_ms: input.interval_ms,
    requirement_hash: input.request.decision_market_input_requirement_hash,
    visibility_policy: "closed_candle",
    bars,
    bars_hash: canonicalHash(bars),
  }
  const snapshot = { ...body, snapshot_hash: canonicalHash(body) }
  assertReplayDecisionMarketInputSnapshot(snapshot, input.request, body.decision_time)
  return snapshot
}

export function assertReplayDecisionMarketInputSnapshot(
  snapshot: ReplayDecisionMarketInputSnapshot,
  request?: ReplayExecutionRequest,
  expectedDecisionTime?: string,
): void {
  if (snapshot.schema_version !== REPLAY_DECISION_MARKET_INPUT_SNAPSHOT_SCHEMA_VERSION
      || snapshot.visibility_policy !== "closed_candle") {
    fail("unsupported Replay decision market input snapshot")
  }
  requireText(snapshot.run_id, "decision_market_input_snapshot.run_id")
  requireUtcTimestamp(snapshot.decision_time, "decision_market_input_snapshot.decision_time")
  requireText(snapshot.symbol, "decision_market_input_snapshot.symbol")
  requireText(snapshot.timeframe, "decision_market_input_snapshot.timeframe")
  if (!Number.isSafeInteger(snapshot.interval_ms) || snapshot.interval_ms <= 0) {
    fail("decision market input interval must be a positive safe integer")
  }
  requireHash(snapshot.requirement_hash, "decision_market_input_snapshot.requirement_hash")
  assertReplayMarketBars(snapshot.bars)
  requireHash(snapshot.bars_hash, "decision_market_input_snapshot.bars_hash")
  requireHash(snapshot.snapshot_hash, "decision_market_input_snapshot.snapshot_hash")
  if (canonicalHash(snapshot.bars) !== snapshot.bars_hash) fail("decision market input bars hash mismatch")
  const { snapshot_hash: _snapshotHash, ...body } = snapshot
  if (canonicalHash(body) !== snapshot.snapshot_hash) fail("decision market input snapshot hash mismatch")
  if (!request) return
  if (snapshot.run_id !== request.run_id
      || snapshot.decision_time !== (expectedDecisionTime ?? request.order.signal_time)
      || snapshot.symbol !== request.symbol
      || snapshot.timeframe !== request.timeframe
      || snapshot.requirement_hash !== request.decision_market_input_requirement_hash) {
    fail("decision market input snapshot does not match Replay request")
  }
  const requirement = request.decision_market_input_requirement
  if (requirement.mode === "none") {
    if (snapshot.bars.length !== 0) fail("decision market input mode none requires an empty snapshot")
    return
  }
  if (snapshot.bars.length !== requirement.lookback_bars) fail("decision market input lookback is incomplete")
  const decisionTime = Date.parse(snapshot.decision_time)
  for (const [index, bar] of snapshot.bars.entries()) {
    const open = Date.parse(bar.open_time)
    const close = Date.parse(bar.close_time)
    if (close > decisionTime) fail("decision market input contains a future-visible bar")
    if (close - open !== snapshot.interval_ms) fail("decision market input bar duration differs from interval")
    if (index > 0 && open !== Date.parse(snapshot.bars[index - 1].close_time)) {
      fail("decision market input lookback contains a grid gap")
    }
  }
  if (snapshot.bars.at(-1)?.close_time !== snapshot.decision_time) {
    fail("decision market input terminal bar must close at decision time")
  }
}

export function createReplayDecisionStateSnapshot(
  body: ReplayDecisionStateSnapshotBody,
): ReplayDecisionStateSnapshot {
  const snapshot = { ...structuredClone(body), snapshot_hash: canonicalHash(body) }
  assertReplayDecisionStateSnapshot(snapshot)
  return snapshot
}

export function assertReplayDecisionStateSnapshot(
  snapshot: ReplayDecisionStateSnapshot,
  request?: ReplayExecutionRequest,
  scheduleEntry?: ReplayDecisionScheduleEntry,
): void {
  if (snapshot.schema_version !== REPLAY_DECISION_STATE_SNAPSHOT_SCHEMA_VERSION) {
    fail("unsupported Replay decision state snapshot")
  }
  requireText(snapshot.run_id, "decision_state_snapshot.run_id")
  requireUtcTimestamp(snapshot.decision_time, "decision_state_snapshot.decision_time")
  if (!Number.isSafeInteger(snapshot.decision_sequence) || snapshot.decision_sequence <= 0) {
    fail("decision state snapshot sequence must be a positive safe integer")
  }
  assertReplayEventKey(snapshot.observation_event_key)
  requireHash(snapshot.source_prefix_hash, "decision_state_snapshot.source_prefix_hash")
  if (snapshot.position.state !== "open" || !["long", "short"].includes(snapshot.position.side)) {
    fail("decision state snapshot requires an open position")
  }
  for (const [field, value] of Object.entries({
    signed_quantity: snapshot.position.signed_quantity,
    average_entry_price: snapshot.position.average_entry_price,
    mark_price: snapshot.mark_price,
    cash_balance: snapshot.cash_balance,
    total_fees: snapshot.total_fees,
    total_funding: snapshot.total_funding,
    unrealized_pnl: snapshot.unrealized_pnl,
    equity: snapshot.equity,
  })) if (!Number.isFinite(value)) fail(`decision state snapshot ${field} must be finite`)
  if (snapshot.position.signed_quantity === 0
      || Math.sign(snapshot.position.signed_quantity) !== (snapshot.position.side === "long" ? 1 : -1)
      || snapshot.position.average_entry_price <= 0
      || snapshot.mark_price <= 0
      || snapshot.total_fees < 0) {
    fail("decision state snapshot position or monetary state is invalid")
  }
  const expectedExitSide = snapshot.position.side === "long" ? "sell" : "buy"
  for (const [role, order] of Object.entries(snapshot.active_protection) as Array<
    ["stop" | "target", ReplayDecisionStateSnapshot["active_protection"]["stop" | "target"]]
  >) {
    requireText(order.order_id, `decision_state_snapshot.active_protection.${role}.order_id`)
    if (order.status !== "active" || order.trigger_price <= 0
        || order.remaining_quantity !== Math.abs(snapshot.position.signed_quantity)
        || !Number.isFinite(order.trigger_price)) {
      fail("decision state snapshot requires active full-position protection")
    }
  }
  if (expectedExitSide === "sell"
      ? snapshot.active_protection.stop.trigger_price >= snapshot.active_protection.target.trigger_price
      : snapshot.active_protection.stop.trigger_price <= snapshot.active_protection.target.trigger_price) {
    fail("decision state snapshot protection prices are inverted")
  }
  requireHash(snapshot.snapshot_hash, "decision_state_snapshot.snapshot_hash")
  const { snapshot_hash: _snapshotHash, ...body } = snapshot
  if (canonicalHash(body) !== snapshot.snapshot_hash) fail("decision state snapshot hash mismatch")
  if (!request) return
  const entry = scheduleEntry ?? replayDecisionScheduleEntryAt(request, snapshot.decision_time)
  if (snapshot.run_id !== request.run_id
      || snapshot.decision_sequence !== entry.decision_sequence
      || snapshot.decision_time !== entry.decision_time
      || replayDecisionPhaseFor(request, entry) !== "position_open"
      || snapshot.observation_event_key.event_time !== entry.decision_time) {
    fail("decision state snapshot does not match a frozen position-open decision")
  }
}

export function assertReplayDecisionStateSnapshotSourcePrefix(
  snapshot: ReplayDecisionStateSnapshot,
  sourceEvents: ReplaySourceEvent[],
): void {
  const observationIndex = sourceEvents.findIndex(
    (source) => canonicalJson(source.event_key) === canonicalJson(snapshot.observation_event_key),
  )
  if (observationIndex < 0
      || sourceEvents[observationIndex]?.kind !== "bar_range"
      || canonicalHash(sourceEvents.slice(0, observationIndex + 1)) !== snapshot.source_prefix_hash) {
    fail("decision state snapshot source prefix does not match Replay source evidence")
  }
}

export function createReplayDecisionHarnessContext(
  request: ReplayExecutionRequest,
  scheduleEntry: ReplayDecisionScheduleEntry = replayAuthorizedInitialDecisionScheduleEntry(request),
): ReplayDecisionHarnessContext {
  return {
    schema_version: REPLAY_DECISION_HARNESS_CONTEXT_SCHEMA_VERSION,
    run_id: request.run_id,
    experiment_id: request.experiment_id,
    trial_group_id: request.trial_group_id,
    trial_id: request.trial_id,
    candidate_id: request.candidate_id,
    candidate_hash: request.candidate_hash,
    strategy_policy_hash: request.strategy_policy_hash ?? null,
    symbol: request.symbol,
    timeframe: request.timeframe,
    decision_sequence: scheduleEntry.decision_sequence,
    decision_time: scheduleEntry.decision_time,
    decision_phase: replayDecisionPhaseFor(request, scheduleEntry),
    earliest_executable_time: replayDecisionEarliestExecutableTimeFor(request, scheduleEntry),
    random_seed: request.random_seed,
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
  assertReplaySnapshotSchedule(manifest.instrument.status_epochs, assertReplayInstrumentStatusSnapshot, "instrument.status_epochs")
  assertReplayInstrumentStatusProvenance(manifest.instrument.status_provenance, manifest)
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
  if (manifest.instrument.status_history === "current_snapshot_only"
      && manifest.instrument.status_epochs.some((snapshot) => snapshot.status === "halted")) {
    fail("current-snapshot-only instrument history cannot certify historical halt epochs")
  }
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
  if (manifest.liquidity_capacity_attestation !== undefined) {
    assertReplayLiquidityCapacityAttestation(manifest.liquidity_capacity_attestation)
    if (manifest.liquidity_capacity_attestation.symbol !== manifest.symbol) {
      fail("liquidity capacity attestation symbol does not match manifest")
    }
  }
}

export function assertReplayLiquidityCapacityAttestation(value: ReplayLiquidityCapacityAttestation): void {
  if (value.schema_version !== REPLAY_LIQUIDITY_CAPACITY_ATTESTATION_SCHEMA_VERSION) {
    fail("liquidity capacity attestation schema_version")
  }
  for (const [field, item] of Object.entries({
    attestation_id: value.attestation_id,
    attestation_ref: value.attestation_ref,
    symbol: value.symbol,
    source_ref: value.source_ref,
    derivation_policy_id: value.derivation_policy_id,
    derivation_policy_version: value.derivation_policy_version,
  })) requireText(item, `liquidity_capacity_attestation.${field}`)
  for (const [field, item] of Object.entries({
    source_hash: value.source_hash,
    derivation_policy_hash: value.derivation_policy_hash,
    attestation_hash: value.attestation_hash,
  })) requireHash(item, `liquidity_capacity_attestation.${field}`)
  requirePositive(value.full_fill_capacity, "liquidity_capacity_attestation.full_fill_capacity")
  if (value.quantity_unit !== "base_asset"
      || value.capacity_scope !== "static_order_quantity_ceiling"
      || value.evidence_limitation !== "not_event_depth_or_queue_position_proof") {
    fail("unsupported liquidity capacity attestation policy")
  }
  for (const [field, item] of Object.entries({
    calibration_window_start: value.calibration_window_start,
    calibration_window_end: value.calibration_window_end,
    observed_through: value.observed_through,
    available_at: value.available_at,
  })) requireUtcTimestamp(item, `liquidity_capacity_attestation.${field}`)
  if (Date.parse(value.calibration_window_start) >= Date.parse(value.calibration_window_end)
      || Date.parse(value.calibration_window_end) > Date.parse(value.observed_through)
      || Date.parse(value.observed_through) > Date.parse(value.available_at)) {
    fail("liquidity capacity attestation chronology is invalid")
  }
  const { attestation_hash: _attestationHash, ...body } = value
  if (canonicalHash(body) !== value.attestation_hash) fail("liquidity capacity attestation hash mismatch")
}

export function replayLiquidityCapacityAttestationHash(
  value: ReplayLiquidityCapacityAttestationBody | ReplayLiquidityCapacityAttestation,
): string {
  const { attestation_hash: _attestationHash, ...body } = value as ReplayLiquidityCapacityAttestation
  return canonicalHash(body)
}

export function createReplayLiquidityCapacityAttestation(
  body: ReplayLiquidityCapacityAttestationBody,
): ReplayLiquidityCapacityAttestation {
  const value = { ...body, attestation_hash: canonicalHash(body) }
  assertReplayLiquidityCapacityAttestation(value)
  return value
}

export function assertReplayLiquidityCapacityBinding(
  request: ReplayExecutionRequest,
  manifest: ReplayDatasetManifest,
): void {
  const execution = request.order.entry_execution
  if (execution.order_type === "market") return
  const attestation = manifest.liquidity_capacity_attestation
  if (!attestation) fail("executable pending entry requires a liquidity capacity attestation")
  assertReplayLiquidityCapacityAttestation(attestation)
  if (attestation.symbol !== request.symbol
      || attestation.attestation_hash !== execution.liquidity_capacity_attestation_hash
      || attestation.full_fill_capacity !== execution.full_fill_capacity) {
    fail("pending entry does not match its liquidity capacity attestation")
  }
  if (Date.parse(attestation.available_at) > Date.parse(request.order.signal_time)) {
    fail("liquidity capacity attestation was not available at signal time")
  }
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
  decisionTime = request.order.signal_time,
): ReplayDecisionInputSnapshot {
  const records = structuredClone(selectedRecords)
  records.forEach(assertReplaySupplementalFact)
  const body: ReplayDecisionInputSnapshotBody = {
    schema_version: REPLAY_DECISION_INPUT_SNAPSHOT_SCHEMA_VERSION,
    run_id: request.run_id,
    decision_time: decisionTime,
    supplemental_requirement_set_hash: request.supplemental_requirement_set_hash,
    visibility_policy: "signal_time_snapshot",
    selected_records: records,
    selected_records_hash: canonicalHash(records),
  }
  const snapshot = { ...body, snapshot_hash: canonicalHash(body) }
  assertReplayDecisionInputSnapshot(snapshot, request, decisionTime)
  return snapshot
}

export function assertReplayDecisionInputSnapshot(
  snapshot: ReplayDecisionInputSnapshot,
  request?: ReplayExecutionRequest,
  expectedDecisionTime?: string,
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
    || snapshot.decision_time !== (expectedDecisionTime ?? request.order.signal_time)
    || snapshot.supplemental_requirement_set_hash !== request.supplemental_requirement_set_hash
  )) fail("decision input snapshot does not match Replay request")
  if (request?.supplemental_requirement_set.mode === "none" && snapshot.selected_records.length !== 0) {
    fail("decision input snapshot without supplemental requirements must be empty")
  }
}

export function createReplayDecisionHarnessSourceBundle(input: {
  bundle_ref: string
  entrypoint: ReplayDecisionHarnessSourceBundle["entrypoint"]
  files: Array<{ path: string; content_utf8: string }>
}): ReplayDecisionHarnessSourceBundle {
  const files = [...input.files]
    .sort((left, right) => left.path < right.path ? -1 : left.path > right.path ? 1 : 0)
    .map((file) => ({
      path: file.path,
      content_utf8: file.content_utf8,
      sha256: createHash("sha256").update(file.content_utf8, "utf8").digest("hex"),
    }))
  const bundle = {
    schema_version: REPLAY_DECISION_HARNESS_SOURCE_BUNDLE_SCHEMA_VERSION,
    bundle_ref: input.bundle_ref,
    format: "utf8_source_set" as const,
    entrypoint: structuredClone(input.entrypoint),
    files,
    bundle_hash: "",
  }
  bundle.bundle_hash = replayDecisionHarnessBundleHash(bundle)
  assertReplayDecisionHarnessSourceBundle(bundle)
  return bundle
}

export function replayDecisionHarnessBundleHash(bundle: Omit<ReplayDecisionHarnessSourceBundle, "bundle_hash"> | ReplayDecisionHarnessSourceBundle): string {
  return canonicalHash({
    schema_version: bundle.schema_version,
    format: bundle.format,
    entrypoint: bundle.entrypoint,
    files: bundle.files,
  })
}

export function assertReplayDecisionHarnessSourceBundle(
  bundle: ReplayDecisionHarnessSourceBundle,
  request?: ReplayExecutionRequest,
): void {
  if (bundle.schema_version !== REPLAY_DECISION_HARNESS_SOURCE_BUNDLE_SCHEMA_VERSION
      || bundle.format !== "utf8_source_set") fail("unsupported Replay decision harness source bundle")
  requireText(bundle.bundle_ref, "decision_harness_bundle.bundle_ref")
  requireText(bundle.entrypoint.file_path, "decision_harness_bundle.entrypoint.file_path")
  const exportName = requireText(bundle.entrypoint.export_name, "decision_harness_bundle.entrypoint.export_name")
  if (!/^[A-Za-z_$][A-Za-z0-9_$]{0,127}$/.test(exportName)) fail("decision harness export_name is invalid")
  if (!Array.isArray(bundle.files) || bundle.files.length === 0) fail("decision harness bundle requires source files")
  let priorPath = ""
  for (const [index, file] of bundle.files.entries()) {
    const path = requireText(file.path, `decision_harness_bundle.files[${index}].path`)
    if (!/^[a-z0-9][a-z0-9._/-]*\.(?:cjs|js|mjs|ts)$/.test(path)
        || path.startsWith("/") || path.split("/").includes("..") || path <= priorPath) {
      fail("decision harness source paths must be unique, sorted, repo-relative ASCII paths")
    }
    priorPath = path
    if (typeof file.content_utf8 !== "string" || file.content_utf8.length === 0) {
      fail("decision harness source content must be non-empty UTF-8 text")
    }
    requireHash(file.sha256, `decision_harness_bundle.files[${index}].sha256`)
    if (createHash("sha256").update(file.content_utf8, "utf8").digest("hex") !== file.sha256) {
      fail("decision harness source file hash mismatch")
    }
  }
  if (!bundle.files.some((file) => file.path === bundle.entrypoint.file_path)) {
    fail("decision harness entrypoint file is not present in source bundle")
  }
  requireHash(bundle.bundle_hash, "decision_harness_bundle.bundle_hash")
  if (replayDecisionHarnessBundleHash(bundle) !== bundle.bundle_hash) fail("decision harness bundle hash mismatch")
  if (request && request.harness_hash !== bundle.bundle_hash) fail("decision harness bundle does not match Replay request")
}

export function createReplayDecisionHarnessBuildAttestation(input: {
  source_bundle: ReplayDecisionHarnessSourceBundle
  runtime_version: string
  runtime_executable_sha256: string
  artifact_content_utf8: string
}): ReplayDecisionHarnessBuildAttestation {
  assertReplayDecisionHarnessSourceBundle(input.source_bundle)
  const artifactHash = createHash("sha256").update(input.artifact_content_utf8, "utf8").digest("hex")
  const body: ReplayDecisionHarnessBuildAttestationBody = {
    schema_version: REPLAY_DECISION_HARNESS_BUILD_ATTESTATION_SCHEMA_VERSION,
    source_bundle_hash: input.source_bundle.bundle_hash,
    build_policy_version: REPLAY_DECISION_HARNESS_BUILD_POLICY_VERSION,
    worker_protocol_version: REPLAY_DECISION_HARNESS_WORKER_PROTOCOL_VERSION,
    dependency_policy: "metafile_exact_source_closure_no_external_imports",
    build_arguments: REPLAY_DECISION_HARNESS_BUILD_ARGUMENTS,
    runtime: {
      runtime_id: "bun",
      runtime_version: input.runtime_version,
      executable_sha256: input.runtime_executable_sha256,
    },
    artifact: {
      format: "bun_esm_bundle_utf8",
      content_utf8: input.artifact_content_utf8,
      sha256: artifactHash,
    },
  }
  const attestation = { ...body, attestation_hash: canonicalHash(body) }
  assertReplayDecisionHarnessBuildAttestation(attestation, input.source_bundle)
  return attestation
}

export function assertReplayDecisionHarnessBuildAttestation(
  attestation: ReplayDecisionHarnessBuildAttestation,
  sourceBundle?: ReplayDecisionHarnessSourceBundle,
): void {
  if (attestation.schema_version !== REPLAY_DECISION_HARNESS_BUILD_ATTESTATION_SCHEMA_VERSION
      || attestation.build_policy_version !== REPLAY_DECISION_HARNESS_BUILD_POLICY_VERSION
      || attestation.worker_protocol_version !== REPLAY_DECISION_HARNESS_WORKER_PROTOCOL_VERSION
      || attestation.dependency_policy !== "metafile_exact_source_closure_no_external_imports"
      || canonicalJson(attestation.build_arguments) !== canonicalJson(REPLAY_DECISION_HARNESS_BUILD_ARGUMENTS)
      || attestation.runtime.runtime_id !== "bun"
      || attestation.artifact.format !== "bun_esm_bundle_utf8") {
    fail("unsupported Replay decision harness build attestation")
  }
  requireHash(attestation.source_bundle_hash, "decision_harness_build.source_bundle_hash")
  requireText(attestation.runtime.runtime_version, "decision_harness_build.runtime.runtime_version")
  requireHash(attestation.runtime.executable_sha256, "decision_harness_build.runtime.executable_sha256")
  if (typeof attestation.artifact.content_utf8 !== "string" || attestation.artifact.content_utf8.length === 0) {
    fail("decision harness build artifact must be non-empty UTF-8 text")
  }
  requireHash(attestation.artifact.sha256, "decision_harness_build.artifact.sha256")
  if (createHash("sha256").update(attestation.artifact.content_utf8, "utf8").digest("hex") !== attestation.artifact.sha256) {
    fail("decision harness build artifact hash mismatch")
  }
  requireHash(attestation.attestation_hash, "decision_harness_build.attestation_hash")
  const { attestation_hash: _attestationHash, ...body } = attestation
  if (canonicalHash(body) !== attestation.attestation_hash) fail("decision harness build attestation hash mismatch")
  if (sourceBundle && attestation.source_bundle_hash !== sourceBundle.bundle_hash) {
    fail("decision harness build attestation does not match source bundle")
  }
}

export function assertReplayDecisionHarnessWorkerRequest(
  workerRequest: ReplayDecisionHarnessWorkerRequest,
  request?: ReplayExecutionRequest,
  snapshot?: ReplayDecisionInputSnapshot,
  marketSnapshot?: ReplayDecisionMarketInputSnapshot,
  buildAttestation?: ReplayDecisionHarnessBuildAttestation,
  stateSnapshot?: ReplayDecisionStateSnapshot | null,
): void {
  if (workerRequest.schema_version !== REPLAY_DECISION_HARNESS_WORKER_REQUEST_SCHEMA_VERSION) {
    fail("unsupported Replay decision harness worker request")
  }
  requireHash(workerRequest.invocation_id, "decision_harness_worker_request.invocation_id")
  requireHash(workerRequest.source_bundle_hash, "decision_harness_worker_request.source_bundle_hash")
  requireHash(workerRequest.artifact_hash, "decision_harness_worker_request.artifact_hash")
  const scheduleEntry = request
    ? replayDecisionScheduleEntryAt(request, workerRequest.decision_input_snapshot.decision_time)
    : undefined
  if (request && canonicalJson(workerRequest.request_context) !== canonicalJson(createReplayDecisionHarnessContext(request, scheduleEntry))) {
    fail("decision harness worker context does not match Replay request")
  }
  if (snapshot && canonicalJson(workerRequest.decision_input_snapshot) !== canonicalJson(snapshot)) {
    fail("decision harness worker request does not match decision input snapshot")
  }
  if (marketSnapshot && canonicalJson(workerRequest.decision_market_input_snapshot) !== canonicalJson(marketSnapshot)) {
    fail("decision harness worker request does not match decision market input snapshot")
  }
  if (stateSnapshot !== undefined && canonicalJson(workerRequest.decision_state_snapshot) !== canonicalJson(stateSnapshot)) {
    fail("decision harness worker request does not match decision state snapshot")
  }
  if (request && scheduleEntry) {
    const phase = replayDecisionPhaseFor(request, scheduleEntry)
    if (phase === "position_open") {
      if (!workerRequest.decision_state_snapshot) fail("position-open decision requires a state snapshot")
      assertReplayDecisionStateSnapshot(workerRequest.decision_state_snapshot, request, scheduleEntry)
    } else if (workerRequest.decision_state_snapshot !== null) {
      fail("pre-entry decision cannot consume a position state snapshot")
    }
  }
  if (buildAttestation && (
    workerRequest.source_bundle_hash !== buildAttestation.source_bundle_hash
    || workerRequest.artifact_hash !== buildAttestation.artifact.sha256
  )) fail("decision harness worker request does not match build attestation")
}

export function assertReplayDecisionHarnessWorkerResponse(
  workerResponse: ReplayDecisionHarnessWorkerResponse,
  workerRequest?: ReplayDecisionHarnessWorkerRequest,
): void {
  if (workerResponse.schema_version !== REPLAY_DECISION_HARNESS_WORKER_RESPONSE_SCHEMA_VERSION) {
    fail("unsupported Replay decision harness worker response")
  }
  requireHash(workerResponse.invocation_id, "decision_harness_worker_response.invocation_id")
  requireHash(workerResponse.source_bundle_hash, "decision_harness_worker_response.source_bundle_hash")
  requireHash(workerResponse.artifact_hash, "decision_harness_worker_response.artifact_hash")
  assertReplayDecisionOutput(workerResponse.decision_output)
  if (workerRequest && (
    workerResponse.invocation_id !== workerRequest.invocation_id
    || workerResponse.source_bundle_hash !== workerRequest.source_bundle_hash
    || workerResponse.artifact_hash !== workerRequest.artifact_hash
  )) fail("decision harness worker response does not match worker request")
}

export function assertReplayDecisionOutput(decisionOutput: ReplayDecisionOutput): void {
  if (!decisionOutput || typeof decisionOutput !== "object") {
    fail("decision harness worker response requires a decision output")
  }
  if (decisionOutput.action === "submit_initial_order") {
    requirePositive(decisionOutput.order.quantity, "decision_harness_worker_response.decision_output.order.quantity")
  } else if (decisionOutput.action === "cancel_entry_order") {
    assertReplayEntryCancelIntent(decisionOutput.order)
  } else if (decisionOutput.action === "submit_partial_reduce") {
    const partial = decisionOutput.order
    if (partial.schema_version !== REPLAY_PARTIAL_REDUCE_INTENT_SCHEMA_VERSION
        || !["buy", "sell"].includes(partial.side) || partial.order_type !== "market"
        || partial.reduce_only !== true || partial.quantity_policy !== "fixed_quantity"
        || partial.post_fill_position_policy !== "must_remain_open"
        || partial.protection_resize_policy !== "after_fill_cancel_both_then_replace_remaining_at_same_source_boundary"
        || partial.protection_policy_version !== REPLAY_PARTIAL_REDUCE_PROTECTION_POLICY_VERSION
        || partial.replacement_trigger_policy !== "preserve_current_stop_and_target_prices"
        || partial.remaining_quantity_authority !== "absolute_post_fill_position"
        || !["one_partial_reduce_then_optional_final_full_exit_no_stop_replace",
          "up_to_two_partial_reduces_then_optional_final_full_exit_no_other_mutation",
          "one_partial_reduce_then_one_tighten_only_stop_replace_then_optional_final_full_exit",
          "up_to_two_partial_reduces_then_one_tighten_only_stop_replace_then_optional_final_full_exit",
        ].includes(partial.schedule_combination_policy)) {
      fail("unsupported partial-reduce decision output")
    }
    requirePositive(partial.quantity, "decision_harness_worker_response.decision_output.order.quantity")
    requireUtcTimestamp(partial.signal_time, "decision_harness_worker_response.decision_output.order.signal_time")
    requireUtcTimestamp(partial.earliest_executable_time, "decision_harness_worker_response.decision_output.order.earliest_executable_time")
    if (Date.parse(partial.earliest_executable_time) <= Date.parse(partial.signal_time)) {
      fail("partial-reduce decision output must execute after its signal")
    }
  } else if (decisionOutput.action === "submit_reduce_only_exit") {
    const exit = decisionOutput.order
    if (exit.schema_version !== REPLAY_REDUCE_ONLY_EXIT_INTENT_SCHEMA_VERSION
        || !["buy", "sell"].includes(exit.side) || exit.order_type !== "market"
        || exit.reduce_only !== true || exit.quantity_policy !== "full_open_position") {
      fail("unsupported reduce-only exit decision output")
    }
    requireUtcTimestamp(exit.signal_time, "decision_harness_worker_response.decision_output.order.signal_time")
    requireUtcTimestamp(exit.earliest_executable_time, "decision_harness_worker_response.decision_output.order.earliest_executable_time")
    if (Date.parse(exit.earliest_executable_time) <= Date.parse(exit.signal_time)) {
      fail("reduce-only exit decision output must execute after its signal")
    }
  } else if (decisionOutput.action === "cancel_strategy_exit") {
    const cancel = decisionOutput.order
    if (cancel.schema_version !== REPLAY_STRATEGY_EXIT_CANCEL_INTENT_SCHEMA_VERSION
        || cancel.target_order_role !== "strategy_exit"
        || !Number.isSafeInteger(cancel.target_exit_decision_sequence)
        || cancel.target_exit_decision_sequence <= 0
        || cancel.cancel_policy !== "cancel_submitted_before_earliest_executable_time"
        || cancel.reason_code !== "strategy_exit_condition_revoked") {
      fail("unsupported strategy-exit cancel decision output")
    }
    requireUtcTimestamp(cancel.effective_at, "decision_harness_worker_response.decision_output.order.effective_at")
  } else if (decisionOutput.action === "cancel_take_profit") {
    const cancel = decisionOutput.order
    if (cancel.schema_version !== REPLAY_TAKE_PROFIT_CANCEL_INTENT_SCHEMA_VERSION
        || cancel.target_order_role !== "target" || cancel.target_order_type !== "take_profit_market"
        || cancel.cancel_policy !== "cancel_active_target_preserve_stop"
        || cancel.stop_preservation_policy !== "require_active_full_position_stop"
        || cancel.schedule_combination_policy !== "initial_bracket_only_no_other_position_mutation"
        || cancel.reason_code !== "take_profit_condition_revoked") {
      fail("unsupported take-profit cancel decision output")
    }
    requireText(cancel.target_order_id, "decision_harness_worker_response.decision_output.order.target_order_id")
    requireUtcTimestamp(cancel.effective_at, "decision_harness_worker_response.decision_output.order.effective_at")
  } else if (decisionOutput.action === "cancel_protective_stop") {
    const cancel = decisionOutput.order
    if (cancel.schema_version !== REPLAY_PROTECTIVE_STOP_CANCEL_INTENT_SCHEMA_VERSION
        || cancel.target_order_role !== "stop" || cancel.target_order_type !== "stop_market"
        || cancel.cancel_policy !== "cancel_active_stop_preserve_target"
        || cancel.target_preservation_policy !== "require_active_full_position_target"
        || cancel.schedule_combination_policy !== "initial_bracket_only_no_other_position_mutation"
        || cancel.reason_code !== "protective_stop_condition_revoked") {
      fail("unsupported protective-stop cancel decision output")
    }
    requireText(cancel.target_order_id, "decision_harness_worker_response.decision_output.order.target_order_id")
    requireUtcTimestamp(cancel.effective_at, "decision_harness_worker_response.decision_output.order.effective_at")
  } else if (decisionOutput.action === "replace_protective_stop") {
    const replace = decisionOutput.order
    if (replace.schema_version !== REPLAY_PROTECTIVE_STOP_REPLACE_INTENT_SCHEMA_VERSION
        || !["buy", "sell"].includes(replace.side) || replace.order_type !== "stop_market"
        || replace.reduce_only !== true || replace.quantity_policy !== "full_open_position"
        || replace.replace_policy !== "tighten_only_cancel_then_submit"
        || ![undefined, "initial_bracket_then_optional_full_exit_no_other_position_mutation",
          "after_final_partial_then_optional_full_exit_no_other_position_mutation",
        ].includes(replace.schedule_combination_policy)
        || !Number.isFinite(replace.previous_stop_price) || replace.previous_stop_price <= 0
        || !Number.isFinite(replace.new_stop_price) || replace.new_stop_price <= 0) {
      fail("unsupported protective stop replacement decision output")
    }
    requireUtcTimestamp(replace.signal_time, "decision_harness_worker_response.decision_output.order.signal_time")
  } else if (decisionOutput.action === "replace_take_profit") {
    const replace = decisionOutput.order
    if (replace.schema_version !== REPLAY_TAKE_PROFIT_REPLACE_INTENT_SCHEMA_VERSION
        || !["buy", "sell"].includes(replace.side) || replace.order_type !== "take_profit_market"
        || replace.reduce_only !== true || replace.quantity_policy !== "full_open_position"
        || replace.replace_policy !== "cancel_then_submit_not_already_triggered"
        || replace.stop_preservation_policy !== "require_active_full_position_stop"
        || replace.schedule_combination_policy !== "initial_bracket_only_no_other_position_mutation"
        || replace.reason_code !== "take_profit_repriced"
        || !Number.isFinite(replace.previous_target_price) || replace.previous_target_price <= 0
        || !Number.isFinite(replace.new_target_price) || replace.new_target_price <= 0
        || replace.new_target_price === replace.previous_target_price) {
      fail("unsupported take-profit replacement decision output")
    }
    requireText(replace.target_order_id, "decision_harness_worker_response.decision_output.order.target_order_id")
    requireUtcTimestamp(replace.signal_time, "decision_harness_worker_response.decision_output.order.signal_time")
  } else if (decisionOutput.action !== "no_action") {
    fail("unsupported decision harness output action")
  }
}

export function assertReplayDecisionHarnessRegistryCapability(
  capability: ReplayDecisionHarnessRegistryCapability,
): void {
  if (canonicalJson(capability) !== canonicalJson(REPLAY_DECISION_HARNESS_REGISTRY_CAPABILITY)) {
    fail("Replay decision harness registry capability is not certified")
  }
}

export function assertReplayDecisionHarnessCapability(
  capability: ReplayDecisionHarnessCapability,
  request?: ReplayExecutionRequest,
): void {
  if (capability.schema_version !== REPLAY_DECISION_HARNESS_CAPABILITY_SCHEMA_VERSION
      || capability.execution_policy !== "fresh_subprocess_stdio_reproducibility_pair"
      || capability.context_schema_version !== REPLAY_DECISION_HARNESS_CONTEXT_SCHEMA_VERSION
      || capability.supplemental_input_schema_version !== REPLAY_DECISION_INPUT_SNAPSHOT_SCHEMA_VERSION
      || capability.market_input_schema_version !== REPLAY_DECISION_MARKET_INPUT_SNAPSHOT_SCHEMA_VERSION
      || capability.state_input_schema_version !== REPLAY_DECISION_STATE_SNAPSHOT_SCHEMA_VERSION
      || capability.output_schema_version !== REPLAY_DECISION_HARNESS_RECEIPT_SCHEMA_VERSION) {
    fail("unsupported Replay decision harness capability")
  }
  requireHash(capability.harness_hash, "decision_harness_capability.harness_hash")
  requireText(capability.source_bundle_ref, "decision_harness_capability.source_bundle_ref")
  requireHash(capability.source_bundle_hash, "decision_harness_capability.source_bundle_hash")
  requireHash(capability.build_attestation_hash, "decision_harness_capability.build_attestation_hash")
  requireHash(capability.build_artifact_hash, "decision_harness_capability.build_artifact_hash")
  requireHash(capability.runtime_executable_hash, "decision_harness_capability.runtime_executable_hash")
  if (capability.harness_hash !== capability.source_bundle_hash
      || capability.registry_policy_version !== REPLAY_DECISION_HARNESS_REGISTRY_POLICY_VERSION
      || capability.build_policy_version !== REPLAY_DECISION_HARNESS_BUILD_POLICY_VERSION
      || capability.loader_policy_version !== REPLAY_DECISION_HARNESS_LOADER_POLICY_VERSION
      || capability.worker_protocol_version !== REPLAY_DECISION_HARNESS_WORKER_PROTOCOL_VERSION) {
    fail("decision harness capability source/build/runtime binding is invalid")
  }
  if (request && capability.harness_hash !== request.harness_hash) {
    fail("decision harness capability hash does not match Replay request")
  }
}

export function createReplayDecisionHarnessReceipt(input: {
  request: ReplayExecutionRequest
  decision_input_snapshot: ReplayDecisionInputSnapshot
  decision_market_input_snapshot: ReplayDecisionMarketInputSnapshot
  decision_state_snapshot: ReplayDecisionStateSnapshot | null
  source_bundle: ReplayDecisionHarnessSourceBundle
  build_attestation: ReplayDecisionHarnessBuildAttestation
  capability: ReplayDecisionHarnessCapability
  worker_request: ReplayDecisionHarnessWorkerRequest
  worker_response: ReplayDecisionHarnessWorkerResponse
  worker_verification_response: ReplayDecisionHarnessWorkerResponse
  decision_output: ReplayDecisionOutput
  trace: ReplaySupplementalValue
}): ReplayDecisionHarnessReceipt {
  const scheduleEntry = replayDecisionScheduleEntryAt(input.request, input.decision_input_snapshot.decision_time)
  assertReplayDecisionInputSnapshot(input.decision_input_snapshot, input.request, scheduleEntry.decision_time)
  assertReplayDecisionMarketInputSnapshot(input.decision_market_input_snapshot, input.request, scheduleEntry.decision_time)
  assertReplayDecisionHarnessSourceBundle(input.source_bundle, input.request)
  assertReplayDecisionHarnessBuildAttestation(input.build_attestation, input.source_bundle)
  assertReplayDecisionHarnessCapability(input.capability, input.request)
  assertReplayDecisionHarnessWorkerRequest(
    input.worker_request, input.request, input.decision_input_snapshot, input.decision_market_input_snapshot,
    input.build_attestation, input.decision_state_snapshot,
  )
  assertReplayDecisionHarnessWorkerResponse(input.worker_response, input.worker_request)
  assertReplayDecisionHarnessWorkerResponse(input.worker_verification_response, input.worker_request)
  if (canonicalJson(input.worker_response) !== canonicalJson(input.worker_verification_response)) {
    fail("decision harness worker reproducibility parity failed")
  }
  if (canonicalJson(input.worker_response.decision_output) !== canonicalJson(input.decision_output)
      || canonicalJson(input.worker_response.trace) !== canonicalJson(input.trace)) {
    fail("decision harness receipt output does not match worker response")
  }
  if (input.capability.source_bundle_ref !== input.source_bundle.bundle_ref
      || input.capability.source_bundle_hash !== input.source_bundle.bundle_hash
      || input.capability.build_attestation_hash !== input.build_attestation.attestation_hash
      || input.capability.build_artifact_hash !== input.build_attestation.artifact.sha256
      || input.capability.runtime_executable_hash !== input.build_attestation.runtime.executable_sha256) {
    fail("decision harness capability does not match source/build evidence")
  }
  const trace = structuredClone(input.trace)
  const body: ReplayDecisionHarnessReceiptBody = {
    schema_version: REPLAY_DECISION_HARNESS_RECEIPT_SCHEMA_VERSION,
    run_id: input.request.run_id,
    harness_hash: input.request.harness_hash,
    source_bundle_ref: input.source_bundle.bundle_ref,
    source_bundle_hash: input.source_bundle.bundle_hash,
    build_attestation_hash: input.build_attestation.attestation_hash,
    build_artifact_hash: input.build_attestation.artifact.sha256,
    runtime_executable_hash: input.build_attestation.runtime.executable_sha256,
    registry_policy_version: input.capability.registry_policy_version,
    build_policy_version: input.capability.build_policy_version,
    loader_policy_version: input.capability.loader_policy_version,
    worker_protocol_version: input.capability.worker_protocol_version,
    execution_policy: "fresh_subprocess_stdio_reproducibility_pair",
    decision_input_snapshot_hash: input.decision_input_snapshot.snapshot_hash,
    decision_market_input_snapshot_hash: input.decision_market_input_snapshot.snapshot_hash,
    decision_state_snapshot_hash: input.decision_state_snapshot?.snapshot_hash ?? null,
    request_context_hash: canonicalHash(createReplayDecisionHarnessContext(input.request, scheduleEntry)),
    worker_request_hash: canonicalHash(input.worker_request),
    worker_response_hash: canonicalHash(input.worker_response),
    worker_verification_response_hash: canonicalHash(input.worker_verification_response),
    decision_output: structuredClone(input.decision_output),
    trace,
    trace_hash: canonicalHash(trace),
  }
  const receipt = { ...body, receipt_hash: canonicalHash(body) }
  assertReplayDecisionHarnessReceipt(
    receipt, input.request, input.decision_input_snapshot, input.decision_market_input_snapshot,
    input.source_bundle, input.build_attestation, input.decision_state_snapshot,
  )
  return receipt
}

export function assertReplayDecisionHarnessReceipt(
  receipt: ReplayDecisionHarnessReceipt,
  request?: ReplayExecutionRequest,
  snapshot?: ReplayDecisionInputSnapshot,
  marketSnapshot?: ReplayDecisionMarketInputSnapshot,
  sourceBundle?: ReplayDecisionHarnessSourceBundle,
  buildAttestation?: ReplayDecisionHarnessBuildAttestation,
  stateSnapshot?: ReplayDecisionStateSnapshot | null,
): void {
  const legacy = receipt.schema_version === REPLAY_DECISION_HARNESS_RECEIPT_SCHEMA_VERSION
    && receipt.execution_policy === "fresh_subprocess_stdio_reproducibility_pair"
    && receipt.worker_protocol_version === REPLAY_DECISION_HARNESS_WORKER_PROTOCOL_VERSION
  const cutover = receipt.schema_version === REPLAY_DECISION_HARNESS_CUTOVER_RECEIPT_SCHEMA_VERSION
    && receipt.execution_policy === "two_fresh_authority_subprocesses_exact_schedule_cutover"
    && receipt.worker_protocol_version === REPLAY_DECISION_HARNESS_CUTOVER_WORKER_PROTOCOL_VERSION
  if (!legacy && !cutover) {
    fail("unsupported Replay decision harness receipt")
  }
  requireText(receipt.run_id, "decision_harness_receipt.run_id")
  requireHash(receipt.harness_hash, "decision_harness_receipt.harness_hash")
  requireText(receipt.source_bundle_ref, "decision_harness_receipt.source_bundle_ref")
  requireHash(receipt.source_bundle_hash, "decision_harness_receipt.source_bundle_hash")
  requireHash(receipt.build_attestation_hash, "decision_harness_receipt.build_attestation_hash")
  requireHash(receipt.build_artifact_hash, "decision_harness_receipt.build_artifact_hash")
  requireHash(receipt.runtime_executable_hash, "decision_harness_receipt.runtime_executable_hash")
  if (receipt.registry_policy_version !== REPLAY_DECISION_HARNESS_REGISTRY_POLICY_VERSION
      || receipt.build_policy_version !== REPLAY_DECISION_HARNESS_BUILD_POLICY_VERSION
      || receipt.loader_policy_version !== REPLAY_DECISION_HARNESS_LOADER_POLICY_VERSION
      || receipt.harness_hash !== receipt.source_bundle_hash) {
    fail("decision harness receipt source/build/runtime binding is invalid")
  }
  requireHash(receipt.decision_input_snapshot_hash, "decision_harness_receipt.decision_input_snapshot_hash")
  requireHash(receipt.decision_market_input_snapshot_hash, "decision_harness_receipt.decision_market_input_snapshot_hash")
  if (receipt.decision_state_snapshot_hash !== null) {
    requireHash(receipt.decision_state_snapshot_hash, "decision_harness_receipt.decision_state_snapshot_hash")
  }
  requireHash(receipt.request_context_hash, "decision_harness_receipt.request_context_hash")
  requireHash(receipt.worker_request_hash, "decision_harness_receipt.worker_request_hash")
  requireHash(receipt.worker_response_hash, "decision_harness_receipt.worker_response_hash")
  requireHash(receipt.worker_verification_response_hash, "decision_harness_receipt.worker_verification_response_hash")
  requireHash(receipt.trace_hash, "decision_harness_receipt.trace_hash")
  requireHash(receipt.receipt_hash, "decision_harness_receipt.receipt_hash")
  if (canonicalHash(receipt.trace) !== receipt.trace_hash) fail("decision harness trace hash mismatch")
  const { receipt_hash: _receiptHash, ...body } = receipt
  if (canonicalHash(body) !== receipt.receipt_hash) fail("decision harness receipt hash mismatch")
  if (request) {
    const decisionTime = snapshot?.decision_time ?? marketSnapshot?.decision_time ?? request.order.signal_time
    const scheduleEntry = replayDecisionScheduleEntryAt(request, decisionTime)
    if (receipt.run_id !== request.run_id
        || receipt.harness_hash !== request.harness_hash
        || receipt.request_context_hash !== canonicalHash(createReplayDecisionHarnessContext(request, scheduleEntry))
        || canonicalJson(receipt.decision_output) !== canonicalJson(replayDecisionOutputFor(request, scheduleEntry))) {
      fail("decision harness receipt does not match Replay request schedule")
    }
  }
  if (snapshot && receipt.decision_input_snapshot_hash !== snapshot.snapshot_hash) {
    fail("decision harness receipt does not match decision input snapshot")
  }
  if (marketSnapshot && receipt.decision_market_input_snapshot_hash !== marketSnapshot.snapshot_hash) {
    fail("decision harness receipt does not match decision market input snapshot")
  }
  if (stateSnapshot !== undefined
      && receipt.decision_state_snapshot_hash !== (stateSnapshot?.snapshot_hash ?? null)) {
    fail("decision harness receipt does not match decision state snapshot")
  }
  if (sourceBundle && (
    receipt.source_bundle_ref !== sourceBundle.bundle_ref
    || receipt.source_bundle_hash !== sourceBundle.bundle_hash
  )) fail("decision harness receipt does not match source bundle")
  if (buildAttestation && (
    receipt.build_attestation_hash !== buildAttestation.attestation_hash
    || receipt.build_artifact_hash !== buildAttestation.artifact.sha256
    || receipt.runtime_executable_hash !== buildAttestation.runtime.executable_sha256
  )) fail("decision harness receipt does not match build attestation")
}

export function createReplayDecisionBoundary(
  request: ReplayExecutionRequest,
  marketSnapshot: ReplayDecisionMarketInputSnapshot,
  scheduleEntry: ReplayDecisionScheduleEntry = replayDecisionScheduleEntryAt(request, marketSnapshot.decision_time),
): ReplayDecisionBoundary {
  const attestedHarness = request.supplemental_requirement_set.mode === "signal_time_complete"
    || request.decision_market_input_requirement.mode === "closed_bar_lookback"
  const body: ReplayDecisionBoundaryBody = {
    schema_version: REPLAY_DECISION_BOUNDARY_SCHEMA_VERSION,
    boundary_sequence: scheduleEntry.decision_sequence,
    boundary_kind: "frozen_decision_schedule_entry",
    decision_origin: attestedHarness ? "attested_harness_verified_schedule_effect" : "frozen_request_order",
    evaluation_time: scheduleEntry.decision_time,
    market_data_cutoff: scheduleEntry.decision_time,
    supplemental_data_cutoff: scheduleEntry.decision_time,
    earliest_executable_time: replayDecisionEarliestExecutableTimeFor(request, scheduleEntry),
    signal_visibility: request.simulator_policy.signal_visibility,
    supplemental_visibility: "signal_time_snapshot",
    execution_policy: request.simulator_policy.earliest_execution,
    order_transition_policy: replayDecisionOrderTransitionPolicyFor(scheduleEntry),
    market_input_evidence: request.decision_market_input_requirement.mode === "closed_bar_lookback"
      ? "materialized_closed_bar_lookback"
      : "not_required_compatibility",
    market_input_snapshot_hash: marketSnapshot.snapshot_hash,
  }
  const boundary = { ...body, boundary_hash: canonicalHash(body) }
  assertReplayDecisionBoundary(boundary, request, marketSnapshot, scheduleEntry)
  return boundary
}

export function assertReplayDecisionBoundary(
  boundary: ReplayDecisionBoundary,
  request: ReplayExecutionRequest,
  marketSnapshot?: ReplayDecisionMarketInputSnapshot,
  scheduleEntry: ReplayDecisionScheduleEntry = replayDecisionScheduleEntryAt(request, boundary.evaluation_time),
): void {
  const attestedHarness = request.supplemental_requirement_set.mode === "signal_time_complete"
    || request.decision_market_input_requirement.mode === "closed_bar_lookback"
  if (boundary.schema_version !== REPLAY_DECISION_BOUNDARY_SCHEMA_VERSION
      || boundary.boundary_sequence !== scheduleEntry.decision_sequence
      || boundary.boundary_kind !== "frozen_decision_schedule_entry"
      || boundary.decision_origin !== (attestedHarness ? "attested_harness_verified_schedule_effect" : "frozen_request_order")
      || boundary.evaluation_time !== scheduleEntry.decision_time
      || boundary.market_data_cutoff !== scheduleEntry.decision_time
      || boundary.supplemental_data_cutoff !== scheduleEntry.decision_time
      || boundary.earliest_executable_time !== replayDecisionEarliestExecutableTimeFor(request, scheduleEntry)
      || boundary.signal_visibility !== request.simulator_policy.signal_visibility
      || boundary.supplemental_visibility !== "signal_time_snapshot"
      || boundary.execution_policy !== request.simulator_policy.earliest_execution
      || boundary.order_transition_policy !== replayDecisionOrderTransitionPolicyFor(scheduleEntry)
      || boundary.market_input_evidence !== (request.decision_market_input_requirement.mode === "closed_bar_lookback"
        ? "materialized_closed_bar_lookback" : "not_required_compatibility")) {
    fail("decision boundary does not match the certified decision-input protocol")
  }
  requireHash(boundary.market_input_snapshot_hash, "decision_boundary.market_input_snapshot_hash")
  if (marketSnapshot && boundary.market_input_snapshot_hash !== marketSnapshot.snapshot_hash) {
    fail("decision boundary does not match decision market input snapshot")
  }
  requireHash(boundary.boundary_hash, "decision_boundary.boundary_hash")
  const { boundary_hash: _boundaryHash, ...body } = boundary
  if (canonicalHash(body) !== boundary.boundary_hash) fail("decision boundary hash mismatch")
}

export interface ReplayDecisionEvidenceInput {
  schedule_entry: ReplayDecisionScheduleEntry
  decision_input_snapshot: ReplayDecisionInputSnapshot
  decision_market_input_snapshot: ReplayDecisionMarketInputSnapshot
  evaluation_status?: ReplayDecisionEvidenceEntry["evaluation_status"]
  decision_state_snapshot?: ReplayDecisionStateSnapshot | null
  decision_harness_bundle?: ReplayDecisionHarnessSourceBundle | null
  decision_harness_build?: ReplayDecisionHarnessBuildAttestation | null
  decision_harness_receipt?: ReplayDecisionHarnessReceipt | null
  terminal_event_key?: ReplayEventKey | null
}

function replayDecisionKindFor(entry: ReplayDecisionScheduleEntry): ReplayDecisionEvidenceEntry["decision_kind"] {
  if (entry.expected_effect === "authorized_initial_order") return "initial_order"
  if (entry.expected_effect === "authorized_entry_cancel") return "entry_cancel"
  if (entry.expected_effect === "authorized_protective_stop_replace") return "protective_stop_replace"
  if (entry.expected_effect === "authorized_take_profit_replace") return "take_profit_replace"
  if (entry.expected_effect === "authorized_partial_reduce") return "partial_reduce"
  if (entry.expected_effect === "authorized_reduce_only_exit") return "reduce_only_exit"
  if (entry.expected_effect === "authorized_strategy_exit_cancel") return "strategy_exit_cancel"
  if (entry.expected_effect === "authorized_take_profit_cancel") return "take_profit_cancel"
  if (entry.expected_effect === "authorized_protective_stop_cancel") return "protective_stop_cancel"
  return "scheduled_evaluation"
}

function replayDecisionExecutionEffectFor(
  entry: ReplayDecisionScheduleEntry,
): Exclude<ReplayDecisionEvidenceEntry["execution_effect"], "not_reached"> {
  if (entry.expected_effect === "authorized_initial_order") return "authorized_order"
  if (entry.expected_effect === "authorized_entry_cancel") return "authorized_entry_cancel"
  if (entry.expected_effect === "authorized_protective_stop_replace") return "authorized_protective_stop_replace"
  if (entry.expected_effect === "authorized_take_profit_replace") return "authorized_take_profit_replace"
  if (entry.expected_effect === "authorized_partial_reduce") return "authorized_partial_reduce"
  if (entry.expected_effect === "authorized_reduce_only_exit") return "authorized_reduce_only_exit"
  if (entry.expected_effect === "authorized_strategy_exit_cancel") return "authorized_strategy_exit_cancel"
  if (entry.expected_effect === "authorized_take_profit_cancel") return "authorized_take_profit_cancel"
  if (entry.expected_effect === "authorized_protective_stop_cancel") return "authorized_protective_stop_cancel"
  return "no_action"
}

export function createReplayDecisionEvidenceTimeline(input: {
  request: ReplayExecutionRequest
  decisions: ReplayDecisionEvidenceInput[]
}): ReplayDecisionEvidenceTimeline {
  const entries = input.decisions.map((decision): ReplayDecisionEvidenceEntry => {
    const scheduleEntry = decision.schedule_entry
    const evaluationStatus = decision.evaluation_status ?? "evaluated"
    const decisionOutput = replayDecisionOutputFor(input.request, scheduleEntry)
    const evaluated = evaluationStatus === "evaluated"
    const entryBody: ReplayDecisionEvidenceEntryBody = {
      decision_sequence: scheduleEntry.decision_sequence,
      decision_time: scheduleEntry.decision_time,
      decision_kind: replayDecisionKindFor(scheduleEntry),
      evaluation_status: evaluationStatus,
      execution_effect: evaluationStatus === "not_reached_terminal"
        ? "not_reached"
        : replayDecisionExecutionEffectFor(scheduleEntry),
      evidence_mode: evaluationStatus === "pending_runtime" || evaluationStatus === "not_reached_terminal"
        ? evaluationStatus
        : input.request.supplemental_requirement_set.mode === "signal_time_complete"
          || input.request.decision_market_input_requirement.mode === "closed_bar_lookback"
          ? "attested_harness"
          : "precomputed_order_compatibility",
      authorized_order_hash: scheduleEntry.authorized_order_hash,
      decision_output_hash: evaluated ? canonicalHash(decisionOutput) : null,
      decision_boundary: createReplayDecisionBoundary(input.request, decision.decision_market_input_snapshot, scheduleEntry),
      decision_input_snapshot: structuredClone(decision.decision_input_snapshot),
      decision_market_input_snapshot: structuredClone(decision.decision_market_input_snapshot),
      decision_state_snapshot: structuredClone(decision.decision_state_snapshot ?? null),
      decision_harness_bundle: structuredClone(evaluated ? decision.decision_harness_bundle ?? null : null),
      decision_harness_build: structuredClone(evaluated ? decision.decision_harness_build ?? null : null),
      decision_harness_receipt: structuredClone(evaluated ? decision.decision_harness_receipt ?? null : null),
      terminal_event_key: structuredClone(evaluationStatus === "not_reached_terminal"
        ? decision.terminal_event_key ?? null : null),
    }
    return { ...entryBody, entry_hash: canonicalHash(entryBody) }
  })
  const body: ReplayDecisionEvidenceTimelineBody = {
    schema_version: REPLAY_DECISION_EVIDENCE_TIMELINE_SCHEMA_VERSION,
    run_id: input.request.run_id,
    ordering_policy: "decision_time_then_sequence",
    cardinality_policy: "frozen_decision_schedule",
    entries,
  }
  const timeline = { ...body, timeline_hash: canonicalHash(body) }
  assertReplayDecisionEvidenceTimeline(timeline, input.request, {
    allow_pending_runtime: entries.some((entry) => entry.evaluation_status === "pending_runtime"),
  })
  return timeline
}

export function assertReplayDecisionEvidenceTimeline(
  timeline: ReplayDecisionEvidenceTimeline,
  request: ReplayExecutionRequest,
  options: { allow_pending_runtime?: boolean; source_events?: ReplaySourceEvent[] } = {},
): void {
  if (timeline.schema_version !== REPLAY_DECISION_EVIDENCE_TIMELINE_SCHEMA_VERSION
      || timeline.ordering_policy !== "decision_time_then_sequence"
      || timeline.cardinality_policy !== "frozen_decision_schedule") {
    fail("unsupported Replay decision evidence timeline")
  }
  if (timeline.run_id !== request.run_id) fail("decision evidence timeline does not match Replay request")
  if (timeline.entries.length !== request.decision_schedule.entries.length) {
    fail("decision evidence timeline cardinality does not match frozen schedule")
  }
  const expectsAttestedHarness = request.supplemental_requirement_set.mode === "signal_time_complete"
    || request.decision_market_input_requirement.mode === "closed_bar_lookback"
  for (const [index, entry] of timeline.entries.entries()) {
    const scheduleEntry = request.decision_schedule.entries[index]!
    const expectedOutput = replayDecisionOutputFor(request, scheduleEntry)
    const expectedExecutionEffect = replayDecisionExecutionEffectFor(scheduleEntry)
    const phase = replayDecisionPhaseFor(request, scheduleEntry)
    if (entry.decision_sequence !== scheduleEntry.decision_sequence
        || entry.decision_time !== scheduleEntry.decision_time
        || entry.decision_kind !== replayDecisionKindFor(scheduleEntry)
        || entry.authorized_order_hash !== scheduleEntry.authorized_order_hash) {
      fail("decision evidence entry does not match frozen schedule authority")
    }
    if (entry.evaluation_status === "pending_runtime") {
      if (!options.allow_pending_runtime || (phase !== "position_open" && phase !== "pending_entry")
          || entry.execution_effect !== expectedExecutionEffect || entry.evidence_mode !== "pending_runtime"
          || entry.decision_output_hash !== null || entry.decision_state_snapshot !== null
          || entry.decision_harness_bundle || entry.decision_harness_build || entry.decision_harness_receipt
          || entry.terminal_event_key !== null) {
        fail("invalid pending runtime decision evidence")
      }
    } else if (entry.evaluation_status === "not_reached_terminal") {
      if ((phase !== "position_open" && phase !== "pending_entry") || entry.execution_effect !== "not_reached"
          || entry.evidence_mode !== "not_reached_terminal" || entry.decision_output_hash !== null
          || entry.decision_state_snapshot !== null || entry.decision_harness_bundle
          || entry.decision_harness_build || entry.decision_harness_receipt || !entry.terminal_event_key) {
        fail("invalid terminal-not-reached decision evidence")
      }
      assertReplayEventKey(entry.terminal_event_key)
      if (Date.parse(entry.terminal_event_key.event_time) > Date.parse(entry.decision_time)) {
        fail("terminal-not-reached evidence must precede or equal the decision time")
      }
    } else if (entry.evaluation_status !== "evaluated"
        || entry.execution_effect !== expectedExecutionEffect
        || entry.decision_output_hash !== canonicalHash(expectedOutput)) {
      fail("decision evidence entry does not match frozen evaluated effect")
    }
    if (entry.authorized_order_hash !== null) requireHash(entry.authorized_order_hash, "decision_evidence_entry.authorized_order_hash")
    if (entry.decision_output_hash !== null) requireHash(entry.decision_output_hash, "decision_evidence_entry.decision_output_hash")
    requireHash(entry.entry_hash, "decision_evidence_entry.entry_hash")
    const { entry_hash: _entryHash, ...entryBody } = entry
    if (canonicalHash(entryBody) !== entry.entry_hash) fail("decision evidence entry hash mismatch")
    assertReplayDecisionBoundary(entry.decision_boundary, request, entry.decision_market_input_snapshot, scheduleEntry)
    assertReplayDecisionInputSnapshot(entry.decision_input_snapshot, request, scheduleEntry.decision_time)
    assertReplayDecisionMarketInputSnapshot(entry.decision_market_input_snapshot, request, scheduleEntry.decision_time)
    if (entry.evaluation_status !== "evaluated") continue
    if (phase === "position_open") {
      if (!entry.decision_state_snapshot) fail("evaluated position-open decision requires state evidence")
      assertReplayDecisionStateSnapshot(entry.decision_state_snapshot, request, scheduleEntry)
      if (options.source_events) {
        assertReplayDecisionStateSnapshotSourcePrefix(entry.decision_state_snapshot, options.source_events)
      }
    } else if (entry.decision_state_snapshot !== null) {
      fail("pre-entry decision cannot bind position state evidence")
    }
    if (expectsAttestedHarness) {
      if (entry.evidence_mode !== "attested_harness" || !entry.decision_harness_bundle
          || !entry.decision_harness_build || !entry.decision_harness_receipt) {
        fail("Replay scheduled decision lane requires attested decision evidence")
      }
      assertReplayDecisionHarnessSourceBundle(entry.decision_harness_bundle, request)
      assertReplayDecisionHarnessBuildAttestation(entry.decision_harness_build, entry.decision_harness_bundle)
      assertReplayDecisionHarnessReceipt(
        entry.decision_harness_receipt, request, entry.decision_input_snapshot,
        entry.decision_market_input_snapshot, entry.decision_harness_bundle,
        entry.decision_harness_build, entry.decision_state_snapshot,
      )
    } else if (entry.evidence_mode !== "precomputed_order_compatibility"
        || entry.decision_harness_bundle || entry.decision_harness_build || entry.decision_harness_receipt) {
      fail("Replay compatibility lane cannot claim attested decision evidence")
    }
  }
  requireHash(timeline.timeline_hash, "decision_evidence_timeline.timeline_hash")
  const { timeline_hash: _timelineHash, ...timelineBody } = timeline
  if (canonicalHash(timelineBody) !== timeline.timeline_hash) fail("decision evidence timeline hash mismatch")
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

export function assertReplayInstrumentStatusProvenance(
  provenance: ReplayInstrumentStatusProvenance,
  manifest: ReplayDatasetManifest,
): void {
  if (provenance.schema_version !== REPLAY_INSTRUMENT_STATUS_PROVENANCE_SCHEMA_VERSION) {
    fail("unsupported instrument status provenance schema")
  }
  if (provenance.producer_domain !== "market-data-products") {
    fail("instrument status provenance producer domain must be market-data-products")
  }
  for (const [field, value] of Object.entries({
    producer_id: provenance.producer_id,
    producer_version: provenance.producer_version,
    source_owner: provenance.source_owner,
    normalization_policy_version: provenance.normalization_policy_version,
    source_ref: provenance.source_ref,
    provider_certification_ref: provenance.provider_certification_ref,
  })) requireText(value, `instrument.status_provenance.${field}`)
  for (const [field, value] of Object.entries({
    coverage_start: provenance.coverage_start,
    coverage_end: provenance.coverage_end,
    source_observed_through: provenance.source_observed_through,
    produced_at: provenance.produced_at,
  })) requireUtcTimestamp(value, `instrument.status_provenance.${field}`)
  requireHash(provenance.source_hash, "instrument.status_provenance.source_hash")
  requireHash(provenance.producer_build_hash, "instrument.status_provenance.producer_build_hash")
  requireHash(provenance.provider_capability_hash, "instrument.status_provenance.provider_capability_hash")
  requireHash(provenance.provider_certification_hash, "instrument.status_provenance.provider_certification_hash")
  requireHash(provenance.normalization_policy_hash, "instrument.status_provenance.normalization_policy_hash")
  requireHash(provenance.status_schedule_hash, "instrument.status_provenance.status_schedule_hash")
  if (!Number.isSafeInteger(provenance.source_record_count) || provenance.source_record_count < 1) {
    fail("instrument status provenance source_record_count must be positive")
  }
  if (Date.parse(provenance.coverage_start) >= Date.parse(provenance.coverage_end)) {
    fail("instrument status provenance coverage must have positive duration")
  }
  if (Date.parse(provenance.source_observed_through) > Date.parse(provenance.produced_at)) {
    fail("instrument status provenance cannot be produced before its source observation")
  }
  const statusScheduleHash = canonicalHash(manifest.instrument.status_epochs)
  if (provenance.status_schedule_hash !== statusScheduleHash) {
    fail("instrument status provenance schedule hash mismatch")
  }
  if (provenance.source_owner !== manifest.instrument.status_epochs[0]?.venue_id) {
    fail("instrument status provenance source owner must match the status venue")
  }
  const expectedCompleteness = manifest.instrument.status_history === "complete"
    ? "complete_history"
    : "current_snapshot_only"
  if (provenance.completeness !== expectedCompleteness) {
    fail("instrument status provenance completeness does not match status_history")
  }
  if (provenance.completeness === "complete_history") {
    if (provenance.source_kind !== "venue_status_event_archive") {
      fail("complete instrument status history requires a venue status event archive")
    }
    if (Date.parse(provenance.coverage_start) > Date.parse(manifest.first_open_time)
        || Date.parse(provenance.coverage_end) < Date.parse(manifest.last_close_time)) {
      fail("complete instrument status provenance must cover the Replay window")
    }
  } else if (provenance.source_kind === "venue_status_event_archive") {
    fail("current-snapshot-only provenance cannot claim a venue status event archive")
  }
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

export function replayEntryCancelIntentHash(
  value: Omit<ReplayLimitEntryCancelIntent, "intent_hash"> | Omit<ReplayStopEntryCancelIntent, "intent_hash">,
): string {
  return canonicalHash(value)
}

export function createReplayEntryCancelIntent(input: {
  intent_id: string
  requested_at: string
  effective_at: string
  target_order_type?: "limit" | "stop_market"
}): ReplayEntryCancelIntent {
  const targetOrderType = input.target_order_type ?? "limit"
  const common = {
    intent_id: input.intent_id,
    authority: "experiment_contract" as const,
    target_order_role: "entry" as const,
    target_time_in_force: "gtc" as const,
    requested_at: input.requested_at,
    effective_at: input.effective_at,
    effective_boundary: "after_bar_range" as const,
    reason_code: "experiment_contract_cancel" as const,
  }
  const body: Omit<ReplayLimitEntryCancelIntent, "intent_hash"> | Omit<ReplayStopEntryCancelIntent, "intent_hash"> = targetOrderType === "limit"
    ? { schema_version: REPLAY_ENTRY_CANCEL_INTENT_SCHEMA_VERSION, ...common, target_order_type: "limit" }
    : { schema_version: REPLAY_STOP_ENTRY_CANCEL_INTENT_SCHEMA_VERSION, ...common, target_order_type: "stop_market" }
  const value: ReplayEntryCancelIntent = targetOrderType === "limit"
    ? { ...body as Omit<ReplayLimitEntryCancelIntent, "intent_hash">, intent_hash: replayEntryCancelIntentHash(body) }
    : { ...body as Omit<ReplayStopEntryCancelIntent, "intent_hash">, intent_hash: replayEntryCancelIntentHash(body) }
  assertReplayEntryCancelIntent(value)
  return value
}

export function assertReplayEntryCancelIntent(value: ReplayEntryCancelIntent): void {
  const validVersionAndTarget = value.schema_version === REPLAY_ENTRY_CANCEL_INTENT_SCHEMA_VERSION
    ? value.target_order_type === "limit"
    : value.schema_version === REPLAY_STOP_ENTRY_CANCEL_INTENT_SCHEMA_VERSION
      ? value.target_order_type === "stop_market"
      : false
  if (!validVersionAndTarget
      || value.authority !== "experiment_contract"
      || value.target_order_role !== "entry"
      || value.target_time_in_force !== "gtc"
      || value.effective_boundary !== "after_bar_range"
      || value.reason_code !== "experiment_contract_cancel") {
    fail("unsupported Replay entry cancel intent")
  }
  requireText(value.intent_id, "entry_cancel_intent.intent_id")
  requireUtcTimestamp(value.requested_at, "entry_cancel_intent.requested_at")
  requireUtcTimestamp(value.effective_at, "entry_cancel_intent.effective_at")
  if (Date.parse(value.effective_at) <= Date.parse(value.requested_at)) {
    fail("entry cancel intent effective time must follow its request time")
  }
  requireHash(value.intent_hash, "entry_cancel_intent.intent_hash")
  const { intent_hash: _intentHash, ...body } = value
  if (replayEntryCancelIntentHash(body) !== value.intent_hash) fail("entry cancel intent hash mismatch")
}

export function replayPendingOrderResolutionHash(
  value: Omit<ReplayPendingOrderResolution, "resolution_hash">,
): string {
  return canonicalHash(value)
}

export function assertReplayPendingOrderResolution(value: ReplayPendingOrderResolution): void {
  if (value.schema_version !== REPLAY_PENDING_ORDER_RESOLUTION_SCHEMA_VERSION) fail("pending order resolution schema_version")
  const { order, observation, outcome } = value
  requireText(order.order_id, "pending_order.order_id")
  if (order.order_type !== "limit" && order.order_type !== "stop_market") fail("pending order type is unsupported")
  if (order.side !== "buy" && order.side !== "sell") fail("pending order side is unsupported")
  requirePositive(order.quantity, "pending_order.quantity")
  if (order.time_in_force !== "gtc" && order.time_in_force !== "ioc" && order.time_in_force !== "gtd") {
    fail("pending order time_in_force is unsupported")
  }
  if (order.time_in_force === "gtd") {
    requireUtcTimestamp(order.expires_at!, "pending_order.expires_at")
    if (Date.parse(order.expires_at!) <= Date.parse(order.activation_event_key.event_time)) {
      fail("GTD pending order expiry must follow activation")
    }
  } else if (order.expires_at !== null) {
    fail("non-GTD pending order cannot carry expires_at")
  }
  assertReplayEventKey(order.activation_event_key)
  if (order.liquidity_model !== "ohlcv-cross-through-full-fill-bounded-v1") fail("pending order liquidity model is unsupported")
  requirePositive(order.full_fill_capacity, "pending_order.full_fill_capacity")
  if (order.quantity > order.full_fill_capacity) fail("pending order quantity exceeds full-fill capacity")
  if (order.order_type === "limit") {
    requirePositive(order.limit_price, "pending_order.limit_price")
    if (order.trigger_price !== null || order.trigger_source !== null) fail("limit order cannot carry stop trigger fields")
  } else {
    requirePositive(order.trigger_price, "pending_order.trigger_price")
    if (order.limit_price !== null || order.trigger_source !== "last_trade_ohlcv") fail("stop-market trigger contract is invalid")
    if (order.time_in_force === "ioc") fail("stop-market pending order does not support ioc")
  }
  if (order.time_in_force === "ioc" && observation.observation_kind !== "bar_open") {
    fail("IOC limit order requires a bar_open observation")
  }
  if (order.time_in_force === "gtd") {
    const observationTime = Date.parse(observation.source_event_key.event_time)
    const expiryTime = Date.parse(order.expires_at!)
    if (observationTime > expiryTime
        || (observationTime === expiryTime && observation.observation_kind !== "bar_range")) {
      fail("GTD pending-order observations must end at the frozen bar-range expiry boundary")
    }
  }
  assertReplayEventKey(observation.source_event_key)
  assertReplayMarketBars([observation.bar])
  const expectedObservationTime = observation.observation_kind === "bar_open"
    ? observation.bar.open_time
    : observation.observation_kind === "bar_range" ? observation.bar.close_time : null
  if (expectedObservationTime === null || observation.source_event_key.event_time !== expectedObservationTime) {
    fail("pending order observation key does not match its bar boundary")
  }
  if (compareReplayEventKeys(order.activation_event_key, observation.source_event_key) >= 0) {
    fail("pending order observation must follow activation")
  }
  if (value.cancel_effective_key) {
    assertReplayEventKey(value.cancel_effective_key)
    if (compareReplayEventKeys(order.activation_event_key, value.cancel_effective_key) >= 0) {
      fail("pending order cancellation must follow activation")
    }
  }
  if (!["resting", "filled", "triggered_and_filled", "cancelled", "expired", "unresolved"].includes(outcome.status)) {
    fail("pending order outcome status is unsupported")
  }
  requireNonNegative(outcome.fill_quantity, "pending_order.outcome.fill_quantity")
  requireNonNegative(outcome.remaining_quantity, "pending_order.outcome.remaining_quantity")
  if (Math.abs(outcome.fill_quantity + outcome.remaining_quantity - order.quantity) > 1e-12) {
    fail("pending order outcome quantity is not conserved")
  }
  const isFilled = outcome.status === "filled" || outcome.status === "triggered_and_filled"
  if (isFilled) {
    requirePositive(outcome.fill_reference_price, "pending_order.outcome.fill_reference_price")
    if (outcome.fill_quantity !== order.quantity || outcome.remaining_quantity !== 0) fail("pending order fill must be full under bounded model")
    if (!outcome.decisive_event_key || canonicalJson(outcome.decisive_event_key) !== canonicalJson(observation.source_event_key)) {
      fail("pending order fill must bind the observation key")
    }
    if (order.order_type === "limit") {
      if (order.side === "buy" && outcome.fill_reference_price! > order.limit_price!
          || order.side === "sell" && outcome.fill_reference_price! < order.limit_price!) {
        fail("limit fill reference price violates its price bound")
      }
    }
  } else if (outcome.fill_reference_price !== null || outcome.fill_quantity !== 0 || outcome.remaining_quantity !== order.quantity) {
    fail("non-filled pending order outcome cannot carry fill evidence")
  }
  if (outcome.status === "unresolved") {
    if (outcome.decisive_event_key !== null
        || !["same_ordinal_cancel_race", "limit_touch_before_cancel_unresolved", "limit_touch_before_gtd_expiry_unresolved"]
          .includes(outcome.reason)) {
      fail("unresolved race contract is invalid")
    }
  } else if (!outcome.decisive_event_key) {
    fail("resolved pending order outcome requires a decisive EventKey")
  }
  if (order.time_in_force === "ioc" && value.cancel_effective_key === null
      && outcome.status !== "filled" && outcome.status !== "expired") {
    fail("IOC limit must fill or expire at its sole observation")
  }
  if (outcome.status === "expired") {
    const validIoc = order.time_in_force === "ioc" && outcome.reason === "ioc_unfilled_at_first_open"
    const validGtd = order.time_in_force === "gtd" && outcome.reason === "gtd_unfilled_at_expiry_close"
      && observation.observation_kind === "bar_range"
      && observation.source_event_key.event_time === order.expires_at
    if (!validIoc && !validGtd) fail("pending order expiry does not match its frozen TIF boundary")
  }
  const queueLimited = order.order_type === "limit"
    && [
      "limit_open_marketable", "limit_strict_cross", "limit_touch_queue_unproven",
      "limit_touch_before_cancel_unresolved", "limit_touch_before_gtd_expiry_unresolved",
    ].includes(outcome.reason)
  const raceLimited = outcome.reason === "same_ordinal_cancel_race"
  const expectedLimitations = [
    ...(queueLimited ? ["ohlcv-limit-queue-unobserved" as const] : []),
    ...(raceLimited ? ["same-event-order-unproven" as const] : []),
  ]
  if (canonicalJson(value.limitations) !== canonicalJson(expectedLimitations)) fail("pending order limitations are inconsistent")
  if (value.resolution_status !== (expectedLimitations.length > 0 ? "resolution_limited" : "exact_under_ohlc")) {
    fail("pending order resolution status is inconsistent")
  }
  assertReplayPendingOrderOutcomeSemantics(value)
  requireHash(value.resolution_hash, "pending_order.resolution_hash")
  const { resolution_hash: _resolutionHash, ...body } = value
  if (replayPendingOrderResolutionHash(body) !== value.resolution_hash) fail("pending order resolution hash mismatch")
}

export function createReplayStopEntrySameBarPathAmbiguity(
  body: Omit<ReplayStopEntrySameBarPathAmbiguity, "schema_version" | "policy" | "evidence_hash">,
): ReplayStopEntrySameBarPathAmbiguity {
  const evidenceBody = {
    schema_version: REPLAY_STOP_ENTRY_SAME_BAR_PATH_AMBIGUITY_SCHEMA_VERSION,
    ...structuredClone(body),
    policy: "fail_without_result_when_post_trigger_path_is_unprovable" as const,
  }
  const evidence = { ...evidenceBody, evidence_hash: canonicalHash(evidenceBody) }
  assertReplayStopEntrySameBarPathAmbiguity(evidence)
  return evidence
}

export function assertReplayStopEntrySameBarPathAmbiguity(
  value: ReplayStopEntrySameBarPathAmbiguity,
): void {
  if (value.schema_version !== REPLAY_STOP_ENTRY_SAME_BAR_PATH_AMBIGUITY_SCHEMA_VERSION
      || value.policy !== "fail_without_result_when_post_trigger_path_is_unprovable") {
    fail("unsupported Stop-market entry same-bar path ambiguity evidence")
  }
  requireText(value.run_id, "stop_entry_path_ambiguity.run_id")
  assertReplayEventKey(value.source_event_key)
  assertReplayMarketBars([value.bar])
  requirePositive(value.entry_trigger_price, "stop_entry_path_ambiguity.entry_trigger_price")
  requirePositive(value.protective_stop_price, "stop_entry_path_ambiguity.protective_stop_price")
  requirePositive(value.target_price, "stop_entry_path_ambiguity.target_price")
  if (value.source_event_key.event_time !== value.bar.close_time || value.source_event_key.boundary_phase !== 20) {
    fail("Stop-market entry same-bar path ambiguity must bind the bar-range SourceEvent")
  }
  const expectedStopTouched = value.position_side === "long"
    ? value.bar.low <= value.protective_stop_price
    : value.bar.high >= value.protective_stop_price
  const expectedTargetTouched = value.position_side === "long"
    ? value.bar.high >= value.target_price
    : value.bar.low <= value.target_price
  if ((!value.stop_touched && !value.target_touched)
      || value.stop_touched !== expectedStopTouched || value.target_touched !== expectedTargetTouched) {
    fail("Stop-market entry same-bar path ambiguity touch evidence is inconsistent")
  }
  const { evidence_hash: _evidenceHash, ...body } = value
  requireHash(value.evidence_hash, "stop_entry_path_ambiguity.evidence_hash")
  if (canonicalHash(body) !== value.evidence_hash) fail("Stop-market entry same-bar path ambiguity hash mismatch")
}

function assertReplayPendingOrderOutcomeSemantics(value: ReplayPendingOrderResolution): void {
  const { order, observation, outcome, cancel_effective_key: cancelKey } = value
  const decisiveIs = (key: ReplayEventKey): boolean => outcome.decisive_event_key !== null
    && canonicalJson(outcome.decisive_event_key) === canonicalJson(key)
  const limit = order.limit_price ?? Number.NaN
  const trigger = order.trigger_price ?? Number.NaN
  const limitMarketable = observation.observation_kind === "bar_open"
    && (order.side === "buy" ? observation.bar.open <= limit : observation.bar.open >= limit)
  const limitStrictCross = observation.observation_kind === "bar_range"
    && (order.side === "buy" ? observation.bar.low < limit : observation.bar.high > limit)
  const limitTouch = observation.observation_kind === "bar_range"
    && (order.side === "buy" ? observation.bar.low === limit : observation.bar.high === limit)
  const stopOpenTriggered = observation.observation_kind === "bar_open"
    && (order.side === "buy" ? observation.bar.open >= trigger : observation.bar.open <= trigger)
  const stopRangeTriggered = observation.observation_kind === "bar_range"
    && (order.side === "buy" ? observation.bar.high >= trigger : observation.bar.low <= trigger)
  const cancelBefore = cancelKey !== null && !sameReplayEventOrdinal(cancelKey, observation.source_event_key)
    && compareReplayEventKeys(cancelKey, observation.source_event_key) < 0
  const cancelAfter = cancelKey !== null && !sameReplayEventOrdinal(cancelKey, observation.source_event_key)
    && compareReplayEventKeys(cancelKey, observation.source_event_key) > 0
  const sourceCanDecide = cancelKey === null || cancelAfter
  const sourceDecisive = decisiveIs(observation.source_event_key)
  const gtdExpiryReached = order.time_in_force === "gtd"
    && observation.observation_kind === "bar_range"
    && observation.source_event_key.event_time === order.expires_at
  const valid = (() => {
    switch (outcome.reason) {
      case "limit_open_marketable":
        return order.order_type === "limit" && sourceCanDecide && limitMarketable && outcome.status === "filled"
          && outcome.fill_reference_price === observation.bar.open && sourceDecisive
      case "limit_strict_cross":
        return order.order_type === "limit" && sourceCanDecide && limitStrictCross && outcome.status === "filled"
          && outcome.fill_reference_price === order.limit_price && sourceDecisive
      case "limit_touch_queue_unproven":
        return order.order_type === "limit" && limitTouch && !gtdExpiryReached
          && outcome.status === "resting" && cancelKey === null && sourceDecisive
      case "limit_not_reached":
        return order.order_type === "limit" && !limitMarketable && !limitStrictCross && !limitTouch
          && order.time_in_force !== "ioc" && !gtdExpiryReached
          && outcome.status === "resting" && cancelKey === null && sourceDecisive
      case "stop_open_gap":
        return order.order_type === "stop_market" && sourceCanDecide && stopOpenTriggered && outcome.status === "triggered_and_filled"
          && outcome.fill_reference_price === observation.bar.open && sourceDecisive
      case "stop_range_trigger":
        return order.order_type === "stop_market" && sourceCanDecide && stopRangeTriggered && outcome.status === "triggered_and_filled"
          && outcome.fill_reference_price === order.trigger_price && sourceDecisive
      case "stop_not_triggered":
        return order.order_type === "stop_market" && !stopOpenTriggered && !stopRangeTriggered
          && outcome.status === "resting" && cancelKey === null && sourceDecisive
      case "cancel_precedes_observation":
        return cancelKey !== null && cancelBefore && outcome.status === "cancelled" && decisiveIs(cancelKey)
      case "cancel_after_non_fill":
        return cancelKey !== null && cancelAfter && outcome.status === "cancelled" && decisiveIs(cancelKey)
          && (order.order_type === "limit" ? !limitMarketable && !limitStrictCross && !limitTouch : !stopOpenTriggered && !stopRangeTriggered)
      case "ioc_unfilled_at_first_open":
        return order.order_type === "limit" && sourceCanDecide && order.time_in_force === "ioc" && !limitMarketable
          && outcome.status === "expired" && sourceDecisive
      case "same_ordinal_cancel_race":
        return cancelKey !== null && sameReplayEventOrdinal(cancelKey, observation.source_event_key)
          && outcome.status === "unresolved" && outcome.decisive_event_key === null
      case "limit_touch_before_cancel_unresolved":
        return order.order_type === "limit" && limitTouch && cancelAfter
          && outcome.status === "unresolved" && outcome.decisive_event_key === null
      case "gtd_unfilled_at_expiry_close":
        return gtdExpiryReached
          && (order.order_type === "limit"
            ? !limitStrictCross && !limitTouch
            : !stopRangeTriggered)
          && outcome.status === "expired" && sourceDecisive
      case "limit_touch_before_gtd_expiry_unresolved":
        return order.order_type === "limit" && gtdExpiryReached && limitTouch
          && outcome.status === "unresolved" && outcome.decisive_event_key === null
    }
  })()
  if (!valid) fail("pending order outcome does not match price/time/cancel semantics")
}

function sameReplayEventOrdinal(left: ReplayEventKey, right: ReplayEventKey): boolean {
  return left.event_time === right.event_time
    && left.boundary_phase === right.boundary_phase
    && left.source_sequence === right.source_sequence
    && left.event_subphase === right.event_subphase
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
