import type { Database } from "bun:sqlite"
import {
  assertReplayExecutionRequest,
  canonicalHash,
  type ReplayExecutionRequest,
} from "../../../../replay-execution-plane/contracts/src/lib/replay-contracts"
import {
  assertReplayKlineAggregateTradeBarLinkAttestation,
  type ReplayKlineAggregateTradeBarLinkAttestation,
} from "../../../../replay-execution-plane/contracts/src/lib/replay-kline-aggregate-trade-bar-link-contracts"
import {
  REPLAY_BAR_LINKED_AGGREGATE_TRADE_PATH_AUTHORITY_LIMITATIONS,
  REPLAY_BAR_LINKED_AGGREGATE_TRADE_PATH_AUTHORITY_SCHEMA_VERSION,
  assertReplayBarLinkedAggregateTradePathAuthoritySnapshot,
  assertTrialReservationSnapshot,
  createReplayBarLinkedAggregateTradePathAuthoritySnapshot,
  hashTrialReservationSnapshot,
  type ReplayBarLinkedAggregateTradePathAuthoritySnapshot,
  type TrialReservationSnapshot,
} from "../../../contracts/src/lib/control-plane-contracts"
import { readReplayAggregateTradeEvidenceAdmission } from "./aggregate-trade-provider-certification-registry"
import { readReplayCrossSourceOrderingAdmission } from "./cross-source-ordering-admission-registry"

interface AuthorityRow {
  authority_snapshot_hash: string
  authority_json: string
}

export interface IssueReplayBarLinkedAggregateTradePathAuthorityInput {
  authority_snapshot_id: string
  authority_snapshot_ref: string
  issued_at: string
  authority_id: string
  authority_policy_version: string
  reservation: TrialReservationSnapshot
  request: ReplayExecutionRequest
  bar_link_attestation: ReplayKlineAggregateTradeBarLinkAttestation
}

