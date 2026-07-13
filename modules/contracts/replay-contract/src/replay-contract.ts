import type { JSONRecord } from "../../runtime-core/src/json"

type ReplaySide = "long" | "short"
type ReplayExitReason = "target" | "stop" | "time_exit"

interface ReplayTrade {
  side: ReplaySide
  signal_time: string
  entry_time: string
  exit_time: string
  entry: number
  exit: number
  stop: number
  target: number
  r: number
  funding_r?: number
  outcome: ReplayExitReason
  reason: string
  bars_held: number
  regime: string
  meta?: JSONRecord
  fill_model?: JSONRecord
  r_multiple_initial?: number
  r_multiple_max_live_risk?: number
}

interface ReplaySupplementalTemporalContract {
  ref: string
  reference_at: string | null
  availability_at: string | null
  availability_source: string
}

interface ReplayTemporalContract {
  method: "closed_candle_replay_v1"
  timeframe: string
  closed_candle_only: boolean
  reference_at: string | null
  availability_at: string | null
  lookback_start: string | null
  label_end: string | null
  universe_selected_at: string | null
  universe_selection_source: string
  label_policy: string
  supplemental_data: ReplaySupplementalTemporalContract[]
}

interface ReplayProvenance {
  harness_hash: string
  data_hash: string
  assumptions_hash: string
  data_ref: string
  timeframe: string
  data_schema_version: number
  closed_candles_only: boolean
  manifest_checksum_verified: boolean
  temporal_contract: ReplayTemporalContract
  supplemental_data?: Array<{ ref: string; content_sha256: string }>
}

interface ReplayFingerprint {
  harness_hash: string
  data_hash?: string
  assumptions_hash?: string
}

type ReplayGate = JSONRecord & {
  shadow_candidate: boolean
  live_small_candidate: false
  blocked_by: Array<{ check_id: string; reason: string }>
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
  gate: ReplayGate
  trades: ReplayTrade[]
  diagnostics?: JSONRecord
  assumptions: JSONRecord
  provenance: ReplayProvenance
  notes: string[]
}

export {
  type ReplayFingerprint,
  type ReplayGate,
  type ReplayProvenance,
  type ReplayResult,
  type ReplayTemporalContract,
  type ReplayTrade,
}
