import { expect, test } from "bun:test"
import { assertReplayOhlcvResolutionEvidence, canonicalHash, replayOhlcvActiveProtectionHash, replayOhlcvEconomicImpactHash, replayOhlcvResolutionEvidenceHash, type ReplayMarketBar, type ReplaySourceEvent } from "../../../contracts/src/lib/replay-contracts"
import { assertReplayOhlcvEconomicImpactBindings, createReplaySimpleBracketOhlcvResolution } from "./replay-ohlcv-resolution"

function protection(stop: number, target: number) {
  return {
    protection_generation: 1, remaining_quantity: 1,
    stop_order_id: "run:order:stop", stop_trigger_price: stop,
    target_order_id: "run:order:target", target_trigger_price: target,
  }
}

const economics = {
  entry_basis_price: 100, exit_side: "sell" as const,
  cost_policy_id: "fixture-cost", cost_policy_version: "v1",
  fee_bps: 4, slippage_bps: 5,
  price_increment: "0.01", settlement_increment: "0.00000001", settlement_asset: "USDT",
}

const collisionBar: ReplayMarketBar = {
  open_time: "2026-07-14T04:00:00Z", close_time: "2026-07-14T08:00:00Z",
  open: 100, high: 111, low: 89, close: 101, volume: 10, closed: true,
}

function source(kind: "bar_open" | "bar_range"): ReplaySourceEvent {
  const eventTime = kind === "bar_open" ? collisionBar.open_time : collisionBar.close_time
  return {
    source_event_id: `source:${kind}:1:${eventTime}`,
    kind, source_index: 0,
    event_key: {
      event_time: eventTime, boundary_phase: 20, source_sequence: 1,
      event_subphase: kind === "bar_open" ? 0 : 1, stable_event_id: `source:${kind}:1:${eventTime}`,
    },
  }
}

test("OHLCV collision evidence exposes both admissible path owners and picks stop conservatively", () => {
  for (const side of ["long", "short"] as const) {
    const evidence = createReplaySimpleBracketOhlcvResolution({
      run_id: `collision-${side}`, source_event: source("bar_range"), bar: collisionBar,
      position_side: side, active_protection: protection(side === "long" ? 95 : 105, side === "long" ? 105 : 95),
      economics: { ...economics, exit_side: side === "long" ? "sell" : "buy" },
      observation_kind: "bar_range_touch", stop_touched: true, target_touched: true,
      canonical_terminal_role: "stop",
    })
    expect(evidence).toMatchObject({
      status: "resolution_limited", resolution_reason: "stop_target_order_ambiguous",
      canonical: { terminal_role: "stop", selection_policy: "lower_terminal_equity_then_realized_pnl_then_path_id" },
    })
    expect(evidence.paths.map((path) => path.first_terminal_role)).toEqual(
      side === "long" ? ["target", "stop"] : ["stop", "target"],
    )
    expect(evidence.economic_impact).toMatchObject({
      scope: "terminal_fill_contribution_excludes_common_cashflows",
      entry_basis_price: 100, quantity: 1,
      canonical_net_terminal_contribution: evidence.paths.find((path) => path.first_terminal_role === "stop")!
        .net_terminal_contribution,
      canonical_shortfall_to_best: evidence.economic_impact.net_terminal_contribution_span,
    })
    expect(evidence.economic_impact.net_terminal_contribution_span).toBeGreaterThan(0)
    expect(evidence.paths.map(({ first_terminal_role, simulated_execution_price, gross_realized_pnl, exit_fee, net_terminal_contribution }) => ({
      first_terminal_role, simulated_execution_price, gross_realized_pnl, exit_fee, net_terminal_contribution,
    }))).toEqual(side === "long" ? [
      { first_terminal_role: "target", simulated_execution_price: 104.94, gross_realized_pnl: 4.94, exit_fee: 0.041976, net_terminal_contribution: 4.898024 },
      { first_terminal_role: "stop", simulated_execution_price: 94.95, gross_realized_pnl: -5.05, exit_fee: 0.03798, net_terminal_contribution: -5.08798 },
    ] : [
      { first_terminal_role: "stop", simulated_execution_price: 105.06, gross_realized_pnl: -5.06, exit_fee: 0.042024, net_terminal_contribution: -5.102024 },
      { first_terminal_role: "target", simulated_execution_price: 95.05, gross_realized_pnl: 4.95, exit_fee: 0.03802, net_terminal_contribution: 4.91198 },
    ])
    expect(evidence.economic_impact.net_terminal_contribution_span)
      .toBe(side === "long" ? 9.986004 : 10.014004)
    expect(() => assertReplayOhlcvEconomicImpactBindings(
      evidence, { ...economics, exit_side: side === "long" ? "sell" : "buy" },
    )).not.toThrow()
    expect(evidence.canonical.path_id).toBe(side === "long" ? "open_low_high_close" : "open_high_low_close")
    expect(() => assertReplayOhlcvResolutionEvidence(evidence)).not.toThrow()

    const tampered = structuredClone(evidence)
    tampered.paths[0].first_terminal_role = tampered.paths[0].first_terminal_role === "stop" ? "target" : "stop"
    const { evidence_hash: _oldHash, ...body } = tampered
    tampered.evidence_hash = canonicalHash(body)
    expect(() => assertReplayOhlcvResolutionEvidence(tampered)).toThrow("path digest mismatch")

    const policyTampered = structuredClone(evidence)
    policyTampered.economic_impact.fee_bps = 8
    policyTampered.economic_impact.impact_hash = replayOhlcvEconomicImpactHash(policyTampered.economic_impact)
    policyTampered.evidence_hash = replayOhlcvResolutionEvidenceHash(policyTampered)
    expect(() => assertReplayOhlcvResolutionEvidence(policyTampered)).not.toThrow()
    expect(() => assertReplayOhlcvEconomicImpactBindings(
      policyTampered, { ...economics, exit_side: side === "long" ? "sell" : "buy" },
    )).toThrow("does not match frozen execution inputs")
  }
})

