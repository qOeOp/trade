import assert from "node:assert/strict"
import { spawn } from "node:child_process"
import { readFile } from "node:fs/promises"
import { once } from "node:events"
import test from "node:test"

import { stopProcess } from "./browser-acceptance.mjs"

// This asserts the hole, not the symptom it once produced. The leak that motivated this could not
// be reproduced here, so a test written against it would never be able to finish; what is
// decidable is whether an already-exited child leaves its pipes open.
test("stopping an already-exited child still releases pipes a survivor holds open", async () => {
  // A child that exits alone has its pipes closed by Node, so asserting on that proves nothing -
  // it holds with or without this teardown. The case that matters is the one that caused the
  // failure: the spawned process is gone, something it started is not, and that survivor inherited
  // the write ends. Then the pipes stay open on their own and only this teardown closes them.
  const child = spawn("/bin/sh", ["-c", "sleep 30 & exit 0"], { stdio: ["ignore", "pipe", "pipe"] })
  await once(child, "exit")
  assert.notEqual(child.exitCode === null && child.signalCode === null, true,
    "the spawned process must be gone before this exercises the early return")
  assert.equal(child.stdout?.destroyed, false,
    "the survivor must still be holding the write end, or this asserts nothing")

  await stopProcess(child, "probe")

  assert.equal(child.stdout?.destroyed, true, "stdout must be released")
  assert.equal(child.stderr?.destroyed, true, "stderr must be released")
})

// The signal path keeps working: a live child is still stopped, and its pipes end up released too.
test("stopping a live child still stops it", async () => {
  const child = spawn(process.execPath, ["-e", "setInterval(() => {}, 1000)"], {
    stdio: ["ignore", "pipe", "pipe"],
  })
  await stopProcess(child, "probe")
  assert.notEqual(child.exitCode === null && child.signalCode === null, true,
    "a live child must actually be stopped")
})

// Four copies of this teardown exist, and they have drifted before: the browser flags that made the
// gate hang were present in one copy and missing from the other three. An assertion that they agree
// is cheaper than finding out again from a stalled job.
test("every copy of the teardown releases the pipes on the early return", async () => {
  const copies = [
    "./browser-acceptance.mjs",
    "./operations-workers.postgres.test.mjs",
    "./schedule-calendar.postgres.test.mjs",
    "./service-logs.postgres.test.mjs",
  ]
  for (const copy of copies) {
    const source = await readFile(new URL(copy, import.meta.url), "utf8")
    const early = source.match(/if \(!child \|\| child\.exitCode !== null[^}]*\}/u)
    assert.ok(early, `${copy} must still have an early return to guard`)
    assert.match(early[0], /child\?\.stdout\?\.destroy\(\)/u, copy)
    assert.match(early[0], /child\?\.stderr\?\.destroy\(\)/u, copy)
  }
})
