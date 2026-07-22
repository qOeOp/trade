import { expect, test } from "bun:test"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import {
  REPLAY_PORTFOLIO_TWO_FIXED_PARTIAL_RESERVATION_SCHEMA_VERSION,
  REPLAY_PORTFOLIO_TWO_FIXED_PARTIAL_CYCLE_SEQUENCE_RESERVATION_SCHEMA_VERSION,
  createReplayPortfolioTwoFixedPartialReservationSnapshot,
  createReplayPortfolioTwoFixedPartialCycleSequenceReservationSnapshot,
  type ReplayPortfolioTwoFixedPartialReservationSnapshot,
} from "../../../../research-control-plane/contracts/src/lib/control-plane-contracts"
import {
  REPLAY_DECISION_SCHEDULE_SCHEMA_VERSION,
  REPLAY_PARTIAL_REDUCE_INTENT_SCHEMA_VERSION,
  REPLAY_PARTIAL_REDUCE_PROTECTION_POLICY_VERSION,
  canonicalHash,
  type ReplayArtifactManifest,
  type ReplayExecutionRequest,
  type ReplayFill,
  type ReplayPartialReduceIntent,
  type ReplayResult,
} from "../../../contracts/src/lib/replay-contracts"
import {
  assertReplayPortfolioTwoFixedPartialAccountingArtifactManifest,
  assertReplayPortfolioTwoFixedPartialAccountingEvidence,
} from "../../../contracts/src/lib/replay-portfolio-two-fixed-partial-accounting-contracts"
import { assertReplayPortfolioTwoFixedPartialCycleSequenceEvidence } from
  "../../../contracts/src/lib/replay-portfolio-two-fixed-partial-cycle-sequence-contracts"
import {
  runReplayPortfolioTwoFixedPartialTerminalProjection,
} from "./replay-portfolio-two-fixed-partial-terminal-runner"
import { runReplayPortfolioTwoFixedPartialTerminalAccounting } from
  "./replay-portfolio-two-fixed-partial-accounting-runner"
import { runReplayPortfolioTwoFixedPartialCycleSequence } from
  "./replay-portfolio-two-fixed-partial-cycle-sequence-runner"
import { createReplayLocalArtifactStore } from "./replay-local-artifact-store"
import type { ReplayArtifactStore } from "./replay-artifact-store"
import type { ReplayTrialRunInput, ReplayTrialRunOutcome } from "./replay-trial-runner"

test("Runner materializes two frozen partial authorities into generation-three Portfolio evidence", () => {
  const trial = fixture()
  const authority = authorityFor(trial)
  let calls = 0
  const projected = runReplayPortfolioTwoFixedPartialTerminalProjection({ authority,
    lanes: [{ lane_id: "lane-1", trial }], execute_lane_replay: (received) => {
      calls += 1; expect(received).toBe(trial); return completed(trial)
    } })
  expect(calls).toBe(1)
  expect(projected).toMatchObject({ idempotent_replay: true,
    evidence: { portfolio_id: "portfolio-p27", ending_settled_cash: 112.5,
      ending_available_cash: 112.5, ending_active_stop_bounded_risk: 0,
      total_risk_budget_released: 10 } })
  expect(projected.evidence.lane_records[0]).toMatchObject({ owner: "strategy_exit",
    partial_steps: [{ partial_sequence: 1, protection_generation: 2, remaining_quantity: 0.7 },
      { partial_sequence: 2, protection_generation: 3, remaining_quantity: 0.4 }] })
  expect(projected.lane_results.map((item) => item.lane_id)).toEqual(["lane-1"])
})

