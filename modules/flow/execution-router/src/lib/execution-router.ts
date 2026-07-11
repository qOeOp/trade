import {
  compileExecutionContract,
  type ExecutionContract,
  type ExecutionContractInput,
} from "../../../../contracts/execution-contract/src/execution-contract"
import { readTargetAction, TARGET_ACTIONS, type ExecutableTargetAction } from "../../../../contracts/preflight-contract/src/target-action"

type JSONRecord = Record<string, unknown>

const EXECUTABLE_TARGET_ACTIONS = TARGET_ACTIONS.filter((action): action is ExecutableTargetAction => action !== "no_action")

interface ExecutionCommandSpec {
  target_action: ExecutableTargetAction
  tool: string
  cwd: string
  command: string[]
}

function buildExecutionCommandSpec(input: JSONRecord, contract?: ExecutionContract): ExecutionCommandSpec {
  const targetAction = readTargetAction(input.target_action)
  const repoRoot = stringField(input.repoRoot) || process.cwd()
  if (targetAction === "place_entry") {
    const compiled = contract
      ?? compileExecutionContract(asRecord(input.execution_contract_input) as unknown as ExecutionContractInput)
    return {
      target_action: targetAction,
      tool: "binance-order-place",
      cwd: `${repoRoot}/modules/binance/order-place`,
      command: buildOrderPlaceCommand(compiled),
    }
  }
  if (targetAction === "cancel_order") {
    return {
      target_action: targetAction,
      tool: "binance-order-cancel",
      cwd: `${repoRoot}/modules/binance/order-cancel`,
      command: buildOrderCancelCommand(input),
    }
  }
  if (targetAction === "adjust_position") {
    return {
      target_action: targetAction,
      tool: "binance-position-adjust",
      cwd: `${repoRoot}/modules/binance/position-adjust`,
      command: buildPositionAdjustCommand(input),
    }
  }
  if (targetAction === "sync_protection") {
    return {
      target_action: targetAction,
      tool: "binance-position-protect",
      cwd: `${repoRoot}/modules/binance/position-protect`,
      command: buildPositionProtectCommand(input),
    }
  }
  throw new Error("no_action has no executable tool command")
}

function buildOrderPlaceCommand(contract: ExecutionContract): string[] {
  const entry = contract.entries[0]
  const command = [
    "bun",
    "src/scripts/main.ts",
    "--symbol",
    contract.symbol,
    "--side",
    contract.side === "long" ? "BUY" : "SELL",
    "--type",
    entry.type,
    "--quantity",
    String(entry.quantity),
    "--position-side",
    contract.position_side,
    "--leverage",
    String(contract.target_leverage),
    "--new-client-order-id",
    entry.client_order_id,
    "--yes",
  ]
  if (entry.price != null) {
    command.push("--price", String(entry.price))
  }
  if (entry.stop_price != null) {
    command.push("--stop-price", String(entry.stop_price))
  }
  return command
}

function buildOrderCancelCommand(input: JSONRecord): string[] {
  const request = asRecord(input.request)
  const command = ["bun", "src/scripts/main.ts", "--symbol", readRequiredSymbol(input)]
  const all = readBoolean(firstValue(request.all, request.cancel_all, request.scope === "all"))
  const algo = readBoolean(firstValue(request.algo, request.order_bucket === "algo"))
    || readId(request.algo_id, request.algoId) !== ""
    || readId(request.client_algo_id, request.clientAlgoId) !== ""

  if (algo) {
    command.push("--algo")
  }
  if (all) {
    command.push("--all")
  } else if (algo) {
    pushFlag(command, "--algo-id", readId(request.algo_id, request.algoId))
    pushFlag(command, "--client-algo-id", readId(request.client_algo_id, request.clientAlgoId))
  } else {
    pushFlag(command, "--order-id", readId(request.order_id, request.orderId))
    pushFlag(command, "--orig-client-order-id", readId(
      request.orig_client_order_id,
      request.origClientOrderId,
      request.client_order_id,
      request.clientOrderId,
    ))
  }
  command.push("--yes")
  return command
}

function buildPositionAdjustCommand(input: JSONRecord): string[] {
  const request = asRecord(input.request)
  const direction = firstString(request.direction, request.adjustment)
  if (direction === "add") {
    throw new Error("adjust_position command only supports reduce or close")
  }

  const command = [
    "bun",
    "src/scripts/main.ts",
    "--symbol",
    readRequiredSymbol(input),
    "--position-side",
    readPositionSide(input),
  ]
  const closePosition = readBoolean(firstValue(
    request.close_position,
    request.closePosition,
    request.close_all,
    request.closeAll,
    direction === "close",
  ))
  if (closePosition) {
    command.push("--close-position", "true")
  } else {
    command.push("--reduce-quantity", readRequiredQuantity(input, [
      request.reduce_quantity,
      request.reduceQuantity,
      request.quantity,
      request.qty,
    ]))
  }
  command.push("--yes")
  return command
}

