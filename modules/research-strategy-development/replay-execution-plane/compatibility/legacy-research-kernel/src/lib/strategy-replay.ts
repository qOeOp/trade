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
} from "./replay-core"

export { detectReplayDecisionLookahead, evaluateLatestSignal } from "../../../legacy-research-decision/src/lib/legacy-research-decision"
export { simulateReplayOrderLane } from "../../../legacy-research-order-lane/src/lib/legacy-research-order-lane"

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
