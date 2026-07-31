import assert from "node:assert/strict"
import test from "node:test"
import { Database } from "bun:sqlite"
import {
  AGENT_CYCLE_SQLITE_BUSY_TIMEOUT_MS,
  configureAgentCycleDatabase,
} from "./agent-cycle-cli"

test("Agent cycle clients wait for bounded concurrent owner writes", () => {
  const db = new Database(":memory:")
  try {
    configureAgentCycleDatabase(db)
    const row = db.query("PRAGMA busy_timeout").get() as { timeout: number }
    assert.equal(row.timeout, AGENT_CYCLE_SQLITE_BUSY_TIMEOUT_MS)
  } finally {
    db.close()
  }
})
