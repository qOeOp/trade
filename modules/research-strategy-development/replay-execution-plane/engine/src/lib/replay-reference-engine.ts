import {
  REPLAY_RESULT_SCHEMA_VERSION,
  assertReplayExecutionRequest,
  canonicalHash,
  type ReplayDatasetManifest,
  type ReplayExecutionRequest,
  type ReplayFill,
  type ReplayFundingEvent,
  type ReplayMarketBar,
  type ReplayResult,
} from "../../../contracts/src/lib/replay-contracts"
import {
  applyAdverseSlippage,
  buildSinglePositionLedger,
  calculateFundingCashflow,
  calculateNotionalCharge,
  roundReplayAmount,
} from "../../../accounting/src/lib/replay-accounting"
import { fundingEventsInWindow, prepareReplayInputData } from "../../../data-adapter/src/lib/replay-data-adapter"
import { deriveReplayMetrics } from "../../../metrics/src/lib/replay-metrics"

export interface ReplayKernelInput {
  request: ReplayExecutionRequest
  dataset_manifest: ReplayDatasetManifest
  bars: ReplayMarketBar[]
  funding_events?: ReplayFundingEvent[]
}

export function executeReplayKernel(input: ReplayKernelInput): ReplayResult {
  const { request } = input
  assertReplayExecutionRequest(request)
  const prepared = prepareReplayInputData({
    request,
    dataset_manifest: input.dataset_manifest,
    bars: input.bars,
    funding_events: input.funding_events,
  })
  const { bars, funding_events: fundingEvents, entry_index: entryIndex } = prepared

  const entryBar = bars[entryIndex]
  const entryPrice = applyAdverseSlippage(entryBar.open, request.order.side === "long" ? "buy" : "sell", request.cost_policy.slippage_bps)
  const entrySide = request.order.side === "long" ? "buy" : "sell"
  const exitSide = request.order.side === "long" ? "sell" : "buy"
  const entryFee = calculateNotionalCharge(entryPrice, request.order.quantity, request.cost_policy.fee_bps)
  const entryFill: ReplayFill = {
    fill_id: `${request.run_id}:fill:1`,
    order_role: "entry",
    timestamp: entryBar.open_time,
    side: entrySide,
    quantity: request.order.quantity,
    price: entryPrice,
    fee: entryFee,
    reduce_only: false,
  }
  const fills: ReplayFill[] = [entryFill]
  const limitations: ReplayResult["limitations"] = [...prepared.limitations]
  const exit = resolveExit(request, bars, entryIndex, limitations)
  const exitPrice = applyAdverseSlippage(exit.rawPrice, exitSide, request.cost_policy.slippage_bps)
  const exitFee = calculateNotionalCharge(exitPrice, request.order.quantity, request.cost_policy.fee_bps)
  const exitFill: ReplayFill = {
    fill_id: `${request.run_id}:fill:2`,
    order_role: exit.role,
    timestamp: exit.timestamp,
    side: exitSide,
    quantity: request.order.quantity,
    price: exitPrice,
    fee: exitFee,
    reduce_only: true,
  }
  fills.push(exitFill)

  const realizedPnl = roundReplayAmount((request.order.side === "long" ? exitPrice - entryPrice : entryPrice - exitPrice) * request.order.quantity)
  const appliedFunding = fundingEventsInWindow(fundingEvents, entryBar.open_time, exit.timestamp)
  const fundingAmounts = appliedFunding.map((event) => calculateFundingCashflow(
    event.mark_price, request.order.quantity, event.rate, request.order.side,
  ))
  const totalFunding = roundReplayAmount(fundingAmounts.reduce((sum, amount) => sum + amount, 0))
  const totalFees = roundReplayAmount(entryFee + exitFee)
  const endingEquity = roundReplayAmount(request.initial_cash + realizedPnl + totalFunding - totalFees)
  const ledger = buildSinglePositionLedger({
    run_id: request.run_id,
    initial_cash: request.initial_cash,
    entry_time: entryBar.open_time,
    fills: [entryFill, exitFill],
    funding_events: appliedFunding,
    funding_cashflows: fundingAmounts,
    realized_pnl: realizedPnl,
    ending_equity: endingEquity,
  })
  const metrics = deriveReplayMetrics({ initial_cash: request.initial_cash, fills, ledger })
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
      dataset_manifest_hash: prepared.dataset_manifest_hash,
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
