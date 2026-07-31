import type {
  ReplayExecutionRequest,
  ReplayMarketBar,
} from "../../../contracts/src/lib/replay-contracts"
import type {
  ReplaySourceEventDecisionObservationBundle,
} from "../../../contracts/src/lib/replay-source-event-decision-observation-bundle"

export function selectReplayDecisionMarketInputBars(
  request: ReplayExecutionRequest,
  observations: ReplaySourceEventDecisionObservationBundle["projections"][number]["observations"],
): ReplayMarketBar[] {
  const requirement = request.decision_market_input_requirement
  if (requirement.mode === "none") return []
  return observations
    .filter((item) => item.observation_type === "closed_bar")
    .map((item) => structuredClone(item.observation) as ReplayMarketBar)
    .slice(-requirement.lookback_bars)
}
