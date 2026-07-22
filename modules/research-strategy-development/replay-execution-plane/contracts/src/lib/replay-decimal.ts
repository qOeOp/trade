import { REPLAY_DERIVED_DECIMAL_INCREMENT } from "./replay-contracts"

export type ReplayDecimalRounding = "floor" | "ceil" | "toward_zero" | "half_away_from_zero"

interface DecimalParts {
  coefficient: bigint
  scale: number
}

interface ReplayRational {
  numerator: bigint
  denominator: bigint
}

export function quantizeReplayDecimal(
  value: number,
  increment: string,
  rounding: ReplayDecimalRounding,
): number {
  const source = rationalFromNumber(value)
  const step = decimalPartsFromCanonicalString(increment)
  if (step.coefficient <= 0n) throw new Error("Replay decimal increment must be positive")
  return quantizeRationalToIncrement(source, step, rounding)
}

export function quantizeReplayProduct(
  values: number[],
  divisor: number,
  increment: string,
  rounding: ReplayDecimalRounding,
): number {
  if (values.length === 0) throw new Error("Replay decimal product requires at least one value")
  const product = values.map(rationalFromNumber).reduce(multiplyRationals, { numerator: 1n, denominator: 1n })
  const divisorRational = rationalFromNumber(divisor)
  if (divisorRational.numerator <= 0n) throw new Error("Replay decimal divisor must be positive")
  return quantizeRationalToIncrement(
    divideRationals(product, divisorRational),
    decimalPartsFromCanonicalString(increment),
    rounding,
  )
}

export function quantizeReplayProductSum(
  pairs: Array<readonly [number, number]>,
  increment: string,
  rounding: ReplayDecimalRounding,
): number {
  if (pairs.length === 0) throw new Error("Replay decimal product sum requires at least one pair")
  const sum = pairs
    .map(([left, right]) => multiplyRationals(rationalFromNumber(left), rationalFromNumber(right)))
    .reduce(addRationals, { numerator: 0n, denominator: 1n })
  return quantizeRationalToIncrement(sum, decimalPartsFromCanonicalString(increment), rounding)
}

export function quantizeReplayBasisPointPrice(
  price: number,
  side: "buy" | "sell",
  bps: number,
  priceIncrement: string,
): number {
  if (!Number.isFinite(price) || price <= 0) throw new Error("Replay execution price must be positive")
  if (!Number.isFinite(bps) || bps < 0) throw new Error("Replay basis points must be non-negative")
  const basis = rationalFromNumber(10_000)
  const adjustment = rationalFromNumber(bps)
  const multiplier = side === "buy" ? addRationals(basis, adjustment) : subtractRationals(basis, adjustment)
  if (multiplier.numerator <= 0n) throw new Error("Replay sell slippage must remain below 10000 bps")
  const adjusted = divideRationals(multiplyRationals(rationalFromNumber(price), multiplier), basis)
  return quantizeRationalToIncrement(
    adjusted,
    decimalPartsFromCanonicalString(priceIncrement),
    side === "buy" ? "ceil" : "floor",
  )
}

export function quantizeReplayWeightedAverage(
  priorQuantity: number,
  priorPrice: number,
  fillQuantity: number,
  fillPrice: number,
): number {
  for (const [field, value] of Object.entries({ priorQuantity, priorPrice, fillQuantity, fillPrice })) {
    if (!Number.isFinite(value) || value <= 0) throw new Error(`Replay weighted average ${field} must be positive`)
  }
  const priorWeight = rationalFromNumber(priorQuantity)
  const fillWeight = rationalFromNumber(fillQuantity)
  const numerator = addRationals(
    multiplyRationals(priorWeight, rationalFromNumber(priorPrice)),
    multiplyRationals(fillWeight, rationalFromNumber(fillPrice)),
  )
  const denominator = addRationals(priorWeight, fillWeight)
  return quantizeRationalToIncrement(
    divideRationals(numerator, denominator),
    decimalPartsFromCanonicalString(REPLAY_DERIVED_DECIMAL_INCREMENT),
    "half_away_from_zero",
  )
}

