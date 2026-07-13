import assert from "node:assert/strict"
import test from "node:test"
import { run } from "./main"

test("execution flow runner CLI returns structured errors", async () => {
  const result = await run(["--mode", "live"])
  assert.equal(result.ok, false)
  assert.match(String(result.error), /unsupported --mode/)
})
