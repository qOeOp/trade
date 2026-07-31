import { expect, test } from "bun:test"
import { existsSync } from "node:fs"
import { createTestDatabaseEnvironment } from "./test-database-environment"

test("test database environments isolate same-named WAL databases and clean sidecars", () => {
  const first = createTestDatabaseEnvironment("parallel")
  const second = createTestDatabaseEnvironment("parallel")
  try {
    const firstPath = first.database("state.db")
    const secondPath = second.database("state.db")
    expect(firstPath).not.toBe(secondPath)
    for (const [environment, value] of [[first, "first"], [second, "second"]] as const) {
      const db = environment.open("state.db")
      db.run("PRAGMA journal_mode = WAL")
      db.run("CREATE TABLE state(value TEXT NOT NULL)")
      db.query("INSERT INTO state(value) VALUES (?)").run(value)
    }
    const firstDb = first.open("state.db")
    const secondDb = second.open("state.db")
    expect(firstDb.query("SELECT value FROM state").get()).toEqual({ value: "first" })
    expect(secondDb.query("SELECT value FROM state").get()).toEqual({ value: "second" })
  } finally {
    first.cleanup()
    second.cleanup()
  }
  expect(existsSync(first.root)).toBe(false)
  expect(existsSync(second.root)).toBe(false)
  first.cleanup()
})
