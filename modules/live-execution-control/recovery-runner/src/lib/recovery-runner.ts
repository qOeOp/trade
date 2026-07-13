import { asRecord, stringField, type JSONRecord } from "../../../../contracts/runtime-core/src/json"
import { unwrapToolResponse } from "../../../execution-recorder/src/lib/execution-recorder"
import { buildReconcileDrafts } from "../../../reconcile-drafts/src/lib/reconcile-drafts"
import { appendEvent, readFlowEvents } from "./event-store-client"
import { applyReconcile, reduceFlow } from "./flow-projector-client"
import { runJsonCommand, type Runner } from "./tool-runner"

type PlanEvent = {
  event_key: string
  chain_id: string
  kind: string
  created_at: string
  body_json: JSONRecord
}

interface RecoveryRuntime {
  eventReader?: (dbPath: string, chainId: string) => JSONRecord[]
  stateReader?: (dbPath: string, chainId: string) => JSONRecord
  eventAppender?: (dbPath: string, event: JSONRecord) => JSONRecord
  reconcileApplier?: (dbPath: string, reconcile: JSONRecord, yes: boolean) => JSONRecord
}

export const CRON_RECOVER_STATUSES = ["abort_unmatched_reconcile", "recovered_noop", "recovered_applied", "reconcile_draft_ready"] as const
export type CronRecoverStatus = typeof CRON_RECOVER_STATUSES[number]

export async function reconcileFromTools(
  dbPath: string,
  chainId: string,
  input: JSONRecord,
  runner: Runner = runJsonCommand,
  runtime: RecoveryRuntime = {},
): Promise<JSONRecord> {
  const localEvents = (runtime.eventReader ?? readFlowEvents)(dbPath, chainId)
  const localState = (runtime.stateReader ?? reduceFlow)(dbPath, chainId)
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
    cwd: `${repoRoot}/modules/exchange-gateway/binance-read/account-snapshot`,
  })
  if (!snapshot.ok) {
    throw new Error(`reconcile snapshot failed: ${snapshot.error}`)
  }
  const accountSnapshot = unwrapToolResponse(snapshot.data)
  return buildReconcileDrafts({
    chain_id: chainId,
    local_events: localEvents as unknown as Parameters<typeof buildReconcileDrafts>[0]["local_events"],
    local_state: localState,
    account_snapshot: accountSnapshot,
  }) as unknown as JSONRecord
}

export function reconcileLocalFlow(dbPath: string, chainId: string, accountSnapshot: JSONRecord, runtime: RecoveryRuntime = {}): JSONRecord {
  const localEvents = (runtime.eventReader ?? readFlowEvents)(dbPath, chainId)
  return buildReconcileDrafts({
    chain_id: chainId,
    local_events: localEvents as unknown as Parameters<typeof buildReconcileDrafts>[0]["local_events"],
    local_state: (runtime.stateReader ?? reduceFlow)(dbPath, chainId),
    account_snapshot: accountSnapshot,
  }) as unknown as JSONRecord
}

export async function cronRecoverFromTools(
  dbPath: string,
  chainId: string,
  input: JSONRecord,
  yes: boolean,
  runner: Runner = runJsonCommand,
  runtime: RecoveryRuntime = {},
): Promise<JSONRecord> {
  const before = (runtime.stateReader ?? reduceFlow)(dbPath, chainId)
  const reconcile = await reconcileFromTools(dbPath, chainId, input, runner, runtime)
  if (Array.isArray(reconcile.unmatched) && reconcile.unmatched.length > 0) {
    const reviewEvent = buildNeedsReviewEvent(chainId, reconcile, input)
    ;(runtime.eventAppender ?? appendEvent)(dbPath, reviewEvent as unknown as JSONRecord)
    return {
      status: "abort_unmatched_reconcile",
      before,
      reconcile,
      review_event: reviewEvent,
      after: (runtime.stateReader ?? reduceFlow)(dbPath, chainId),
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
    const apply_result = (runtime.reconcileApplier ?? applyReconcile)(dbPath, reconcile, yes)
    return {
      status: "recovered_applied",
      before,
      reconcile,
      apply_result,
      after: (runtime.stateReader ?? reduceFlow)(dbPath, chainId),
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

function inferFlowSymbol(events: JSONRecord[], localState: JSONRecord): string {
  for (let index = events.length - 1; index >= 0; index -= 1) {
    const symbol = stringField(asRecord(events[index].body_json).symbol)
    if (symbol) {
      return symbol
    }
  }
  const position = asRecord(localState.current_position)
  return stringField(position.symbol)
}
