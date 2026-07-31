import assert from "node:assert/strict"
import test from "node:test"
import { parseArgs } from "./session"

test("session CLI accepts only one JSON object payload", () => {
  assert.deepEqual(parseArgs(["--json", '{"max_cycles":2,"session_ms":10000}']), {
    max_cycles: 2,
    session_ms: 10_000,
  })
  assert.throws(() => parseArgs(["--max-cycles", "2"]), /unknown flag/)
})
