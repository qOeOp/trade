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
