type Side = "long" | "short"
type PositionSide = "BOTH" | "LONG" | "SHORT"
type MarginMode = "isolated" | "crossed"
type EntryRole = "entry" | "add"
type EntryType = "MARKET" | "LIMIT" | "STOP" | "STOP_MARKET" | "TAKE_PROFIT" | "TAKE_PROFIT_MARKET"
type EntryIntent = "entry_at" | "entry_market"
type ProtectionType = "STOP" | "STOP_MARKET" | "TAKE_PROFIT" | "TAKE_PROFIT_MARKET"

interface AccountSnapshot {
  equity_usdt: number
  available_balance_usdt: number
  snapshot_at: string
}

interface RiskSnapshot {
  risk_budget_usdt: number
  stop_price: number
  invalidation: string
  expected_rr_net: number
}

interface ExchangeRules {
  quantity_step_size?: string
  min_qty?: string
  min_notional?: string
}

interface EntryDraft {
  role?: EntryRole
  type?: EntryType
  intent?: EntryIntent
  price?: number
  stop_price?: number
  reference_price?: number
  quantity?: number
  margin_usdt?: number
  notional_usdt?: number
  client_order_id?: string
  marketable_tolerance_bps?: number
}

interface ProtectionPlan {
  stop?: {
    type: Extract<ProtectionType, "STOP" | "STOP_MARKET">
    stop_price: number
    quantity: number | "close_position"
  }
  take_profit?: Array<{
    type: Extract<ProtectionType, "TAKE_PROFIT" | "TAKE_PROFIT_MARKET">
    trigger_price: number
    quantity: number
  }>
}

interface ExecutionContractInput {
  source_observe_event_key: string
  chain_id: string
  setup_id: string
  market: "usdm"
  symbol: string
  side: Side
  position_side: PositionSide
  margin_mode: MarginMode
  target_leverage: number
  account_snapshot: AccountSnapshot
  risk: RiskSnapshot
  entries: EntryDraft[]
  protection_plan?: ProtectionPlan
  exchange_rules?: ExchangeRules
}

interface CompiledEntry {
  role: EntryRole
  type: EntryType
  price?: number
  stop_price?: number
  reference_price?: number
  quantity: number
  client_order_id: string
  resolver_snapshot: EntryResolverSnapshot
}

interface ExecutionContract extends Omit<ExecutionContractInput, "entries" | "exchange_rules"> {
  entries: CompiledEntry[]
  verify_policy: {
    read_after_submit: true
    abort_on_mismatch: true
  }
}

interface ValidationResult {
  ok: boolean
  errors: string[]
}

interface ResolvedEntryDraft extends EntryDraft {
  type: EntryType
  resolver_snapshot: EntryResolverSnapshot
}

interface EntryResolverSnapshot {
  resolver: "explicit_type_v1" | "entry_at_v1" | "entry_market_v1"
  input_intent: EntryIntent | "explicit_type"
  side: Side
  requested_price?: number
  reference_price?: number
  marketable_tolerance_bps?: number
  route_reason: string
}

function compileExecutionContract(input: ExecutionContractInput): ExecutionContract {
  const basicErrors = validateContractInput(input)
  if (basicErrors.length > 0) {
    throw new Error(basicErrors.join("; "))
  }

  const entries = input.entries.map((entry, index) => compileEntry(input, entry, index))
  const contract: ExecutionContract = {
    source_observe_event_key: input.source_observe_event_key,
    chain_id: input.chain_id,
    setup_id: input.setup_id,
    market: input.market,
    symbol: input.symbol.toUpperCase(),
    side: input.side,
    position_side: input.position_side,
    margin_mode: input.margin_mode,
    target_leverage: input.target_leverage,
    account_snapshot: input.account_snapshot,
    risk: input.risk,
    entries,
    ...(input.protection_plan ? { protection_plan: input.protection_plan } : {}),
    verify_policy: {
      read_after_submit: true,
      abort_on_mismatch: true,
    },
  }

  const validation = validateExecutionContract(contract)
  if (!validation.ok) {
    throw new Error(validation.errors.join("; "))
  }
  return contract
}

