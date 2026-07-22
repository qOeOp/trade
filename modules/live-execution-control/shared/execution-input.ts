type JSONRecord = Record<string, unknown>

function readRequiredSymbol(input: JSONRecord): string {
  const request = asRecord(input.request)
  const symbol = normalizeSymbol(firstString(
    request.symbol,
    input.symbol,
    asRecord(input.plan).symbol,
    asRecord(input.observe).symbol,
    asRecord(input.execution_contract_input).symbol,
  ))
  if (!symbol) throw new Error("execution command requires symbol")
  return symbol
}

function readPositionSide(input: JSONRecord): string {
  const request = asRecord(input.request)
  return firstString(
    request.position_side,
    request.positionSide,
    input.position_side,
    asRecord(input.observe).position_side,
    asRecord(input.execution_contract_input).position_side,
  ).toUpperCase() || "BOTH"
}

function asRecord(value: unknown): JSONRecord {
  return value && typeof value === "object" && !Array.isArray(value) ? value as JSONRecord : {}
}

function firstString(...values: unknown[]): string {
  for (const value of values) if (typeof value === "string" && value.trim()) return value.trim()
  return ""
}

function normalizeSymbol(symbol: string): string {
  return symbol.trim().toUpperCase().replace(/[\/:_\-\s]/g, "")
}

export { readPositionSide, readRequiredSymbol }
