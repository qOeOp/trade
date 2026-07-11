type JSONRecord = Record<string, unknown>

export const TARGET_ACTIONS = ["no_action", "place_entry", "cancel_order", "sync_protection", "adjust_position"] as const
export type TargetAction = typeof TARGET_ACTIONS[number]
export type ExecutableTargetAction = Exclude<TargetAction, "no_action">

const TARGET_ACTION_SET = new Set<string>(TARGET_ACTIONS)

export function readTargetAction(value: unknown): TargetAction {
  const candidate = typeof value === "string" ? value.trim() : ""
  return TARGET_ACTION_SET.has(candidate) ? candidate as TargetAction : "no_action"
}

export function readObserveTargetAction(observe: JSONRecord): TargetAction {
  const actionIntent = asRecord(observe.action_intent)
  return readTargetAction(actionIntent.target_action)
}

function asRecord(value: unknown): JSONRecord {
  return value && typeof value === "object" && !Array.isArray(value) ? value as JSONRecord : {}
}
