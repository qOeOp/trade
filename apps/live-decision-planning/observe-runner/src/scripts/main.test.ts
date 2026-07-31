import assert from "node:assert/strict"
import test from "node:test"
import { run } from "./main"

test("observe runner CLI requires symbol", async () => {
  const result = await run(["--observe-from-tools", "--json", "{}"])
  assert.equal(result.ok, false)
  assert.match(String(result.error), /symbol is required/)
})
