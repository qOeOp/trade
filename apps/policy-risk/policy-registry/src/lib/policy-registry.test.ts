import { Database } from "bun:sqlite"
import assert from "node:assert/strict"
import test from "node:test"
import {
  authorizeCompiledRuntimePolicy,
  buildApprovedStrategyRef,
  buildPolicySnapshot,
  ensurePolicyRegistrySchema,
  listApprovedStrategyRefs,
  readPolicySnapshot,
  recordPolicySnapshot,
  upsertApprovedStrategyRef,
} from "./policy-registry"

test("policy registry persists compiled policy and issues account-scoped bounded authorization", () => {
  const db = new Database(":memory:")
  ensurePolicyRegistrySchema(db)
  try {
    const result = authorizeCompiledRuntimePolicy(db, {
      now: "2026-07-23T00:00:00.000Z",
      ttl_seconds: 300,
      runtime_policy: {
        schema_version: "runtime-policy.v1",
        profile_id: "retail-small-usdm",
        account_ref: "exchange-account://binance/live/usdm/primary",
        account_scope: "capital-scope://retail-small-usdm",
        source_hash: `sha256:${"a".repeat(64)}`,
        compiled_at: "2026-07-23T00:00:00.000Z",
        effective_limits: {},
        cost_model: {},
        permissions: { can_live_small: true },
      },
      policy_snapshot_ref: {
        policy_hash: `sha256:${"a".repeat(64)}`,
      },
    })

    assert.equal(result.authorization.account_scope, "capital-scope://retail-small-usdm")
    assert.equal(result.authorization.expires_at, "2026-07-23T00:05:00.000Z")
    assert.match(result.authorization.authorization_ref, /^policy-authorization:\/\//)
    assert.equal(readPolicySnapshot(db, `sha256:${"a".repeat(64)}`)?.profile, "retail-small-usdm")
  } finally {
    db.close()
  }
})

test("policy registry records immutable snapshots and approved refs", () => {
  const db = new Database(":memory:")
  ensurePolicyRegistrySchema(db)
  try {
    recordPolicySnapshot(db, buildPolicySnapshot({
      policy_hash: "policy-a",
      source_hash: "source-a",
      profile: "default",
      snapshot: { max_risk_pct: 0.5 },
      now: "2026-07-11T00:00:00Z",
    }))
    upsertApprovedStrategyRef(db, buildApprovedStrategyRef({
      strategy_ref: "strategy://btc-breakout",
      strategy_id: "btc-breakout",
      policy_hash: "policy-a",
      status: "live-small",
      source_path: "strategies/btc-breakout.md",
      source_hash: "sha256:strategy",
      approved_at: "2026-07-10T00:00:00Z",
      now: "2026-07-11T00:00:00Z",
    }))

    const snapshot = readPolicySnapshot(db, "policy-a")
    assert.equal(snapshot?.profile, "default")
    assert.equal(snapshot?.snapshot_json.max_risk_pct, 0.5)
    const refs = listApprovedStrategyRefs(db, "live-small")
    assert.equal(refs.length, 1)
    assert.equal(refs[0].strategy_id, "btc-breakout")
  } finally {
    db.close()
  }
})

test("policy registry upserts strategy status without mutating snapshot", () => {
  const db = new Database(":memory:")
  ensurePolicyRegistrySchema(db)
  try {
    recordPolicySnapshot(db, buildPolicySnapshot({
      policy_hash: "policy-a",
      source_hash: "source-a",
      snapshot: { version: 1 },
    }))
    upsertApprovedStrategyRef(db, buildApprovedStrategyRef({
      strategy_ref: "strategy://eth",
      strategy_id: "eth",
      policy_hash: "policy-a",
      status: "shadow",
      source_path: "strategies/eth.md",
      source_hash: "sha256:eth1",
    }))
    upsertApprovedStrategyRef(db, buildApprovedStrategyRef({
      strategy_ref: "strategy://eth",
      strategy_id: "eth",
      policy_hash: "policy-a",
      status: "paused",
      source_path: "strategies/eth.md",
      source_hash: "sha256:eth2",
    }))
    assert.equal(listApprovedStrategyRefs(db, "shadow").length, 0)
    assert.equal(listApprovedStrategyRefs(db, "paused")[0].source_hash, "sha256:eth2")
    assert.equal(readPolicySnapshot(db, "policy-a")?.snapshot_json.version, 1)
  } finally {
    db.close()
  }
})
