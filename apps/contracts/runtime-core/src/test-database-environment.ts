import { randomUUID } from "node:crypto"
import { mkdirSync, mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { Database } from "bun:sqlite"
import { resolveDatabaseEnvironment, resolveEnvironmentDatabase, type DatabaseEnvironment } from "./database-environment"

export interface TestDatabaseEnvironment {
  root: string
  environment: DatabaseEnvironment
  database(fileName: string): string
  open(fileName: string): Database
  cleanup(): void
}

export function createTestDatabaseEnvironment(prefix: string): TestDatabaseEnvironment {
  const safePrefix = prefix.trim().toLowerCase().replace(/[^a-z0-9_-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 20)
  if (!safePrefix) throw new Error("test database environment prefix is required")
  const root = mkdtempSync(join(tmpdir(), `trade-${safePrefix}-`))
  const environment = resolveDatabaseEnvironment({
    kind: "test",
    instanceId: `${safePrefix}-${randomUUID()}`,
    dataRoot: join(root, "data"),
    tmpRoot: join(root, "tmp"),
  })
  mkdirSync(environment.data_root, { recursive: true })
  mkdirSync(environment.tmp_root, { recursive: true })
  const handles = new Set<Database>()
  let cleaned = false
  return {
    root,
    environment,
    database: (fileName) => resolveEnvironmentDatabase(environment, fileName),
    open: (fileName) => {
      if (cleaned) throw new Error("test database environment is already cleaned")
      const db = new Database(resolveEnvironmentDatabase(environment, fileName))
      handles.add(db)
      return db
    },
    cleanup: () => {
      if (cleaned) return
      for (const db of handles) {
        try { db.run("PRAGMA wal_checkpoint(TRUNCATE)") } catch { /* test cleanup is best-effort */ }
        try { db.close() } catch { /* test cleanup is best-effort */ }
      }
      handles.clear()
      rmSync(root, { recursive: true, force: true })
      cleaned = true
    },
  }
}
