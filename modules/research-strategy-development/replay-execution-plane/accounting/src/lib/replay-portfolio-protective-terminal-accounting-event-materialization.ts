import type { ReplayRuntimeSharedWalletFundingEvent } from
  "../../../contracts/src/lib/replay-runtime-shared-wallet-funding-contracts"
import type {
  ReplayRuntimeSharedWalletRiskEntryEvent,
  ReplayRuntimeSharedWalletRiskResult,
} from "../../../contracts/src/lib/replay-runtime-shared-wallet-risk-contracts"
import { addReplayDecimalValues } from "../../../contracts/src/lib/replay-decimal"

interface ProtectiveTerminalAccountingRecord {
  lane_id: string
  priority_rank: number
  funding_cashflow_before_terminal: number
  terminal_time: string | null
  terminal_phase: 10 | 15 | 20 | null
  terminal_source_hash: string | null
  ending_open: boolean
}

interface ProtectiveTerminalAccountingEvent<TRecord> {
  event_time: string
  boundary_phase: 10 | 15 | 20
  event_rank: number
  priority_rank: number
  lane_id: string
  source_event_hash: string
  record: TRecord
  kind: "entry" | "funding" | "terminal" | "terminal_mark"
  funding_cashflow: number
}

export function appendReplayPortfolioProtectiveTerminalPostEntryAccountingEvents<
  TRecord extends ProtectiveTerminalAccountingRecord,
>(input: {
  events: ProtectiveTerminalAccountingEvent<TRecord>[]
  risk_result: ReplayRuntimeSharedWalletRiskResult
  record: TRecord
  entry: ReplayRuntimeSharedWalletRiskEntryEvent
  error_prefix: string
}): void {
  const { events, risk_result: risk, record, entry } = input
  const fundingEvents = fundingBeforeTerminal(risk, record)
  if (addReplayDecimalValues(...fundingEvents.map((event) => event.funding_cashflow))
      !== record.funding_cashflow_before_terminal) {
    throw new Error(`${input.error_prefix} ${record.lane_id} funding source drift`)
  }
  for (const event of fundingEvents) events.push({
    event_time: event.event_time,
    boundary_phase: event.boundary_phase,
    event_rank: 0,
    priority_rank: record.priority_rank,
    lane_id: record.lane_id,
    source_event_hash: event.event_hash,
    record,
    kind: "funding",
    funding_cashflow: event.funding_cashflow,
  })
  if (record.terminal_time && record.terminal_phase && record.terminal_source_hash) events.push({
    event_time: record.terminal_time,
    boundary_phase: record.terminal_phase,
    event_rank: record.terminal_phase === 15 ? 1 : 2,
    priority_rank: record.priority_rank,
    lane_id: record.lane_id,
    source_event_hash: record.terminal_source_hash,
    record,
    kind: "terminal",
    funding_cashflow: 0,
  })
  if (record.ending_open) {
    const mark = [...risk.global_source_event_queue].reverse().find((event) =>
      event.lane_id === record.lane_id && event.event_role === "risk_observation"
        && event.outcome !== "not_reached") ?? entry
    events.push({
      event_time: mark.event_time,
      boundary_phase: mark.boundary_phase,
      event_rank: 4,
      priority_rank: record.priority_rank,
      lane_id: record.lane_id,
      source_event_hash: mark.event_hash,
      record,
      kind: "terminal_mark",
      funding_cashflow: 0,
    })
  }
}

function fundingBeforeTerminal(
  risk: ReplayRuntimeSharedWalletRiskResult,
  record: ProtectiveTerminalAccountingRecord,
): ReplayRuntimeSharedWalletFundingEvent[] {
  return risk.global_source_event_queue.filter((event): event is ReplayRuntimeSharedWalletFundingEvent => {
    if (event.event_role !== "funding" || event.lane_id !== record.lane_id || event.outcome !== "applied") return false
    return !record.terminal_time || event.event_time < record.terminal_time
      || event.event_time === record.terminal_time && event.boundary_phase < (record.terminal_phase ?? 20)
  })
}
