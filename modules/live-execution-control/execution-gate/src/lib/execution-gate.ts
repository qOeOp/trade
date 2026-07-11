import { asRecord, stringField, type JSONRecord } from "../../../../contracts/runtime-core/src/json"

export type ExecutionGateResult =
  | { status: "ready" }
  | { status: "skipped"; reason: string; evidence?: JSONRecord }

export type SkippedExecutionGateResult = Extract<ExecutionGateResult, { status: "skipped" }>

export function evaluateTriggerCondition(input: JSONRecord): ExecutionGateResult {
  const trigger = readTriggerCondition(input)
  if (Object.keys(trigger).length === 0) {
    return { status: "ready" }
  }

  const parsedNow = parseTimeMillis(stringField(input.now) || new Date().toISOString())
  const now = parsedNow == null ? Date.now() : parsedNow
  const validUntil = parseTimeMillis(stringField(trigger.valid_until_at))
  if (validUntil != null && now > validUntil) {
    return {
      status: "skipped",
      reason: "trigger_condition_expired",
      evidence: {
        now: new Date(now).toISOString(),
        valid_until_at: stringField(trigger.valid_until_at),
      },
    }
  }

  const range = readPriceRange(trigger.price_in_range)
  if (range) {
    const mark = readCurrentMark(input)
    if (mark == null) {
      return {
        status: "skipped",
        reason: "current_mark_missing_for_trigger",
        evidence: {
          price_in_range: range,
        },
      }
    }
    if (mark < range[0] || mark > range[1]) {
      return {
        status: "skipped",
        reason: "current_mark_outside_trigger_range",
        evidence: {
          current_mark: mark,
          price_in_range: range,
        },
      }
    }
  }

  return { status: "ready" }
}

function readTriggerCondition(input: JSONRecord): JSONRecord {
  const direct = asRecord(input.trigger_condition)
  if (Object.keys(direct).length > 0) {
    return direct
  }
  const planIntent = asRecord(asRecord(input.plan).action_intent)
  const planTrigger = asRecord(planIntent.trigger_condition)
  if (Object.keys(planTrigger).length > 0) {
    return planTrigger
  }
  const observeIntent = asRecord(asRecord(input.observe).action_intent)
  return asRecord(observeIntent.trigger_condition)
}

function readCurrentMark(input: JSONRecord): number | null {
  const candidates = [
    input.current_mark,
    input.current_mark_price,
    input.mark_price,
    asRecord(input.market).mark_price,
    asRecord(input.market).markPrice,
    asRecord(input.market_snapshot).mark_price,
    asRecord(input.market_snapshot).markPrice,
    asRecord(input.observe).current_mark,
    asRecord(input.observe).mark_price,
    asRecord(input.observe).markPrice,
  ]
  for (const candidate of candidates) {
    const parsed = Number(candidate)
    if (Number.isFinite(parsed) && parsed > 0) {
      return parsed
    }
  }
  return null
}

function readPriceRange(value: unknown): [number, number] | null {
  if (!Array.isArray(value) || value.length !== 2) {
    return null
  }
  const low = Number(value[0])
  const high = Number(value[1])
  if (!Number.isFinite(low) || !Number.isFinite(high)) {
    return null
  }
  return low <= high ? [low, high] : [high, low]
}

function parseTimeMillis(value: string): number | null {
  if (!value) {
    return null
  }
  const parsed = Date.parse(value)
  return Number.isFinite(parsed) ? parsed : null
}
