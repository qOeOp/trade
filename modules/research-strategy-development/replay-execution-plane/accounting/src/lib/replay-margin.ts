import {
  REPLAY_MARGIN_POLICY_VERSION,
  assertReplayEventKey,
  assertReplayIsolatedMarginPolicy,
  compareReplayEventKeys,
  type ReplayEventKey,
  type ReplayInstrumentAccountingSpec,
  type ReplayIsolatedMarginPolicy,
  type ReplayLedgerEntry,
  type ReplayMarginSnapshot,
  type ReplayPositionProjection,
} from "../../../contracts/src/lib/replay-contracts"
import {
  addReplayDecimalValues,
  divideReplayDecimalValues,
  isReplayIncrementAligned,
  quantizeReplayProduct,
} from "../../../contracts/src/lib/replay-decimal"

export interface ReplayMarginSnapshotInput {
  run_id: string
  stage: ReplayMarginSnapshot["stage"]
  snapshot_sequence: number
  accounting_spec: ReplayInstrumentAccountingSpec
  margin_policy: ReplayIsolatedMarginPolicy
  position: ReplayPositionProjection
  event_key: ReplayEventKey
  mark_source_ref: string
  mark_source: ReplayMarginSnapshot["mark_source"]
  resolution: ReplayMarginSnapshot["resolution"]
  mark_price: number
  unrealized_pnl: number
  ledger: ReplayLedgerEntry[]
}

export function buildReplayMarginSnapshot(input: ReplayMarginSnapshotInput): ReplayMarginSnapshot {
  validateInput(input)
  const { position, accounting_spec: spec, margin_policy: policy } = input
  if (position.state === "flat") return flatSnapshot(input)

  const notional = quantizeReplayProduct(
    [input.mark_price, Math.abs(position.signed_quantity), Number(spec.contract_multiplier)],
    1,
    spec.settlement_increment,
    "ceil",
  )
  const tier = policy.maintenance_tier
  if (notional < tier.notional_floor || (tier.notional_cap !== null && notional >= tier.notional_cap)) {
    throw new Error("Replay notional is outside the frozen maintenance tier")
  }
  const initialMarginRequirement = quantizeReplayProduct(
    [notional, policy.initial_margin_rate], 1, spec.settlement_increment, "ceil",
  )
  const grossMaintenance = quantizeReplayProduct(
    [notional, tier.maintenance_margin_rate], 1, spec.settlement_increment, "ceil",
  )
  const maintenanceMarginRequirement = Math.max(
    0,
    addReplayDecimalValues(grossMaintenance, -tier.maintenance_amount),
  )
  const attributedSettledCashflow = input.ledger
    .filter((entry) => (entry.kind === "fee" || entry.kind === "liquidation_fee" || entry.kind === "funding" || entry.kind === "realized_pnl")
      && compareReplayEventKeys(entry.event_key, input.event_key) <= 0)
    .reduce((sum, entry) => addReplayDecimalValues(sum, entry.amount), 0)
  const marginBalance = addReplayDecimalValues(
    policy.isolated_collateral,
    attributedSettledCashflow,
    input.unrealized_pnl,
  )
  const initialMarginHeadroom = addReplayDecimalValues(marginBalance, -initialMarginRequirement)
  const maintenanceMarginHeadroom = addReplayDecimalValues(marginBalance, -maintenanceMarginRequirement)
  const state = marginBalance <= 0
    ? "nonpositive_balance" as const
    : maintenanceMarginHeadroom < 0
      ? "maintenance_breached" as const
      : "healthy" as const

  return {
    policy_version: REPLAY_MARGIN_POLICY_VERSION,
    snapshot_id: `${input.run_id}:margin:${input.snapshot_sequence}`,
    snapshot_sequence: input.snapshot_sequence,
    stage: input.stage,
    event_key: input.event_key,
    timestamp: input.event_key.event_time,
    position_event_id: position.position_event_id,
    mark_source_ref: input.mark_source_ref,
    mark_source: input.mark_source,
    resolution: input.resolution,
    symbol: position.symbol,
    collateral_asset: policy.collateral_asset,
    signed_quantity: position.signed_quantity,
    mark_price: input.mark_price,
    notional,
    isolated_collateral: policy.isolated_collateral,
    attributed_settled_cashflow: attributedSettledCashflow,
    unrealized_pnl: input.unrealized_pnl,
    margin_balance: marginBalance,
    initial_margin_requirement: initialMarginRequirement,
    maintenance_margin_requirement: maintenanceMarginRequirement,
    initial_margin_headroom: initialMarginHeadroom,
    maintenance_margin_headroom: maintenanceMarginHeadroom,
    margin_ratio: marginBalance > 0
      ? divideReplayDecimalValues(maintenanceMarginRequirement, marginBalance)
      : null,
    initial_margin_sufficient: initialMarginHeadroom >= 0,
    maintenance_margin_sufficient: maintenanceMarginHeadroom >= 0,
    maintenance_trigger: policy.maintenance_trigger,
    maintenance_breach_observed: maintenanceMarginHeadroom < 0,
    breach_terminal_priority: policy.breach_terminal_priority,
    state,
    liquidation_evaluated: (input.mark_source === "mark_event" || input.mark_source === "funding_mark")
      && input.resolution === "exact"
      && maintenanceMarginHeadroom < 0,
  }
}