test("Runner rejects authority drift and any schedule other than exactly two bounded partials before Replay", () => {
  const trial = fixture(); const authority = authorityFor(trial)
  let calls = 0
  const execute = () => { calls += 1; return completed(trial) }
  const drift = structuredClone(authority); drift.lanes[0]!.isolated_collateral = 21
  expect(() => runReplayPortfolioTwoFixedPartialTerminalProjection({ authority: drift,
    lanes: [{ lane_id: "lane-1", trial }], execute_lane_replay: execute })).toThrow("reservation hash")
  const missing = fixture(); missing.request.decision_schedule.entries.splice(1, 1)
  missing.request.decision_schedule_hash = canonicalHash(missing.request.decision_schedule)
  missing.attempt_lease.request_hash = canonicalHash(missing.request)
  const missingAuthority = authorityFor(missing)
  expect(() => runReplayPortfolioTwoFixedPartialTerminalProjection({ authority: missingAuthority,
    lanes: [{ lane_id: "lane-1", trial: missing }], execute_lane_replay: execute }))
    .toThrow("exactly two bounded partials")
  expect(calls).toBe(0)
})

test("P27 owner-keyed accounting commits one manifest-last Portfolio Artifact and retries idempotently", () => {
  const trial = fixture(); const authority = authorityFor(trial)
  const root = mkdtempSync(join(tmpdir(), "replay-p27-accounting-"))
  const interruptedRoot = mkdtempSync(join(tmpdir(), "replay-p27-accounting-interrupted-"))
  try {
    const input = { authority, lanes: [{ lane_id: "lane-1", trial }],
      execute_lane_replay: () => completed(trial), artifact_store: createReplayLocalArtifactStore(root) }
    const first = runReplayPortfolioTwoFixedPartialTerminalAccounting(input)
    expect(first).toMatchObject({ status: "completed", idempotent_replay: false,
      evidence: { shared_initial_cash: 100, owner_posting_counts: { strategy_exit: 3 },
        trial_balance: { ending_available_cash: 112.5, ending_reserved_isolated_collateral: 0,
          ending_settled_cash: 112.5, ending_portfolio_nav: 112.5, balanced: true } } })
    expect(first.evidence?.ledger.map((entry) => [entry.cashflow_kind, entry.amount,
      entry.terminal_owner])).toEqual([
      ["realized_pnl", 1.5, "strategy_exit"], ["realized_pnl", 3, "strategy_exit"],
      ["realized_pnl", 8, "strategy_exit"],
    ])
    expect(first.artifact_manifest?.files.map((file) => file.role)).toEqual([
      "reservation", "lane_result_artifact_manifests", "lane_results", "terminal_evidence",
      "ledger", "journal", "trial_balance", "accounting_evidence",
    ])
    expect(first.artifact_manifest?.completeness).toMatchObject({ authoritative_result: true,
      commit_marker: "portfolio-two-fixed-partial-accounting-artifact-manifest.json",
      partial_payload_without_manifest_is_authoritative: false })
    const tamperedEvidence = structuredClone(first.evidence!)
    tamperedEvidence.ledger[0]!.terminal_owner = "generation_three_take_profit"
    expect(() => assertReplayPortfolioTwoFixedPartialAccountingEvidence(tamperedEvidence)).toThrow("drift")
    const tamperedManifest = structuredClone(first.artifact_manifest!)
    tamperedManifest.files[0]!.sha256 = "0".repeat(64)
    expect(() => assertReplayPortfolioTwoFixedPartialAccountingArtifactManifest(tamperedManifest)).toThrow("drift")
    expect(runReplayPortfolioTwoFixedPartialTerminalAccounting(input)).toMatchObject({
      status: "completed", idempotent_replay: true, evidence: first.evidence,
      artifact_manifest: first.artifact_manifest,
    })

    const base = createReplayLocalArtifactStore(interruptedRoot)
    const interrupted = runReplayPortfolioTwoFixedPartialTerminalAccounting({ ...input,
      artifact_store: failWriteOnce(base, "journal.json") })
    expect(interrupted).toMatchObject({ status: "failed", evidence: null, terminal_evidence: null,
      artifact_manifest: null, failure: { code: "artifact-publication-failed",
        partial_portfolio_result_published: false } })
    expect(base.discoverAttemptNamespaces().some((namespace) => namespace.exists(
      "portfolio-two-fixed-partial-accounting-artifact-manifest.json"))).toBe(false)
    expect(runReplayPortfolioTwoFixedPartialTerminalAccounting({ ...input,
      artifact_store: base })).toMatchObject({ status: "completed", idempotent_replay: false })
  } finally {
    rmSync(root, { recursive: true, force: true })
    rmSync(interruptedRoot, { recursive: true, force: true })
  }
})

