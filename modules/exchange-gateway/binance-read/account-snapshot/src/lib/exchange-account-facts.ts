import { canonicalHash } from "../../../../../contracts/runtime-core/src/canonical-json"

type JSONRecord = Record<string, unknown>

export interface VenueAccountIdentity {
  account_ref: string
  account_scope: string
  account_alias: string
  venue: "binance"
  environment: "live"
  market: "usdm"
}

export interface ExchangeAccountFactInput {
  identity: VenueAccountIdentity
  as_of: string
  account: JSONRecord
  balances: JSONRecord[]
  positions: JSONRecord[]
  open_orders: { regular: JSONRecord[]; protective: JSONRecord[] }
  errors: JSONRecord
}

export function buildVenueAccountIdentity(input: Partial<VenueAccountIdentity> = {}): VenueAccountIdentity {
  const accountAlias = clean(input.account_alias) || "primary"
  const accountRef = clean(input.account_ref) || `exchange-account://binance/live/usdm/${accountAlias}`
  return {
    account_ref: accountRef,
    account_scope: clean(input.account_scope) || accountRef,
    account_alias: accountAlias,
    venue: "binance",
    environment: "live",
    market: "usdm",
  }
}

export function buildExchangeAccountFacts(input: ExchangeAccountFactInput): JSONRecord {
  assertTimestamp(input.as_of)
  const factBody = {
    schema_version: "trade.exchange.account-facts.v1",
    account_ref: input.identity.account_ref,
    account_scope: input.identity.account_scope,
    venue: input.identity.venue,
    environment: input.identity.environment,
    market: input.identity.market,
    as_of: input.as_of,
    source: "binance.futures.account-snapshot",
    freshness: {
      observed_at: input.as_of,
      max_age_seconds: 30,
    },
    can_trade: input.account.canTrade === true,
    equity_usdt: numeric(input.account.totalMarginBalance) || numeric(input.account.totalWalletBalance),
    wallet_balance_usdt: numeric(input.account.totalWalletBalance),
    available_margin_usdt: numeric(input.account.availableBalance),
    unrealized_pnl_usdt: numeric(input.account.totalUnrealizedProfit),
    balances: input.balances,
    positions: input.positions,
    open_orders: input.open_orders,
    source_errors: input.errors,
  }
  const contentHash = `sha256:${canonicalHash(factBody)}`
  return {
    ...factBody,
    content_hash: contentHash,
    snapshot_ref: `exchange-account-facts://binance/live/usdm/${encodeURIComponent(input.identity.account_alias)}/${encodeURIComponent(input.as_of)}/${contentHash.slice(7)}`,
  }
}

function assertTimestamp(value: string): void {
  if (!value || !Number.isFinite(Date.parse(value))) {
    throw new Error("exchange account facts require a valid as_of timestamp")
  }
}

function clean(value: unknown): string {
  return typeof value === "string" ? value.trim() : ""
}

function numeric(value: unknown): number {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : 0
}