function flatSnapshot(input: ReplayMarginSnapshotInput): ReplayMarginSnapshot {
  return {
    policy_version: REPLAY_MARGIN_POLICY_VERSION,
    snapshot_id: `${input.run_id}:margin:${input.snapshot_sequence}`,
    snapshot_sequence: input.snapshot_sequence,
    stage: input.stage,
    event_key: input.event_key,
    timestamp: input.event_key.event_time,
    position_event_id: input.position.position_event_id,
    mark_source_ref: input.mark_source_ref,
    mark_source: input.mark_source,
    resolution: "not_applicable_flat",
    symbol: input.position.symbol,
    collateral_asset: input.margin_policy.collateral_asset,
    signed_quantity: 0,
    mark_price: input.mark_price,
    notional: 0,
    isolated_collateral: 0,
    attributed_settled_cashflow: 0,
    unrealized_pnl: 0,
    margin_balance: 0,
    initial_margin_requirement: 0,
    maintenance_margin_requirement: 0,
    initial_margin_headroom: 0,
    maintenance_margin_headroom: 0,
    margin_ratio: null,
    initial_margin_sufficient: true,
    maintenance_margin_sufficient: true,
    maintenance_trigger: input.margin_policy.maintenance_trigger,
    maintenance_breach_observed: false,
    breach_terminal_priority: input.margin_policy.breach_terminal_priority,
    state: "flat",
    liquidation_evaluated: false,
  }
}

function validateInput(input: ReplayMarginSnapshotInput): void {
  if (input.run_id.trim() === "" || input.mark_source_ref.trim() === "") {
    throw new Error("Replay margin run_id and mark source ref are required")
  }
  assertReplayEventKey(input.event_key)
  if (!Number.isSafeInteger(input.snapshot_sequence) || input.snapshot_sequence <= 0) {
    throw new Error("Replay margin snapshot_sequence must be a positive safe integer")
  }
  assertReplayIsolatedMarginPolicy(input.margin_policy)
  if (input.margin_policy.collateral_asset !== input.accounting_spec.settlement_asset) {
    throw new Error("Replay isolated collateral must use the settlement asset")
  }
  if (!isReplayIncrementAligned(input.margin_policy.isolated_collateral, input.accounting_spec.settlement_increment)
      || !isReplayIncrementAligned(input.margin_policy.maintenance_tier.maintenance_amount, input.accounting_spec.settlement_increment)
      || !isReplayIncrementAligned(input.unrealized_pnl, input.accounting_spec.settlement_increment)) {
    throw new Error("Replay margin monetary inputs must align to the settlement increment")
  }
  if (!Number.isFinite(input.mark_price) || input.mark_price <= 0
      || !isReplayIncrementAligned(input.mark_price, input.accounting_spec.price_increment)) {
    throw new Error("Replay margin mark must be positive and price-increment aligned")
  }
  if (input.stage === "post_entry") {
    if (input.position.state !== "open"
        || compareReplayEventKeys(input.position.event_key, input.event_key) !== 0
        || input.mark_source !== "fill_price"
        || input.resolution !== "exact"
        || input.unrealized_pnl !== 0) {
      throw new Error("Replay post-entry margin snapshot must bind the open Position Fill")
    }
  } else if (compareReplayEventKeys(input.position.event_key, input.event_key) >= 0) {
    throw new Error("Replay terminal margin snapshot must follow the terminal Position fact")
  }
}
