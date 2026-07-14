import {
  REPLAY_RESULT_SCHEMA_VERSION,
  assertReplayExecutionRequest,
  assertReplayMarketBars,
  canonicalHash,
  type ReplayExecutionRequest,
  type ReplayFill,
  type ReplayFundingEvent,
  type ReplayLedgerEntry,
  type ReplayMarketBar,
  type ReplayResult,
} from "../../../contracts/src/lib/replay-contracts"

export interface ReplayKernelInput {
  request: ReplayExecutionRequest
  bars: ReplayMarketBar[]
  funding_events?: ReplayFundingEvent[]
}

export function executeReplayKernel(input: ReplayKernelInput): ReplayResult {
  const { request, bars } = input
  assertReplayExecutionRequest(request)
  assertReplayMarketBars(bars)
  if (bars.length === 0) throw new Error("Replay requires at least one closed bar")
  const fundingEvents = validateFundingEvents(input.funding_events || [])
  const entryIndex = bars.findIndex((bar) => Date.parse(bar.open_time) >= Date.parse(request.order.earliest_executable_time))
  if (entryIndex < 0) throw new Error("dataset contains no bar at or after earliest executable time")

  const entryBar = bars[entryIndex]
  const entryPrice = adversePrice(entryBar.open, request.order.side === "long" ? "buy" : "sell", request.cost_policy.slippage_bps)
  const entrySide = request.order.side === "long" ? "buy" : "sell"
  const exitSide = request.order.side === "long" ? "sell" : "buy"
  const entryFee = fee(entryPrice, request.order.quantity, request.cost_policy.fee_bps)
  const fills: ReplayFill[] = [{
    fill_id: `${request.run_id}:fill:1`,
    order_role: "entry",
    timestamp: entryBar.open_time,
    side: entrySide,
    quantity: request.order.quantity,
    price: entryPrice,
    fee: entryFee,
    reduce_only: false,
  }]
  const limitations: ReplayResult["limitations"] = []
  const exit = resolveExit(request, bars, entryIndex, limitations)
  const exitPrice = adversePrice(exit.rawPrice, exitSide, request.cost_policy.slippage_bps)
  const exitFee = fee(exitPrice, request.order.quantity, request.cost_policy.fee_bps)
  fills.push({
    fill_id: `${request.run_id}:fill:2`,
    order_role: exit.role,
    timestamp: exit.timestamp,
    side: exitSide,
    quantity: request.order.quantity,
    price: exitPrice,
    fee: exitFee,
    reduce_only: true,
  })

  const realizedPnl = roundMoney((request.order.side === "long" ? exitPrice - entryPrice : entryPrice - exitPrice) * request.order.quantity)
  const appliedFunding = fundingEvents.filter((event) => {
    const time = Date.parse(event.timestamp)
    return time >= Date.parse(entryBar.open_time) && time <= Date.parse(exit.timestamp)
  })
  const fundingAmounts = appliedFunding.map((event) => roundMoney(
    event.mark_price * request.order.quantity * event.rate * (request.order.side === "long" ? -1 : 1),
  ))
  const totalFunding = roundMoney(fundingAmounts.reduce((sum, amount) => sum + amount, 0))
  const totalFees = roundMoney(entryFee + exitFee)
  const endingEquity = roundMoney(request.initial_cash + realizedPnl + totalFunding - totalFees)
  const ledger = buildLedger(request, entryBar.open_time, fills, appliedFunding, fundingAmounts, realizedPnl, endingEquity)
  const metrics = {
    initial_cash: request.initial_cash,
    ending_equity: endingEquity,
    net_pnl: roundMoney(endingEquity - request.initial_cash),
    return_fraction: roundMoney((endingEquity - request.initial_cash) / request.initial_cash),
    realized_pnl: realizedPnl,
    total_fees: totalFees,
    total_funding: totalFunding,
    trade_count: 1,
  }
  const resultBody = {
    schema_version: REPLAY_RESULT_SCHEMA_VERSION,
    run_id: request.run_id,
    status: "completed" as const,
    started_at: entryBar.open_time,
    completed_at: exit.timestamp,
    fills,
    ledger,
    metrics,
    limitations,
  }
  const resultHash = canonicalHash(resultBody)
  return {
    ...resultBody,
    fingerprint: {
      experiment_contract_hash: request.experiment_contract_hash,
      trial_group_hash: request.trial_group_hash,
      candidate_hash: request.candidate_hash,
      identity_hash_policy_version: request.identity_hash_policy_version,
      dataset_hash: request.dataset_hash,
      harness_hash: request.harness_hash,
      assumptions_hash: request.assumptions_hash,
      cost_policy_hash: canonicalHash(request.cost_policy),
      simulator_policy_version: request.simulator_policy.version,
      request_hash: canonicalHash(request),
      result_hash: resultHash,
      random_seed: request.random_seed,
    },
  }
}

