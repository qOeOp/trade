import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import test from "node:test"
import { repoRoot } from "../../../../../contracts/runtime-core/src/paths"
import {
  parseServerRuntimeContainerProfile,
  serverRuntimeContainerProfileHash,
} from "./server-runtime-container-profile"
import { serverRuntimeContainerProcessSpecs } from "./server-runtime-container-processes"

function fixture(): Record<string, unknown> {
  return JSON.parse(readFileSync(
    resolve(repoRoot(), "profile/server-runtime-container.json"),
    "utf8",
  )) as Record<string, unknown>
}

test("container profile composes demand-driven market data and no-live control", () => {
  const profile = parseServerRuntimeContainerProfile(fixture())
  assert.equal(profile.market_data_runtime.l2.max_instances, 3)
  assert.equal(profile.safety.live_writes_allowed, false)
  assert.equal(profile.safety.formal_replay_jobs_enabled, true)
  assert.match(serverRuntimeContainerProfileHash(profile), /^[a-f0-9]{64}$/)
  const specs = serverRuntimeContainerProcessSpecs(profile, "/opt/trade", "/usr/bin/bun")
  assert.deepEqual(
    specs.map((item) => item.id),
    [
      "control-runtime",
      "market-data-manager",
      "ohlcv-worker",
      "funding-worker",
      "indicator-worker",
      "formal-replay-worker",
    ],
  )
  assert.match(specs[0]!.command.at(-1)!, /"runtime_profile":"demand_driven_shadow"/)
  assert.match(specs[5]!.command.join(" "), /formal-replay-foreground/)
  assert.match(
    specs[5]!.command.join(" "),
    /formal-replay:single-node-shadow-container/,
  )
  assert.doesNotMatch(specs[5]!.command.join(" "), /--environment-id/)
})

test("container profile rejects live widening, DB collision, and invalid L2 capacity", () => {
  const live = fixture()
  ;(live.safety as Record<string, unknown>).live_writes_allowed = true
  assert.throws(() => parseServerRuntimeContainerProfile(live), /safety/)
  const replayDisabled = fixture()
  ;(replayDisabled.safety as Record<string, unknown>).formal_replay_jobs_enabled = false
  assert.throws(() => parseServerRuntimeContainerProfile(replayDisabled), /safety/)
  const collision = fixture()
  ;(collision.control_runtime as Record<string, unknown>).trade_db = "data/market_data.db"
  assert.throws(() => parseServerRuntimeContainerProfile(collision), /distinct/)
  const port = fixture()
  const market = port.market_data_runtime as Record<string, unknown>
  ;(market.l2 as Record<string, unknown>).base_port = 65_535
  assert.throws(() => parseServerRuntimeContainerProfile(port), /port range/)
})
