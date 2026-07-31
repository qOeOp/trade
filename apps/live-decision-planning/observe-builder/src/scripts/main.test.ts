import assert from "node:assert/strict"
import test from "node:test"
import { run } from "./main"

test("observe builder CLI returns structured errors", () => {
  const result = run(["--build-observe", "--json", "{}"])
  assert.equal(result.ok, false)
  assert.equal(typeof result.error, "string")
})
