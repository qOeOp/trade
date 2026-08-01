import { existsSync, mkdtempSync, readFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import assert from "node:assert/strict"
import test from "node:test"
import {
  classifyResidentWorkerFailure,
  parseBoundedInteger,
  resolveWorkerDataPath,
  waitForResidentWorkerBackoff,
  workerAbsolutePath,
  workerFlagValues,
  workerRepoPath,
  writeResidentWorkerState,
} from "./resident-worker"

test("resident worker helpers preserve bounded state and failure semantics", async () => {
  const directory = mkdtempSync(join(tmpdir(), "resident-worker-"))
  const statePath = join(directory, "state.json")
  writeResidentWorkerState(statePath, { status: "running" })
  assert.deepEqual(JSON.parse(readFileSync(statePath, "utf8")), { status: "running" })
  assert.equal(existsSync(`${statePath}.tmp.${process.pid}`), false)
  assert.equal(classifyResidentWorkerFailure(new Error("owner timed out"), "public"), "public_owner_timeout")
  assert.equal(classifyResidentWorkerFailure(new Error("hash drifted"), "compute"), "owner_contract_drift")
  assert.equal(parseBoundedInteger("2", 1, 3, "count"), 2)
  assert.throws(() => parseBoundedInteger("04", 1, 5, "count"), /integer/)
  assert.equal(resolveWorkerDataPath(directory, "data/state.db", "DB"), join(directory, "data/state.db"))
  assert.throws(() => resolveWorkerDataPath(directory, "tmp/state.db", "DB"), /escaped data root/)
  assert.equal(workerRepoPath("data/state.db", "db"), "data/state.db")
  assert.throws(() => workerRepoPath("../state.db", "db"), /invalid/)
  assert.equal(workerAbsolutePath("/tmp/state.json", "state"), "/tmp/state.json")
  assert.throws(() => workerAbsolutePath("tmp/state.json", "state"), /invalid/)
  assert.deepEqual(
    workerFlagValues(["--count", "2"], new Set(["count"]), "worker"),
    new Map([["count", "2"]]),
  )
  await waitForResidentWorkerBackoff(5_000, 0, (cancel) => cancel())
})
