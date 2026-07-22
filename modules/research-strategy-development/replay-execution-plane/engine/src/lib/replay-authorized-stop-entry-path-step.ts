import {
  assertReplayBarLinkedAggregateTradePathAuthoritySnapshot,
  type ReplayBarLinkedAggregateTradePathAuthoritySnapshot,
} from "../../../../research-control-plane/contracts/src/lib/control-plane-contracts"
import {
  assertReplayAggregateTradeCoverageBinding,
  assertReplayDatasetManifest,
  assertReplayExecutionRequest,
  assertReplayMarketBars,
  canonicalHash,
  canonicalJson,
  type ReplayAggregateTradeCoverageAttestation,
  type ReplayAggregateTradeEvent,
  type ReplayDatasetManifest,
  type ReplayExecutionRequest,
  type ReplayMarketBar,
} from "../../../contracts/src/lib/replay-contracts"
import {
  assertReplayKlineAggregateTradeBarLinkAttestation,
  type ReplayKlineAggregateTradeBarLinkAttestation,
} from "../../../contracts/src/lib/replay-kline-aggregate-trade-bar-link-contracts"
import {
  assertReplayExactTradeStopResolution,
  resolveReplayExactTradeStopPath,
  type ReplayExactTradeStopResolution,
} from "./replay-exact-trade-stop-resolution"

export const REPLAY_AUTHORIZED_STOP_ENTRY_PATH_STEP_SCHEMA_VERSION =
  "trade.rd-replay-authorized-stop-entry-path-step.v1" as const

