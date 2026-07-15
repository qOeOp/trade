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

interface EconomicProfile {
  profile_id: string
  fee_bps: number
  slippage_bps: number
  price_increment: string
  settlement_increment: string
  quantity: number
}

interface PathEconomics {
  simulated_execution_price: number
  gross_realized_pnl: number
  exit_fee: number
  net_terminal_contribution: number
}

interface Rational {
  numerator: bigint
  denominator: bigint
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

const economicFixture = JSON.parse(readFileSync(
  new URL("./fixtures/certified-ohlcv-economic-oracle-v1.json", import.meta.url), "utf8",
)) as {
  schema_version: string
  profiles: EconomicProfile[]
  goldens: Array<{
    case_id: string
    profile_id: string
    actual_path_id: ReplayOhlcvPathId
    actual_path: PathEconomics
    canonical_path: PathEconomics
    envelope: {
      min_net_terminal_contribution: number
      max_net_terminal_contribution: number
      net_terminal_contribution_span: number
      canonical_shortfall_to_best: number
    }
  }>
}

const ZERO_COST_PROFILE = economicFixture.profiles.find(
  (profile) => profile.profile_id === "zero-cost-fine-grid",
)!

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

function evidenceFor(
  case_: OracleCase,
  profile: EconomicProfile = ZERO_COST_PROFILE,
): ReplayOhlcvResolutionEvidence {
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
      protection_generation: 1, remaining_quantity: profile.quantity,
      stop_order_id: `oracle-${case_.case_id}:order:stop`, stop_trigger_price: case_.active_stop_price,
      target_order_id: `oracle-${case_.case_id}:order:target`, target_trigger_price: case_.active_target_price,
    },
    economics: {
      entry_basis_price: fixture.entry_price,
      exit_side: case_.position_side === "long" ? "sell" : "buy",
      cost_policy_id: `oracle-${profile.profile_id}`, cost_policy_version: "v1",
      fee_bps: profile.fee_bps, slippage_bps: profile.slippage_bps,
      price_increment: profile.price_increment,
      settlement_increment: profile.settlement_increment,
      settlement_asset: "USDT",
    },
    observation_kind: oracle.observation_kind,
    stop_touched: oracle.observation_kind === "bar_open_gap" ? oracle.role === "stop" : stopTouched,
    target_touched: oracle.observation_kind === "bar_open_gap" ? oracle.role === "target" : targetTouched,
    canonical_terminal_role: oracle.observation_kind === "bar_open_gap"
      ? oracle.role
      : stopTouched && targetTouched ? "stop" : oracle.role,
  })
}

function rational(value: number | string): Rational {
  const source = String(value)
  const match = /^(-?)(\d+)(?:\.(\d+))?$/.exec(source)
  if (!match) throw new Error(`economic oracle requires plain decimal input: ${source}`)
  const fraction = match[3] ?? ""
  const coefficient = BigInt(`${match[1] ?? ""}${match[2]}${fraction}`)
  return { numerator: coefficient, denominator: 10n ** BigInt(fraction.length) }
}

function add(left: Rational, right: Rational): Rational {
  return {
    numerator: left.numerator * right.denominator + right.numerator * left.denominator,
    denominator: left.denominator * right.denominator,
  }
}

function multiply(left: Rational, right: Rational): Rational {
  return {
    numerator: left.numerator * right.numerator,
    denominator: left.denominator * right.denominator,
  }
}

function divide(left: Rational, right: Rational): Rational {
  if (right.numerator === 0n) throw new Error("economic oracle division by zero")
  const sign = right.numerator < 0n ? -1n : 1n
  return {
    numerator: left.numerator * right.denominator * sign,
    denominator: left.denominator * right.numerator * sign,
  }
}

function negate(value: Rational): Rational {
  return { numerator: -value.numerator, denominator: value.denominator }
}

function quantize(
  value: Rational,
  increment: string,
  rounding: "floor" | "ceil",
): Rational {
  const step = rational(increment)
  const units = divide(value, step)
  let quotient = units.numerator / units.denominator
  const remainder = units.numerator % units.denominator
  if (remainder !== 0n && rounding === "floor" && units.numerator < 0n) quotient -= 1n
  if (remainder !== 0n && rounding === "ceil" && units.numerator > 0n) quotient += 1n
  return multiply(rational(quotient.toString()), step)
}

function toNumber(value: Rational): number {
  return Number(value.numerator) / Number(value.denominator)
}

