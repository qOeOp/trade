import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import test from "node:test"
import { repoRoot } from "../../../../../contracts/runtime-core/src/paths"
import { parseServerRuntimeProfile } from "./server-runtime-profile"
import { renderServerRuntimeLaunchd } from "./server-runtime-launchd"

test("launchd renderer emits three foreground agents without installing them", () => {
  const root = repoRoot()
  const profile = parseServerRuntimeProfile(JSON.parse(readFileSync(resolve(root, "profile/server-runtime-macos.json"), "utf8")))
  const rendered = renderServerRuntimeLaunchd(profile, "/opt/trade & local", "/usr/local/bin/bun")
  assert.equal(rendered.process_authority, "launchd")
  assert.equal(Object.keys(rendered.units).length, 3)
  const owner = rendered.units["com.trade.server-shadow.l2-owner.plist"]
  assert.match(owner, /<key>WorkingDirectory<\/key>/)
  assert.match(owner, /\/opt\/trade &amp; local/)
  assert.match(owner, /foreground\.ts/)
  assert.match(owner, /<key>SuccessfulExit<\/key>\s*<false\/>/)
  assert.doesNotMatch(owner, /API_KEY|API_SECRET/)
})

test("launchd renderer is deterministic and target-specific", () => {
  const root = repoRoot()
  const profile = parseServerRuntimeProfile(JSON.parse(readFileSync(resolve(root, "profile/server-runtime-macos.json"), "utf8")))
  assert.deepEqual(
    renderServerRuntimeLaunchd(profile, "/opt/trade", "/usr/local/bin/bun"),
    renderServerRuntimeLaunchd(profile, "/opt/trade", "/usr/local/bin/bun"),
  )
  const linux = parseServerRuntimeProfile(JSON.parse(readFileSync(resolve(root, "profile/server-runtime.json"), "utf8")))
  assert.throws(() => renderServerRuntimeLaunchd(linux, "/opt/trade", "/usr/bin/bun"), /launchd profile/)
})
