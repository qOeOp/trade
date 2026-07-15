import { expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import {
  assertReplayOhlcvResolutionEvidence,
  canonicalHash,
  type ReplayMarketBar,
  type ReplayOhlcvPathId,
  type ReplayOhlcvResolutionEvidence,
  type ReplaySourceEvent,
} from "../../contracts/src/lib/replay-contracts"
import { createReplaySimpleBracketOhlcvResolution } from "../../engine/src/lib/replay-ohlcv-resolution"

type Side = "long" | "short"
type TerminalRole = "stop" | "target"
type Sample = [offset_seconds: number, price: number]

interface OracleCase {
  case_id: string
  position_side: Side
  active_stop_price: number
  active_target_price: number
  samples: Sample[]
  expected: {
    observation_kind: "bar_open_gap" | "bar_range_touch"
    status: "exact_under_ohlc" | "resolution_limited"
    resolution_reason: "open_gap_observed" | "single_terminal_touch" | "stop_target_order_ambiguous"
    actual_terminal_role: TerminalRole
    actual_trigger_price: number
    admissible_path_id: ReplayOhlcvPathId | null
  }
}

const fixture = JSON.parse(readFileSync(
  new URL("./fixtures/certified-ohlcv-resolution-oracle-v1.json", import.meta.url), "utf8",
)) as {
  schema_version: string
  open_time: string
  close_time: string
  entry_price: number
  cases: OracleCase[]
}

function assertSamples(samples: Sample[], expectedDurationSeconds: number): void {
  if (samples.length < 2 || samples[0]![0] !== 0
      || samples[samples.length - 1]![0] !== expectedDurationSeconds) {
    throw new Error("oracle samples must cover the complete bar interval")
  }
  for (const [index, [offset, price]] of samples.entries()) {
    if (!Number.isSafeInteger(offset) || offset < 0 || !Number.isFinite(price) || price <= 0
        || index > 0 && offset <= samples[index - 1]![0]) {
      throw new Error("oracle samples must be strictly ordered finite observations")
    }
  }
}

function barFrom(case_: OracleCase): ReplayMarketBar {
  const duration = (Date.parse(fixture.close_time) - Date.parse(fixture.open_time)) / 1000
  assertSamples(case_.samples, duration)
  const prices = case_.samples.map((sample) => sample[1])
  return {
    open_time: fixture.open_time,
    close_time: fixture.close_time,
    open: prices[0]!, high: Math.max(...prices), low: Math.min(...prices), close: prices[prices.length - 1]!,
    volume: 1, closed: true,
  }
}

function crossedRole(side: Side, price: number, stop: number, target: number): TerminalRole | null {
  if (side === "long") {
    if (price <= stop) return "stop"
    if (price >= target) return "target"
    return null
  }
  if (price >= stop) return "stop"
  if (price <= target) return "target"
  return null
}

function resolveOrderedOracle(case_: OracleCase): {
  role: TerminalRole
  trigger_price: number
  observation_kind: "bar_open_gap" | "bar_range_touch"
  admissible_path_id: ReplayOhlcvPathId | null
} {
  const bar = barFrom(case_)
  const openRole = crossedRole(
    case_.position_side, bar.open, case_.active_stop_price, case_.active_target_price,
  )
  if (openRole) {
    return { role: openRole, trigger_price: bar.open, observation_kind: "bar_open_gap", admissible_path_id: null }
  }
  for (const [, price] of case_.samples.slice(1)) {
    const role = crossedRole(
      case_.position_side, price, case_.active_stop_price, case_.active_target_price,
    )
    if (role) {
      const highIndex = case_.samples.findIndex((sample) => sample[1] === bar.high)
      const lowIndex = case_.samples.findIndex((sample) => sample[1] === bar.low)
      const stopTouched = case_.position_side === "long"
        ? bar.low <= case_.active_stop_price
        : bar.high >= case_.active_stop_price
      const targetTouched = case_.position_side === "long"
        ? bar.high >= case_.active_target_price
        : bar.low <= case_.active_target_price
      return {
        role,
        trigger_price: role === "stop" ? case_.active_stop_price : case_.active_target_price,
        observation_kind: "bar_range_touch",
        admissible_path_id: stopTouched && targetTouched
          ? highIndex < lowIndex ? "open_high_low_close" : "open_low_high_close"
          : null,
      }
    }
  }
  throw new Error(`oracle trace ${case_.case_id} has no terminal crossing`)
}

function source(case_: OracleCase, kind: "bar_open_gap" | "bar_range_touch"): ReplaySourceEvent {
  const sourceKind = kind === "bar_open_gap" ? "bar_open" as const : "bar_range" as const
  const eventTime = sourceKind === "bar_open" ? fixture.open_time : fixture.close_time
  const sourceEventId = `oracle:${case_.case_id}:${sourceKind}`
  return {
    source_event_id: sourceEventId,
    kind: sourceKind,
    source_index: 0,
    event_key: {
      event_time: eventTime, boundary_phase: 20, source_sequence: 1,
      event_subphase: sourceKind === "bar_open" ? 0 : 1, stable_event_id: sourceEventId,
    },
  }
}

function evidenceFor(case_: OracleCase): ReplayOhlcvResolutionEvidence {
  const bar = barFrom(case_)
  const stopTouched = case_.position_side === "long"
    ? bar.low <= case_.active_stop_price
    : bar.high >= case_.active_stop_price
  const targetTouched = case_.position_side === "long"
    ? bar.high >= case_.active_target_price
    : bar.low <= case_.active_target_price
  const oracle = resolveOrderedOracle(case_)
  return createReplaySimpleBracketOhlcvResolution({
    run_id: `oracle-${case_.case_id}`,
    source_event: source(case_, oracle.observation_kind),
    bar,
    position_side: case_.position_side,
    active_protection: {
      protection_generation: 1, remaining_quantity: 1,
      stop_order_id: `oracle-${case_.case_id}:order:stop`, stop_trigger_price: case_.active_stop_price,
      target_order_id: `oracle-${case_.case_id}:order:target`, target_trigger_price: case_.active_target_price,
    },
    economics: {
      entry_basis_price: fixture.entry_price,
      exit_side: case_.position_side === "long" ? "sell" : "buy",
      cost_policy_id: "oracle-cost", cost_policy_version: "v1",
      fee_bps: 0, slippage_bps: 0,
      price_increment: "0.01", settlement_increment: "0.00000001", settlement_asset: "USDT",
    },
    observation_kind: oracle.observation_kind,
    stop_touched: oracle.observation_kind === "bar_open_gap" ? oracle.role === "stop" : stopTouched,
    target_touched: oracle.observation_kind === "bar_open_gap" ? oracle.role === "target" : targetTouched,
    canonical_terminal_role: oracle.observation_kind === "bar_open_gap"
      ? oracle.role
      : stopTouched && targetTouched ? "stop" : oracle.role,
  })
}

function rawTerminalPnl(side: Side, entryPrice: number, terminalPrice: number): number {
  return side === "long" ? terminalPrice - entryPrice : entryPrice - terminalPrice
}

function semanticEnvelope(evidence: ReplayOhlcvResolutionEvidence): unknown {
  return {
    bar: evidence.bar,
    position_side: evidence.position_side,
    active_stop_price: evidence.active_protection.stop_trigger_price,
    active_target_price: evidence.active_protection.target_trigger_price,
    observation_kind: evidence.observation_kind,
    status: evidence.status,
    resolution_reason: evidence.resolution_reason,
    paths: evidence.paths.map(({ path_id, first_terminal_role, trigger_price }) => ({
      path_id, first_terminal_role, trigger_price,
    })),
    canonical: evidence.canonical,
  }
}

test("golden parity: ordered price oracle is contained by simple-bracket OHLC evidence", () => {
  expect(fixture.schema_version).toBe("trade.rd-replay-ohlcv-oracle-fixture.v1")
  expect(fixture.cases.length).toBe(8)
  for (const case_ of fixture.cases) {
    const oracle = resolveOrderedOracle(case_)
    const evidence = evidenceFor(case_)
    expect(oracle).toEqual({
      role: case_.expected.actual_terminal_role,
      trigger_price: case_.expected.actual_trigger_price,
      observation_kind: case_.expected.observation_kind,
      admissible_path_id: case_.expected.admissible_path_id,
    })
    expect(evidence).toMatchObject({
      status: case_.expected.status,
      resolution_reason: case_.expected.resolution_reason,
    })
    expect(() => assertReplayOhlcvResolutionEvidence(evidence)).not.toThrow()
    if (evidence.status === "resolution_limited") {
      const actualPath = evidence.paths.find((path) => path.path_id === oracle.admissible_path_id)
      expect(actualPath).toMatchObject({
        first_terminal_role: oracle.role,
        trigger_price: oracle.trigger_price,
      })
    } else {
      expect(evidence.paths.map((path) => [path.first_terminal_role, path.trigger_price]))
        .toEqual([[oracle.role, oracle.trigger_price], [oracle.role, oracle.trigger_price]])
    }
    const canonicalTrigger = evidence.observation_kind === "bar_open_gap"
      ? evidence.bar.open
      : evidence.canonical.terminal_role === "stop"
        ? evidence.active_protection.stop_trigger_price
        : evidence.active_protection.target_trigger_price
    expect(rawTerminalPnl(case_.position_side, fixture.entry_price, canonicalTrigger))
      .toBeLessThanOrEqual(rawTerminalPnl(case_.position_side, fixture.entry_price, oracle.trigger_price))
  }
})

test("parity: identical collision OHLC admits opposite ordered-oracle outcomes", () => {
  for (const side of ["long", "short"] as const) {
    const highFirst = fixture.cases.find((case_) => case_.case_id === `${side}-collision-high-first`)!
    const lowFirst = fixture.cases.find((case_) => case_.case_id === `${side}-collision-low-first`)!
    const highEvidence = evidenceFor(highFirst)
    const lowEvidence = evidenceFor(lowFirst)
    expect(barFrom(highFirst)).toEqual(barFrom(lowFirst))
    expect(semanticEnvelope(highEvidence)).toEqual(semanticEnvelope(lowEvidence))
    expect(resolveOrderedOracle(highFirst).role).not.toBe(resolveOrderedOracle(lowFirst).role)
    expect(highEvidence.canonical.terminal_role).toBe("stop")
    expect(lowEvidence.canonical.terminal_role).toBe("stop")
  }
})

test("metamorphic: densifying an ordered oracle trace preserves OHLC and terminal evidence", () => {
  for (const case_ of fixture.cases) {
    const densified = structuredClone(case_)
    densified.samples = case_.samples.flatMap((sample, index) => {
      const next = case_.samples[index + 1]
      if (!next) return [sample]
      return [sample, [
        (sample[0] + next[0]) / 2,
        (sample[1] + next[1]) / 2,
      ] as Sample]
    })
    expect(barFrom(densified)).toEqual(barFrom(case_))
    expect(resolveOrderedOracle(densified)).toEqual(resolveOrderedOracle(case_))
    expect(canonicalHash(semanticEnvelope(evidenceFor(densified))))
      .toBe(canonicalHash(semanticEnvelope(evidenceFor(case_))))
  }
})
