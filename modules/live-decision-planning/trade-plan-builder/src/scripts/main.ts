#!/usr/bin/env bun

import { stringArray, stringField, withoutUndefined, type JSONRecord } from "../../../../contracts/runtime-core/src/json"
import { errorResponse, printScriptResult, readJsonObjectFlag, successResponse } from "../../../../contracts/runtime-core/src/script-json"

const SCHEMA_VERSION = "trade-plan-builder.result.v1"

function main(argv: string[]): void {
  printScriptResult(run(argv))
}

export function run(argv: string[]): JSONRecord {
  try {
    const input = readJsonObjectFlag(argv, printHelp)
    const planRef = stringField(input.plan_ref)
    const decisionInputRef = stringField(input.decision_input_ref)
    const symbol = stringField(input.symbol)
    const side = stringField(input.side)
    const sourceRefs = stringArray(input.source_refs)
    if (!planRef) throw new Error("plan_ref is required")
    if (!decisionInputRef) throw new Error("decision_input_ref is required")
    if (!symbol) throw new Error("symbol is required")
    if (!["long", "short"].includes(side)) throw new Error("side must be long or short")
    if (sourceRefs.length === 0) throw new Error("source_refs must be non-empty")
    const riskBudgetUsdt = optionalNumber(input.risk_budget_usdt) ?? 0
    const accountScope = stringField(input.account_scope)
    const expiresAt = stringField(input.expires_at) || undefined
    return successResponse(SCHEMA_VERSION, withoutUndefined({
        schema_version: "trade-plan-draft.v1",
        plan_ref: planRef,
        decision_input_ref: decisionInputRef,
        symbol,
        side,
        entry: optionalNumber(input.entry),
        stop: optionalNumber(input.stop),
        invalidation_ref: stringField(input.invalidation_ref) || undefined,
        trigger_ref: stringField(input.trigger_ref) || undefined,
        risk_budget_ref: stringField(input.risk_budget_ref) || undefined,
        risk_budget_usdt: riskBudgetUsdt,
        expires_at: expiresAt,
        source_refs: sourceRefs,
        capital_allocation_proposal: {
          schema_version: "capital-allocation-proposal.v1",
          proposal_ref: stringField(input.allocation_proposal_ref) || `${planRef}/allocation`,
          status: riskBudgetUsdt > 0 ? "proposed" : "not_allocated",
          account_scope: accountScope || undefined,
          strategy_ref: stringField(input.strategy_ref) || undefined,
          symbol,
          risk_budget_usdt: riskBudgetUsdt,
          expires_at: expiresAt,
          source_refs: sourceRefs,
        },
        content_hash: stringField(input.content_hash) || stableHash([planRef, decisionInputRef, symbol, side, ...sourceRefs].join("|")),
      }))
  } catch (error) {
    return errorResponse(SCHEMA_VERSION, error)
  }
}

function optionalNumber(value: unknown): number | undefined {
  if (value === undefined || value === null || value === "") return undefined
  const parsed = Number(value)
  if (!Number.isFinite(parsed)) throw new Error("numeric plan fields must be finite")
  return parsed
}

function stableHash(value: string): string {
  let hash = 2166136261
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index)
    hash = Math.imul(hash, 16777619)
  }
  return `fnv1a:${(hash >>> 0).toString(16)}`
}

function printHelp(): void {
  console.log("Usage: bun src/scripts/main.ts --json '<trade plan payload>'")
}

if (import.meta.main) main(process.argv.slice(2))