export function issueReplayBarLinkedAggregateTradePathAuthority(
  db: Database,
  input: IssueReplayBarLinkedAggregateTradePathAuthorityInput,
): ReplayBarLinkedAggregateTradePathAuthoritySnapshot {
  assertTrialReservationSnapshot(input.reservation)
  assertReplayExecutionRequest(input.request)
  assertReplayKlineAggregateTradeBarLinkAttestation(input.bar_link_attestation)
  const reservationHash = hashTrialReservationSnapshot(input.reservation)
  const issuedAt = Date.parse(input.issued_at)
  if (!Number.isFinite(issuedAt)
      || issuedAt < Date.parse(input.reservation.issued_at)
      || issuedAt >= Date.parse(input.reservation.expires_at)) {
    throw new Error("bar-linked path authority must fall inside the Trial Reservation window")
  }
  const trial = db.query(`
    SELECT trial_id, run_id, status FROM rd_trial WHERE trial_id = $trial_id
  `).get({ $trial_id: input.reservation.identity.trial_id }) as {
    trial_id: string
    run_id: string
    status: string
  } | null
  if (!trial || trial.run_id !== input.reservation.run_id || trial.status !== "reserved") {
    throw new Error("bar-linked path authority requires the authoritative reserved Trial")
  }
  assertRequestReservationIdentity(input.request, input.reservation, reservationHash)
  const aggregateAdmission = readReplayAggregateTradeEvidenceAdmission(db, reservationHash)
  const orderingAdmission = readReplayCrossSourceOrderingAdmission(db, reservationHash)
  if (issuedAt < Date.parse(aggregateAdmission.issued_at)
      || issuedAt < Date.parse(orderingAdmission.issued_at)) {
    throw new Error("bar-linked path authority cannot predate its parent admissions")
  }
  assertParentAdmissionLineage(aggregateAdmission, orderingAdmission)
  assertBarLinkLineage(input.bar_link_attestation, aggregateAdmission, orderingAdmission, input.request)
  assertBoundedStopMarketScope(input.request, input.bar_link_attestation)

  const request = input.request
  const barLink = input.bar_link_attestation
  const entryExecution = request.order.entry_execution
  if (entryExecution.order_type !== "stop_market") {
    throw new Error("bar-linked path authority requires one initial Stop-market entry")
  }
  const authority = createReplayBarLinkedAggregateTradePathAuthoritySnapshot({
    schema_version: REPLAY_BAR_LINKED_AGGREGATE_TRADE_PATH_AUTHORITY_SCHEMA_VERSION,
    authority_snapshot_id: input.authority_snapshot_id,
    authority_snapshot_ref: input.authority_snapshot_ref,
    status: "authorized",
    issued_at: input.issued_at,
    authority_id: input.authority_id,
    authority_policy_version: input.authority_policy_version,
    trial_id: input.reservation.identity.trial_id,
    run_id: input.reservation.run_id,
    reservation_ref: input.reservation.reservation_ref,
    reservation_hash: reservationHash,
    request_schema_version: request.schema_version,
    request_hash: canonicalHash(request),
    entry_order_hash: canonicalHash(request.order),
    dataset_manifest_ref: request.dataset_manifest_ref,
    dataset_hash: request.dataset_hash,
    aggregate_trade_evidence_admission_ref: aggregateAdmission.admission_ref,
    aggregate_trade_evidence_admission_hash: aggregateAdmission.admission_hash,
    cross_source_ordering_admission_ref: orderingAdmission.admission_ref,
    cross_source_ordering_admission_hash: orderingAdmission.admission_hash,
    bar_link_attestation_id: barLink.attestation_id,
    bar_link_attestation_hash: barLink.attestation_hash,
    bar_link_schema_version: barLink.schema_version,
    bar_link_policy_version: barLink.policy_version,
    venue_id: barLink.venue_id,
    symbol: barLink.symbol,
    timeframe: barLink.timeframe,
    window_start_inclusive: barLink.window_start_inclusive,
    window_end_exclusive: barLink.window_end_exclusive,
    latest_component_available_at: barLink.latest_component_available_at,
    kline_record_hash: barLink.kline_record_hash,
    replay_market_bar_hash: barLink.replay_market_bar_hash,
    aggregate_trade_coverage_attestation_hash: barLink.aggregate_trade_coverage_attestation_hash,
    aggregate_trade_events_hash: barLink.aggregate_trade_events_hash,
    entry_side: request.order.side,
    entry_trigger_price: entryExecution.trigger_price,
    protective_stop_price: request.order.stop_price,
    protective_target_price: request.order.target_price,
    consumer_capability: "bounded_initial_stop_market_same_bar_post_entry_protection_ordering",
    entry_scope: "initial_stop_market_entry_only",
    path_resolution_authority: "authorized_for_bound_request_and_bar",
    path_observation_rule: "strictly_after_entry_trigger_trade",
    path_source_authority: "ordered_aggregate_trade_prices_within_linked_bar_only",
    cross_source_ordering_authority: "lineage_only_not_global_sequence",
    fill_quantity_authority: "none",
    cost_authority: "none",
    external_completeness: "not_verified",
    runner_compatibility: "not_bound",
    activation: "forbidden_until_exact_request_runner_consumer",
    limitations: [...REPLAY_BAR_LINKED_AGGREGATE_TRADE_PATH_AUTHORITY_LIMITATIONS],
    limitations_hash: canonicalHash(REPLAY_BAR_LINKED_AGGREGATE_TRADE_PATH_AUTHORITY_LIMITATIONS),
  })

  return db.transaction(() => {
    const existing = db.query(`
      SELECT authority_snapshot_hash, authority_json
      FROM rd_replay_bar_linked_aggregate_trade_path_authority
      WHERE authority_snapshot_id = $authority_snapshot_id
        OR authority_snapshot_ref = $authority_snapshot_ref
        OR reservation_hash = $reservation_hash
        OR request_hash = $request_hash
        OR bar_link_attestation_hash = $bar_link_attestation_hash
    `).get({
      $authority_snapshot_id: authority.authority_snapshot_id,
      $authority_snapshot_ref: authority.authority_snapshot_ref,
      $reservation_hash: authority.reservation_hash,
      $request_hash: authority.request_hash,
      $bar_link_attestation_hash: authority.bar_link_attestation_hash,
    }) as AuthorityRow | null
    if (existing) {
      if (existing.authority_snapshot_hash !== authority.authority_snapshot_hash) {
        throw new Error("Replay bar-linked path authority identity already exists with different content")
      }
      return parseAuthorityRow(existing)
    }
    db.query(`
      INSERT INTO rd_replay_bar_linked_aggregate_trade_path_authority(
        authority_snapshot_id, authority_snapshot_ref, authority_snapshot_hash,
        status, issued_at, authority_id, authority_policy_version, trial_id, run_id,
        reservation_ref, reservation_hash, request_hash, entry_order_hash,
        dataset_manifest_ref, dataset_hash, aggregate_trade_evidence_admission_hash,
        cross_source_ordering_admission_hash, bar_link_attestation_id,
        bar_link_attestation_hash, symbol, timeframe, window_start_inclusive,
        window_end_exclusive, latest_component_available_at, kline_record_hash,
        replay_market_bar_hash, aggregate_trade_coverage_attestation_hash,
        aggregate_trade_events_hash, consumer_capability, path_resolution_authority,
        external_completeness, runner_compatibility, activation, limitations_hash,
        authority_json
      ) VALUES (
        $authority_snapshot_id, $authority_snapshot_ref, $authority_snapshot_hash,
        $status, $issued_at, $authority_id, $authority_policy_version, $trial_id, $run_id,
        $reservation_ref, $reservation_hash, $request_hash, $entry_order_hash,
        $dataset_manifest_ref, $dataset_hash, $aggregate_trade_evidence_admission_hash,
        $cross_source_ordering_admission_hash, $bar_link_attestation_id,
        $bar_link_attestation_hash, $symbol, $timeframe, $window_start_inclusive,
        $window_end_exclusive, $latest_component_available_at, $kline_record_hash,
        $replay_market_bar_hash, $aggregate_trade_coverage_attestation_hash,
        $aggregate_trade_events_hash, $consumer_capability, $path_resolution_authority,
        $external_completeness, $runner_compatibility, $activation, $limitations_hash,
        $authority_json
      )
    `).run({
      $authority_snapshot_id: authority.authority_snapshot_id,
      $authority_snapshot_ref: authority.authority_snapshot_ref,
      $authority_snapshot_hash: authority.authority_snapshot_hash,
      $status: authority.status,
      $issued_at: authority.issued_at,
      $authority_id: authority.authority_id,
      $authority_policy_version: authority.authority_policy_version,
      $trial_id: authority.trial_id,
      $run_id: authority.run_id,
      $reservation_ref: authority.reservation_ref,
      $reservation_hash: authority.reservation_hash,
      $request_hash: authority.request_hash,
      $entry_order_hash: authority.entry_order_hash,
      $dataset_manifest_ref: authority.dataset_manifest_ref,
      $dataset_hash: authority.dataset_hash,
      $aggregate_trade_evidence_admission_hash: authority.aggregate_trade_evidence_admission_hash,
      $cross_source_ordering_admission_hash: authority.cross_source_ordering_admission_hash,
      $bar_link_attestation_id: authority.bar_link_attestation_id,
      $bar_link_attestation_hash: authority.bar_link_attestation_hash,
      $symbol: authority.symbol,
      $timeframe: authority.timeframe,
      $window_start_inclusive: authority.window_start_inclusive,
      $window_end_exclusive: authority.window_end_exclusive,
      $latest_component_available_at: authority.latest_component_available_at,
      $kline_record_hash: authority.kline_record_hash,
      $replay_market_bar_hash: authority.replay_market_bar_hash,
      $aggregate_trade_coverage_attestation_hash: authority.aggregate_trade_coverage_attestation_hash,
      $aggregate_trade_events_hash: authority.aggregate_trade_events_hash,
      $consumer_capability: authority.consumer_capability,
      $path_resolution_authority: authority.path_resolution_authority,
      $external_completeness: authority.external_completeness,
      $runner_compatibility: authority.runner_compatibility,
      $activation: authority.activation,
      $limitations_hash: authority.limitations_hash,
      $authority_json: JSON.stringify(authority),
    })
    return structuredClone(authority)
  }).immediate()
}

