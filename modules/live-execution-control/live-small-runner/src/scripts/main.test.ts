import assert from "node:assert/strict"
import test from "node:test"
import { run } from "./main"

test("live small runner CLI requires explicit yes", async () => {
  const result = await run(["--run-live-small", "--json", "{}"])
  assert.equal(result.ok, false)
  assert.match(String(result.error), /requires --yes/)
})
