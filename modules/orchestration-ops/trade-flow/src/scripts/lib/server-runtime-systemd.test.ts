import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import test from "node:test"
import { repoRoot } from "../../../../../contracts/runtime-core/src/paths"
import { parseServerRuntimeProfile } from "./server-runtime-profile"
import { renderServerRuntimeSystemd } from "./server-runtime-systemd"

const profile = parseServerRuntimeProfile(JSON.parse(
  readFileSync(resolve(repoRoot(), "profile/server-runtime.json"), "utf8"),
))

test("systemd renderer emits three foreground units and a non-ready target", () => {
  const result = renderServerRuntimeSystemd(profile, "/opt/trade release", "/usr/local/bin/bun")
  assert.deepEqual(Object.keys(result.units).sort(), [
    "trade-control-runtime.service",
    "trade-l2-consumer.service",
    "trade-l2-owner.service",
    "trade-server-shadow.target",
  ])
  assert.equal(result.readiness_claim, "process_units_only_status_required")
  const serialized = JSON.stringify(result.units)
  assert.match(result.units["trade-l2-owner.service"] ?? "", /src\/scripts\/foreground\.ts/)
  assert.match(result.units["trade-l2-consumer.service"] ?? "", /consumer-foreground\.ts/)
  assert.match(result.units["trade-control-runtime.service"] ?? "", /--run-program-shadow-supervisor/)
  assert.match(serialized, /KillMode=control-group/)
  assert.match(serialized, /ProtectSystem=strict/)
  assert.equal(serialized.includes("launch.ts"), false)
  assert.equal(serialized.includes("consumer-launch.ts"), false)
  assert.equal(serialized.includes("PIDFile"), false)
  assert.equal(serialized.includes("BINANCE_API_KEY"), false)
  assert.equal(serialized.includes("SILICONFLOW_API_KEY"), false)
  assert.equal(serialized.includes("allow_live_writes"), false)
})

test("systemd renderer is deterministic and rejects relative manager paths", () => {
  const first = renderServerRuntimeSystemd(profile, "/opt/trade", "/usr/bin/bun")
  const second = renderServerRuntimeSystemd(profile, "/opt/trade", "/usr/bin/bun")
  assert.deepEqual(first, second)
  assert.throws(() => renderServerRuntimeSystemd(profile, "./trade", "/usr/bin/bun"), /release_root/)
  assert.throws(() => renderServerRuntimeSystemd(profile, "/opt/trade", "bun"), /bun_path/)
})
