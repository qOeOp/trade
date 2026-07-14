import {
  REPLAY_NUMERIC_POLICY_VERSION,
  compareReplayEventKeys,
  type ReplayFill,
  type ReplayInstrumentAccountingSpec,
  type ReplayPositionProjection,
} from "../../../contracts/src/lib/replay-contracts"
import {
  addReplayDecimalValues,
  isReplayIncrementAligned,
  quantizeReplayDifferenceProduct,
  quantizeReplayWeightedAverage,
} from "../../../contracts/src/lib/replay-decimal"

interface PositionProjectionInput {
  run_id: string
  symbol: string
  accounting_spec: ReplayInstrumentAccountingSpec
}

export function buildCertifiedSinglePositionProjection(input: PositionProjectionInput & {
  fills: [ReplayFill, ReplayFill]
}): ReplayPositionProjection[] {
  const [entry, exit] = input.fills
  if (entry.order_role !== "entry" || entry.reduce_only) {
    throw new Error("certified position projection requires one non-reduce entry fill")
  }
  if (!exit.reduce_only || exit.order_role === "entry") {
    throw new Error("certified position projection requires one reduce-only exit fill")
  }
  const expectedExitSide = entry.side === "buy" ? "sell" : "buy"
  if (exit.side !== expectedExitSide) throw new Error("certified position exit must oppose the entry side")
  if (addReplayDecimalValues(entry.quantity, -exit.quantity) !== 0) {
    throw new Error("certified position projection requires a full close")
  }
  const projections = buildAverageCostPositionProjection(input)
  if (projections[0].state !== "open" || projections[1].state !== "flat") {
    throw new Error("certified position projection must open then fully close")
  }
  return projections
}

export function buildAverageCostPositionProjection(input: PositionProjectionInput & {
  fills: ReplayFill[]
}): ReplayPositionProjection[] {
  if (input.fills.length === 0) throw new Error("position projection requires at least one Fill")
  const positionId = `${input.run_id}:position:1`
  const fillIds = new Set<string>()
  let signedQuantity = 0
  let averageEntryPrice: number | null = null
  let realizedPnlCumulative = 0
  let previousFill: ReplayFill | undefined

  return input.fills.map((fill, index) => {
    validatePositionFill(fill, previousFill, fillIds, input.accounting_spec)
    previousFill = fill
    const fillPrice = fill.price
    const fillQuantity = fill.quantity
    const signedFillQuantity = fill.side === "buy" ? fillQuantity : -fillQuantity
    let realizedPnlDelta = 0

    if (signedQuantity === 0) {
      if (fill.reduce_only) throw new Error("reduce-only Fill cannot open a flat position")
      signedQuantity = signedFillQuantity
      averageEntryPrice = fillPrice
    } else if (Math.sign(signedFillQuantity) === Math.sign(signedQuantity)) {
      if (fill.reduce_only) throw new Error("reduce-only Fill must oppose and reduce the open position")
      if (averageEntryPrice === null) throw new Error("open position requires average entry price")
      const priorQuantity = Math.abs(signedQuantity)
      averageEntryPrice = quantizeReplayWeightedAverage(
        priorQuantity,
        averageEntryPrice,
        fillQuantity,
        fillPrice,
      )
      signedQuantity = addReplayDecimalValues(signedQuantity, signedFillQuantity)
    } else {
      if (averageEntryPrice === null) throw new Error("open position requires average entry price")
      const priorDirection = Math.sign(signedQuantity)
      const priorQuantity = Math.abs(signedQuantity)
      if (fill.reduce_only && fillQuantity > priorQuantity) {
        throw new Error("executed reduce-only Fill exceeds reducible position quantity")
      }
      const closingQuantity = Math.min(priorQuantity, fillQuantity)
      realizedPnlDelta = quantizeReplayDifferenceProduct(
        fillPrice,
        averageEntryPrice,
        closingQuantity,
        priorDirection as -1 | 1,
        input.accounting_spec.settlement_increment,
        "floor",
      )
      const nextSignedQuantity = addReplayDecimalValues(signedQuantity, signedFillQuantity)
      if (nextSignedQuantity === 0) {
        averageEntryPrice = null
      } else if (Math.sign(nextSignedQuantity) !== priorDirection) {
        averageEntryPrice = fillPrice
      }
      signedQuantity = nextSignedQuantity
    }

    realizedPnlCumulative = addReplayDecimalValues(realizedPnlCumulative, realizedPnlDelta)
    const unrealizedPnl = signedQuantity === 0 || averageEntryPrice === null
      ? 0
      : quantizeReplayDifferenceProduct(
        fillPrice,
        averageEntryPrice,
        Math.abs(signedQuantity),
        Math.sign(signedQuantity) as -1 | 1,
        input.accounting_spec.settlement_increment,
        "floor",
      )
    return projection({
      positionId,
      sequence: index + 1,
      fill,
      symbol: input.symbol,
      state: signedQuantity === 0 ? "flat" : "open",
      side: signedQuantity > 0 ? "long" : signedQuantity < 0 ? "short" : null,
      signedQuantity,
      averageEntryPrice,
      realizedPnlDelta,
      realizedPnlCumulative,
      unrealizedPnl,
    })
  })
}