test("P27 rolls four predeclared full-flat cycles from committed Trial Balances and commits manifest last", () => {
  const cycles = [100, 112.5, 125, 137.5].map((initialCash, index) => {
    const trial = fixture({ index, initialCash }); const laneId = `lane-${index + 1}`
    return { cycle_index: index + 1, laneId, trial, authority: authorityFor(trial, laneId) }
  })
  const sequenceAuthority = createReplayPortfolioTwoFixedPartialCycleSequenceReservationSnapshot({
    schema_version: REPLAY_PORTFOLIO_TWO_FIXED_PARTIAL_CYCLE_SEQUENCE_RESERVATION_SCHEMA_VERSION,
    reservation_id: "p27-sequence-1", reservation_ref: "reservation://p27-sequence/1",
    issued_at: "2026-07-14T00:00:00Z", expires_at: "2026-07-14T01:00:00Z", status: "reserved",
    authority_id: "research-control-plane", experiment_id: "experiment-1", trial_group_id: "group-1",
    trial_group_hash: "9".repeat(64), portfolio_id: "portfolio-p27", settlement_asset: "USDT",
    initial_cash: 100, cycle_count: 4, max_cycle_count: 8,
    opening_cash_policy: "first_cycle_initial_then_predecessor_committed_trial_balance",
    successor_eligibility_policy: "predecessor_committed_full_flat_exposure_collateral_and_risk_zero",
    expansion_policy: "exact_predeclared_child_reservations_no_runtime_append_or_search_expansion",
    cycles: cycles.map((cycle) => ({ cycle_index: cycle.cycle_index,
      two_fixed_partial_reservation_hash: cycle.authority.reservation_hash,
      earliest_cycle_time: completed(cycle.trial).result!.fills[0]!.timestamp,
      lanes: cycle.authority.lanes.map((lane) => ({ lane_id: lane.lane_id,
        priority_rank: lane.priority_rank, trial_id: lane.trial_id, run_id: lane.run_id,
        trial_reservation_hash: lane.trial_reservation_hash, request_hash: lane.request_hash })) })),
    limitations: ["one_to_eight_predeclared_two_fixed_partial_full_flat_cycles_only",
      "cycle_opening_cash_must_equal_predecessor_committed_trial_balance",
      "no_dynamic_sizing_third_partial_post_partial_mutation_reentry_cross_margin_borrow_real_liquidity_fast_or_runtime_cycle_expansion"],
  })
  const root = mkdtempSync(join(tmpdir(), "replay-p27-sequence-"))
  const failureRoot = mkdtempSync(join(tmpdir(), "replay-p27-sequence-failure-"))
  const openRoot = mkdtempSync(join(tmpdir(), "replay-p27-sequence-open-"))
  const interruptedRoot = mkdtempSync(join(tmpdir(), "replay-p27-sequence-interrupted-"))
  const cycleInputs = cycles.map((cycle) => ({ cycle_index: cycle.cycle_index,
    authority: cycle.authority, lanes: [{ lane_id: cycle.laneId, trial: cycle.trial }] }))
  try {
    const input = { sequence_authority: sequenceAuthority, cycles: cycleInputs,
      artifact_store: createReplayLocalArtifactStore(root), execute_lane_replay: completed }
    const outcome = runReplayPortfolioTwoFixedPartialCycleSequence(input)
    if (!outcome.evidence || !outcome.artifact_manifest) throw new Error(outcome.failure?.message)
    expect(outcome.evidence.cycle_commits.map((commit) => [commit.cycle_index,
      commit.opening_available_cash, commit.ending_available_cash])).toEqual([
      [1, 100, 112.5], [2, 112.5, 125], [3, 125, 137.5], [4, 137.5, 150],
    ])
    expect(outcome.evidence.consolidated_ledger.filter((entry) =>
      entry.cycle_entry.cashflow_kind === "realized_pnl")).toHaveLength(12)
    expect(outcome.evidence.consolidated_journal.filter((entry) =>
      entry.cycle_entry.posting_kind === "opening_cash")).toHaveLength(1)
    expect(outcome.evidence.consolidated_trial_balance).toMatchObject({ ending_available_cash: 150,
      ending_reserved_isolated_collateral: 0, ending_unrealized_pnl: 0,
      opening_equity_posting_count: 1, balanced: true })
    expect(outcome.artifact_manifest.files.map((file) => file.role)).toEqual([
      "sequence_reservation", "cycle_child_reservations", "cycle_accounting_artifact_manifests",
      "cycle_terminal_evidence", "cycle_accounting_evidence", "consolidated_ledger",
      "consolidated_journal", "consolidated_trial_balance", "cycle_sequence_fingerprint",
      "cycle_sequence_evidence",
    ])
    expect(runReplayPortfolioTwoFixedPartialCycleSequence(input)).toMatchObject({
      status: "completed", idempotent_replay: true, evidence: outcome.evidence,
      artifact_manifest: outcome.artifact_manifest,
    })
    const tampered = structuredClone(outcome.evidence); tampered.cycle_commits[1]!.opening_available_cash += 1
    expect(() => assertReplayPortfolioTwoFixedPartialCycleSequenceEvidence(tampered)).toThrow("drift")

    let calls = 0
    const midFailure = runReplayPortfolioTwoFixedPartialCycleSequence({ ...input,
      artifact_store: createReplayLocalArtifactStore(failureRoot), execute_lane_replay: (trial) => {
        calls += 1; if (calls === 3) throw new Error("fixture cycle 3 failed"); return completed(trial)
      } })
    expect(midFailure).toMatchObject({ status: "failed", evidence: null, artifact_manifest: null,
      failure: { code: "cycle-child-failed", cycle_index: 3, partial_sequence_result_published: false } })

    const openFailure = runReplayPortfolioTwoFixedPartialCycleSequence({ ...input,
      artifact_store: createReplayLocalArtifactStore(openRoot), execute_lane_replay: (trial) =>
        trial.request.run_id === cycles[1]!.trial.request.run_id ? completedOpen(trial) : completed(trial) })
    expect(openFailure).toMatchObject({ status: "failed", evidence: null, artifact_manifest: null,
      failure: { code: "cycle-not-full-flat", cycle_index: 2 } })

    const interruptedBase = createReplayLocalArtifactStore(interruptedRoot)
    const interrupted = runReplayPortfolioTwoFixedPartialCycleSequence({ ...input,
      artifact_store: failWriteOnce(interruptedBase, "consolidated-journal.json") })
    expect(interrupted).toMatchObject({ status: "failed", evidence: null, artifact_manifest: null,
      failure: { code: "cycle-sequence-artifact-failed", partial_sequence_result_published: false } })
    expect(interruptedBase.discoverAttemptNamespaces().some((namespace) => namespace.exists(
      "portfolio-two-fixed-partial-cycle-sequence-artifact-manifest.json"))).toBe(false)
  } finally {
    for (const directory of [root, failureRoot, openRoot, interruptedRoot]) {
      rmSync(directory, { recursive: true, force: true })
    }
  }
})