test("observed gaps and single terminal touches are exact under the two-path envelope", () => {
  const gapBar = { ...collisionBar, open: 90, high: 102, low: 88, close: 100 }
  const gap = createReplaySimpleBracketOhlcvResolution({
    run_id: "gap", source_event: { ...source("bar_open"), event_key: { ...source("bar_open").event_key }, source_index: 0 },
    bar: gapBar, position_side: "long", active_protection: protection(95, 110), economics,
    observation_kind: "bar_open_gap", stop_touched: true, target_touched: false,
    canonical_terminal_role: "stop",
  })
  expect(gap).toMatchObject({ status: "exact_under_ohlc", resolution_reason: "open_gap_observed" })
  expect(gap.paths.map((path) => [path.first_terminal_role, path.trigger_price]))
    .toEqual([["stop", 90], ["stop", 90]])
  expect(gap.economic_impact).toMatchObject({
    net_terminal_contribution_span: 0, canonical_shortfall_to_best: 0,
  })

  const single = createReplaySimpleBracketOhlcvResolution({
    run_id: "single", source_event: source("bar_range"),
    bar: { ...collisionBar, low: 99 }, position_side: "long",
    active_protection: protection(95, 105), economics,
    observation_kind: "bar_range_touch", stop_touched: false, target_touched: true,
    canonical_terminal_role: "target",
  })
  expect(single).toMatchObject({ status: "exact_under_ohlc", resolution_reason: "single_terminal_touch" })
  expect(single.paths.map((path) => [path.first_terminal_role, path.trigger_price]))
    .toEqual([["target", 105], ["target", 105]])

  const triggerTamper = structuredClone(single)
  for (const path of triggerTamper.paths) {
    path.trigger_price = 106
    const { path_digest: _pathDigest, ...pathBody } = path
    path.path_digest = canonicalHash(pathBody)
  }
  const { evidence_hash: _evidenceHash, ...triggerTamperBody } = triggerTamper
  triggerTamper.evidence_hash = canonicalHash(triggerTamperBody)
  expect(() => assertReplayOhlcvResolutionEvidence(triggerTamper))
    .toThrow("single-touch resolution evidence is inconsistent")

  const sourceTamper = structuredClone(single)
  sourceTamper.source_event_id = "forged-source"
  const { evidence_hash: _sourceHash, ...sourceTamperBody } = sourceTamper
  sourceTamper.evidence_hash = canonicalHash(sourceTamperBody)
  expect(() => assertReplayOhlcvResolutionEvidence(sourceTamper))
    .toThrow("source id does not match its EventKey")
})

test("single-sided protection makes the cancelled sibling unreachable without inventing intrabar order", () => {
  const stopOnly = createReplaySimpleBracketOhlcvResolution({
    run_id: "stop-only", source_event: source("bar_range"), bar: collisionBar,
    position_side: "long",
    active_protection: {
      ...protection(95, 105), protection_mode: "stop_only",
      stop_order_status: "active", target_order_status: "cancelled",
    },
    economics, observation_kind: "bar_range_touch", stop_touched: true, target_touched: false,
    canonical_terminal_role: "stop",
  })
  const targetOnly = createReplaySimpleBracketOhlcvResolution({
    run_id: "target-only", source_event: source("bar_range"), bar: collisionBar,
    position_side: "long",
    active_protection: {
      ...protection(95, 105), protection_mode: "target_only",
      stop_order_status: "cancelled", target_order_status: "active",
    },
    economics, observation_kind: "bar_range_touch", stop_touched: false, target_touched: true,
    canonical_terminal_role: "target",
  })
  expect(stopOnly.paths.every((path) => path.first_terminal_role === "stop")).toBe(true)
  expect(targetOnly.paths.every((path) => path.first_terminal_role === "target")).toBe(true)
  expect(stopOnly.status).toBe("exact_under_ohlc")
  expect(targetOnly.status).toBe("exact_under_ohlc")
  expect(() => assertReplayOhlcvResolutionEvidence(stopOnly)).not.toThrow()
  expect(() => assertReplayOhlcvResolutionEvidence(targetOnly)).not.toThrow()

  const rehashedStatusTamper = structuredClone(targetOnly)
  rehashedStatusTamper.active_protection.stop_order_status = "active"
  rehashedStatusTamper.active_protection.protection_hash = replayOhlcvActiveProtectionHash(rehashedStatusTamper.active_protection)
  const { evidence_hash: _evidenceHash, ...body } = rehashedStatusTamper
  rehashedStatusTamper.evidence_hash = canonicalHash(body)
  expect(() => assertReplayOhlcvResolutionEvidence(rehashedStatusTamper))
    .toThrow("protection mode and Order statuses are inconsistent")
})
