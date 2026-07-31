import {
  REPLAY_NUMERIC_POLICY_VERSION,
  REPLAY_OHLCV_RESOLUTION_EVIDENCE_SCHEMA_VERSION,
  assertReplayOhlcvResolutionEvidence,
  canonicalHash,
  replayOhlcvActiveProtectionHash,
  replayOhlcvEconomicImpactHash,
  replayOhlcvResolutionEvidenceHash,
  type ReplayMarketBar,
  type ReplayOhlcvPathId,
  type ReplayOhlcvResolutionEvidence,
  type ReplayOhlcvResolutionPath,
  type ReplaySourceEvent,
} from "../../../contracts/src/lib/replay-contracts"
import { addReplayDecimalValues, quantizeReplayDifferenceProduct } from "../../../contracts/src/lib/replay-decimal"
import { applyAdverseSlippageV3, calculateNotionalChargeV3 } from "../../../accounting/src/lib/replay-accounting"

export interface ReplayOhlcvResolutionEconomics {
  entry_basis_price: number
  exit_side: "buy" | "sell"
  cost_policy_id: string
  cost_policy_version: string
  fee_bps: number
  slippage_bps: number
  price_increment: string
  settlement_increment: string
  settlement_asset: string
}

export function createReplaySimpleBracketOhlcvResolution(input: {
  run_id: string
  source_event: ReplaySourceEvent
  bar: ReplayMarketBar
  position_side: "long" | "short"
  active_protection: {
    protection_mode?: "bracket" | "stop_only" | "target_only"
    protection_generation: number
    remaining_quantity: number
    stop_order_id: string
    stop_trigger_price: number
    stop_order_status?: "active" | "cancelled"
    target_order_id: string
    target_trigger_price: number
    target_order_status?: "active" | "cancelled"
  }
  economics: ReplayOhlcvResolutionEconomics
  observation_kind: "bar_open_gap" | "bar_range_touch"
  stop_touched: boolean
  target_touched: boolean
  canonical_terminal_role: "stop" | "target"
}): ReplayOhlcvResolutionEvidence {
  if (!input.stop_touched && !input.target_touched) {
    throw new Error("Replay OHLCV resolution requires at least one terminal touch")
  }
  const protectionMode = input.active_protection.protection_mode ?? "bracket"
  const stopOrderStatus = input.active_protection.stop_order_status ?? "active"
  const targetOrderStatus = input.active_protection.target_order_status ?? "active"
  if ((protectionMode === "bracket" && (stopOrderStatus !== "active" || targetOrderStatus !== "active"))
      || (protectionMode === "stop_only" && (stopOrderStatus !== "active" || targetOrderStatus !== "cancelled" || input.target_touched))
      || (protectionMode === "target_only" && (stopOrderStatus !== "cancelled" || targetOrderStatus !== "active" || input.stop_touched))) {
    throw new Error("Replay OHLCV resolution protection mode is inconsistent")
  }
  const collision = input.stop_touched && input.target_touched
  if (collision && input.observation_kind !== "bar_range_touch") {
    throw new Error("Replay OHLCV open gap cannot ambiguously cross both sides of a valid bracket")
  }
  const equivalentRole = input.stop_touched ? "stop" as const : "target" as const
  const roleFor = (pathId: ReplayOhlcvPathId): "stop" | "target" => {
    if (!collision) return equivalentRole
    if (pathId === "open_high_low_close") return input.position_side === "long" ? "target" : "stop"
    return input.position_side === "long" ? "stop" : "target"
  }
  const triggerFor = (role: "stop" | "target"): number => input.observation_kind === "bar_open_gap"
    ? input.bar.open
    : role === "stop" ? input.active_protection.stop_trigger_price : input.active_protection.target_trigger_price
  const pathFor = (pathId: ReplayOhlcvPathId): ReplayOhlcvResolutionPath => {
    const firstTerminalRole = roleFor(pathId)
    const triggerPrice = triggerFor(firstTerminalRole)
    const simulatedExecutionPrice = applyAdverseSlippageV3(
      triggerPrice, input.economics.exit_side, input.economics.slippage_bps, input.economics.price_increment,
    )
    const grossRealizedPnl = quantizeReplayDifferenceProduct(
      simulatedExecutionPrice,
      input.economics.entry_basis_price,
      input.active_protection.remaining_quantity,
      input.position_side === "long" ? 1 : -1,
      input.economics.settlement_increment,
      "floor",
    )
    const exitFee = calculateNotionalChargeV3(
      simulatedExecutionPrice,
      input.active_protection.remaining_quantity,
      input.economics.fee_bps,
      input.economics.settlement_increment,
    )
    const body = {
      path_id: pathId,
      first_terminal_role: firstTerminalRole,
      trigger_price: triggerPrice,
      simulated_execution_price: simulatedExecutionPrice,
      gross_realized_pnl: grossRealizedPnl,
      exit_fee: exitFee,
      net_terminal_contribution: addReplayDecimalValues(grossRealizedPnl, -exitFee),
    }
    return { ...body, path_digest: canonicalHash(body) }
  }
  const paths = [pathFor("open_high_low_close"), pathFor("open_low_high_close")] as const
  const activeProtection = {
    ...input.active_protection,
    protection_mode: protectionMode,
    stop_order_status: stopOrderStatus,
    target_order_status: targetOrderStatus,
    protection_hash: replayOhlcvActiveProtectionHash({
      ...input.active_protection,
      protection_mode: protectionMode,
      stop_order_status: stopOrderStatus,
      target_order_status: targetOrderStatus,
    }),
  }
  const status = collision ? "resolution_limited" as const : "exact_under_ohlc" as const
  const canonicalPath = collision
    ? paths.find((path) => path.first_terminal_role === input.canonical_terminal_role)!
    : paths[0]
  const pathContributions = paths.map((path) => path.net_terminal_contribution)
  const minimumContribution = Math.min(...pathContributions)
  const maximumContribution = Math.max(...pathContributions)
  const economicImpactBody = {
    scope: "terminal_fill_contribution_excludes_common_cashflows" as const,
    settlement_asset: input.economics.settlement_asset,
    cost_policy_id: input.economics.cost_policy_id,
    cost_policy_version: input.economics.cost_policy_version,
    numeric_policy_version: REPLAY_NUMERIC_POLICY_VERSION,
    fee_bps: input.economics.fee_bps,
    slippage_bps: input.economics.slippage_bps,
    price_increment: input.economics.price_increment,
    settlement_increment: input.economics.settlement_increment,
    entry_basis_price: input.economics.entry_basis_price,
    quantity: input.active_protection.remaining_quantity,
    min_net_terminal_contribution: minimumContribution,
    max_net_terminal_contribution: maximumContribution,
    net_terminal_contribution_span: addReplayDecimalValues(maximumContribution, -minimumContribution),
    canonical_net_terminal_contribution: canonicalPath.net_terminal_contribution,
    canonical_shortfall_to_best: addReplayDecimalValues(
      maximumContribution, -canonicalPath.net_terminal_contribution,
    ),
  }
  const economicImpact = {
    ...economicImpactBody,
    impact_hash: replayOhlcvEconomicImpactHash(economicImpactBody),
  }
  const body = {
    schema_version: REPLAY_OHLCV_RESOLUTION_EVIDENCE_SCHEMA_VERSION,
    resolution_id: `${input.run_id}:ohlcv-resolution:${input.source_event.source_event_id}`,
    source_event_id: input.source_event.source_event_id,
    source_event_key: structuredClone(input.source_event.event_key),
    bar_index: input.source_event.source_index,
    bar: {
      open_time: input.bar.open_time, close_time: input.bar.close_time,
      open: input.bar.open, high: input.bar.high, low: input.bar.low, close: input.bar.close,
    },
    position_side: input.position_side,
    active_protection: activeProtection,
    observation_kind: input.observation_kind,
    status,
    resolution_reason: input.observation_kind === "bar_open_gap"
      ? "open_gap_observed" as const
      : collision ? "stop_target_order_ambiguous" as const : "single_terminal_touch" as const,
    paths: [...paths] as [ReplayOhlcvResolutionPath, ReplayOhlcvResolutionPath],
    economic_impact: economicImpact,
    canonical: {
      path_id: canonicalPath.path_id,
      terminal_role: input.canonical_terminal_role,
      selection_policy: collision
        ? "lower_terminal_equity_then_realized_pnl_then_path_id" as const
        : "equivalent_paths_stable_id" as const,
    },
  }
  const evidence = { ...body, evidence_hash: replayOhlcvResolutionEvidenceHash(body) }
  assertReplayOhlcvResolutionEvidence(evidence)
  return evidence
}