function fixture(options: { index?: number; initialCash?: number } = {}): ReplayTrialRunInput {
  const index = options.index ?? 0; const initialCash = options.initialCash ?? 100
  const at = (offset: number) => `2026-07-14T00:${String(index * 8 + offset).padStart(2, "0")}:00Z`
  const partial = (signal: string, executable: string): ReplayPartialReduceIntent => ({
    schema_version: REPLAY_PARTIAL_REDUCE_INTENT_SCHEMA_VERSION, side: "sell", order_type: "market",
    reduce_only: true, quantity_policy: "fixed_quantity", quantity: 0.3,
    signal_time: signal, earliest_executable_time: executable, post_fill_position_policy: "must_remain_open",
    protection_resize_policy: "after_fill_cancel_both_then_replace_remaining_at_same_source_boundary",
    protection_policy_version: REPLAY_PARTIAL_REDUCE_PROTECTION_POLICY_VERSION,
    replacement_trigger_policy: "preserve_current_stop_and_target_prices",
    remaining_quantity_authority: "absolute_post_fill_position",
    schedule_combination_policy: "up_to_two_partial_reduces_then_optional_final_full_exit_no_other_mutation",
  })
  const first = partial(at(1), at(2))
  const second = partial(at(3), at(4))
  const exit = { schema_version: "trade.rd-replay-reduce-only-exit-intent.v1" as const,
    side: "sell" as const, order_type: "market" as const, reduce_only: true as const,
    quantity_policy: "full_open_position" as const, signal_time: at(5),
    earliest_executable_time: at(6) }
  const entries: ReplayExecutionRequest["decision_schedule"]["entries"] = [first, second].map((intent, index) => ({
    decision_sequence: index + 1, decision_time: intent.signal_time,
    expected_effect: "authorized_partial_reduce", authorized_reduce_only_exit: null,
    authorized_protective_stop_replace: null, authorized_partial_reduce: intent,
    authorized_order_hash: canonicalHash(intent),
  }))
  entries.push({ decision_sequence: 3, decision_time: exit.signal_time,
    expected_effect: "authorized_reduce_only_exit", authorized_reduce_only_exit: exit,
    authorized_protective_stop_replace: null, authorized_partial_reduce: null,
    authorized_order_hash: canonicalHash(exit) })
  const schedule = { schema_version: REPLAY_DECISION_SCHEDULE_SCHEMA_VERSION,
    schedule_policy: "frozen_closed_bar_schedule" as const, entries }
  const suffix = index === 0 ? "p27" : `p27-${index + 1}`
  const request = { run_id: `run-${suffix}`, experiment_id: "experiment-1", trial_group_id: "group-1",
    trial_group_hash: "9".repeat(64), trial_id: `trial-${index + 1}`,
    trial_reservation_ref: `reservation://trial-${index + 1}`,
    trial_reservation_hash: String((index + 8) % 10).repeat(64),
    symbol: "BTCUSDT", initial_cash: initialCash,
    order: { side: "long", quantity: 1, stop_price: 90, target_price: 120 },
    cost_policy: { fee_bps: 0, slippage_bps: 0 }, decision_schedule: schedule,
    decision_schedule_hash: canonicalHash(schedule) } as unknown as ReplayExecutionRequest
  const requestHash = canonicalHash(request)
  return { request, attempt_lease: { request_hash: requestHash }, observed_at: at(7),
    dataset_manifest: { instrument: { accounting: { price_increment: "0.1",
      settlement_increment: "0.1", settlement_asset: "USDT" } } } } as unknown as ReplayTrialRunInput
}