export function quantizeReplayDifferenceProduct(
  minuend: number,
  subtrahend: number,
  multiplier: number,
  direction: -1 | 1,
  increment: string,
  rounding: ReplayDecimalRounding,
): number {
  if (!Number.isFinite(multiplier) || multiplier < 0) throw new Error("Replay difference multiplier must be non-negative")
  const difference = subtractRationals(rationalFromNumber(minuend), rationalFromNumber(subtrahend))
  const signed = direction === 1 ? difference : { numerator: -difference.numerator, denominator: difference.denominator }
  return quantizeRationalToIncrement(
    multiplyRationals(signed, rationalFromNumber(multiplier)),
    decimalPartsFromCanonicalString(increment),
    rounding,
  )
}

export function divideReplayDecimalValues(
  dividend: number,
  divisor: number,
  increment: string = REPLAY_DERIVED_DECIMAL_INCREMENT,
): number {
  if (!Number.isFinite(divisor) || divisor === 0) throw new Error("Replay decimal divisor must be non-zero")
  return quantizeRationalToIncrement(
    divideRationals(rationalFromNumber(dividend), rationalFromNumber(divisor)),
    decimalPartsFromCanonicalString(increment),
    "half_away_from_zero",
  )
}

export function quantizeReplayExecutionPrice(
  value: number,
  side: "buy" | "sell",
  priceIncrement: string,
): number {
  if (!Number.isFinite(value) || value <= 0) throw new Error("Replay execution price must be positive")
  return quantizeReplayDecimal(value, priceIncrement, side === "buy" ? "ceil" : "floor")
}

export function quantizeReplayQuantity(value: number, quantityIncrement: string): number {
  if (!Number.isFinite(value) || value <= 0) throw new Error("Replay quantity must be positive")
  const result = quantizeReplayDecimal(value, quantityIncrement, "floor")
  if (result <= 0) throw new Error("Replay quantity is below the instrument increment")
  return result
}

export function quantizeReplayExpense(value: number, settlementIncrement: string): number {
  if (!Number.isFinite(value) || value < 0) throw new Error("Replay expense must be non-negative")
  return quantizeReplayDecimal(value, settlementIncrement, "ceil")
}

export function quantizeReplaySignedCashflow(value: number, settlementIncrement: string): number {
  if (!Number.isFinite(value)) throw new Error("Replay cashflow must be finite")
  return quantizeReplayDecimal(value, settlementIncrement, "floor")
}

export function isReplayIncrementAligned(value: number, increment: string): boolean {
  if (!Number.isFinite(value)) return false
  const source = decimalPartsFromNumber(value)
  const step = decimalPartsFromCanonicalString(increment)
  if (step.coefficient <= 0n) return false
  const scale = Math.max(source.scale, step.scale)
  const numerator = source.coefficient * powerOfTen(scale - source.scale)
  const denominator = step.coefficient * powerOfTen(scale - step.scale)
  return numerator % denominator === 0n
}

export function addReplayDecimalValues(...values: number[]): number {
  if (values.length === 0) return 0
  const parts = values.map(decimalPartsFromNumber)
  const scale = Math.max(...parts.map((item) => item.scale))
  const coefficient = parts.reduce(
    (sum, item) => sum + item.coefficient * powerOfTen(scale - item.scale),
    0n,
  )
  return decimalPartsToNumber({ coefficient, scale })
}

function rationalFromNumber(value: number): ReplayRational {
  const parts = decimalPartsFromNumber(value)
  return { numerator: parts.coefficient, denominator: powerOfTen(parts.scale) }
}

function addRationals(left: ReplayRational, right: ReplayRational): ReplayRational {
  return {
    numerator: left.numerator * right.denominator + right.numerator * left.denominator,
    denominator: left.denominator * right.denominator,
  }
}

function subtractRationals(left: ReplayRational, right: ReplayRational): ReplayRational {
  return addRationals(left, { numerator: -right.numerator, denominator: right.denominator })
}

