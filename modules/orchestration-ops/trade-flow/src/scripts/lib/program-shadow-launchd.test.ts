import assert from "node:assert/strict"
import test from "node:test"
import {
  PROGRAM_SHADOW_LAUNCHD_LABEL,
  isMacOsProtectedUserPath,
  renderProgramShadowLaunchAgent,
} from "./program-shadow-launchd"

test("launchd owns restart without introducing a PID-file authority", () => {
  const plist = renderProgramShadowLaunchAgent({
    bun_path: "/opt/bin/bun",
    repository_root: "/repo/trade & research",
    main_script_path: "/repo/trade/modules/trade-flow/main.ts",
    trade_db_path: "/repo/trade/data/trade.db",
    ops_runtime_db_path: "/repo/trade/data/ops_runtime.db",
    stdout_path: "/repo/trade/tmp/runtime/stdout.log",
    stderr_path: "/repo/trade/tmp/runtime/stderr.log",
    interval_seconds: 60,
  })

  assert.match(plist, new RegExp(`<string>${PROGRAM_SHADOW_LAUNCHD_LABEL}</string>`))
  assert.match(plist, /<key>KeepAlive<\/key>\s*<true\/>/)
  assert.match(plist, /--run-program-shadow-supervisor/)
  assert.match(plist, /<key>TRADE_REPO_ROOT<\/key>/)
  assert.doesNotMatch(plist, /<key>WorkingDirectory<\/key>/)
  assert.match(plist, /&amp;/)
  assert.match(plist, /&quot;observe_agent_parity&quot;:true/)
  assert.doesNotMatch(plist, /PIDFile|pid_file|\.pid/)
})

test("launchd installation identifies macOS protected source roots", () => {
  assert.equal(isMacOsProtectedUserPath("/Users/operator/Downloads/trade", "/Users/operator"), true)
  assert.equal(isMacOsProtectedUserPath("/Users/operator/Documents", "/Users/operator/"), true)
  assert.equal(isMacOsProtectedUserPath("/Users/operator/src/trade", "/Users/operator"), false)
  assert.equal(isMacOsProtectedUserPath("/Users/operator/Downloads-old/trade", "/Users/operator"), false)
})