function authorityFor(trial: ReplayTrialRunInput, laneId = "lane-1"): ReplayPortfolioTwoFixedPartialReservationSnapshot {
  return createReplayPortfolioTwoFixedPartialReservationSnapshot({
    schema_version: REPLAY_PORTFOLIO_TWO_FIXED_PARTIAL_RESERVATION_SCHEMA_VERSION,
    reservation_id: `portfolio-p27-reservation:${trial.request.run_id}`,
    reservation_ref: `reservation://portfolio-p27/${trial.request.run_id}`,
    issued_at: "2026-07-14T00:00:00Z", expires_at: "2026-07-14T01:00:00Z", status: "reserved",
    authority_id: "research-control-plane", experiment_id: trial.request.experiment_id,
    trial_group_id: trial.request.trial_group_id, trial_group_hash: trial.request.trial_group_hash,
    portfolio_id: "portfolio-p27", settlement_asset: "USDT",
    source_terminal_evidence_hash: "a".repeat(64), source_terminal_artifact_manifest_hash: "b".repeat(64),
    risk_result_hash: "c".repeat(64), projection_policy_version: "two-predeclared-fixed-partials-terminal-risk-v1",
    lanes: [{ lane_id: laneId, priority_rank: 1, trial_id: trial.request.trial_id,
      run_id: trial.request.run_id, trial_reservation_ref: trial.request.trial_reservation_ref,
      trial_reservation_hash: trial.request.trial_reservation_hash, request_hash: canonicalHash(trial.request),
      source_terminal_record_hash: "d".repeat(64), isolated_collateral: 20 }],
    limitations: ["exactly_two_predeclared_fixed_quantity_partial_reduces_per_opened_lane",
      "projection_only_no_contract_search_review_or_lifecycle_authority",
      "no_dynamic_sizing_third_partial_post_partial_mutation_reentry_cross_margin_borrow_real_liquidity_or_fast"],
  })
}

