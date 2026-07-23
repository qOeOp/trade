import assert from "node:assert/strict"
import test from "node:test"
import { parseArgs } from "../scripts/reviewer-resident"

test("Reviewer resident CLI defaults to private Host and bounded no-trade worker", () => {
  const parsed = parseArgs([
    "--source-revision", "fixture-revision",
    "--max-cycles", "1",
  ])
  assert.equal(parsed.host_url, "http://agent-host:7313")
  assert.equal(parsed.host_token_env, "TRADE_AGENT_HOST_HTTP_TOKEN")
  assert.equal(parsed.config.source_revision, "fixture-revision")
  assert.equal(parsed.config.max_cycles, 1)
  assert.ok(parsed.config.lease_duration_ms > parsed.config.run_duration_ms)
})

test("Reviewer resident CLI rejects a Run window not fenced by its lease", () => {
  assert.throws(() => parseArgs([
    "--source-revision", "fixture-revision",
    "--lease-duration-ms", "900000",
    "--run-duration-ms", "900000",
  ]), /must exceed/)
})
