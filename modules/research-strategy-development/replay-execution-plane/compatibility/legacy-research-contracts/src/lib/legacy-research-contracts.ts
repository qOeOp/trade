import type { FundingEvent } from "../../../legacy-research-data/src/lib/funding-events"
import type { Candle } from "../../../legacy-research-data/src/lib/legacy-research-data"
import type { LegacyReplayGate } from "../../../legacy-research-evaluation/src/lib/legacy-research-evaluation"
import type { IndicatorSet } from "../../../legacy-research-features/src/lib/legacy-research-features"
import type { ReplayProvenance } from "../../../legacy-research-provenance/src/lib/legacy-research-provenance"

type JSONRecord = Record<string, unknown>

interface ReplaySignal {
  side: "long" | "short"
  signal_index: number
  entry_index: number
  entry: number
  stop: number
  target: number
  entry_risk_limit?: number
  break_even_after_r?: number
  break_even_offset_r?: number
  reason: string
  meta?: JSONRecord
}

interface ReplayTrade {
  side: "long" | "short"
  signal_time: string
  entry_time: string
  exit_time: string
  entry: number
  exit: number
  stop: number
  target: number
  r: number
  funding_r?: number
  outcome: "target" | "stop" | "time_exit"
  reason: string
  bars_held: number
  regime: string
  meta?: JSONRecord
  fill_model?: JSONRecord
  r_multiple_initial?: number
  r_multiple_max_live_risk?: number
}

interface SimulatedLaneOrder {
  id: string
  role: "entry" | "take_profit" | "stop"
  side: "BUY" | "SELL"
  kind: "market" | "limit" | "stop_market"
  quantity: number
  price?: number
  stop_price?: number
  reduce_only?: boolean
}

interface SimulatedLaneFill {
  order_id: string
  role: "entry" | "take_profit" | "stop"
  side: "BUY" | "SELL"
  quantity: number
  requested_quantity: number
  price: number
  candle_time: string
  reduced_only_cap_applied: boolean
}

interface SimulatedLaneResult {
  fills: SimulatedLaneFill[]
  final_position_qty: number
  realized_r_multiple_initial: number
  realized_r_multiple_max_live_risk: number
  assumptions: JSONRecord
}

interface ReplayStrategy {
  strategy_id: string
  default_timeframe: string
  warmup_bars: number
  generateSignal(input: {
    candles: Candle[]
    indicators: IndicatorSet
    index: number
    decisionPrice: number
    entryIndex: number
    options: ReplayOptions
  }): ReplaySignal | null
}

interface ReplayOptions {
  manifestPath: string
  strategyId?: string
  timeframe?: string
  maxHoldBars?: number
  rewardRisk?: number
  feeBps?: number
  slippageBps?: number
  fundingBpsPer8h?: number
  fundingEvents?: FundingEvent[]
  oosSplitRatio?: number
  trialCount?: number
  parameterCount?: number
  antiOverfitStage?: "selection_validation" | "external_validation" | "locked_holdout"
  supplementalDataRefs?: string[]
  skipParameterStability?: boolean
}

interface ReplayResult {
  strategy_id: string
  symbol: string
  timeframe: string
  sample_count: number
  win_rate: number
  avg_r: number
  total_r: number
  max_drawdown_r: number
  profit_factor: number
  expectancy_r: number
  gate: LegacyReplayGate
  trades: ReplayTrade[]
  diagnostics?: JSONRecord
  assumptions: JSONRecord
  provenance: ReplayProvenance
  notes: string[]
}

interface ReplayTemporalIntegrityReport {
  method: "full_vs_cutoff_recompute_v1"
  status: "passed" | "failed"
  coverage: "complete" | "sampled"
  eligible_cutoffs: number
  checked_cutoffs: number
  mismatch_count: number
  mismatch_examples_truncated: boolean
  mismatches: Array<{
    cutoff_index: number
    cutoff_time: string
    full_signal_hash: string
    cutoff_signal_hash: string
    error?: string
  }>
}

interface LatestSignalResult {
  strategy_id: string
  symbol: string
  timeframe: string
  signal_time: string
  entry_reference: number
  action: "entry" | "no_action"
  signal: ReplaySignal | null
}

export type {
  LatestSignalResult,
  ReplayOptions,
  ReplayResult,
  ReplaySignal,
  ReplayStrategy,
  ReplayTemporalIntegrityReport,
  ReplayTrade,
  SimulatedLaneFill,
  SimulatedLaneOrder,
  SimulatedLaneResult,
}