export function readReplayBarLinkedAggregateTradePathAuthority(
  db: Database,
  reservationHash: string,
): ReplayBarLinkedAggregateTradePathAuthoritySnapshot {
  const row = db.query(`
    SELECT authority_snapshot_hash, authority_json
    FROM rd_replay_bar_linked_aggregate_trade_path_authority
    WHERE reservation_hash = $reservation_hash
  `).get({ $reservation_hash: reservationHash }) as AuthorityRow | null
  if (!row) throw new Error("Replay bar-linked aggregate-trade path authority is not registered")
  return parseAuthorityRow(row)
}

function assertRequestReservationIdentity(
  request: ReplayExecutionRequest,
  reservation: TrialReservationSnapshot,
  reservationHash: string,
): void {
  if (request.trial_reservation_ref !== reservation.reservation_ref
      || request.trial_reservation_hash !== reservationHash
      || request.run_id !== reservation.run_id) {
    throw new Error("bar-linked path authority Request does not bind the Trial Reservation")
  }
  for (const field of [
    "experiment_id", "trial_group_id", "trial_group_hash", "trial_id", "candidate_id",
    "candidate_hash", "identity_hash_policy_version", "experiment_contract_hash",
  ] as const) {
    if (request[field] !== reservation.identity[field]) {
      throw new Error(`bar-linked path authority Request identity mismatch: ${field}`)
    }
  }
  const bindings = reservation.bindings
  if (request.idempotency_key !== bindings.replay_idempotency_key
      || request.dataset_manifest_ref !== bindings.dataset_manifest_ref
      || request.dataset_hash !== bindings.dataset_hash
      || request.supplemental_facts_hash !== bindings.supplemental_facts_hash
      || request.supplemental_requirement_set_hash !== bindings.supplemental_requirement_set_hash
      || request.venue_risk_policy_schedule_hash !== bindings.venue_risk_policy_schedule_hash
      || request.instrument_spec_schedule_hash !== bindings.instrument_spec_schedule_hash
      || request.instrument_status_schedule_hash !== bindings.instrument_status_schedule_hash
      || request.instrument_status_provenance_hash !== bindings.instrument_status_provenance_hash
      || request.instrument_status_provider_capability_hash !== bindings.instrument_status_provider_capability_hash
      || request.instrument_status_provider_certification_hash !== bindings.instrument_status_provider_certification_hash
      || request.harness_hash !== bindings.harness_hash
      || request.assumptions_hash !== bindings.assumptions_hash
      || canonicalHash(request.cost_policy) !== bindings.cost_policy_hash
      || canonicalHash(request.margin_policy) !== bindings.margin_policy_hash
      || request.simulator_policy.version !== bindings.simulator_policy_version
      || bindings.execution_mode !== "step") {
    throw new Error("bar-linked path authority Request bindings do not match the Trial Reservation")
  }
  const entry = request.order.entry_execution
  if (entry.order_type !== "stop_market"
      || bindings.liquidity_capacity_attestation_hash === null
      || entry.liquidity_capacity_attestation_hash !== bindings.liquidity_capacity_attestation_hash) {
    throw new Error("bar-linked path authority Stop-market liquidity binding does not match the Trial Reservation")
  }
}

