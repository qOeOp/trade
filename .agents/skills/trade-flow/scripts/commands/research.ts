import { runArtifactGc } from "../lib/artifact-hygiene"
import { replayRegisteredStrategy } from "../lib/strategy-replay"
import { runStrategyPanelRnd, strategyPanelRndInputFromJson } from "../lib/strategy-panel-rnd"
import {
  runCalibrationSuite,
  runTrendBenchmark,
  strategyBenchmarkInputFromJson,
  strategyCalibrationInputFromJson,
} from "../lib/strategy-benchmark"
import {
  evaluateRndSignal,
  runStrategyRndBatch,
  runStrategyRndCampaign,
  runStrategyRndLoop,
  strategyRndBatchInputFromJson,
  strategyRndCampaignInputFromJson,
  strategyRndLoopInputFromJson,
  strategyRndSignalInputFromJson,
} from "../lib/strategy-rnd"
import { successResponse } from "./response"
import type { CommandConfig, ScriptResponse } from "./types"

export function handleResearchCommand(config: CommandConfig): ScriptResponse | null {
  if (config.replayStrategy) {
    if (!config.manifestPath) {
      throw new Error("--replay-strategy requires --manifest")
    }
    return successResponse(replayRegisteredStrategy({
        manifestPath: config.manifestPath,
        strategyId: config.strategyId,
        timeframe: config.timeframe,
        maxHoldBars: config.maxHoldBars,
        rewardRisk: config.rewardRisk,
        feeBps: config.feeBps,
        slippageBps: config.slippageBps,
        fundingBpsPer8h: config.fundingBpsPer8h,
        oosSplitRatio: config.oosSplitRatio,
        trialCount: config.trialCount,
        parameterCount: config.parameterCount,
        antiOverfitStage: config.antiOverfitStage,
      }))
  }
  if (config.strategyRndBatch) {
    return successResponse(runStrategyRndBatch(strategyRndBatchInputFromJson(config.input)))
  }
  if (config.strategyRndLoop) {
    return successResponse(runStrategyRndLoop(strategyRndLoopInputFromJson(config.input)))
  }
  if (config.strategyRndCampaign) {
    return successResponse(runStrategyRndCampaign(strategyRndCampaignInputFromJson(config.input)))
  }
  if (config.strategyPanelRnd) {
    return successResponse(runStrategyPanelRnd(strategyPanelRndInputFromJson(config.input)))
  }
  if (config.strategyBenchmark) {
    return successResponse(runTrendBenchmark(strategyBenchmarkInputFromJson(config.input)))
  }
  if (config.strategyCalibrationSuite) {
    return successResponse(runCalibrationSuite(strategyCalibrationInputFromJson(config.input)))
  }
  if (config.strategySignal) {
    return successResponse(evaluateRndSignal(strategyRndSignalInputFromJson(config.input)))
  }
  if (config.artifactGc) {
    if (!config.artifactRoot) {
      throw new Error("--artifact-gc requires --artifact-root")
    }
    return successResponse(runArtifactGc({
        root: config.artifactRoot,
        retentionHours: config.retentionHours,
        ephemeralRetentionHours: config.ephemeralRetentionHours,
        yes: config.yes,
        referencedPaths: readStringArray(config.input.referenced_paths),
        now: stringField(config.input.now) || undefined,
      }))
  }
  return null
}

function readStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return []
  }
  return value.filter((item): item is string => typeof item === "string" && item.length > 0)
}

function stringField(value: unknown): string {
  return typeof value === "string" ? value.trim() : ""
}
