import assert from "node:assert/strict"
import test from "node:test"
import { run } from "./main"

test("recovery runner CLI requires chain id", async () => {
  const result = await run(["--reconcile-from-tools", "--json", "{}"])
  assert.equal(result.ok, false)
  assert.match(String(result.error), /--chain-id is required/)
})
