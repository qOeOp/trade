import assert from "node:assert/strict"
import test from "node:test"
import { run } from "./main"

test("execution recorder CLI returns structured errors", () => {
  const result = run(["--record-execution", "--json", "{}"])
  assert.equal(result.ok, false)
  assert.match(String(result.error), /preflight_result\.verdict=armable/)
})