function buildPositionProtectCommand(input: JSONRecord): string[] {
  const request = asRecord(input.request)
  const command = [
    "bun",
    "src/scripts/main.ts",
    "--symbol",
    readRequiredSymbol(input),
    "--position-side",
    readPositionSide(input),
  ]
  pushFlag(command, "--side", commandScalar(request.side))

  const closePosition = readBoolean(firstValue(request.close_position, request.closePosition, request.close_all, request.closeAll))
  if (closePosition) {
    command.push("--close-position", "true")
  } else {
    command.push("--quantity", readRequiredQuantity(input, [
      request.quantity,
      request.qty,
      request.protection_quantity,
      request.position_quantity,
      asRecord(input.plan).position_quantity,
      asRecord(input.observe).position_quantity,
    ]))
  }

  pushFlag(command, "--stop-loss-trigger", commandScalar(
    request.stop_loss_trigger,
    request.stopLossTrigger,
    request.stop_price,
    asRecord(input.plan).stop_price,
    asRecord(input.observe).stop_price,
  ))
  pushFlag(command, "--stop-loss-limit-price", commandScalar(request.stop_loss_limit_price, request.stopLossLimitPrice))
  pushFlag(command, "--take-profit-trigger", commandScalar(
    request.take_profit_trigger,
    request.takeProfitTrigger,
    request.takeprofit_trigger,
    request.tp_price,
  ))
  pushFlag(command, "--take-profit-limit-price", commandScalar(request.take_profit_limit_price, request.takeProfitLimitPrice))
  pushFlag(command, "--trailing-activation-price", commandScalar(
    request.trailing_activation_price,
    request.trailingActivationPrice,
  ))
  pushFlag(command, "--callback-rate", commandScalar(request.callback_rate, request.callbackRate))
  pushFlag(command, "--working-type", commandScalar(request.working_type, request.workingType))
  if (request.price_protect !== undefined || request.priceProtect !== undefined) {
    command.push("--price-protect", String(readBoolean(firstValue(request.price_protect, request.priceProtect))))
  }
  command.push("--yes")
  return command
}

function readRequiredSymbol(input: JSONRecord): string {
  const request = asRecord(input.request)
  const symbol = normalizeSymbol(firstString(
    request.symbol,
    input.symbol,
    asRecord(input.plan).symbol,
    asRecord(input.observe).symbol,
    asRecord(input.execution_contract_input).symbol,
  ))
  if (!symbol) {
    throw new Error("execution command requires symbol")
  }
  return symbol
}

function readPositionSide(input: JSONRecord): string {
  const request = asRecord(input.request)
  const value = firstString(
    request.position_side,
    request.positionSide,
    input.position_side,
    asRecord(input.observe).position_side,
    asRecord(input.execution_contract_input).position_side,
  ).toUpperCase()
  return value || "BOTH"
}

function readRequiredQuantity(input: JSONRecord, candidates: unknown[]): string {
  const quantity = commandScalar(...candidates)
  if (!quantity) {
    throw new Error(`${readTargetAction(input.target_action)} command requires quantity unless close-position is true`)
  }
  return quantity
}

function readBoolean(value: unknown): boolean {
  if (typeof value === "boolean") {
    return value
  }
  const normalized = stringField(value).toLowerCase()
  return ["1", "true", "yes", "y", "on"].includes(normalized)
}

function pushFlag(command: string[], flag: string, value: string): void {
  if (value) {
    command.push(flag, value)
  }
}

function commandScalar(...values: unknown[]): string {
  for (const value of values) {
    if (value == null || value === "") {
      continue
    }
    if (typeof value === "string") {
      return value.trim()
    }
    if (typeof value === "number" && Number.isFinite(value)) {
      return String(value)
    }
  }
  return ""
}

function readId(...values: unknown[]): string {
  for (const value of values) {
    if (value == null || value === "") {
      continue
    }
    return String(value)
  }
  return ""
}

function normalizeSymbol(symbol: string): string {
  return symbol.toUpperCase().replace(/[\/:_\-\s]/g, "")
}

function firstValue(...values: unknown[]): unknown {
  for (const value of values) {
    if (value !== undefined && value !== "") {
      return value
    }
  }
  return undefined
}

function firstString(...values: unknown[]): string {
  for (const value of values) {
    const candidate = stringField(value)
    if (candidate) {
      return candidate
    }
  }
  return ""
}

function stringField(value: unknown): string {
  if (typeof value === "string") {
    return value.trim()
  }
  if (typeof value === "number") {
    return String(value)
  }
  return ""
}

function asRecord(value: unknown): JSONRecord {
  return value && typeof value === "object" && !Array.isArray(value) ? value as JSONRecord : {}
}

export {
  EXECUTABLE_TARGET_ACTIONS,
  buildExecutionCommandSpec,
  buildOrderCancelCommand,
  buildOrderPlaceCommand,
  buildPositionAdjustCommand,
  buildPositionProtectCommand,
  type ExecutionCommandSpec,
}
