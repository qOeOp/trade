import { readFileSync } from "node:fs"
import assert from "node:assert/strict"
import test from "node:test"
import {
  DOMAIN_HOOK_ORDER,
  DOMAIN_RESULT_STATUSES,
  DOMAIN_RUNTIME_SCHEMA_IDS,
  buildDomainJobResult,
  buildHookContext,
  validateDomainJobResult,
} from "./domain-runtime"

test("domain runtime exposes explicit hook order", () => {
  assert.deepEqual(DOMAIN_HOOK_ORDER, ["pre_accept", "pre_handle", "handler", "post_handle", "post_commit", "outbox"])
})

test("domain runtime schemas use stable ids and status vocabulary", () => {
  assert.equal(readSchema("hook-context.schema.json").$id, DOMAIN_RUNTIME_SCHEMA_IDS.hookContext)
  const resultSchema = readSchema("domain-job-result.schema.json")
  assert.equal(resultSchema.$id, DOMAIN_RUNTIME_SCHEMA_IDS.domainJobResult)
  assert.deepEqual(resultSchema.properties?.status?.enum, DOMAIN_RESULT_STATUSES)
})

test("hook context carries permission and audit shell without business payload", () => {
  assert.deepEqual(buildHookContext({
    domain: "live-execution-control",
    job_id: "account_reconcile_guard",
    ticket_no: "J01",
    stage: "serial_account_reconcile",
    hook: "pre_handle",
    idempotency_key: "cycle-1:J01",
    input_refs: ["trade_event_store:chain/flow-1"],
    allowed_writes: ["trade_event_store"],
    trading_mode_ref: "policy_registry:snapshot/runtime",
    audit: { cycle_id: "cycle-1" },
  }), {
    schema_id: DOMAIN_RUNTIME_SCHEMA_IDS.hookContext,
    domain: "live-execution-control",
    job_id: "account_reconcile_guard",
    ticket_no: "J01",
    stage: "serial_account_reconcile",
    hook: "pre_handle",
    idempotency_key: "cycle-1:J01",
    input_refs: ["trade_event_store:chain/flow-1"],
    allowed_writes: ["trade_event_store"],
    trading_mode_ref: "policy_registry:snapshot/runtime",
    audit: { cycle_id: "cycle-1" },
  })
})

test("domain job result validates status, ok semantics, and write scope", () => {
  const result = buildDomainJobResult({
    domain: "governance-review-compliance",
    job_id: "closed_flow_review_sweep",
    idempotency_key: "cycle-1:J07",
    status: "needs_review",
    input_refs: ["trade_event_store:chain/flow-1"],
    output_refs: ["governance_ledger:review_batch/batch-1"],
    writes: { governance_ledger: true },
    incidents: ["incident:review-needed"],
    audit: { ticket_no: "J07" },
  })

  assert.equal(result.ok, false)
  validateDomainJobResult(result, ["governance_ledger"])
  assert.throws(() => validateDomainJobResult(result, ["trade_event_store"]), /writes outside allowed scope/)
})

test("domain runtime rejects unsupported domains and inconsistent ok status", () => {
  assert.throws(() => buildHookContext({
    domain: "unknown-domain",
    job_id: "job",
    hook: "pre_accept",
    idempotency_key: "k",
  }), /unsupported domain/)
  assert.throws(() => buildDomainJobResult({
    domain: "artifact-knowledge",
    job_id: "catalog_hygiene_scan",
    idempotency_key: "cycle-1:J06",
    status: "blocked",
    ok: true,
  }), /ok must be true/)
})

function readSchema(name: string): { $id?: string; properties?: { status?: { enum?: unknown[] } } } {
  return JSON.parse(readFileSync(new URL(`./schemas/${name}`, import.meta.url), "utf8")) as { $id?: string; properties?: { status?: { enum?: unknown[] } } }
}