export interface ReplayAuthorizedStopEntryPathStepInput {
  request: ReplayExecutionRequest
  dataset_manifest: ReplayDatasetManifest
  market_bar: ReplayMarketBar
  path_authority: ReplayBarLinkedAggregateTradePathAuthoritySnapshot
  bar_link_attestation: ReplayKlineAggregateTradeBarLinkAttestation
  aggregate_trade_coverage: ReplayAggregateTradeCoverageAttestation
  aggregate_trade_events: ReplayAggregateTradeEvent[]
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

export function executeReplayAuthorizedStopEntryPathStep(
  input: ReplayAuthorizedStopEntryPathStepInput,
): ReplayAuthorizedStopEntryPathStep {
  assertInput(input)
  const entry = input.request.order.entry_execution
  if (entry.order_type !== "stop_market") {
    throw new Error("authorized Stop-entry path Step requires a Stop-market entry")
  }
  const exactResolution = resolveReplayExactTradeStopPath({
    run_id: input.request.run_id,
    position_side: input.request.order.side,
    entry_trigger_price: entry.trigger_price,
    protective_stop_price: input.request.order.stop_price,
    target_price: input.request.order.target_price,
    coverage_attestation: input.aggregate_trade_coverage,
    events: input.aggregate_trade_events,
  })
  if (exactResolution.entry_trigger === null) {
    throw new Error("authorized Stop-entry path evidence does not contain the frozen entry trigger")
  }
  const body: Omit<ReplayAuthorizedStopEntryPathStep, "step_hash"> = {
    schema_version: REPLAY_AUTHORIZED_STOP_ENTRY_PATH_STEP_SCHEMA_VERSION,
    run_id: input.request.run_id,
    request_hash: canonicalHash(input.request),
    dataset_hash: input.dataset_manifest.data_hash,
    market_bar_hash: canonicalHash(input.market_bar),
    path_authority_hash: input.path_authority.authority_snapshot_hash,
    bar_link_attestation_hash: input.bar_link_attestation.attestation_hash,
    aggregate_trade_coverage_attestation_hash: input.aggregate_trade_coverage.attestation_hash,
    aggregate_trade_events_hash: input.aggregate_trade_coverage.events_hash,
    exact_trade_stop_resolution: exactResolution,
    resolution_scope: "initial_stop_market_same_bar_terminal_owner_ordering_only",
    economic_fill_policy: "frozen_request_not_aggregate_trade_evidence",
    fill_quantity_authority: "none",
    cost_authority: "none",
    external_completeness: "not_verified",
    publication_state: "blocked_until_checkpoint_result_artifact_binding",
  }
  return { ...body, step_hash: canonicalHash(body) }
}

export function assertReplayAuthorizedStopEntryPathStep(
  value: ReplayAuthorizedStopEntryPathStep,
  input: ReplayAuthorizedStopEntryPathStepInput,
): void {
  assertInput(input)
  const entry = input.request.order.entry_execution
  if (entry.order_type !== "stop_market") {
    throw new Error("authorized Stop-entry path Step requires a Stop-market entry")
  }
  assertReplayExactTradeStopResolution(value.exact_trade_stop_resolution, {
    run_id: input.request.run_id,
    position_side: input.request.order.side,
    entry_trigger_price: entry.trigger_price,
    protective_stop_price: input.request.order.stop_price,
    target_price: input.request.order.target_price,
    coverage_attestation: input.aggregate_trade_coverage,
    events: input.aggregate_trade_events,
  })
  const expected = executeReplayAuthorizedStopEntryPathStep(input)
  if (canonicalJson(value) !== canonicalJson(expected)) {
    throw new Error("authorized Stop-entry path Step does not match its frozen authority and evidence")
  }
}

function assertInput(input: ReplayAuthorizedStopEntryPathStepInput): void {
  assertReplayExecutionRequest(input.request)
  assertReplayDatasetManifest(input.dataset_manifest)
  assertReplayMarketBars([input.market_bar])
  assertReplayBarLinkedAggregateTradePathAuthoritySnapshot(input.path_authority)
  assertReplayKlineAggregateTradeBarLinkAttestation(input.bar_link_attestation)
  assertReplayAggregateTradeCoverageBinding(input.aggregate_trade_coverage, input.aggregate_trade_events)

  const request = input.request
  const manifest = input.dataset_manifest
  const authority = input.path_authority
  const link = input.bar_link_attestation
  const entry = request.order.entry_execution
  if (entry.order_type !== "stop_market") {
    throw new Error("authorized Stop-entry path Step requires a Stop-market entry")
  }
  if (request.dataset_manifest_ref !== manifest.manifest_ref
      || request.dataset_hash !== manifest.data_hash
      || request.symbol !== manifest.symbol || request.timeframe !== manifest.timeframe) {
    throw new Error("authorized Stop-entry path Step Request and Dataset lineage mismatch")
  }
  if (authority.run_id !== request.run_id || authority.trial_id !== request.trial_id
      || authority.request_hash !== canonicalHash(request)
      || authority.entry_order_hash !== canonicalHash(request.order)
      || authority.dataset_manifest_ref !== manifest.manifest_ref
      || authority.dataset_hash !== manifest.data_hash
      || authority.symbol !== request.symbol || authority.timeframe !== request.timeframe
      || authority.entry_side !== request.order.side
      || authority.entry_trigger_price !== entry.trigger_price
      || authority.protective_stop_price !== request.order.stop_price
      || authority.protective_target_price !== request.order.target_price) {
    throw new Error("authorized Stop-entry path Step does not match its Request authority")
  }
  if (authority.bar_link_attestation_id !== link.attestation_id
      || authority.bar_link_attestation_hash !== link.attestation_hash
      || authority.window_start_inclusive !== link.window_start_inclusive
      || authority.window_end_exclusive !== link.window_end_exclusive
      || authority.kline_record_hash !== link.kline_record_hash
      || authority.replay_market_bar_hash !== link.replay_market_bar_hash
      || authority.aggregate_trade_coverage_attestation_hash !== link.aggregate_trade_coverage_attestation_hash
      || authority.aggregate_trade_events_hash !== link.aggregate_trade_events_hash) {
    throw new Error("authorized Stop-entry path Step does not match its Bar Link authority")
  }
  if (link.replay_market_bar_hash !== canonicalHash(input.market_bar)
      || link.window_start_inclusive !== input.market_bar.open_time
      || link.window_end_exclusive !== input.market_bar.close_time
      || link.aggregate_trade_coverage_attestation_hash !== input.aggregate_trade_coverage.attestation_hash
      || link.aggregate_trade_events_hash !== input.aggregate_trade_coverage.events_hash
      || input.aggregate_trade_coverage.coverage_start !== input.market_bar.open_time
      || input.aggregate_trade_coverage.coverage_end !== input.market_bar.close_time) {
    throw new Error("authorized Stop-entry path Step evidence does not close the linked bar window")
  }
  if (Date.parse(input.market_bar.open_time) < Date.parse(manifest.first_open_time)
      || Date.parse(input.market_bar.close_time) > Date.parse(manifest.last_close_time)
      || Date.parse(link.latest_component_available_at) > Date.parse(authority.issued_at)) {
    throw new Error("authorized Stop-entry path Step violates Dataset or PIT authority bounds")
  }
}