export function assertReplayOhlcvEconomicImpactBindings(
  evidence: ReplayOhlcvResolutionEvidence,
  economics: ReplayOhlcvResolutionEconomics,
): void {
  const expected = createReplaySimpleBracketOhlcvResolution({
    run_id: evidence.resolution_id.slice(0, evidence.resolution_id.indexOf(":ohlcv-resolution:")),
    source_event: {
      source_event_id: evidence.source_event_id,
      event_key: structuredClone(evidence.source_event_key),
      kind: evidence.observation_kind === "bar_open_gap" ? "bar_open" : "bar_range",
      source_index: evidence.bar_index,
    },
    bar: { ...evidence.bar, volume: 1, closed: true },
    position_side: evidence.position_side,
    active_protection: {
      protection_mode: evidence.active_protection.protection_mode,
      protection_generation: evidence.active_protection.protection_generation,
      remaining_quantity: evidence.active_protection.remaining_quantity,
      stop_order_id: evidence.active_protection.stop_order_id,
      stop_trigger_price: evidence.active_protection.stop_trigger_price,
      stop_order_status: evidence.active_protection.stop_order_status,
      target_order_id: evidence.active_protection.target_order_id,
      target_trigger_price: evidence.active_protection.target_trigger_price,
      target_order_status: evidence.active_protection.target_order_status,
    },
    economics,
    observation_kind: evidence.observation_kind,
    stop_touched: evidence.paths.some((path) => path.first_terminal_role === "stop"),
    target_touched: evidence.paths.some((path) => path.first_terminal_role === "target"),
    canonical_terminal_role: evidence.canonical.terminal_role,
  })
  if (canonicalHash(expected.paths) !== canonicalHash(evidence.paths)
      || canonicalHash(expected.economic_impact) !== canonicalHash(evidence.economic_impact)) {
    throw new Error("Replay OHLCV economic impact does not match frozen execution inputs")
  }
}
