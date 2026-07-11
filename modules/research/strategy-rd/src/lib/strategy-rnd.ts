import { defaultCatalogDbPathForGeneratedPath } from "./data-catalog"
import {
  runStrategyRndBatch,
  type StrategyRndBatchReport,
} from "../../../candidate-batch-engine/src/lib/strategy-rnd-batch"
import {
  strategyRndBatchInputFromJson,
  strategyRndCampaignInputFromJson,
  strategyRndLoopInputFromJson,
  type StrategyRndBatchInput,
  type StrategyRndCandidateInput,
  type StrategyRndCampaignInput,
  type StrategyRndLoopInput,
} from "../../../candidate-batch-engine/src/lib/strategy-rnd-inputs"
import {
  runStrategyRndCampaignWithDeps,
  type StrategyRndCampaignReport,
} from "./strategy-rnd-campaign"
import { resolveCandidateCount } from "../../../candidate-batch-engine/src/lib/strategy-rnd-candidates"
import {
  maybeUpdateRdProgramState,
  runStrategyRndLoop,
  type StrategyRndLoopReport,
} from "../../../rd-loop-runner/src/lib/rd-loop-runner"

type JSONRecord = Record<string, unknown>

function runStrategyRndCampaign(input: StrategyRndCampaignInput): StrategyRndCampaignReport {
  const report = runStrategyRndCampaignWithDeps(input, {
    runLoop: runStrategyRndLoop,
    resolveCandidateCount,
  })
  const rdProgramState = maybeUpdateRdProgramState(input.rdProgramStatePath, input.catalogDbPath || defaultCatalogDbPathForGeneratedPath(report.artifact_ref), report as unknown as JSONRecord, report.created_at)
  return rdProgramState ? { ...report, rd_program_state: rdProgramState } : report
}

export {
  runStrategyRndBatch,
  runStrategyRndCampaign,
  runStrategyRndLoop,
  strategyRndBatchInputFromJson,
  strategyRndCampaignInputFromJson,
  strategyRndLoopInputFromJson,
  type StrategyRndBatchInput,
  type StrategyRndBatchReport,
  type StrategyRndCandidateInput,
  type StrategyRndCampaignInput,
  type StrategyRndCampaignReport,
  type StrategyRndLoopInput,
  type StrategyRndLoopReport,
}
