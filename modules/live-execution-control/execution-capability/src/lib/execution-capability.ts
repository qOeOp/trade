import { canonicalHash } from "../../../../contracts/runtime-core/src/canonical-json"
import { asRecord, numberField, stringField, type JSONRecord } from "../../../../contracts/runtime-core/src/json"
export { validateExecutionCapability } from "../../../../contracts/execution-capability-contract/src/execution-capability-contract"

const CAPABILITY_ACTIONS = new Set(["place_entry", "cancel_order", "adjust_position", "sync_protection", "reduce_position", "close_position"])

export interface BuildExecutionCapabilityInput {
  target_action: string
  preflight_result: JSONRecord
  runtime_authorization: JSONRecord
  account_fact: JSONRecord
  portfolio_projection: JSONRecord
  source_intent_ref: string
  idempotency_key: string
  risk_budget_usdt?: number
  max_notional_usdt?: number
  now?: string
  expires_at?: string
}

export function buildExecutionCapability(input: BuildExecutionCapabilityInput): JSONRecord {
  if (input.preflight_result.verdict !== "armable") throw new Error("execution capability requires armable preflight")
  if (!CAPABILITY_ACTIONS.has(input.target_action)) throw new Error("execution capability target_action is unsupported")
  if (!input.source_intent_ref || !input.idempotency_key) throw new Error("source_intent_ref and idempotency_key are required")

  const authorization = input.runtime_authorization
  const accountFact = input.account_fact
  const projection = input.portfolio_projection
  const accountRef = stringField(accountFact.account_ref)
  const accountScope = stringField(accountFact.account_scope)
  assertEqual(accountRef, stringField(authorization.account_ref), "authorization account_ref")
  assertEqual(accountScope, stringField(authorization.account_scope), "authorization account_scope")
  assertEqual(accountRef, stringField(projection.account_ref), "projection account_ref")
  assertEqual(accountScope, stringField(projection.account_scope), "projection account_scope")

  const policyAuthorizationRef = stringField(authorization.authorization_ref)
  const policyHash = stringField(authorization.policy_hash)
  const accountFactRef = stringField(accountFact.snapshot_ref)
  const portfolioProjectionRef = stringField(projection.projection_ref)
  if (!policyAuthorizationRef || !policyHash || !accountFactRef || !portfolioProjectionRef) {
    throw new Error("execution capability requires policy, account fact, and portfolio projection refs")
  }

  const issuedAt = input.now || new Date().toISOString()
  const issuedMs = parseTime(issuedAt, "now")
  const expiryCandidates = [
    parseTime(stringField(authorization.expires_at), "authorization expires_at"),
    parseTime(stringField(accountFact.as_of), "account fact as_of") + freshnessSeconds(accountFact) * 1000,
    issuedMs + 30_000,
  ]
  if (input.expires_at) expiryCandidates.push(parseTime(input.expires_at, "expires_at"))
  const expiresAtMs = Math.min(...expiryCandidates)
  if (expiresAtMs <= issuedMs) throw new Error("execution capability sources are expired")

  const body = {
    schema_version: "trade.execution.capability.v1",
    target_action: input.target_action,
    account_ref: accountRef,
    account_scope: accountScope,
    source_intent_ref: input.source_intent_ref,
    policy_authorization_ref: policyAuthorizationRef,
    policy_hash: policyHash,
    account_fact_ref: accountFactRef,
    portfolio_projection_ref: portfolioProjectionRef,
    idempotency_key: input.idempotency_key,
    max_effect: {
      risk_budget_usdt: Math.max(0, Number(input.risk_budget_usdt) || 0),
      notional_usdt: Math.max(0, Number(input.max_notional_usdt) || 0),
    },
    issued_at: issuedAt,
    expires_at: new Date(expiresAtMs).toISOString(),
  }
  const contentHash = `sha256:${canonicalHash(body)}`
  return {
    ...body,
    content_hash: contentHash,
    capability_ref: `execution-capability://${encodeURIComponent(accountScope)}/${contentHash.slice(7)}`,
  }
}

function assertEqual(value: string, expected: string, label: string): void {
  if (!value || !expected || value !== expected) throw new Error(`execution capability ${label} mismatch`)
}

function parseTime(value: string, label: string): number {
  const parsed = Date.parse(value)
  if (!value || !Number.isFinite(parsed)) throw new Error(`execution capability ${label} must be a valid timestamp`)
  return parsed
}

function freshnessSeconds(accountFact: JSONRecord): number {
  return numberField(asRecord(accountFact.freshness).max_age_seconds) || 30
}
