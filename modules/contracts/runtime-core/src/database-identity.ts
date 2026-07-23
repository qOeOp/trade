import type { Database } from "bun:sqlite"

export const DATABASE_IDENTITY_SCHEMA_VERSION = "trade.database-identity.v1"

export interface DatabaseIdentity {
  schema_version: typeof DATABASE_IDENTITY_SCHEMA_VERSION
  environment_id: string
  store_id: string
  instance_id: string
}

export function buildDatabaseIdentity(environmentId: string, storeId: string): DatabaseIdentity {
  if (!/^(local|test|ci|runtime):[a-z0-9][a-z0-9_-]{0,63}$/.test(environmentId)) {
    throw new Error(`invalid database environment identity: ${environmentId}`)
  }
  if (!/^[a-z][a-z0-9_]{1,63}$/.test(storeId)) throw new Error(`invalid logical store identity: ${storeId}`)
  return {
    schema_version: DATABASE_IDENTITY_SCHEMA_VERSION,
    environment_id: environmentId,
    store_id: storeId,
    instance_id: environmentId.slice(environmentId.indexOf(":") + 1),
  }
}

export function ensureDatabaseIdentity(
  db: Database,
  expected: DatabaseIdentity,
  options: { allowLegacyMigration?: boolean } = {},
): DatabaseIdentity {
  const existing = inspectDatabaseIdentity(db)
  if (!existing) {
    const legacyTables = db.query(`
      SELECT name FROM sqlite_master
      WHERE type = 'table' AND name NOT LIKE 'sqlite_%' AND name != 'runtime_database_identity'
      ORDER BY name
    `).all() as Array<{ name: string }>
    if (legacyTables.length > 0 && !options.allowLegacyMigration) {
      throw new Error(`database identity is missing on a non-empty database; explicit migration required (${legacyTables.map((row) => row.name).join(", ")})`)
    }
    db.run(`
      CREATE TABLE runtime_database_identity (
        singleton INTEGER PRIMARY KEY CHECK(singleton = 1),
        schema_version TEXT NOT NULL,
        environment_id TEXT NOT NULL,
        store_id TEXT NOT NULL,
        instance_id TEXT NOT NULL
      )
    `)
    db.query(`
      INSERT INTO runtime_database_identity(singleton, schema_version, environment_id, store_id, instance_id)
      VALUES (1, $schema_version, $environment_id, $store_id, $instance_id)
    `).run({
      $schema_version: expected.schema_version,
      $environment_id: expected.environment_id,
      $store_id: expected.store_id,
      $instance_id: expected.instance_id,
    })
    return expected
  }
  return assertMatchingDatabaseIdentity(existing, expected)
}

export function assertDatabaseIdentity(db: Database, expected: DatabaseIdentity): DatabaseIdentity {
  const existing = inspectDatabaseIdentity(db)
  if (!existing) throw new Error("database identity is missing")
  return assertMatchingDatabaseIdentity(existing, expected)
}

export function inspectDatabaseIdentity(db: Database): DatabaseIdentity | null {
  const table = db.query("SELECT 1 FROM sqlite_master WHERE type='table' AND name='runtime_database_identity'").get()
  if (!table) return null
  return db.query(`
    SELECT schema_version, environment_id, store_id, instance_id
    FROM runtime_database_identity WHERE singleton = 1
  `).get() as DatabaseIdentity | null
}

function assertMatchingDatabaseIdentity(existing: DatabaseIdentity, expected: DatabaseIdentity): DatabaseIdentity {
  for (const field of ["schema_version", "environment_id", "store_id", "instance_id"] as const) {
    if (existing[field] !== expected[field]) {
      throw new Error(`database identity mismatch for ${field}: ${existing[field]} != ${expected[field]}`)
    }
  }
  return existing
}
