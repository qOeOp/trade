#!/usr/bin/env bun

import { mkdirSync, readFileSync, rmSync } from "node:fs"
import { join } from "node:path"
import { Database } from "bun:sqlite"

type JSONRecord = Record<string, unknown>

const manifest = JSON.parse(readFileSync("docs/architecture-manifest.json", "utf8")) as JSONRecord
const stores = Array.isArray(manifest.stores) ? manifest.stores.map(asRecord) : []
const tmpRoot = "tmp/check/storage-schema"
const issues: string[] = []

rmSync(tmpRoot, { recursive: true, force: true })
mkdirSync(tmpRoot, { recursive: true })

for (const store of stores) {
  const storeId = stringField(store.id)
  const schemaPath = stringField(store.schema)
  const tables = stringArray(asRecord(store.physical).tables)
  if (!schemaPath || tables.length === 0) {
    continue
  }
  const ddl = readFileSync(schemaPath, "utf8")
  const dbPath = join(tmpRoot, `${storeId}.db`)
  const db = new Database(dbPath)
  try {
    db.exec(ddl)
    const existing = new Set((db.query(`
      SELECT name
      FROM sqlite_master
      WHERE type = 'table'
    `).all() as Array<{ name: string }>).map((row) => row.name))
    for (const table of tables) {
      if (!existing.has(table)) {
        issues.push(`${schemaPath} did not create expected table ${table}`)
      }
    }
  } catch (error) {
    issues.push(`${schemaPath} failed to execute: ${error instanceof Error ? error.message : String(error)}`)
  } finally {
    db.close()
  }
}

if (issues.length > 0) {
  console.error(`storage schema violations:\n${issues.join("\n")}`)
  process.exit(1)
}

function asRecord(value: unknown): JSONRecord {
  return value && typeof value === "object" && !Array.isArray(value) ? value as JSONRecord : {}
}

function stringField(value: unknown): string {
  return typeof value === "string" ? value : ""
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.map(String).filter(Boolean) : []
}
