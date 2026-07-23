import assert from "node:assert/strict"
import test from "node:test"
import { buildExchangeAccountFacts, buildVenueAccountIdentity } from "./exchange-account-facts"

test("venue account identity is stable and contains no credential material", () => {
  assert.deepEqual(buildVenueAccountIdentity({ account_alias: "primary" }), {
    account_ref: "exchange-account://binance/live/usdm/primary",
    account_scope: "exchange-account://binance/live/usdm/primary",
    account_alias: "primary",
    venue: "binance",
    environment: "live",
    market: "usdm",
  })
})

test("exchange account facts normalize money fields and bind a content-addressed ref", () => {
  const identity = buildVenueAccountIdentity({
    account_ref: "exchange-account://binance/live/usdm/primary",
    account_scope: "capital-scope://retail-small-usdm",
    account_alias: "primary",
  })
  const facts = buildExchangeAccountFacts({
    identity,
    as_of: "2026-07-23T00:00:00.000Z",
    account: {
      canTrade: true,
      totalWalletBalance: "1000.25",
      totalMarginBalance: "1020.50",
      availableBalance: "800.10",
      totalUnrealizedProfit: "20.25",
    },
    balances: [{ asset: "USDT", walletBalance: "1000.25" }],
    positions: [],
    open_orders: { regular: [], protective: [] },
    errors: {},
  })

  assert.equal(facts.account_ref, identity.account_ref)
  assert.equal(facts.account_scope, identity.account_scope)
  assert.equal(facts.equity_usdt, 1020.5)
  assert.equal(facts.available_margin_usdt, 800.1)
  assert.match(String(facts.content_hash), /^sha256:[a-f0-9]{64}$/)
  assert.match(String(facts.snapshot_ref), /^exchange-account-facts:\/\/binance\/live\/usdm\/primary\//)
  assert.equal(JSON.stringify(facts).includes("API"), false)
})
