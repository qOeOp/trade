import assert from "node:assert/strict"
import test from "node:test"
import { run } from "./main"

test("slow track CLI returns structured errors", async () => {
  const result = await run(["--unknown"])
  assert.equal(result.ok, false)
  assert.match(String(result.error), /unknown flag/)
})