function resolveExit(
  request: ReplayExecutionRequest,
  bars: ReplayMarketBar[],
  entryIndex: number,
  limitations: ReplayResult["limitations"],
): { role: "stop" | "target" | "end_of_data"; timestamp: string; rawPrice: number } {
  for (let index = entryIndex; index < bars.length; index += 1) {
    const bar = bars[index]
    const isLong = request.order.side === "long"
    const stopGap = isLong ? bar.open <= request.order.stop_price : bar.open >= request.order.stop_price
    if (stopGap) {
      return { role: "stop", timestamp: bar.open_time, rawPrice: bar.open }
    }
    const stopTouched = isLong ? bar.low <= request.order.stop_price : bar.high >= request.order.stop_price
    const targetTouched = isLong ? bar.high >= request.order.target_price : bar.low <= request.order.target_price
    if (stopTouched && targetTouched) {
      limitations.push({
        code: "ohlcv-stop-target-collision",
        severity: "resolution_limited",
        detail: "OHLCV cannot prove intrabar path; certified conservative policy resolves stop before target.",
      })
      return { role: "stop", timestamp: bar.close_time, rawPrice: request.order.stop_price }
    }
    if (stopTouched) return { role: "stop", timestamp: bar.close_time, rawPrice: request.order.stop_price }
    if (targetTouched) return { role: "target", timestamp: bar.close_time, rawPrice: request.order.target_price }
  }
  const last = bars.at(-1)
  if (!last) throw new Error("Replay cannot close without market data")
  limitations.push({
    code: "end-of-data-forced-close",
    severity: "info",
    detail: "Open evidence position was marked closed at the final closed bar for finite Result accounting.",
  })
  return { role: "end_of_data", timestamp: last.close_time, rawPrice: last.close }
}

function buildLedger(
  request: ReplayExecutionRequest,
  entryTime: string,
  fills: ReplayFill[],
  fundingEvents: ReplayFundingEvent[],
  fundingAmounts: number[],
  realizedPnl: number,
  endingEquity: number,
): ReplayLedgerEntry[] {
  let balance = request.initial_cash
  const entries: ReplayLedgerEntry[] = [{
    entry_id: `${request.run_id}:ledger:1`, timestamp: entryTime, kind: "initial_cash",
    amount: request.initial_cash, balance_after: balance, ref: request.run_id,
  }]
  const append = (timestamp: string, kind: ReplayLedgerEntry["kind"], amount: number, ref: string): void => {
    balance = roundMoney(balance + amount)
    entries.push({ entry_id: `${request.run_id}:ledger:${entries.length + 1}`, timestamp, kind, amount, balance_after: balance, ref })
  }
  append(fills[0].timestamp, "fee", -fills[0].fee, fills[0].fill_id)
  for (const [index, event] of fundingEvents.entries()) {
    append(event.timestamp, "funding", fundingAmounts[index], `funding:${event.timestamp}`)
  }
  append(fills[1].timestamp, "realized_pnl", realizedPnl, fills[1].fill_id)
  append(fills[1].timestamp, "fee", -fills[1].fee, fills[1].fill_id)
  entries.push({
    entry_id: `${request.run_id}:ledger:${entries.length + 1}`,
    timestamp: fills[1].timestamp,
    kind: "ending_equity",
    amount: 0,
    balance_after: endingEquity,
    ref: request.run_id,
  })
  if (Math.abs(balance - endingEquity) > 1e-9) throw new Error("ledger conservation failed")
  return entries
}

function validateFundingEvents(events: ReplayFundingEvent[]): ReplayFundingEvent[] {
  let prior = Number.NEGATIVE_INFINITY
  return [...events].map((event) => {
    const timestamp = Date.parse(event.timestamp)
    if (!Number.isFinite(timestamp) || timestamp < prior) throw new Error("funding events must be ordered ISO timestamps")
    if (!Number.isFinite(event.rate)) throw new Error("funding rate must be finite")
    if (!Number.isFinite(event.mark_price) || event.mark_price <= 0) throw new Error("funding mark_price must be positive")
    prior = timestamp
    return event
  })
}

function adversePrice(price: number, side: "buy" | "sell", bps: number): number {
  const multiplier = side === "buy" ? 1 + bps / 10_000 : 1 - bps / 10_000
  return roundMoney(price * multiplier)
}

function fee(price: number, quantity: number, bps: number): number {
  return roundMoney(price * quantity * bps / 10_000)
}

function roundMoney(value: number): number {
  return Number(value.toFixed(12))
}