function validateExecutionContract(value: unknown): ValidationResult {
  const errors: string[] = []
  const contract = asRecord(value)

  requireString(contract, "source_observe_event_key", errors)
  requireString(contract, "chain_id", errors)
  requireString(contract, "setup_id", errors)
  requireString(contract, "symbol", errors)
  requireEnum(contract, "market", ["usdm"], errors)
  requireEnum(contract, "side", ["long", "short"], errors)
  requireEnum(contract, "position_side", ["BOTH", "LONG", "SHORT"], errors)
  requireEnum(contract, "margin_mode", ["isolated", "crossed"], errors)
  requirePositiveNumber(contract, "target_leverage", errors)

  const account = asRecord(contract.account_snapshot)
  requirePositiveNumber(account, "equity_usdt", errors, "account_snapshot")
  requireNonNegativeNumber(account, "available_balance_usdt", errors, "account_snapshot")
  requireString(account, "snapshot_at", errors, "account_snapshot")

  const risk = asRecord(contract.risk)
  requirePositiveNumber(risk, "risk_budget_usdt", errors, "risk")
  requirePositiveNumber(risk, "stop_price", errors, "risk")
  requireString(risk, "invalidation", errors, "risk")
  requirePositiveNumber(risk, "expected_rr_net", errors, "risk")

  if (!Array.isArray(contract.entries) || contract.entries.length === 0) {
    errors.push("entries must contain at least one entry")
  } else {
    contract.entries.forEach((entryValue, index) => {
      const entry = asRecord(entryValue)
      const path = `entries[${index}]`
      requireEnum(entry, "role", ["entry", "add"], errors, path)
      requireEnum(entry, "type", ["MARKET", "LIMIT", "STOP", "STOP_MARKET", "TAKE_PROFIT", "TAKE_PROFIT_MARKET"], errors, path)
      requirePositiveNumber(entry, "quantity", errors, path)
      requireString(entry, "client_order_id", errors, path)
      if (["LIMIT", "STOP", "TAKE_PROFIT"].includes(String(entry.type))) {
        requirePositiveNumber(entry, "price", errors, path)
      }
      if (["STOP", "STOP_MARKET", "TAKE_PROFIT", "TAKE_PROFIT_MARKET"].includes(String(entry.type))) {
        requirePositiveNumber(entry, "stop_price", errors, path)
      }
    })
  }

  const verifyPolicy = asRecord(contract.verify_policy)
  if (verifyPolicy.read_after_submit !== true) {
    errors.push("verify_policy.read_after_submit must be true")
  }
  if (verifyPolicy.abort_on_mismatch !== true) {
    errors.push("verify_policy.abort_on_mismatch must be true")
  }

  return {
    ok: errors.length === 0,
    errors,
  }
}

function compileEntry(input: ExecutionContractInput, entry: EntryDraft, index: number): CompiledEntry {
  const resolved = resolveEntryDraft(input, entry, index)
  const quantity = entry.quantity ?? compileQuantity({
    marginUsdt: entry.margin_usdt,
    notionalUsdt: entry.notional_usdt,
    leverage: input.target_leverage,
    referencePrice: resolved.price ?? resolved.stop_price ?? resolved.reference_price,
    quantityStepSize: input.exchange_rules?.quantity_step_size,
    minQty: input.exchange_rules?.min_qty,
  })
  const minNotional = parseOptionalPositive(input.exchange_rules?.min_notional)
  const referencePrice = resolved.price ?? resolved.stop_price ?? resolved.reference_price

  if (minNotional != null && referencePrice != null && quantity * referencePrice < minNotional) {
    throw new Error(`entries[${index}] notional ${formatNumber(quantity * referencePrice)} is below min_notional ${minNotional}`)
  }

  return {
    role: resolved.role ?? "entry",
    type: resolved.type,
    ...(resolved.price != null ? { price: resolved.price } : {}),
    ...(resolved.stop_price != null ? { stop_price: resolved.stop_price } : {}),
    ...(resolved.reference_price != null ? { reference_price: resolved.reference_price } : {}),
    quantity,
    client_order_id: entry.client_order_id || `${input.chain_id}-${index + 1}-${entry.role ?? "entry"}`,
    resolver_snapshot: resolved.resolver_snapshot,
  }
}