function completed(trial: ReplayTrialRunInput): ReplayTrialRunOutcome {
  const partials = trial.request.decision_schedule.entries.filter((entry) =>
    entry.expected_effect === "authorized_partial_reduce").map((entry) => entry.authorized_partial_reduce!)
  const exit = trial.request.decision_schedule.entries.find((entry) =>
    entry.expected_effect === "authorized_reduce_only_exit")!.authorized_reduce_only_exit!
  const firstTime = partials[0]!.earliest_executable_time
  const secondTime = partials[1]!.earliest_executable_time
  const exitTime = exit.earliest_executable_time
  const entryTime = new Date(Date.parse(firstTime) - 120_000).toISOString().replace(".000Z", "Z")
  const event = (time: string, id: string) => ({ event_time: time, boundary_phase: 20 as const,
    source_sequence: 1, event_subphase: 0, stable_event_id: id })
  const fill = (id: string, role: ReplayFill["order_role"], quantity: number, price: number,
    time: string): ReplayFill => ({ fill_id: id, order_id: `order:${id}`, order_role: role,
    event_key: event(time, id), timestamp: time, side: role === "entry" ? "buy" : "sell",
    quantity, price, fee: 0, reduce_only: role !== "entry" })
  const fills = [fill("entry", "entry", 1, 100, entryTime),
    fill("partial-1", "strategy_partial_reduce", 0.3, 105, firstTime),
    fill("partial-2", "strategy_partial_reduce", 0.3, 110, secondTime),
    fill("exit", "strategy_exit", 0.4, 120, exitTime)]
  const position = (id: string, fillId: string, time: string, signed: number, delta: number, cumulative: number) => ({
    position_event_id: id, position_id: "position-1", sequence: 1, event_key: event(time, fillId),
    timestamp: time, cause_fill_id: fillId, symbol: "BTCUSDT", accounting_method: "average_cost" as const,
    numeric_policy_version: "rd-replay-number-v3" as const, state: signed === 0 ? "flat" as const : "open" as const,
    side: signed === 0 ? null : "long" as const, signed_quantity: signed,
    average_entry_price: signed === 0 ? null : 100, valuation_price: 100,
    valuation_source: "fill_price" as const, realized_pnl_delta: delta,
    realized_pnl_cumulative: cumulative, unrealized_pnl: 0 })
  const positions: ReplayResult["positions"] = [position("p0", "entry", entryTime, 1, 0, 0),
    position("p1", "partial-1", firstTime, 0.7, 1.5, 1.5),
    position("p2", "partial-2", secondTime, 0.4, 3, 4.5),
    position("p3", "exit", exitTime, 0, 8, 12.5)]
  let balance = trial.request.initial_cash
  const cashflows = positions.slice(1).map((position, index) => {
    balance += position.realized_pnl_delta
    return { entry_id: `ledger-${index}`, event_key: position.event_key, timestamp: position.timestamp,
      kind: "realized_pnl" as const, amount: position.realized_pnl_delta, balance_after: balance,
      ref: position.cause_fill_id, sequence: index + 1 }
  }) as ReplayResult["ledger"]
  const ledger: ReplayResult["ledger"] = [{ entry_id: "ledger-initial", event_key: event(
    entryTime, "ledger-initial"), timestamp: entryTime,
  kind: "initial_cash", amount: trial.request.initial_cash, balance_after: trial.request.initial_cash,
  ref: trial.request.run_id }, ...cashflows,
  { entry_id: "ledger-ending", event_key: event(exitTime, "ledger-ending"),
    timestamp: exitTime, kind: "ending_cash", amount: 0,
    balance_after: balance, ref: trial.request.run_id }]
  const resultHash = canonicalHash({ fills, positions, ledger })
  const sourceEvents = [entryTime, firstTime, secondTime, exitTime].map((time, index) => ({
    source_event_id: `source:${index}`, kind: "bar_open" as const, source_index: index,
    event_key: { event_time: time, boundary_phase: 0 as const, source_sequence: index,
      event_subphase: 0, stable_event_id: `source:${index}` },
  }))
  const result = { run_id: trial.request.run_id, source_events: sourceEvents, fills, positions, ledger,
    margin_snapshots: [], liquidation: null,
    equity_bridge: { terminal_position_state: "flat" },
    valuation_snapshot: { signed_quantity: 0, mark_price: 120, unrealized_pnl: 0 },
    fingerprint: { request_hash: canonicalHash(trial.request), result_hash: resultHash } } as unknown as ReplayResult
  return { status: "completed", idempotent_replay: true, result,
    artifact_manifest: { run_id: result.run_id, result_hash: resultHash } as ReplayArtifactManifest,
  } as ReplayTrialRunOutcome
}

