import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import assert from "node:assert/strict"
import test from "node:test"
import { compileRuntimePolicy, loadRuntimePolicy } from "./runtime-policy"
import { asRecord } from "./json"

test("compileRuntimePolicy allows live-small when the project profile permits it", () => {
  const policy = compileRuntimePolicy({
    schema_version: 1,
    profile_id: "retail-small-usdm",
    mode: "live",
    permissions: {
      live_small_enabled: true,
      max_stage: "live-small",
    },
    risk: {
      max_single_trade_risk_usdt: 50,
    },
    exposure: {
      max_entry_notional_usdt: 1000,
    },
    execution: {},
    research: {},
  }, { now: "2026-07-09T00:00:00.000Z" })

  assert.equal(policy.mode, "live")
  assert.equal(asRecord(policy.permissions).can_live_small, true)
  assert.equal(asRecord(policy.permissions).max_stage, "live-small")
  assert.equal(asRecord(policy.effective_limits).max_single_trade_risk_usdt, 50)
  assert.equal(asRecord(policy.effective_limits).max_entry_notional_usdt, 1000)
})

test("loadRuntimePolicy keeps legacy fallback out of live-small by default", () => {
  const dir = mkdtempSync(join(tmpdir(), "runtime-policy-legacy-"))
  try {
    const profileDir = join(dir, "profile")
    mkdirSync(profileDir, { recursive: true })
    const accountConfigPath = join(profileDir, "account_config.json")
    writeFileSync(accountConfigPath, JSON.stringify({ max_open_risk_pct: 0.01 }))

    const { runtime_policy } = loadRuntimePolicy({
      accountConfigPath,
      now: "2026-07-09T00:00:00.000Z",
    })

    assert.equal(runtime_policy.mode, "dry_run")
    assert.equal(asRecord(runtime_policy.permissions).can_live_small, false)
    assert.match(String(runtime_policy.warnings[0]), /trading-config missing/)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test("compileRuntimePolicy normalizes and clamps hard execution boundaries", () => {
  const policy = compileRuntimePolicy({
    schema_version: 1,
    profile_id: "retail-small-usdm",
    mode: "LIVE",
    permissions: {
      live_small_enabled: true,
      max_stage: "live_small",
    },
    risk: {
      max_single_trade_risk_usdt: "5000",
      max_open_risk_pct: 9,
      max_concurrent_risk_flows: 99,
    },
    exposure: {
      max_entry_notional_usdt: 999999,
      max_single_position_leverage: 50,
    },
    execution: {
      max_open_actions_per_cycle: 99,
      reentry_cooldown_minutes: 999,
    },
    research: {
      default_slippage_bps: 500,
    },
  }, { now: "2026-07-09T00:00:00.000Z" })

  const limits = asRecord(policy.effective_limits)
  assert.equal(policy.mode, "live")
  assert.equal(asRecord(policy.permissions).max_stage, "live-small")
  assert.equal(asRecord(policy.permissions).can_live_small, true)
  assert.equal(limits.max_single_trade_risk_usdt, 1000)
  assert.equal(limits.max_open_risk_pct, 0.2)
  assert.equal(limits.max_concurrent_risk_flows, 20)
  assert.equal(limits.max_entry_notional_usdt, 100000)
  assert.equal(limits.max_single_position_leverage, 10)
  assert.equal(limits.max_open_actions_per_cycle, 5)
  assert.equal(limits.reentry_cooldown_minutes, 240)
  assert.equal(asRecord(policy.cost_model).slippage_bps, 100)
  assert.ok(policy.warnings.some((warning) => warning.includes("clamped risk.max_single_trade_risk_usdt")))
})

test("compileRuntimePolicy hashes normalized numeric strings and numbers identically", () => {
  const base = {
    schema_version: 1,
    profile_id: "retail-small-usdm",
    mode: "live",
    permissions: {
      live_small_enabled: true,
      max_stage: "live-small",
    },
    risk: {
      max_single_trade_risk_usdt: 50,
      max_open_risk_pct: 0.05,
    },
    exposure: {},
    execution: {},
    research: {},
  }
  const stringy = {
    ...base,
    risk: {
      max_single_trade_risk_usdt: "50",
      max_open_risk_pct: "0.05",
    },
  }

  assert.equal(
    compileRuntimePolicy(base, { now: "2026-07-09T00:00:00.000Z" }).source_hash,
    compileRuntimePolicy(stringy, { now: "2026-07-09T00:00:00.000Z" }).source_hash,
  )
})
