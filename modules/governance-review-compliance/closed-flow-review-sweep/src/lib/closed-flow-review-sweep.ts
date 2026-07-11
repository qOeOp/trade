import { Database } from "bun:sqlite"
import { asRecord, stringField, type JSONRecord } from "../../../../contracts/runtime-core/src/json"
import { readFlowEvents } from "../../../../portfolio-execution-state/event-store/src/lib/event-store"
import { reduceFlowState } from "../../../../portfolio-execution-state/flow-projector/src/lib/flow-projector"
import { ensureGovernanceLedgerSchema, recordReviewBatch } from "../../../governance-ledger/src/lib/governance-ledger"

export interface ReviewCandidate {
  chain_id: string
  input_ref: string
  strategy_id?: string
  setup_id?: string
  symbol?: string
  side?: string
  latest_order_fill_event_key: string
}

export interface ClosedFlowReviewSweepResult {
  ok: boolean
  ticket_no: "J08"
  job_id: "closed_flow_review_sweep"
  batch_ref: string
  candidates: ReviewCandidate[]
}

export function runClosedFlowReviewSweep(tradeDb: Database, governanceDb: Database, input: JSONRecord): ClosedFlowReviewSweepResult {
  ensureGovernanceLedgerSchema(governanceDb)
  const now = stringField(input.now) || new Date().toISOString()
  const candidateChainIds = stringList(input.candidate_chain_ids)
  const chainIds = candidateChainIds.length > 0 ? candidateChainIds : readAllChainIds(tradeDb)
  const candidates = chainIds
    .map((chainId) => reviewCandidateForChain(tradeDb, chainId))
    .filter((candidate): candidate is ReviewCandidate => candidate != null)
  const batchId = stringField(input.batch_id) || `review-batch-${now.replace(/[^0-9]/g, "") || crypto.randomUUID()}`
  recordReviewBatch(governanceDb, {
    batch_id: batchId,
    status: candidates.length > 0 ? "planned" : "skipped",
    input_refs_json: candidates.map((candidate) => candidate.input_ref),
    summary_json: {
      candidate_count: candidates.length,
      scanned_chain_count: chainIds.length,
    },
    created_at: now,
  })
  return {
    ok: true,
    ticket_no: "J08",
    job_id: "closed_flow_review_sweep",
    batch_ref: `governance_ledger:review_batch/${batchId}`,
    candidates,
  }
}

export function reviewCandidateForChain(db: Database, chainId: string): ReviewCandidate | null {
  const events = readFlowEvents(db, chainId)
  if (events.length === 0 || events.some((event) => event.kind === "review")) {
    return null
  }
  const state = reduceFlowState(db, chainId)
  const position = asRecord(state.current_position)
  const latestOrderFill = asRecord(state.latest_order_fill)
  if (stringField(position.state) !== "flat" || !stringField(latestOrderFill.event_key)) {
    return null
  }
  const latestObserve = asRecord(state.latest_observe)
  const latestObserveBody = asRecord(latestObserve.body_json)
  const latestOrderBody = asRecord(latestOrderFill.body_json)
  return {
    chain_id: chainId,
    input_ref: `trade_event_store:chain/${chainId}`,
    strategy_id: stringField(latestObserveBody.strategy_ref) || undefined,
    setup_id: stringField(latestObserveBody.setup_id) || undefined,
    symbol: stringField(latestObserveBody.symbol) || stringField(latestOrderBody.symbol) || undefined,
    side: stringField(latestObserveBody.side) || undefined,
    latest_order_fill_event_key: stringField(latestOrderFill.event_key),
  }
}

function readAllChainIds(db: Database): string[] {
  const rows = db.query("SELECT DISTINCT chain_id FROM plan_event ORDER BY chain_id ASC").all() as Array<{ chain_id: string }>
  return rows.map((row) => row.chain_id)
}

function stringList(value: unknown): string[] {
  return Array.isArray(value) ? value.map(stringField).filter(Boolean) : []
}