function validatePositionFill(
  fill: ReplayFill,
  previousFill: ReplayFill | undefined,
  fillIds: Set<string>,
  accountingSpec: ReplayInstrumentAccountingSpec,
): void {
  if (fillIds.has(fill.fill_id)) throw new Error("position projection Fill ids must be unique")
  fillIds.add(fill.fill_id)
  if (fill.timestamp !== fill.event_key.event_time) throw new Error("position projection fill timestamp must equal EventKey time")
  if (previousFill && compareReplayEventKeys(previousFill.event_key, fill.event_key) >= 0) {
    throw new Error("position projection Fill EventKeys must be strictly increasing")
  }
  if (!Number.isFinite(fill.price) || fill.price <= 0) throw new Error("position projection Fill price must be positive")
  if (!Number.isFinite(fill.quantity) || fill.quantity <= 0) throw new Error("position projection Fill quantity must be positive")
  if (!isReplayIncrementAligned(fill.price, accountingSpec.price_increment)) {
    throw new Error("position projection Fill price must align to price increment")
  }
  if (!isReplayIncrementAligned(fill.quantity, accountingSpec.quantity_increment)) {
    throw new Error("position projection Fill quantity must align to quantity increment")
  }
  if (!isReplayIncrementAligned(fill.fee, accountingSpec.settlement_increment)) {
    throw new Error("position projection Fill fee must align to settlement increment")
  }
}

function projection(input: {
  positionId: string
  sequence: number
  fill: ReplayFill
  symbol: string
  state: ReplayPositionProjection["state"]
  side: ReplayPositionProjection["side"]
  signedQuantity: number
  averageEntryPrice: number | null
  realizedPnlDelta: number
  realizedPnlCumulative: number
  unrealizedPnl: number
}): ReplayPositionProjection {
  return {
    position_event_id: `${input.positionId}:event:${input.sequence}`,
    position_id: input.positionId,
    sequence: input.sequence,
    event_key: input.fill.event_key,
    timestamp: input.fill.timestamp,
    cause_fill_id: input.fill.fill_id,
    symbol: input.symbol,
    accounting_method: "average_cost",
    numeric_policy_version: REPLAY_NUMERIC_POLICY_VERSION,
    state: input.state,
    side: input.side,
    signed_quantity: input.signedQuantity,
    average_entry_price: input.averageEntryPrice,
    valuation_price: input.fill.price,
    valuation_source: "fill_price",
    realized_pnl_delta: input.realizedPnlDelta,
    realized_pnl_cumulative: input.realizedPnlCumulative,
    unrealized_pnl: input.unrealizedPnl,
  }
}