function assertParentAdmissionLineage(
  aggregateAdmission: ReturnType<typeof readReplayAggregateTradeEvidenceAdmission>,
  orderingAdmission: ReturnType<typeof readReplayCrossSourceOrderingAdmission>,
): void {
  if (orderingAdmission.aggregate_trade_evidence_admission_ref !== aggregateAdmission.admission_ref
      || orderingAdmission.aggregate_trade_evidence_admission_hash !== aggregateAdmission.admission_hash
      || orderingAdmission.aggregate_trade_coverage_attestation_hash !== aggregateAdmission.coverage_attestation_hash) {
    throw new Error("bar-linked path authority parent admissions do not share one aggregate-trade lineage")
  }
}

function assertBarLinkLineage(
  barLink: ReplayKlineAggregateTradeBarLinkAttestation,
  aggregateAdmission: ReturnType<typeof readReplayAggregateTradeEvidenceAdmission>,
  orderingAdmission: ReturnType<typeof readReplayCrossSourceOrderingAdmission>,
  request: ReplayExecutionRequest,
): void {
  if (barLink.aggregate_trade_events_hash !== orderingAdmission.aggregate_trade_events_hash
      || Date.parse(barLink.window_start_inclusive) < Date.parse(aggregateAdmission.coverage_start)
      || Date.parse(barLink.window_end_exclusive) > Date.parse(aggregateAdmission.coverage_end)
      || Date.parse(barLink.window_start_inclusive) < Date.parse(orderingAdmission.window_start_inclusive)
      || Date.parse(barLink.window_end_exclusive) >= Date.parse(orderingAdmission.window_end_exclusive)
      || barLink.symbol !== orderingAdmission.symbol || barLink.timeframe !== orderingAdmission.timeframe
      || barLink.symbol !== request.symbol || barLink.timeframe !== request.timeframe
      || request.dataset_manifest_ref !== orderingAdmission.dataset_manifest_ref
      || request.dataset_hash !== orderingAdmission.dataset_hash) {
    throw new Error("bar-linked path authority does not close Bar Link, parent Admission, and Request lineage")
  }
}

