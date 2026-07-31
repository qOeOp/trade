import assert from "node:assert/strict"
import test from "node:test"
import { parseArgs } from "./main"

test("probe CLI accepts only one JSON object", () => {
  assert.deepEqual(parseArgs(["--json", '{"depth":10,"max_freshness_ms":500}']), {
    depth: 10,
    max_freshness_ms: 500,
  })
  assert.throws(() => parseArgs(["--endpoint", "http://remote"]), /unknown flag/)
})
