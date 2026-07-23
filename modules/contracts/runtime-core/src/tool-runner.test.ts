import assert from "node:assert/strict"
import test from "node:test"

import { runJsonCommand } from "./tool-runner"

test("runJsonCommand parses JSON stdout", async () => {
  const result = await runJsonCommand(["bun", "-e", "console.log(JSON.stringify({ ok: true, value: 1 }))"])

  assert.equal(result.ok, true)
  assert.deepEqual(result.ok ? result.data : null, { ok: true, value: 1 })
})

test("runJsonCommand returns non-zero exit details", async () => {
  const result = await runJsonCommand(["bun", "-e", "console.error('bad'); process.exit(7)"])

  assert.equal(result.ok, false)
  assert.equal(result.ok ? null : result.exitCode, 7)
  assert.match(result.ok ? "" : result.stderr, /bad/)
})

test("runJsonCommand rejects non-json stdout", async () => {
  const result = await runJsonCommand(["bun", "-e", "console.log('not json')"])

  assert.equal(result.ok, false)
  assert.match(result.ok ? "" : result.error, /did not return JSON/)
})
