import assert from "node:assert/strict"
import { mkdtempSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import test from "node:test"
import { run } from "./main"
import { CONTROL_PLANE_IDENTITY_SCHEMA_VERSION, REPLAY_ATTEMPT_LEASE_SCHEMA_VERSION, TRIAL_RESERVATION_SNAPSHOT_SCHEMA_VERSION, hashTrialReservationSnapshot, type ReplayAttemptLeaseSnapshot, type TrialReservationSnapshot } from "../../../../../research-control-plane/contracts/src/lib/control-plane-contracts"
import { REPLAY_CERTIFIED_CAPABILITIES, REPLAY_DATASET_MANIFEST_SCHEMA_VERSION, REPLAY_INSTRUMENT_ACCOUNTING_SPEC_VERSION, REPLAY_INSTRUMENT_SPEC_SNAPSHOT_SCHEMA_VERSION, REPLAY_REQUEST_SCHEMA_VERSION, REPLAY_SIMULATOR_POLICY_VERSION, REPLAY_VENUE_RISK_POLICY_SCHEMA_VERSION, canonicalHash, replayDatasetHash, replayExecutionSpecHash, type ReplayExecutionRequest } from "../../../../contracts/src/lib/replay-contracts"

type JSONRecord = Record<string, unknown>

test("replay runner requires a manifest", () => {
  const result = run([])
  assert.equal(result.ok, false)
  assert.match(String(result.error), /requires --manifest/)
})

test("replay runner exposes owner fingerprint surface", () => {
  const result = run(["--fingerprint"]) as {
    ok: boolean
    data: { harness_hash: string }
  }
  assert.equal(result.ok, true)
  assert.equal(typeof result.data.harness_hash, "string")
  assert.equal(result.data.harness_hash.length, 64)
})

test("replay runner executes registered strategy", () => {
  const dir = mkdtempSync(join(tmpdir(), "replay-runner-"))
  const csvPath = join(dir, "BTCUSDT-4h.csv")
  const manifestPath = join(dir, "manifest.json")
  writeFileSync(csvPath, buildCsv())
  writeFileSync(manifestPath, JSON.stringify({
    symbol: "BTCUSDT",
    timeframes: {
      "4h": {
        file: "BTCUSDT-4h.csv",
      },
    },
  }))

  const result = run(["--manifest", manifestPath, "--strategy-id", "S-BTC-4H-TREND-PULLBACK"])
  assert.equal(result.ok, true)
  const data = asRecord(result.data)
  assert.equal(data.strategy_id, "S-BTC-4H-TREND-PULLBACK")
  assert.equal(data.timeframe, "4h")
  assert.ok(Number(data.sample_count) > 0)
})

test("legacy replay runner adapts Trial-bound requests to Replay Execution Plane", () => {
  const hash = "a".repeat(64)
  const bars = [{ open_time: "2026-07-14T04:00:00Z", close_time: "2026-07-14T08:00:00Z", open: 100, high: 111, low: 99, close: 110, volume: 10, closed: true as const }]
  const dataHash = replayDatasetHash(bars)
  const maintenanceTier = { tier_id: "tier-1", snapshot_ref: "fixture:margin-tier-1", snapshot_hash: hash, notional_floor: 0, notional_cap: 50_000, maintenance_margin_rate: 0.005, maintenance_amount: 0 }
  const riskSnapshot = { schema_version: REPLAY_VENUE_RISK_POLICY_SCHEMA_VERSION, snapshot_id: "risk-1", venue_id: "binance-usdm", symbol: "BTCUSDT", effective_at: "2020-01-01T00:00:00Z", valid_until: null, observed_at: "2026-07-13T00:00:00Z", source_ref: "fixture:risk-1", source_hash: hash, initial_margin_rate: 0.1, maintenance_tier: maintenanceTier, liquidation_fee_bps: 50 }
  const specSnapshot = { schema_version: REPLAY_INSTRUMENT_SPEC_SNAPSHOT_SCHEMA_VERSION, snapshot_id: "spec-1", venue_id: "binance-usdm", symbol: "BTCUSDT", effective_at: "2020-01-01T00:00:00Z", valid_until: null, observed_at: "2026-07-13T00:00:00Z", source_ref: "fixture:spec-1", source_hash: hash }
  const accounting = { spec_version: REPLAY_INSTRUMENT_ACCOUNTING_SPEC_VERSION, product_type: "linear_derivative", base_asset: "BTC", quote_asset: "USDT", settlement_asset: "USDT", contract_multiplier: "1", price_increment: "0.01", quantity_increment: "0.001", settlement_increment: "0.00000001" }
  const executionRequest = {
    schema_version: REPLAY_REQUEST_SCHEMA_VERSION,
    run_id: "adapter-run-1", idempotency_key: "adapter-key-1", experiment_id: "experiment-1",
    trial_group_id: "group-1", trial_group_hash: hash, trial_id: "trial-1", candidate_id: "candidate-1", candidate_hash: hash,
    identity_hash_policy_version: "identity-v1", experiment_contract_hash: hash, dataset_manifest_ref: "dataset://fixture", dataset_hash: dataHash,
    supplemental_facts_hash: canonicalHash([]),
    trial_reservation_ref: "reservation://trial-1", trial_reservation_hash: hash,
    venue_risk_policy_schedule_hash: canonicalHash([riskSnapshot]), instrument_spec_schedule_hash: canonicalHash({ epochs: [specSnapshot], accounting }),
    harness_hash: hash, assumptions_hash: hash, symbol: "BTCUSDT", timeframe: "4h", initial_cash: 1000,
    order: { side: "long", quantity: 1, signal_time: "2026-07-14T00:00:00Z", earliest_executable_time: "2026-07-14T04:00:00Z", stop_price: 95, target_price: 110 },
    cost_policy: { policy_id: "fixture", version: "1", fee_bps: 0, slippage_bps: 0, liquidation_fee_bps: 50 },
    simulator_policy: { version: REPLAY_SIMULATOR_POLICY_VERSION, signal_visibility: "closed_candle", earliest_execution: "next_open", same_bar_policy: "stop_first", gap_fill_policy: "worse_open", position_accounting: "average_cost", funding_timing: "exact_event", end_of_data: "mark_open", margin_evaluation: "before_strategy_orders" },
    margin_policy: { policy_id: "fixture", version: "rd-replay-isolated-margin-v7", mode: "isolated", collateral_asset: "USDT", isolated_collateral: 1000, initial_margin_rate: 0.1, maintenance_tier: maintenanceTier, cashflow_scope: "position_attributed", collateral_transfer: "reserve_at_entry_release_at_terminal_if_flat", settled_cashflow_account: "isolated_margin_collateral", observation_scope: "source_event_path", mark_source_policy: "complete_exact_mark_else_ohlcv_adverse", maintenance_trigger: "margin_balance_below_maintenance_requirement", breach_terminal_priority: "risk_before_strategy_exit", breach_evidence: "first_observed_source_event", maintenance_breach_action: "exact_observation_full_liquidation_else_terminal_failure", liquidation: "simulated_full_close", liquidation_trigger_sources: "mark_or_funding_mark", liquidation_execution_price: "trigger_mark_adverse_slippage", liquidation_quantity: "full_position", liquidation_order_priority: "cancel_strategy_exits_before_forced_fill", liquidation_deficit: "fail_without_result" }, random_seed: 1,
  } as ReplayExecutionRequest
  const trialReservation = authorize(executionRequest)
  const attemptLease = authorizeAttempt(executionRequest, trialReservation)
  const result = run(["--json", JSON.stringify({
    execution_request: executionRequest,
    trial_reservation: trialReservation,
    attempt_lease: attemptLease,
    observed_at: "2026-07-14T00:01:00Z",
    dataset_manifest: {
      schema_version: REPLAY_DATASET_MANIFEST_SCHEMA_VERSION,
      manifest_id: "manifest-1", manifest_ref: "dataset://fixture", data_hash: dataHash,
      dataset_kind: "ohlcv", symbol: "BTCUSDT", timeframe: "4h", interval_ms: 14_400_000,
      row_count: 1, first_open_time: bars[0].open_time, last_close_time: bars[0].close_time,
      observed_through: bars[0].close_time, closed_candles_only: true,
      bar_final_availability: "close_time", funding_availability: "event_time", mark_availability: "event_time",
      mark_coverage: "none", mark_interval_ms: null, mark_event_count: 0, supplemental_facts: { coverage: "none" as const, record_count: 0, source_ids: [], content_hash: canonicalHash([]) },
      venue_risk_policy_epochs: [riskSnapshot],
      instrument: {
        listed_at: "2020-01-01T00:00:00Z", trading_enabled_at: "2020-01-01T00:00:00Z", delisted_at: null, status_history: "complete",
        spec_epochs: [specSnapshot],
        accounting,
      },
      universe: { selected_at: "2026-07-13T00:00:00Z", survivorship: "point_in_time" },
    },
    bars,
  })]) as { ok: boolean; data: { status: string } }
  assert.equal(result.ok, true)
  assert.equal(result.data.status, "completed")
})

function authorize(request: ReplayExecutionRequest): TrialReservationSnapshot {
  const reservation: TrialReservationSnapshot = {
    schema_version: TRIAL_RESERVATION_SNAPSHOT_SCHEMA_VERSION, reservation_id: "reservation-1", reservation_ref: request.trial_reservation_ref,
    issued_at: "2026-07-14T00:00:00Z", expires_at: "2026-07-15T00:00:00Z", status: "reserved", identity: { schema_version: CONTROL_PLANE_IDENTITY_SCHEMA_VERSION, experiment_id: request.experiment_id, trial_group_id: request.trial_group_id, trial_group_hash: request.trial_group_hash, trial_id: request.trial_id, candidate_id: request.candidate_id, candidate_hash: request.candidate_hash, identity_hash_policy_version: request.identity_hash_policy_version, experiment_contract_hash: request.experiment_contract_hash },
    trial_ordinal: 1, run_id: request.run_id, counts_against_budget: true, trial_accounting_policy_version: "count-all-v1", candidate_assignment_hash: "a".repeat(64),
    bindings: { replay_idempotency_key: request.idempotency_key, execution_spec_hash: replayExecutionSpecHash(request), dataset_manifest_ref: request.dataset_manifest_ref, dataset_hash: request.dataset_hash, supplemental_facts_hash: request.supplemental_facts_hash, venue_risk_policy_schedule_hash: request.venue_risk_policy_schedule_hash, instrument_spec_schedule_hash: request.instrument_spec_schedule_hash, harness_hash: request.harness_hash, assumptions_hash: request.assumptions_hash, cost_policy_hash: canonicalHash(request.cost_policy), margin_policy_hash: canonicalHash(request.margin_policy), simulator_policy_version: request.simulator_policy.version, execution_mode: "step" }, required_capabilities: [...REPLAY_CERTIFIED_CAPABILITIES],
  }
  request.trial_reservation_hash = hashTrialReservationSnapshot(reservation)
  return reservation
}

function authorizeAttempt(request: ReplayExecutionRequest, reservation: TrialReservationSnapshot): ReplayAttemptLeaseSnapshot {
  return {
    schema_version: REPLAY_ATTEMPT_LEASE_SCHEMA_VERSION,
    attempt_id: "adapter-attempt-1", attempt_ordinal: 1, worker_id: "adapter-worker-1",
    trial_id: request.trial_id, run_id: request.run_id, reservation_ref: reservation.reservation_ref,
    reservation_hash: hashTrialReservationSnapshot(reservation), request_hash: canonicalHash(request),
    status: "running", lease_generation: 2, claimed_at: "2026-07-14T00:00:00Z",
    heartbeat_at: "2026-07-14T00:00:30Z", lease_expires_at: "2026-07-14T00:05:00Z",
  }
}

function buildCsv(): string {
  const lines = ["date,timestamp,open,high,low,close,volume"]
  const start = 1_700_000_000_000
  let close = 100
  for (let index = 0; index < 260; index += 1) {
    const trend = index < 220 ? 0.25 : 0.35
    const pullback = index > 220 && index % 8 === 0 ? -3 : 0
    const open = close
    close = close + trend + pullback
    const high = Math.max(open, close) + 0.5
    const low = Math.min(open, close) - (pullback < 0 ? Math.abs(pullback) + 0.5 : 0.4)
    const timestamp = start + index * 4 * 60 * 60 * 1000
    lines.push(`${new Date(timestamp).toISOString()},${timestamp},${open.toFixed(2)},${high.toFixed(2)},${low.toFixed(2)},${close.toFixed(2)},${1000 + index}`)
  }
  return `${lines.join("\n")}\n`
}

function asRecord(value: unknown): JSONRecord {
  return value && typeof value === "object" && !Array.isArray(value) ? value as JSONRecord : {}
}
