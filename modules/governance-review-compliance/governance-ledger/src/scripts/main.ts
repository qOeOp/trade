#!/usr/bin/env bun

import { Database } from "bun:sqlite"
import { readFileSync } from "node:fs"
import {
  buildClosedFlowReview,
  buildGovernanceEvidence,
  buildPromotionDecision,
  buildReviewBatch,
  ensureGovernanceLedgerSchema,
  recordClosedFlowReview,
  recordGovernanceEvidence,
  recordPromotionDecision,
  recordReviewBatch,
} from "../lib/governance-ledger"
import type { JSONRecord } from "../../../../contracts/runtime-core/src/json"

interface Args {
  dbPath: string
  action: string
  json: JSONRecord
}

export function parseArgs(argv: string[]): Args {
  let dbPath = "data/governance.db"
  let action = "init"
  let json: JSONRecord = {}
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]
    if (arg === "--db") {
      dbPath = argv[++index] ?? dbPath
    } else if (arg === "--action") {
      action = argv[++index] ?? action
    } else if (arg === "--json") {
      json = JSON.parse(argv[++index] ?? "{}") as JSONRecord
    } else if (arg === "--json-file") {
      json = JSON.parse(readFileSync(argv[++index] ?? "", "utf8")) as JSONRecord
    } else if (arg === "--help") {
      printHelp()
      process.exit(0)
    } else {
      throw new Error(`unknown argument: ${arg}`)
    }
  }
  return { dbPath, action, json }
}

export function run(args: Args): JSONRecord {
  const db = new Database(args.dbPath)
  try {
    ensureGovernanceLedgerSchema(db)
    if (args.action === "init") {
      return { ok: true, action: "init", db: args.dbPath }
    }
    if (args.action === "record_evidence") {
      const evidence = buildGovernanceEvidence(args.json)
      recordGovernanceEvidence(db, evidence)
      return { ok: true, action: args.action, evidence }
    }
    if (args.action === "record_promotion_decision") {
      const decision = buildPromotionDecision(args.json)
      recordPromotionDecision(db, decision)
      return { ok: true, action: args.action, decision }
    }
    if (args.action === "record_closed_flow_review") {
      const review = buildClosedFlowReview(args.json)
      recordClosedFlowReview(db, review)
      return { ok: true, action: args.action, review }
    }
    if (args.action === "record_review_batch") {
      const batch = buildReviewBatch(args.json)
      recordReviewBatch(db, batch)
      return { ok: true, action: args.action, batch }
    }
    throw new Error(`unsupported action: ${args.action}`)
  } finally {
    db.close()
  }
}

function printHelp(): void {
  console.log([
    "usage: bun src/scripts/main.ts --db data/governance.db --action init",
    "actions: init | record_evidence | record_promotion_decision | record_closed_flow_review | record_review_batch",
  ].join("\n"))
}

if (import.meta.main) {
  try {
    console.log(JSON.stringify(run(parseArgs(Bun.argv.slice(2))), null, 2))
  } catch (error) {
    console.error(JSON.stringify({ ok: false, error: error instanceof Error ? error.message : String(error) }))
    process.exit(1)
  }
}

