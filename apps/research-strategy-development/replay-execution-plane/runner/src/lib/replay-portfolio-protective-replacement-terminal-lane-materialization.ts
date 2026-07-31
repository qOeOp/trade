import { canonicalHash } from "../../../contracts/src/lib/replay-contracts"
import type { ReplayPortfolioProtectiveTerminalRunInput } from
  "./replay-portfolio-protective-terminal-runner"

type ScheduleEntry = NonNullable<NonNullable<
  ReplayPortfolioProtectiveTerminalRunInput["lanes"][number]["trial"]["request"]["decision_schedule"]
>["entries"]>[number]

export function materializeReplayPortfolioProtectiveReplacementTerminalLanes<TIntent, TLane>(
  input: Pick<ReplayPortfolioProtectiveTerminalRunInput, "risk_plan" | "lanes">,
  config: {
    replacement_effect: ScheduleEntry["expected_effect"]
    select_intent: (entry: ScheduleEntry) => TIntent | null
  },
): TLane[] {
  return materializeReplayPortfolioProtectiveMutationTerminalLanes(input, {
    mutation_effect: config.replacement_effect,
    select_intent: config.select_intent,
    mutation_key: "replacement",
  })
}

export function materializeReplayPortfolioProtectiveMutationTerminalLanes<TIntent, TLane>(
  input: Pick<ReplayPortfolioProtectiveTerminalRunInput, "risk_plan" | "lanes">,
  config: {
    mutation_effect: ScheduleEntry["expected_effect"]
    select_intent: (entry: ScheduleEntry) => TIntent | null
    mutation_key: "replacement" | "cancel"
  },
): TLane[] {
  const plannedByLane = new Map(input.risk_plan.lanes.map((lane) => [lane.lane_id, lane]))
  return input.lanes.map(({ lane_id: laneId, trial }) => {
    const planned = plannedByLane.get(laneId)
    if (!planned || planned.request_hash !== canonicalHash(trial.request)) {
      throw new Error(`Portfolio replacement terminal Lane ${laneId} frozen request drift`)
    }
    const scheduleEntries = trial.request.decision_schedule?.entries ?? []
    const mutations = scheduleEntries.filter((entry) => entry.expected_effect === config.mutation_effect)
    if (mutations.length > 1 || scheduleEntries.some((entry) => ![
      "authorized_initial_order", config.mutation_effect, "authorized_reduce_only_exit", "no_action",
    ].includes(entry.expected_effect))) {
      throw new Error(`Portfolio mutation terminal Lane ${laneId} exceeds bounded mutation scope`)
    }
    const mutationEntry = mutations[0] ?? null
    const intent = mutationEntry ? config.select_intent(mutationEntry) : null
    if (mutationEntry && (!intent || mutationEntry.authorized_order_hash !== canonicalHash(intent))) {
      throw new Error(`Portfolio mutation terminal Lane ${laneId} authority drift`)
    }
    const accounting = trial.dataset_manifest.instrument.accounting
    return {
      lane_id: laneId,
      run_id: trial.request.run_id,
      request_hash: planned.request_hash,
      bars: structuredClone(trial.bars),
      bars_hash: canonicalHash(trial.bars),
      cost_policy_id: trial.request.cost_policy.policy_id,
      cost_policy_version: trial.request.cost_policy.version,
      fee_bps: trial.request.cost_policy.fee_bps,
      slippage_bps: trial.request.cost_policy.slippage_bps,
      price_increment: accounting.price_increment,
      settlement_increment: accounting.settlement_increment,
      settlement_asset: accounting.settlement_asset,
      [config.mutation_key]: mutationEntry && intent ? {
        decision_sequence: mutationEntry.decision_sequence,
        decision_time: mutationEntry.decision_time,
        intent: structuredClone(intent),
        intent_hash: canonicalHash(intent),
      } : null,
    } as TLane
  }).sort((left, right) => {
    const a = left as { lane_id: string }
    const b = right as { lane_id: string }
    return a.lane_id.localeCompare(b.lane_id)
  })
}
