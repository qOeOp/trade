import { Database } from "bun:sqlite"
import { buildDomainJobResult, validateDomainJobResult } from "../../../../contracts/domain-runtime/src/domain-runtime"
import { asRecord, stringField, type JSONRecord } from "../../../../contracts/runtime-core/src/json"
import { ensureGovernanceLedgerSchema, recordReviewBatch } from "../../../governance-ledger/src/lib/governance-ledger"
import { listChainIds, readFlowEvents } from "./event-store-client"
import { reduceFlow } from "./flow-projector-client"

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
  ticket_no: "J07"
  job_id: "closed_flow_review_sweep"
  batch_ref: string
  candidates: ReviewCandidate[]
  runtime_result: JSONRecord
}

export interface ClosedFlowReviewRuntime {
  chainLister?: (dbPath: string) => string[]
  eventReader?: (dbPath: string, chainId: string) => JSONRecord[]
  flowStateReader?: (dbPath: string, chainId: string) => JSONRecord
}

export function runClosedFlowReviewSweep(
  tradeDbPath: string,
  governanceDb: Database,
  input: JSONRecord,
  runtime: ClosedFlowReviewRuntime = {},
): ClosedFlowReviewSweepResult {
  ensureGovernanceLedgerSchema(governanceDb)
  const now = stringField(input.now) || new Date().toISOString()
  const candidateChainIds = stringList(input.candidate_chain_ids)
  const chainIds = candidateChainIds.length > 0 ? candidateChainIds : readChainIds(tradeDbPath, runtime)
  const candidates = chainIds
    .map((chainId) => reviewCandidateForChain(tradeDbPath, chainId, runtime))
    .filter((candidate): candidate is ReviewCandidate => candidate != null)
  const batchId = stringField(input.batch_id) || `review-batch-${now.replace(/[^0-9]/g, "") || crypto.randomUUID()}`
  const batchRef = `governance_ledger:review_batch/${batchId}`
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
  const runtimeResult = buildDomainJobResult({
    domain: "governance-review-compliance",
    job_id: "closed_flow_review_sweep",
    idempotency_key: stringField(input.idempotency_key) || `${stringField(input.cycle_id) || batchId}:J07`,
    status: "ok",
    input_refs: candidates.length > 0 ? candidates.map((candidate) => candidate.input_ref) : chainIds.map((chainId) => `trade_event_store:chain/${chainId}`),
    output_refs: [batchRef],
    writes: { governance_ledger: true },
    incidents: [],
    audit: {
      cycle_id: stringField(input.cycle_id) || undefined,
      ticket_no: "J07",
      batch_id: batchId,
      candidate_count: candidates.length,
      scanned_chain_count: chainIds.length,
    },
  })
  validateDomainJobResult(runtimeResult, ["governance_ledger"])
  return {
    ok: true,
    ticket_no: "J07",
    job_id: "closed_flow_review_sweep",
    batch_ref: batchRef,
    candidates,
    runtime_result: runtimeResult,
  }
}

export function reviewCandidateForChain(
  tradeDbPath: string,
  chainId: string,
  runtime: ClosedFlowReviewRuntime = {},
): ReviewCandidate | null {
  const events = readStateEvents(tradeDbPath, chainId, runtime)
  if (events.length === 0 || events.some((event) => stringField(event.kind) === "review")) {
    return null
  }
  const state = readFlowState(tradeDbPath, chainId, runtime)
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

function readChainIds(tradeDbPath: string, runtime: ClosedFlowReviewRuntime): string[] {
  return (runtime.chainLister ?? listChainIds)(tradeDbPath)
}

function readStateEvents(tradeDbPath: string, chainId: string, runtime: ClosedFlowReviewRuntime): JSONRecord[] {
  return (runtime.eventReader ?? readFlowEvents)(tradeDbPath, chainId)
}

function readFlowState(tradeDbPath: string, chainId: string, runtime: ClosedFlowReviewRuntime): JSONRecord {
  return (runtime.flowStateReader ?? reduceFlow)(tradeDbPath, chainId)
}

function stringList(value: unknown): string[] {
  return Array.isArray(value) ? value.map(stringField).filter(Boolean) : []
}
