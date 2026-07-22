#!/usr/bin/env bun

import { Database } from "bun:sqlite"
import { existsSync, mkdirSync, readFileSync } from "node:fs"
import { dirname, join } from "node:path"

type JSONRecord = Record<string, unknown>

interface Args {
  action: "init" | "check"
  store: string
  baseDir: string
}

const args = parseArgs(Bun.argv.slice(2))
const manifest = JSON.parse(readFileSync("docs/architecture/architecture-manifest.json", "utf8")) as { stores?: JSONRecord[] }
const stores = (Array.isArray(manifest.stores) ? manifest.stores : []).map(asRecord)
const selected = args.store === "all" ? stores : stores.filter((store) => stringField(store.id) === args.store)

if (selected.length === 0) {
  throw new Error(`store not found: ${args.store}`)
}

const results = selected.map((store) => runStore(args, store))
console.log(JSON.stringify({ ok: results.every((result) => result.ok), action: args.action, stores: results }, null, 2))

function runStore(args: Args, store: JSONRecord): JSONRecord {
  const id = stringField(store.id)
  const physical = asRecord(store.physical)
  const kind = stringField(physical.kind)
  const manifestPath = stringField(physical.path)
  const path = args.baseDir ? join(args.baseDir, manifestPath) : manifestPath
  const tables = stringArray(physical.tables)
  const schemaPath = stringField(store.schema)

  if (kind === "memory" || tables.length === 0) {
    return { ok: true, store: id, status: "skipped", reason: "derived_or_memory_store" }
  }
  if (!schemaPath || !existsSync(schemaPath)) {
    return { ok: false, store: id, status: "failed", reason: `schema not found: ${schemaPath}` }
  }
  if (!path) {
    return { ok: false, store: id, status: "failed", reason: "physical.path is required" }
  }

  if (args.action === "init") {
    mkdirSync(dirname(path), { recursive: true })
    const db = new Database(path)
    try {
      db.exec(readFileSync(schemaPath, "utf8"))
      return { ok: true, store: id, status: "initialized", path, table_count: tables.length }
    } finally {
      db.close()
    }
  }

  if (!existsSync(path)) {
    return { ok: false, store: id, status: "missing", path }
  }
  const db = new Database(path, { readonly: true })
  try {
    const missing = tables.filter((table) => !tableExists(db, table))
    return { ok: missing.length === 0, store: id, status: missing.length === 0 ? "ok" : "missing_tables", path, missing_tables: missing }
  } finally {
    db.close()
  }
}

function tableExists(db: Database, table: string): boolean {
  const row = db.query("SELECT name FROM sqlite_master WHERE type='table' AND name=$table").get({ $table: table }) as { name: string } | null
  return row != null
}

function parseArgs(argv: string[]): Args {
  let action: Args["action"] = "check"
  let store = "all"
  let baseDir = ""
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]
    if (arg === "--action") {
      const value = argv[++index]
      if (value !== "init" && value !== "check") {
        throw new Error("--action must be init or check")
      }
      action = value
    } else if (arg === "--store") {
      store = argv[++index] ?? store
    } else if (arg === "--base-dir") {
      baseDir = argv[++index] ?? ""
    } else if (arg === "--help") {
      printHelp()
      process.exit(0)
    } else {
      throw new Error(`unknown argument: ${arg}`)
    }
  }
  return { action, store, baseDir }
}

function printHelp(): void {
  console.log([
    "usage: bun scripts/logical-store.ts --action check --store all",
    "actions: init | check",
    "store: all or a logical store id from docs/architecture/architecture-manifest.json",
    "--base-dir tmp/check/logical-store keeps init/check out of runtime data",
  ].join("\n"))
}

function asRecord(value: unknown): JSONRecord {
  return value && typeof value === "object" && !Array.isArray(value) ? value as JSONRecord : {}
}

function stringField(value: unknown): string {
  return typeof value === "string" ? value.trim() : ""
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.map(stringField).filter(Boolean) : []
}
