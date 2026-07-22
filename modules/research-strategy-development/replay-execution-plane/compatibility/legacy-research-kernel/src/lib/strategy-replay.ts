export {
  atr,
  buildIndicators,
  detectReplayDecisionLookahead,
  ema,
  evaluateLatestSignal,
  evaluateReplayGate,
  loadCandlesFromManifest,
  parseCsvCandles,
  replayStrategy,
  simulateReplayOrderLane,
  summarizeReplay,
  type Candle,
  type IndicatorSet,
} from "./replay-core"

export type {
  LatestSignalResult,
  ReplayOptions,
  ReplayResult,
  ReplaySignal,
  ReplayStrategy,
  ReplayTrade,
  ReplayTemporalIntegrityReport,
  SimulatedLaneFill,
  SimulatedLaneOrder,
  SimulatedLaneResult,
} from "../../../legacy-research-contracts/src/lib/legacy-research-contracts"

export {
  buildTrendPullbackSignal,
  btcTrendPullbackStrategy,
  listReplayStrategies,
  replayRegisteredStrategy,
  replayRegisteredStrategy as replayTrendPullback,
  replayStrategies,
} from "./replay-strategies"
