import { Database } from "bun:sqlite"
import { applyReconcileDrafts, reduceFlowState } from "./flow-state"
import { asRecord, stringField, type JSONRecord } from "./json"
import type { Runner } from "./observe-adapter"
import { appendPlanEvent, readFlowEvents, type PlanEvent } from "./plan-events"
import { buildReconcileDrafts } from "./reconcile"
import { runJsonCommand } from "./tool-runner"
import { unwrapToolResponse } from "./execution-flow"

export const CRON_RECOVER_STATUSES = ["abort_unmatched_reconcile", "recovered_noop", "recovered_applied", "reconcile_draft_ready"] as const
export type CronRecoverStatus = typeof CRON_RECOVER_STATUSES[number]

export async function reconcileFromTools(
  db: Database,
  chainId: string,
  input: JSONRecord,
  runner: Runner = runJsonCommand,
): Promise<JSONRecord> {
  const localEvents = readFlowEvents(db, chainId)
  const localState = reduceFlowState(db, chainId)
  const symbol = stringField(input.symbol) || inferFlowSymbol(localEvents, localState)
  if (!symbol) {
    throw new Error("symbol is required")
  }
  const repoRoot = stringField(input.repoRoot) || process.cwd()
  const historyLimit = Number(input.historyLimit) || 50
  const snapshot = await runner([
    "bun",
    "src/scripts/main.ts",
    "--symbol",
    symbol,
    "--include-history",
    "--history-limit",
    String(historyLimit),
  ], {
    cwd: `${repoRoot}/modules/binance/account-snapshot`,
  })
  if (!snapshot.ok) {
    throw new Error(`reconcile snapshot failed: ${snapshot.error}`)
  }
  const accountSnapshot = unwrapToolResponse(snapshot.data)
  return buildReconcileDrafts({
    chain_id: chainId,
    local_events: localEvents,
    local_state: localState,
    account_snapshot: accountSnapshot,
  }) as unknown as JSONRecord
}

export async function cronRecoverFromTools(
  db: Database,
  chainId: string,
  input: JSONRecord,
  yes: boolean,
  runner: Runner = runJsonCommand,
): Promise<JSONRecord> {
  const before = reduceFlowState(db, chainId)
  const reconcile = await reconcileFromTools(db, chainId, input, runner)
  if (Array.isArray(reconcile.unmatched) && reconcile.unmatched.length > 0) {
    const reviewEvent = buildNeedsReviewEvent(chainId, reconcile, input)
    appendPlanEvent(db, reviewEvent)
    return {
      status: "abort_unmatched_reconcile",
      before,
      reconcile,
      review_event: reviewEvent,
      after: reduceFlowState(db, chainId),
    }
  }
  const drafts = Array.isArray(reconcile.drafts) ? reconcile.drafts : []
  if (drafts.length === 0) {
    return {
      status: "recovered_noop",
      before,
      reconcile,
      after: before,
    }
  }
  if (input.apply_reconcile === true) {
    const apply_result = applyReconcileDrafts(db, reconcile, yes)
    return {
      status: "recovered_applied",
      before,
      reconcile,
      apply_result,
      after: reduceFlowState(db, chainId),
    }
  }
  return {
    status: "reconcile_draft_ready",
    before,
    reconcile,
    after: before,
  }
}

function buildNeedsReviewEvent(chainId: string, reconcile: JSONRecord, input: JSONRecord): PlanEvent {
  const created_at = stringField(input.created_at) || stringField(input.now) || new Date().toISOString()
  return {
    event_key: stringField(input.needs_review_event_key) || `needs-review-${chainId}-${created_at.replace(/[^0-9]/g, "") || crypto.randomUUID()}`,
    chain_id: chainId,
    kind: "review",
    created_at,
    body_json: {
      status: "needs_review",
      lifecycle_status: "needs_review",
      reason: "unmatched_reconcile",
      unmatched: Array.isArray(reconcile.unmatched) ? reconcile.unmatched : [],
      compared_at: reconcile.compared_at,
    },
  }
}

function inferFlowSymbol(events: PlanEvent[], localState: JSONRecord): string {
  for (let index = events.length - 1; index >= 0; index -= 1) {
    const symbol = stringField(events[index].body_json.symbol)
    if (symbol) {
      return symbol
    }
  }
  const position = asRecord(localState.current_position)
  return stringField(position.symbol)
}
