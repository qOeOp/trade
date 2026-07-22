import assert from "node:assert/strict"
import test from "node:test"
import { parseArgs } from "./watch"

test("watch probe CLI accepts one bounded JSON object surface", () => {
  assert.deepEqual(parseArgs(["--json", '{"max_events":5,"watch_ms":250}']), { max_events: 5, watch_ms: 250 })
  assert.throws(() => parseArgs(["--endpoint", "remote"]), /unknown flag/)
})
