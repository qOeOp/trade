import type { Candle } from "../../../legacy-research-data/src/lib/legacy-research-data"
import type {
  SimulatedLaneFill,
  SimulatedLaneOrder,
  SimulatedLaneResult,
} from "../../../legacy-research-contracts/src/lib/legacy-research-contracts"

function simulateReplayOrderLane(input: {
  candles: Candle[]
  orders: SimulatedLaneOrder[]
  initial_position_qty?: number
  initial_entry_price?: number
  initial_risk_per_unit?: number
  max_live_risk_per_unit?: number
}): SimulatedLaneResult {
  let positionQty = input.initial_position_qty ?? 0
  let averageEntry = input.initial_entry_price ?? 0
  const initialRisk = positiveOrDefault(input.initial_risk_per_unit, 1)
  let maxLiveRisk = Math.max(positiveOrDefault(input.max_live_risk_per_unit, initialRisk), Math.abs(positionQty) * initialRisk)
  let realizedPnl = 0
  const fills: SimulatedLaneFill[] = []
  const openOrders = [...input.orders]

  for (const candle of input.candles) {
    const triggered = openOrders
      .filter((order) => orderTriggers(order, candle))
      .sort(compareSimulatedOrders)
    for (const order of triggered) {
      const openIndex = openOrders.findIndex((item) => item.id === order.id)
      if (openIndex >= 0) openOrders.splice(openIndex, 1)
      const requestedQty = Math.max(0, order.quantity)
      if (requestedQty <= 0) continue
      const signedBefore = positionQty
      const closingQty = order.reduce_only ? Math.min(requestedQty, Math.abs(positionQty)) : requestedQty
      if (closingQty <= 0) continue
      const price = simulatedFillPrice(order, candle)
      const signedFill = order.side === "BUY" ? closingQty : -closingQty
      const reducesPosition = Math.sign(signedBefore) !== 0 && Math.sign(signedBefore) !== Math.sign(signedFill)
      if (reducesPosition) {
        const pnl = signedBefore > 0 ? price - averageEntry : averageEntry - price
        realizedPnl += pnl * closingQty
        maxLiveRisk = Math.max(maxLiveRisk, Math.abs(signedBefore) * initialRisk)
        positionQty += signedFill
        if (Math.sign(signedBefore) !== Math.sign(positionQty)) {
          averageEntry = positionQty === 0 ? 0 : price
        }
      } else {
        const oldAbs = Math.abs(positionQty)
        const newAbs = oldAbs + closingQty
        averageEntry = newAbs > 0 ? ((averageEntry * oldAbs) + (price * closingQty)) / newAbs : 0
        positionQty += signedFill
        maxLiveRisk = Math.max(maxLiveRisk, Math.abs(positionQty) * initialRisk)
      }
      fills.push({
        order_id: order.id,
        role: order.role,
        side: order.side,
        quantity: roundLane(closingQty),
        requested_quantity: roundLane(requestedQty),
        price: roundLane(price),
        candle_time: candle.date,
        reduced_only_cap_applied: closingQty < requestedQty,
      })
    }
  }

  const initialRiskBasis = Math.max(initialRisk * Math.max(1, Math.abs(input.initial_position_qty ?? 0)), initialRisk)
  return {
    fills,
    final_position_qty: roundLane(positionQty),
    realized_r_multiple_initial: roundLane(realizedPnl / initialRiskBasis),
    realized_r_multiple_max_live_risk: roundLane(realizedPnl / Math.max(maxLiveRisk, initialRisk)),
    assumptions: {
      model: "ohlcv_lane_simulator_v1",
      intrabar_order_sort: "stop_reduce_only_then_take_profit_then_entry_by_id",
      reduce_only_cap: "cap_to_remaining_position_qty",
      same_candle_policy: "stop_first",
    },
  }
}

function orderTriggers(order: SimulatedLaneOrder, candle: Candle): boolean {
  if (order.kind === "market") return true
  const trigger = order.kind === "stop_market" ? order.stop_price : order.price
  if (!Number.isFinite(trigger)) return false
  if (order.side === "BUY") return candle.high >= Number(trigger)
  return candle.low <= Number(trigger)
}

function compareSimulatedOrders(a: SimulatedLaneOrder, b: SimulatedLaneOrder): number {
  const rank = (order: SimulatedLaneOrder): number => {
    if (order.reduce_only && order.role === "stop") return 0
    if (order.reduce_only && order.role === "take_profit") return 1
    if (order.role === "stop") return 2
    if (order.role === "take_profit") return 3
    return 4
  }
  return rank(a) - rank(b) || a.id.localeCompare(b.id)
}

function simulatedFillPrice(order: SimulatedLaneOrder, candle: Candle): number {
  if (order.kind === "market") return candle.open
  if (order.kind === "limit") return Number(order.price)
  const stop = Number(order.stop_price)
  if (order.side === "SELL") return Math.min(stop, candle.open)
  return Math.max(stop, candle.open)
}

function positiveOrDefault(value: unknown, fallback: number): number {
  const number = Number(value)
  return Number.isFinite(number) && number > 0 ? number : fallback
}

function roundLane(value: number): number {
  return Number.isFinite(value) ? Number(value.toFixed(6)) : value
}

export { simulateReplayOrderLane }
