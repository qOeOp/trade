export {
  atr,
  buildIndicators,
  ema,
  evaluateReplayGate,
  loadCandlesFromManifest,
  parseCsvCandles,
  replayStrategy,
  simulateReplayOrderLane,
  summarizeReplay,
  type Candle,
  type IndicatorSet,
} from "./replay-core"

export { detectReplayDecisionLookahead, evaluateLatestSignal } from "../../../legacy-research-decision/src/lib/legacy-research-decision"

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
