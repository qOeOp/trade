import assert from "node:assert/strict"
import { spawn } from "node:child_process"
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs"
import { once } from "node:events"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { setTimeout as delay } from "node:timers/promises"
import test from "node:test"

import { reapPredecessor, startedAt } from "../scripts/local-preview.mjs"

const scratch = mkdtempSync(join(tmpdir(), "local-preview-reap-"))

// A dev server that outlives its parent is reparented to init, and by then nothing holds a handle
// to it: the only thing left that can stop it is the next run reading a record off disk. That is
// the path these cover, because it is the one that still works after the handlers are gone.

test("a recorded server that is still the recorded server is stopped", async () => {
  const record = join(scratch, "alive.json")
  const survivor = spawn(process.execPath, ["-e", "setInterval(() => {}, 1000)"], {
    stdio: "ignore", detached: true,
  })
  writeFileSync(record, JSON.stringify({ pid: survivor.pid, startedAt: startedAt(survivor.pid) }))

  assert.equal(reapPredecessor(record), "stopped")
  await Promise.race([once(survivor, "exit"), delay(5_000)])
  assert.notEqual(survivor.exitCode === null && survivor.signalCode === null, true,
    "the recorded server must actually be gone")
})

// The guard that matters most, because getting it wrong signals a stranger rather than leaving a
// leak. Process ids are reused, and a record outlives the process it names.
test("a recorded id that now names a different process is left alone", async () => {
  const record = join(scratch, "reused.json")
  const bystander = spawn(process.execPath, ["-e", "setInterval(() => {}, 1000)"], { stdio: "ignore" })
  writeFileSync(record, JSON.stringify({ pid: bystander.pid, startedAt: "Thu Jan  1 00:00:00 1970" }))

  assert.equal(reapPredecessor(record), "identity-mismatch")
  await delay(200)
  assert.equal(bystander.exitCode === null && bystander.signalCode === null, true,
    "a process that only shares the id must survive")
  bystander.kill("SIGKILL")
})

// Absent and empty read the same way from a caller that ignores the return value, so the reaper
// says which one it saw.
test("no record and an unreadable record are reported, not guessed at", () => {
  assert.equal(reapPredecessor(join(scratch, "absent.json")), "no-record")
  const malformed = join(scratch, "malformed.json")
  writeFileSync(malformed, "{")
  assert.equal(reapPredecessor(malformed), "no-record")
})