function multiplyRationals(left: ReplayRational, right: ReplayRational): ReplayRational {
  return { numerator: left.numerator * right.numerator, denominator: left.denominator * right.denominator }
}

function divideRationals(left: ReplayRational, right: ReplayRational): ReplayRational {
  if (right.numerator === 0n) throw new Error("Replay rational divisor must be non-zero")
  const sign = right.numerator < 0n ? -1n : 1n
  return {
    numerator: left.numerator * right.denominator * sign,
    denominator: left.denominator * (right.numerator * sign),
  }
}

function quantizeRationalToIncrement(
  value: ReplayRational,
  step: DecimalParts,
  rounding: ReplayDecimalRounding,
): number {
  if (step.coefficient <= 0n) throw new Error("Replay decimal increment must be positive")
  const numerator = value.numerator * powerOfTen(step.scale)
  const denominator = value.denominator * step.coefficient
  const quotient = roundRationalQuotient(numerator, denominator, rounding)
  return decimalPartsToNumber({ coefficient: quotient * step.coefficient, scale: step.scale })
}

function roundRationalQuotient(
  numerator: bigint,
  denominator: bigint,
  rounding: ReplayDecimalRounding,
): bigint {
  if (denominator <= 0n) throw new Error("Replay rational denominator must be positive")
  let quotient = numerator / denominator
  const remainder = numerator % denominator
  if (remainder === 0n) return quotient
  if (rounding === "floor" && numerator < 0n) quotient -= 1n
  if (rounding === "ceil" && numerator > 0n) quotient += 1n
  if (rounding === "half_away_from_zero" && absoluteBigInt(remainder) * 2n >= denominator) {
    quotient += numerator < 0n ? -1n : 1n
  }
  return quotient
}

function absoluteBigInt(value: bigint): bigint {
  return value < 0n ? -value : value
}

function decimalPartsFromNumber(value: number): DecimalParts {
  if (!Number.isFinite(value)) throw new Error("Replay decimal value must be finite")
  return decimalPartsFromString(Object.is(value, -0) ? "0" : value.toString())
}

function decimalPartsFromCanonicalString(value: string): DecimalParts {
  if (!/^(?:0|[1-9]\d*)(?:\.\d*[1-9])?$/.test(value)) {
    throw new Error("Replay decimal increment must be a canonical decimal string")
  }
  return decimalPartsFromString(value)
}

function decimalPartsFromString(value: string): DecimalParts {
  const match = /^([+-]?)(\d+)(?:\.(\d+))?(?:e([+-]?\d+))?$/i.exec(value)
  if (!match) throw new Error("Replay decimal value is invalid")
  const sign = match[1] === "-" ? -1n : 1n
  const fraction = match[3] ?? ""
  const exponent = Number(match[4] ?? "0")
  if (!Number.isSafeInteger(exponent)) throw new Error("Replay decimal exponent is invalid")
  let coefficient = BigInt(`${match[2]}${fraction}`) * sign
  let scale = fraction.length - exponent
  if (scale < 0) {
    coefficient *= powerOfTen(-scale)
    scale = 0
  }
  return { coefficient, scale }
}

function decimalPartsToNumber(value: DecimalParts): number {
  const negative = value.coefficient < 0n
  const digits = (negative ? -value.coefficient : value.coefficient).toString().padStart(value.scale + 1, "0")
  const body = value.scale === 0
    ? digits
    : `${digits.slice(0, -value.scale)}.${digits.slice(-value.scale)}`
  const result = Number(`${negative ? "-" : ""}${body}`)
  if (!Number.isFinite(result)) throw new Error("Replay decimal result exceeds finite number range")
  return Object.is(result, -0) ? 0 : result
}

function powerOfTen(exponent: number): bigint {
  if (!Number.isSafeInteger(exponent) || exponent < 0 || exponent > 100) {
    throw new Error("Replay decimal scale is unsupported")
  }
  return 10n ** BigInt(exponent)
}