function resolveEntryDraft(input: ExecutionContractInput, entry: EntryDraft, index: number): ResolvedEntryDraft {
  const side = input.side
  if (entry.type) {
    return {
      ...entry,
      type: entry.type,
      resolver_snapshot: {
        resolver: "explicit_type_v1",
        input_intent: "explicit_type",
        side,
        ...(entry.price != null ? { requested_price: entry.price } : {}),
        ...(entry.reference_price != null ? { reference_price: entry.reference_price } : {}),
        route_reason: "entry type was provided explicitly by upstream contract",
      },
    }
  }

  const intent = entry.intent
  if (intent === "entry_market") {
    const referencePrice = requireEntryReferencePrice(entry, index)
    return {
      ...entry,
      type: "MARKET",
      reference_price: referencePrice,
      resolver_snapshot: {
        resolver: "entry_market_v1",
        input_intent: intent,
        side,
        reference_price: referencePrice,
        route_reason: "entry_market compiles to MARKET with reference price used only for quantity sizing",
      },
    }
  }
  if (intent === "entry_at") {
    const requestedPrice = requireEntryPrice(entry, index)
    const referencePrice = requireEntryReferencePrice(entry, index)
    const toleranceBps = entry.marketable_tolerance_bps ?? 1
    if (!Number.isFinite(toleranceBps) || toleranceBps < 0) {
      throw new Error(`entries[${index}].marketable_tolerance_bps must be non-negative`)
    }
    const deltaBps = Math.abs(requestedPrice - referencePrice) / referencePrice * 10_000
    if (deltaBps <= toleranceBps) {
      return {
        ...entry,
        type: "MARKET",
        price: undefined,
        stop_price: undefined,
        reference_price: referencePrice,
        resolver_snapshot: {
          resolver: "entry_at_v1",
          input_intent: intent,
          side,
          requested_price: requestedPrice,
          reference_price: referencePrice,
          marketable_tolerance_bps: toleranceBps,
          route_reason: "requested entry is marketable within tolerance",
        },
      }
    }
    const isLimit = side === "long" ? requestedPrice < referencePrice : requestedPrice > referencePrice
    if (isLimit) {
      return {
        ...entry,
        type: "LIMIT",
        price: requestedPrice,
        reference_price: referencePrice,
        resolver_snapshot: {
          resolver: "entry_at_v1",
          input_intent: intent,
          side,
          requested_price: requestedPrice,
          reference_price: referencePrice,
          marketable_tolerance_bps: toleranceBps,
          route_reason: side === "long" ? "long entry below mark compiles to LIMIT buy" : "short entry above mark compiles to LIMIT sell",
        },
      }
    }
    return {
      ...entry,
      type: "STOP_MARKET",
      stop_price: requestedPrice,
      reference_price: referencePrice,
      resolver_snapshot: {
        resolver: "entry_at_v1",
        input_intent: intent,
        side,
        requested_price: requestedPrice,
        reference_price: referencePrice,
        marketable_tolerance_bps: toleranceBps,
        route_reason: side === "long" ? "long entry above mark compiles to STOP_MARKET breakout" : "short entry below mark compiles to STOP_MARKET breakdown",
      },
    }
  }

  throw new Error(`entries[${index}] requires either type or intent`)
}

function requireEntryPrice(entry: EntryDraft, index: number): number {
  const price = entry.price ?? entry.stop_price
  if (!Number.isFinite(price) || Number(price) <= 0) {
    throw new Error(`entries[${index}].price must be positive for entry_at`)
  }
  return Number(price)
}

function requireEntryReferencePrice(entry: EntryDraft, index: number): number {
  const referencePrice = entry.reference_price
  if (!Number.isFinite(referencePrice) || Number(referencePrice) <= 0) {
    throw new Error(`entries[${index}].reference_price must be positive for semantic entry intent`)
  }
  return Number(referencePrice)
}

