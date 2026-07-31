import { Database } from "bun:sqlite"
import { expect, test } from "bun:test"
import { assertDatabaseIdentity, buildDatabaseIdentity, ensureDatabaseIdentity, inspectDatabaseIdentity } from "./database-identity"

test("database identity is create-or-identical", () => {
  const db = new Database(":memory:")
  const identity = buildDatabaseIdentity("test:suite-a", "research_state_store")
  expect(ensureDatabaseIdentity(db, identity)).toEqual(identity)
  expect(ensureDatabaseIdentity(db, identity)).toEqual(identity)
  expect(inspectDatabaseIdentity(db)).toEqual(identity)
  db.close()
})

test("database identity mismatch fails before domain schema writes", () => {
  const db = new Database(":memory:")
  ensureDatabaseIdentity(db, buildDatabaseIdentity("test:suite-a", "research_state_store"))
  expect(() => ensureDatabaseIdentity(db, buildDatabaseIdentity("runtime:server-a", "research_state_store")))
    .toThrow("database identity mismatch for environment_id")
  expect(db.query("SELECT 1 FROM sqlite_master WHERE type='table' AND name='rd_program'").get()).toBeNull()
  db.close()
})

test("non-empty legacy databases require an explicit identity migration", () => {
  const db = new Database(":memory:")
  db.run("CREATE TABLE legacy_state(value TEXT)")
  const identity = buildDatabaseIdentity("local:local", "research_state_store")
  expect(() => ensureDatabaseIdentity(db, identity)).toThrow("explicit migration required")
  expect(ensureDatabaseIdentity(db, identity, { allowLegacyMigration: true })).toEqual(identity)
  db.close()
})

test("readonly identity assertion rejects an unstamped or mismatched database", () => {
  const unstamped = new Database(":memory:")
  expect(() => assertDatabaseIdentity(unstamped, buildDatabaseIdentity("test:suite-a", "artifact_catalog")))
    .toThrow("database identity is missing")
  unstamped.close()

  const stamped = new Database(":memory:")
  ensureDatabaseIdentity(stamped, buildDatabaseIdentity("test:suite-a", "artifact_catalog"))
  expect(() => assertDatabaseIdentity(stamped, buildDatabaseIdentity("test:suite-b", "artifact_catalog")))
    .toThrow("database identity mismatch for environment_id")
  stamped.close()
})