function completedOpen(trial: ReplayTrialRunInput): ReplayTrialRunOutcome {
  const completedOutcome = completed(trial)
  const result = structuredClone(completedOutcome.result!)
  result.fills = result.fills.slice(0, 3)
  result.positions = result.positions.slice(0, 3)
  result.source_events = result.source_events.slice(0, 3)
  const lastCashflow = result.ledger.filter((entry) => entry.kind === "realized_pnl").slice(0, 2)
  const ending = addEndingLedger(lastCashflow, trial.request.run_id)
  result.ledger = [result.ledger[0]!, ...lastCashflow, ending]
  result.equity_bridge = { ...result.equity_bridge, terminal_position_state: "open" }
  result.valuation_snapshot = { ...result.valuation_snapshot, signed_quantity: 0.4,
    mark_price: 110, unrealized_pnl: 4 }
  const resultHash = canonicalHash({ fills: result.fills, positions: result.positions, ledger: result.ledger })
  result.fingerprint.result_hash = resultHash
  return { ...completedOutcome, result,
    artifact_manifest: { run_id: result.run_id, result_hash: resultHash } as ReplayArtifactManifest }
}

function addEndingLedger(cashflows: ReplayResult["ledger"], runId: string) {
  const last = cashflows.at(-1)!; const balance = last.balance_after
  return { entry_id: "ledger-ending-open", event_key: { ...last.event_key,
    stable_event_id: "ledger-ending-open" }, timestamp: last.timestamp,
  kind: "ending_cash" as const, amount: 0, balance_after: balance, ref: runId }
}

function failWriteOnce(store: ReturnType<typeof createReplayLocalArtifactStore>, name: string): ReplayArtifactStore {
  let failed = false
  return { capability: store.capability, openAttempt: (identity) => {
    const namespace = store.openAttempt(identity)
    return { ...namespace, namespace_ref: namespace.namespace_ref,
      fileRef: namespace.fileRef.bind(namespace), exists: namespace.exists.bind(namespace),
      listNames: namespace.listNames.bind(namespace), read: namespace.read.bind(namespace),
      readRef: namespace.readRef.bind(namespace), remove: namespace.remove.bind(namespace),
      writeImmutable: (candidate, content) => {
        if (!failed && candidate === name) { failed = true; throw new Error("fixture interrupted publication") }
        return namespace.writeImmutable(candidate, content)
      } }
  } }
}
