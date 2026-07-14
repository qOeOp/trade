import { expect, test } from "bun:test"
import type { ReplayBoundaryPhase, ReplayEventKey, ReplayFill, ReplayLedgerEntry } from "../../../contracts/src/lib/replay-contracts"
import { deriveReplayMetrics } from "./replay-metrics"

function eventKey(eventTime: string, phase: ReplayBoundaryPhase, id: string): ReplayEventKey {
  return { event_time: eventTime, boundary_phase: phase, source_sequence: 1, event_subphase: 0, stable_event_id: id }
}

test("metrics are derived from immutable fills and ledger", () => {
  const fills: ReplayFill[] = [
    { fill_id: "f1", order_id: "o1", order_role: "entry", event_key: eventKey("2026-07-14T00:00:00Z", 20, "entry-fill"), timestamp: "2026-07-14T00:00:00Z", side: "buy", quantity: 1, price: 100, fee: 1, reduce_only: false },
    { fill_id: "f2", order_id: "o2", order_role: "target", event_key: eventKey("2026-07-14T08:00:00Z", 20, "exit-fill"), timestamp: "2026-07-14T08:00:00Z", side: "sell", quantity: 1, price: 110, fee: 1, reduce_only: true },
  ]
  const ledger: ReplayLedgerEntry[] = [
    { entry_id: "l1", event_key: eventKey(fills[0].timestamp, 70, "initial"), timestamp: fills[0].timestamp, kind: "initial_cash", amount: 1000, balance_after: 1000, ref: "run" },
    { entry_id: "l2", event_key: fills[0].event_key, timestamp: fills[0].timestamp, kind: "fee", amount: -1, balance_after: 999, ref: "f1" },
    { entry_id: "l3", event_key: fills[1].event_key, timestamp: fills[1].timestamp, kind: "realized_pnl", amount: 10, balance_after: 1009, ref: "f2" },
    { entry_id: "l4", event_key: fills[1].event_key, timestamp: fills[1].timestamp, kind: "fee", amount: -1, balance_after: 1008, ref: "f2" },
    { entry_id: "l5", event_key: eventKey(fills[1].timestamp, 100, "ending"), timestamp: fills[1].timestamp, kind: "ending_equity", amount: 0, balance_after: 1008, ref: "run" },
  ]
  expect(deriveReplayMetrics({ initial_cash: 1000, fills, ledger })).toEqual({
    initial_cash: 1000,
    ending_equity: 1008,
    net_pnl: 8,
    return_fraction: 0.008,
    realized_pnl: 10,
    total_fees: 2,
    total_funding: 0,
    trade_count: 1,
  })
})
