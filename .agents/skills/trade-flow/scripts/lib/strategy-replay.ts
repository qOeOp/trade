export {
  atr,
  buildIndicators,
  ema,
  evaluateReplayGate,
  loadCandlesFromManifest,
  parseCsvCandles,
  replayStrategy,
  summarizeReplay,
  type Candle,
  type IndicatorSet,
  type ReplayOptions,
  type ReplayResult,
  type ReplaySignal,
  type ReplayStrategy,
  type ReplayTrade,
} from "./replay-core"

export {
  buildTrendPullbackSignal,
  btcTrendPullbackStrategy,
  listReplayStrategies,
  replayRegisteredStrategy,
  replayRegisteredStrategy as replayTrendPullback,
  replayStrategies,
} from "./replay-strategies"
