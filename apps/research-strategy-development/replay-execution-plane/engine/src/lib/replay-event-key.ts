import {
  assertReplayEventKey,
  type ReplayEventKey,
} from "../../../contracts/src/lib/replay-contracts"

export { assertReplayEventKey, compareReplayEventKeys } from "../../../contracts/src/lib/replay-contracts"

export function createReplayEventKey(value: ReplayEventKey): ReplayEventKey {
  assertReplayEventKey(value)
  return { ...value }
}