function compileQuantity(input: {
  marginUsdt?: number
  notionalUsdt?: number
  leverage: number
  referencePrice?: number
  quantityStepSize?: string
  minQty?: string
}): number {
  const notional = input.notionalUsdt ?? (input.marginUsdt != null ? input.marginUsdt * input.leverage : undefined)
  if (notional == null || notional <= 0) {
    throw new Error("entry quantity requires quantity, notional_usdt, or margin_usdt")
  }
  if (input.referencePrice == null || input.referencePrice <= 0) {
    throw new Error("quantity compilation requires a positive reference price")
  }

  const rawQuantity = notional / input.referencePrice
  const step = parseOptionalPositive(input.quantityStepSize)
  const minQty = parseOptionalPositive(input.minQty) ?? 0
  const aligned = step == null ? rawQuantity : floorToStep(rawQuantity, step, minQty)
  if (aligned <= 0) {
    throw new Error(`compiled quantity ${formatNumber(aligned)} is not positive`)
  }
  if (minQty > 0 && aligned < minQty) {
    throw new Error(`compiled quantity ${formatNumber(aligned)} is below min_qty ${minQty}`)
  }
  return Number(formatNumber(aligned))
}

function validateContractInput(input: ExecutionContractInput): string[] {
  const errors = validateExecutionContract({
    ...input,
    entries: input.entries.map((entry, index) => ({
      role: entry.role ?? "entry",
      type: entry.type ?? "MARKET",
      quantity: entry.quantity ?? 1,
      client_order_id: entry.client_order_id || `${input.chain_id}-${index + 1}-${entry.role ?? "entry"}`,
      ...(entry.price != null ? { price: entry.price } : {}),
      ...(entry.stop_price != null ? { stop_price: entry.stop_price } : {}),
      resolver_snapshot: {
        resolver: entry.type ? "explicit_type_v1" : "entry_at_v1",
        input_intent: entry.type ? "explicit_type" : entry.intent,
        side: input.side,
        route_reason: "validation placeholder",
      },
    })),
    verify_policy: {
      read_after_submit: true,
      abort_on_mismatch: true,
    },
  }).errors

  if (!Array.isArray(input.entries) || input.entries.length === 0) {
    return errors
  }
  input.entries.forEach((entry, index) => {
    if (entry.quantity == null && entry.notional_usdt == null && entry.margin_usdt == null) {
      errors.push(`entries[${index}] requires quantity, notional_usdt, or margin_usdt`)
    }
    if (!entry.type && entry.intent !== "entry_at" && entry.intent !== "entry_market") {
      errors.push(`entries[${index}] requires type or semantic intent`)
    }
  })
  return errors
}

function requireString(record: Record<string, unknown>, key: string, errors: string[], prefix = ""): void {
  if (typeof record[key] !== "string" || String(record[key]).trim() === "") {
    errors.push(`${field(prefix, key)} must be a non-empty string`)
  }
}

function requireEnum(
  record: Record<string, unknown>,
  key: string,
  values: string[],
  errors: string[],
  prefix = "",
): void {
  if (!values.includes(String(record[key]))) {
    errors.push(`${field(prefix, key)} must be one of ${values.join(", ")}`)
  }
}

function requirePositiveNumber(record: Record<string, unknown>, key: string, errors: string[], prefix = ""): void {
  const value = Number(record[key])
  if (!Number.isFinite(value) || value <= 0) {
    errors.push(`${field(prefix, key)} must be a positive number`)
  }
}

function requireNonNegativeNumber(record: Record<string, unknown>, key: string, errors: string[], prefix = ""): void {
  const value = Number(record[key])
  if (!Number.isFinite(value) || value < 0) {
    errors.push(`${field(prefix, key)} must be a non-negative number`)
  }
}

function field(prefix: string, key: string): string {
  return prefix ? `${prefix}.${key}` : key
}

function floorToStep(value: number, step: number, min: number): number {
  const units = Math.floor((value - min) / step)
  return min + units * step
}

function parseOptionalPositive(value: string | undefined): number | null {
  if (!value) {
    return null
  }
  const parsed = Number(value)
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null
}

function formatNumber(value: number): string {
  return value.toFixed(12).replace(/\.?0+$/, "")
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" ? value as Record<string, unknown> : {}
}

export {
  compileExecutionContract,
  compileQuantity,
  resolveEntryDraft,
  validateExecutionContract,
  type ExecutionContract,
  type ExecutionContractInput,
}
