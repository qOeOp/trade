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
import type { CommandConfig, ScriptResponse } from "./types"

export function handleResearchCommand(config: CommandConfig): ScriptResponse | null {
  if (config.replayStrategy) {
    if (!config.manifestPath) {
      throw new Error("--replay-strategy requires --manifest")
    }
    return {
      ok: true,
      data: replayRegisteredStrategy({
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
      }),
    }
  }
  if (config.strategyRndBatch) {
    return {
      ok: true,
      data: runStrategyRndBatch(strategyRndBatchInputFromJson(config.input)),
    }
  }
  if (config.strategyRndLoop) {
    return {
      ok: true,
      data: runStrategyRndLoop(strategyRndLoopInputFromJson(config.input)),
    }
  }
  if (config.strategyRndCampaign) {
    return {
      ok: true,
      data: runStrategyRndCampaign(strategyRndCampaignInputFromJson(config.input)),
    }
  }
  if (config.strategyPanelRnd) {
    return { ok: true, data: runStrategyPanelRnd(strategyPanelRndInputFromJson(config.input)) }
  }
  if (config.strategyBenchmark) {
    return { ok: true, data: runTrendBenchmark(strategyBenchmarkInputFromJson(config.input)) }
  }
  if (config.strategyCalibrationSuite) {
    return { ok: true, data: runCalibrationSuite(strategyCalibrationInputFromJson(config.input)) }
  }
  if (config.strategySignal) {
    return { ok: true, data: evaluateRndSignal(strategyRndSignalInputFromJson(config.input)) }
  }
  if (config.artifactGc) {
    if (!config.artifactRoot) {
      throw new Error("--artifact-gc requires --artifact-root")
    }
    return {
      ok: true,
      data: runArtifactGc({
        root: config.artifactRoot,
        retentionHours: config.retentionHours,
        yes: config.yes,
        referencedPaths: readStringArray(config.input.referenced_paths),
        now: stringField(config.input.now) || undefined,
      }),
    }
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
