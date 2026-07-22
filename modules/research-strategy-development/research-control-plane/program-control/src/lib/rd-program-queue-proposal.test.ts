import assert from "node:assert/strict"
import test from "node:test"
import { mkdtempSync, rmSync } from "node:fs"
import { join } from "node:path"
import { tmpdir } from "node:os"
import { runRdProgramStateCommand } from "./rd-program-state"

test("queue proposal is CAS-protected, idempotent, and active-only", () => {
  const root = mkdtempSync(join(tmpdir(), "rd-queue-proposal-"))
  const dbPath = join(root, "rd.db")
  try {
    const initialized = runRdProgramStateCommand({
      dbPath, programId: "rd-program",
      input: { action: "init", objective: "find one robust mechanism", now: "2026-07-23T00:00:00.000Z" },
    })
    const proposal = { hypothesis_id: "h-1", ready: true, source: "research.strategy-hypothesis-designer" }
    const queued = runRdProgramStateCommand({
      dbPath, programId: "rd-program",
      input: { action: "queue_proposal", expected_updated_at: initialized.state.updated_at, now: "2026-07-23T00:00:00.001Z", proposal },
    })
    assert.equal(queued.queued, true)
    assert.equal(queued.duplicate, false)
    assert.equal(queued.state.next_hypothesis_queue.length, 1)

    const duplicate = runRdProgramStateCommand({
      dbPath, programId: "rd-program",
      input: { action: "queue_proposal", expected_updated_at: initialized.state.updated_at, now: "2026-07-23T00:00:00.002Z", proposal },
    })
    assert.equal(duplicate.queued, false)
    assert.equal(duplicate.duplicate, true)
    assert.equal(duplicate.state.next_hypothesis_queue.length, 1)

    assert.throws(() => runRdProgramStateCommand({
      dbPath, programId: "rd-program",
      input: {
        action: "queue_proposal", expected_updated_at: initialized.state.updated_at, now: "2026-07-23T00:00:00.003Z",
        proposal: { hypothesis_id: "h-2", ready: true },
      },
    }), /stale/)
    assert.throws(() => runRdProgramStateCommand({
      dbPath, programId: "rd-program",
      input: {
        action: "queue_proposal", expected_updated_at: queued.state.updated_at, now: "2026-07-23T00:00:00.004Z",
        proposal: { ...proposal, source: "conflict" },
      },
    }), /conflicts/)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})
