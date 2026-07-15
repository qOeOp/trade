import { expect, test } from "bun:test"
import { assertReplayOhlcvResolutionEvidence, canonicalHash, type ReplayMarketBar, type ReplaySourceEvent } from "../../../contracts/src/lib/replay-contracts"
import { createReplaySimpleBracketOhlcvResolution } from "./replay-ohlcv-resolution"

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
      position_side: side, active_stop_price: side === "long" ? 95 : 105,
      active_target_price: side === "long" ? 105 : 95,
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
    expect(evidence.canonical.path_id).toBe(side === "long" ? "open_low_high_close" : "open_high_low_close")
    expect(() => assertReplayOhlcvResolutionEvidence(evidence)).not.toThrow()

    const tampered = structuredClone(evidence)
    tampered.paths[0].first_terminal_role = tampered.paths[0].first_terminal_role === "stop" ? "target" : "stop"
    const { evidence_hash: _oldHash, ...body } = tampered
    tampered.evidence_hash = canonicalHash(body)
    expect(() => assertReplayOhlcvResolutionEvidence(tampered)).toThrow("path digest mismatch")
  }
})

test("observed gaps and single terminal touches are exact under the two-path envelope", () => {
  const gapBar = { ...collisionBar, open: 90, high: 102, low: 88, close: 100 }
  const gap = createReplaySimpleBracketOhlcvResolution({
    run_id: "gap", source_event: { ...source("bar_open"), event_key: { ...source("bar_open").event_key }, source_index: 0 },
    bar: gapBar, position_side: "long", active_stop_price: 95, active_target_price: 110,
    observation_kind: "bar_open_gap", stop_touched: true, target_touched: false,
    canonical_terminal_role: "stop",
  })
  expect(gap).toMatchObject({ status: "exact_under_ohlc", resolution_reason: "open_gap_observed" })
  expect(gap.paths.map((path) => [path.first_terminal_role, path.trigger_price]))
    .toEqual([["stop", 90], ["stop", 90]])

  const single = createReplaySimpleBracketOhlcvResolution({
    run_id: "single", source_event: source("bar_range"),
    bar: { ...collisionBar, low: 99 }, position_side: "long",
    active_stop_price: 95, active_target_price: 105,
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
