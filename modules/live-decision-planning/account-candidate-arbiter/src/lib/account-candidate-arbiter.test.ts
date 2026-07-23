import assert from "node:assert/strict"
import test from "node:test"
import { arbitrateAccountCandidates, type AccountCandidateArbiterInput } from "./account-candidate-arbiter"

const HASH = "a".repeat(64)

test("arbiter ranks candidates and enforces account, symbol, correlation, expiry, and slot limits", () => {
  const result = arbitrateAccountCandidates({
    observed_at: "2026-07-23T10:00:00.000Z",
    account_ref: "exchange-account://binance/usdm/primary",
    account_scope: "capital-scope://primary",
    policy: {
      total_risk_units: 500,
      max_new_positions: 2,
      max_risk_units_per_symbol: 200,
      max_risk_units_per_correlation_bucket: 250,
    },
    existing_exposure: [{ symbol: "BTCUSDT", correlation_bucket: "crypto-major", risk_units: 100 }],
    candidates: [
      candidate("setup-eth", "ETHUSDT", "crypto-major", 900, 120),
      candidate("setup-sol", "SOLUSDT", "crypto-major", 800, 100),
      candidate("setup-xrp", "XRPUSDT", "crypto-alt", 700, 180),
      candidate("setup-btc", "BTCUSDT", "crypto-major", 1_000, 50),
      { ...candidate("setup-expired", "BNBUSDT", "crypto-alt", 2_000, 10), expires_at: "2026-07-23T09:00:00.000Z" },
    ],
  })
  assert.deepEqual(result.decisions.map((item) => [item.setup_id, item.status, item.reason]), [
    ["setup-expired", "rejected", "expired"],
    ["setup-btc", "rejected", "existing_symbol_exposure"],
    ["setup-eth", "accepted", "within_account_allocation_limits"],
    ["setup-sol", "rejected", "correlation_bucket_risk_limit"],
    ["setup-xrp", "accepted", "within_account_allocation_limits"],
  ])
  assert.equal(result.proposed_new_risk_units, 300)
  assert.equal(result.remaining_risk_units, 100)
  assert.equal(result.allocation_authority, "proposal_only")
  assert.equal(result.execution_authority, "none")
  assert.match(result.allocation_hash, /^[a-f0-9]{64}$/)
})

test("arbiter is deterministic and rejects identity or evidence drift", () => {
  const input: AccountCandidateArbiterInput = {
    observed_at: "2026-07-23T10:00:00.000Z",
    account_ref: "account:a",
    account_scope: "scope:a",
    policy: {
      total_risk_units: 100,
      max_new_positions: 1,
      max_risk_units_per_symbol: 100,
      max_risk_units_per_correlation_bucket: 100,
    },
    existing_exposure: [],
    candidates: [candidate("setup-a", "ETHUSDT", "major", 10, 50)],
  }
  assert.equal(arbitrateAccountCandidates(input).allocation_hash, arbitrateAccountCandidates(input).allocation_hash)
  assert.throws(() => arbitrateAccountCandidates({
    ...input,
    candidates: [
      candidate("setup-a", "ETHUSDT", "major", 10, 50),
      candidate("setup-a", "SOLUSDT", "major", 9, 50),
    ],
  }), /setup ids/)
  assert.throws(() => arbitrateAccountCandidates({
    ...input,
    candidates: [{ ...candidate("setup-a", "ETHUSDT", "major", 10, 50), market_fact_hashes: [] }],
  }), /non-empty/)
})

function candidate(
  setupId: string,
  symbol: string,
  bucket: string,
  score: number,
  risk: number,
): AccountCandidateArbiterInput["candidates"][number] {
  return {
    setup_id: setupId,
    plan_ref: `trade-plan://${setupId}`,
    plan_hash: HASH,
    strategy_version_ref: "strategy://family/version-1",
    symbol,
    side: "long",
    correlation_bucket: bucket,
    score_units: score,
    requested_risk_units: risk,
    expires_at: "2026-07-23T11:00:00.000Z",
    market_fact_hashes: [HASH],
  }
}
