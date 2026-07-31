import { expect, test } from "bun:test"
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { Database } from "bun:sqlite"
import {
  CONTROL_PLANE_IDENTITY_SCHEMA_VERSION,
  DRAFT_AUTHORIZATION_SCHEMA_VERSION,
  type DraftStrategyAuthorization,
} from "../../../contracts/src/lib/control-plane-contracts"
import {
  SOURCE_SCHEMA_VERSION,
  renderStrategyPolicyMarkdown,
  strategyIDFromSlug,
  strategyPolicySlug,
  type StrategyPolicySource,
} from "../../../strategy-policy-writer/src/lib/strategy-policy-writer"
import {
  ensureStrategyRegistrySchema,
  materializeDraftStrategy,
  readReadyDraftStrategy,
} from "./strategy-registry"

const HASH = "c".repeat(64)

function authorization(): DraftStrategyAuthorization {
  return {
    schema_version: DRAFT_AUTHORIZATION_SCHEMA_VERSION,
    decision: "accept_for_draft",
    decision_id: "decision-1", reviewer_run_id: "reviewer-1",
    primary_result_id: "result-1", primary_result_hash: HASH,
    selected_trial_id: "trial-1", selected_candidate_id: "candidate-1",
    candidate_frozen_at: "2026-07-14T08:00:00Z",
    identity: {
      schema_version: CONTROL_PLANE_IDENTITY_SCHEMA_VERSION,
      experiment_id: "experiment-1", trial_group_id: "group-1", trial_group_hash: HASH,
      trial_id: "trial-1", candidate_id: "candidate-1", candidate_hash: HASH,
      identity_hash_policy_version: "identity-v1", experiment_contract_hash: HASH,
    },
  }
}

function source(): StrategyPolicySource {
  return {
    schema_version: SOURCE_SCHEMA_VERSION,
    program_id: "program-1",
    objective: "Test a causal closed-candle trend pullback candidate on the frozen contract.",
    drafted_at: "2026-07-14T08:00:00Z",
    evidence_refs: ["result://result-1"],
    candidate: { candidate_id: "candidate-1", family: "trend_pullback_v1", timeframe: "4h", validation_run_ref: "result://result-1", params: { side: "long", stop_atr: 1, reward_risk: 2 } },
  }
}

test("accept_for_draft materializes, hashes, and registers one strategy source", () => {
  const db = new Database(":memory:")
  const root = mkdtempSync(join(tmpdir(), "rd-strategy-registry-"))
  const input = { draft_id: "draft-1", strategy_version: "1", idempotency_key: "draft-key-1", strategy_root: root, created_at: "2026-07-14T08:00:00Z", authorization: authorization(), policy_source: source() }
  const first = materializeDraftStrategy(db, input)
  const second = materializeDraftStrategy(db, input)
  expect(first).toEqual(second)
  expect(existsSync(first.strategy_ref)).toBe(true)
  expect(readFileSync(first.strategy_ref, "utf8")).toContain("status: draft")
  expect(readReadyDraftStrategy(db, "draft-1")).toEqual(first)
  db.close()
})

test("materializer rejects policy source not authorized by selected Candidate", () => {
  const db = new Database(":memory:")
  const root = mkdtempSync(join(tmpdir(), "rd-strategy-registry-"))
  expect(() => materializeDraftStrategy(db, {
    draft_id: "draft-2", strategy_version: "1", idempotency_key: "draft-key-2", strategy_root: root,
    created_at: "2026-07-14T08:00:00Z", authorization: authorization(),
    policy_source: { ...source(), candidate: { ...source().candidate, candidate_id: "other" } },
  })).toThrow()
  db.close()
})

test("materializer recovers a source committed before the Registry row became ready", () => {
  const db = new Database(":memory:")
  const root = mkdtempSync(join(tmpdir(), "rd-strategy-registry-"))
  const input = { draft_id: "draft-recovery", strategy_version: "1", idempotency_key: "draft-key-recovery", strategy_root: root, created_at: "2026-07-14T08:00:00Z", authorization: authorization(), policy_source: source() }
  const slug = strategyPolicySlug(input.policy_source.candidate.candidate_id)
  const strategyRef = join(root, `${slug}.md`)
  writeFileSync(strategyRef, renderStrategyPolicyMarkdown(input.policy_source))
  ensureStrategyRegistrySchema(db)
  db.query(`
    INSERT INTO rd_strategy_draft(
      draft_id, strategy_id, strategy_version, strategy_ref, strategy_policy_hash,
      materialization_status, authorization_json, policy_source_json,
      idempotency_key, error_message, created_at, updated_at
    ) VALUES ($draft_id, $strategy_id, $version, NULL, NULL, 'pending',
      $authorization, $source, $key, NULL, $created_at, $created_at)
  `).run({
    $draft_id: input.draft_id,
    $strategy_id: strategyIDFromSlug(slug),
    $version: input.strategy_version,
    $authorization: JSON.stringify(input.authorization),
    $source: JSON.stringify(input.policy_source),
    $key: input.idempotency_key,
    $created_at: input.created_at,
  })
  const binding = materializeDraftStrategy(db, input)
  expect(binding.materialization_status).toBe("ready")
  expect(binding.strategy_ref).toBe(strategyRef)
  db.close()
})

test("materializer never overwrites a conflicting existing strategy source", () => {
  const db = new Database(":memory:")
  const root = mkdtempSync(join(tmpdir(), "rd-strategy-registry-"))
  const input = { draft_id: "draft-conflict", strategy_version: "1", idempotency_key: "draft-key-conflict", strategy_root: root, created_at: "2026-07-14T08:00:00Z", authorization: authorization(), policy_source: source() }
  const strategyRef = join(root, `${strategyPolicySlug(input.policy_source.candidate.candidate_id)}.md`)
  writeFileSync(strategyRef, "foreign content\n")
  expect(() => materializeDraftStrategy(db, input)).toThrow("content drifted")
  expect(readFileSync(strategyRef, "utf8")).toBe("foreign content\n")
  const row = db.query(`
    SELECT materialization_status FROM rd_strategy_draft WHERE draft_id=$draft_id
  `).get({ $draft_id: input.draft_id }) as { materialization_status: string }
  expect(row.materialization_status).toBe("failed")
  db.close()
})
