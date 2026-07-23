import { existsSync, mkdtempSync, readFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import assert from "node:assert/strict"
import test from "node:test"
import {
  classifyResidentWorkerFailure,
  parseBoundedInteger,
  waitForResidentWorkerBackoff,
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
  await waitForResidentWorkerBackoff(5_000, 0, (cancel) => cancel())
})