function assertBoundedStopMarketScope(
  request: ReplayExecutionRequest,
  barLink: ReplayKlineAggregateTradeBarLinkAttestation,
): void {
  const entry = request.order.entry_execution
  if (entry.order_type !== "stop_market") {
    throw new Error("bar-linked path authority requires one initial Stop-market entry")
  }
  if (Date.parse(barLink.window_start_inclusive) < Date.parse(request.order.earliest_executable_time)
      || (entry.time_in_force === "gtd"
        && Date.parse(barLink.window_end_exclusive) > Date.parse(entry.expires_at!))) {
    throw new Error("bar-linked path authority bar is outside the frozen executable window")
  }
  const triggerTouched = request.order.side === "long"
    ? barLink.aggregate_high >= entry.trigger_price
    : barLink.aggregate_low <= entry.trigger_price
  const protectionTouched = request.order.side === "long"
    ? barLink.aggregate_low <= request.order.stop_price || barLink.aggregate_high >= request.order.target_price
    : barLink.aggregate_high >= request.order.stop_price || barLink.aggregate_low <= request.order.target_price
  if (!triggerTouched || !protectionTouched) {
    throw new Error("bar-linked path authority requires a trigger and same-bar protection-path question")
  }
}

function parseAuthorityRow(row: AuthorityRow): ReplayBarLinkedAggregateTradePathAuthoritySnapshot {
  const authority = JSON.parse(row.authority_json) as ReplayBarLinkedAggregateTradePathAuthoritySnapshot
  assertReplayBarLinkedAggregateTradePathAuthoritySnapshot(authority)
  if (authority.authority_snapshot_hash !== row.authority_snapshot_hash) {
    throw new Error("Replay bar-linked path authority registry row is inconsistent")
  }
  return authority
}
