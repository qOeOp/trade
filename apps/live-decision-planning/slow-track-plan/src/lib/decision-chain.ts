import { asRecord, stringField, type JSONRecord } from "../../../../contracts/runtime-core/src/json"
import { run as assembleDecisionInput } from "../../../decision-input-assembler/src/scripts/main"
import { run as buildTradePlan } from "../../../trade-plan-builder/src/scripts/main"
import { run as publishActionIntent } from "../../../action-intent-publisher/src/scripts/main"

export interface DecisionChainInput {
  runId: string
  generatedAt: string
  runtime: JSONRecord
  accountState: JSONRecord
  watchlist: JSONRecord[]
}

export function buildDecisionChain(input: DecisionChainInput): {
  decision_input_bundle: JSONRecord
  trade_plan_draft: JSONRecord | null
  capital_allocation_proposal: JSONRecord | null
  action_intent: JSONRecord
} {
  const authorization = asRecord(input.runtime.runtime_authorization)
  const runtimePolicy = asRecord(input.runtime.runtime_policy)
  const top = input.watchlist[0]
  const marketRefs = input.watchlist.map((item) => stringField(item.symbol)).filter(Boolean)
    .map((symbol) => `market-fact://binance/usdm/${symbol}/${encodeURIComponent(input.generatedAt)}`)
  const policyRefs = [stringField(authorization.authorization_ref), stringField(authorization.policy_ref)].filter(Boolean)
  const accountRefs = [stringField(input.accountState.snapshot_ref), stringField(input.accountState.account_ref)].filter(Boolean)
  const flowRefs = ["flow_read_models:active-flows"]
  const sourceRefs = [...new Set([...policyRefs, ...accountRefs, ...marketRefs, ...flowRefs])]
  const decisionInputRef = `decision-input://${encodeURIComponent(input.runId)}`
  const decisionInput = unwrap(assembleDecisionInput(["--json", JSON.stringify({
    decision_input_ref: decisionInputRef,
    source_refs: sourceRefs,
    policy_refs: policyRefs,
    market_refs: marketRefs,
    flow_refs: flowRefs,
    account_refs: accountRefs,
    symbol_scope: input.watchlist.map((item) => stringField(item.symbol)).filter(Boolean),
    assembled_at: input.generatedAt,
  })]), "decision input assembler")
  let tradePlan: JSONRecord | null = null
  if (top) {
    const symbol = stringField(top.symbol)
    const side = stringField(top.side)
    const strategyUsage = asRecord(top.strategy_usage)
    const matchedStrategies = Array.isArray(strategyUsage.matched_live_small_strategies)
      ? strategyUsage.matched_live_small_strategies.map(String)
      : []
    const expiresAt = new Date(Date.parse(input.generatedAt) + 4 * 60 * 60 * 1000).toISOString()
    tradePlan = unwrap(buildTradePlan(["--json", JSON.stringify({
      plan_ref: `trade-plan://${encodeURIComponent(input.runId)}/${symbol}`,
      decision_input_ref: decisionInputRef,
      symbol,
      side,
      source_refs: [decisionInputRef, ...sourceRefs],
      risk_budget_usdt: 0,
      risk_budget_ref: stringField(authorization.policy_ref),
      account_scope: stringField(runtimePolicy.account_scope),
      strategy_ref: matchedStrategies[0] ? `strategy://${matchedStrategies[0]}` : undefined,
      expires_at: expiresAt,
    })]), "trade plan builder")
  }

  const actionIntent = unwrap(publishActionIntent(["--json", JSON.stringify({
    intent_ref: `action-intent://${encodeURIComponent(input.runId)}`,
    intent_kind: "no_action",
    status: "blocked",
    symbol: top ? stringField(top.symbol) : undefined,
    side: top ? stringField(top.side) : "flat",
    source_refs: tradePlan ? [stringField(tradePlan.plan_ref), decisionInputRef] : [decisionInputRef],
    expires_at: tradePlan ? stringField(tradePlan.expires_at) : undefined,
    no_action_reason: "slow_track_analysis_only_requires_explicit_plan_approval",
    content_hash: stringField(tradePlan?.content_hash) || stringField(decisionInput.content_hash),
  })]), "action intent publisher")
  return {
    decision_input_bundle: decisionInput,
    trade_plan_draft: tradePlan,
    capital_allocation_proposal: tradePlan ? asRecord(tradePlan.capital_allocation_proposal) : null,
    action_intent: actionIntent,
  }
}

function unwrap(result: JSONRecord, label: string): JSONRecord {
  if (result.ok !== true) throw new Error(`${label} failed: ${stringField(result.error) || "unknown error"}`)
  return asRecord(result.data)
}