function economicOracle(
  case_: OracleCase,
  triggerPrice: number,
  profile: EconomicProfile,
): PathEconomics {
  const exitSide = case_.position_side === "long" ? "sell" : "buy"
  const signedBps = exitSide === "buy" ? rational(profile.slippage_bps) : negate(rational(profile.slippage_bps))
  const multiplier = divide(add(rational(10_000), signedBps), rational(10_000))
  const executionPrice = quantize(
    multiply(rational(triggerPrice), multiplier),
    profile.price_increment,
    exitSide === "buy" ? "ceil" : "floor",
  )
  const directionalDifference = case_.position_side === "long"
    ? add(executionPrice, negate(rational(fixture.entry_price)))
    : add(rational(fixture.entry_price), negate(executionPrice))
  const gross = quantize(
    multiply(directionalDifference, rational(profile.quantity)),
    profile.settlement_increment,
    "floor",
  )
  const fee = quantize(
    divide(
      multiply(multiply(executionPrice, rational(profile.quantity)), rational(profile.fee_bps)),
      rational(10_000),
    ),
    profile.settlement_increment,
    "ceil",
  )
  return {
    simulated_execution_price: toNumber(executionPrice),
    gross_realized_pnl: toNumber(gross),
    exit_fee: toNumber(fee),
    net_terminal_contribution: toNumber(add(gross, negate(fee))),
  }
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

test("economic golden: independent rational oracle locks cost and rounding vectors", () => {
  expect(economicFixture.schema_version).toBe("trade.rd-replay-ohlcv-economic-oracle-fixture.v1")
  expect(economicFixture.profiles.length).toBe(3)
  expect(economicFixture.goldens.length).toBe(2)
  for (const golden of economicFixture.goldens) {
    const case_ = fixture.cases.find((candidate) => candidate.case_id === golden.case_id)!
    const profile = economicFixture.profiles.find((candidate) => candidate.profile_id === golden.profile_id)!
    const evidence = evidenceFor(case_, profile)
    const actual = resolveOrderedOracle(case_)
    const actualPath = evidence.paths.find((path) => path.path_id === golden.actual_path_id)!
    const canonicalPath = evidence.paths.find((path) => path.path_id === evidence.canonical.path_id)!
    expect(actual.admissible_path_id).toBe(golden.actual_path_id)
    expect(economicOracle(case_, actual.trigger_price, profile)).toEqual(golden.actual_path)
    expect(actualPath).toMatchObject(golden.actual_path)
    expect(canonicalPath).toMatchObject(golden.canonical_path)
    expect(evidence.economic_impact).toMatchObject(golden.envelope)
  }
})

test("economic parity: independent oracle matches every path across cost and precision profiles", () => {
  for (const profile of economicFixture.profiles) {
    for (const case_ of fixture.cases) {
      const evidence = evidenceFor(case_, profile)
      const oracle = resolveOrderedOracle(case_)
      for (const path of evidence.paths) {
        expect(path).toMatchObject(economicOracle(case_, path.trigger_price, profile))
      }
      const contributions = evidence.paths.map((path) => path.net_terminal_contribution)
      const canonical = evidence.paths.find((path) => path.path_id === evidence.canonical.path_id)!
      const expectedEnvelope = {
        min_net_terminal_contribution: Math.min(...contributions),
        max_net_terminal_contribution: Math.max(...contributions),
        net_terminal_contribution_span: toNumber(add(
          rational(Math.max(...contributions)), negate(rational(Math.min(...contributions))),
        )),
        canonical_shortfall_to_best: toNumber(add(
          rational(Math.max(...contributions)), negate(rational(canonical.net_terminal_contribution)),
        )),
      }
      expect(evidence.economic_impact).toMatchObject(expectedEnvelope)
      const orderedPath = oracle.admissible_path_id
        ? evidence.paths.find((path) => path.path_id === oracle.admissible_path_id)!
        : evidence.paths[0]
      expect(orderedPath).toMatchObject(economicOracle(case_, oracle.trigger_price, profile))
      expect(canonical.net_terminal_contribution).toBeLessThanOrEqual(orderedPath.net_terminal_contribution)
    }
  }
})

test("economic metamorphic: trace densification preserves cost-aware path contributions", () => {
  for (const profile of economicFixture.profiles) {
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
      const originalEvidence = evidenceFor(case_, profile)
      const densifiedEvidence = evidenceFor(densified, profile)
      expect(resolveOrderedOracle(densified)).toEqual(resolveOrderedOracle(case_))
      expect(canonicalHash({
        paths: densifiedEvidence.paths,
        economic_impact: densifiedEvidence.economic_impact,
      })).toBe(canonicalHash({
        paths: originalEvidence.paths,
        economic_impact: originalEvidence.economic_impact,
      }))
    }
  }
})
