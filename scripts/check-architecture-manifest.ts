#!/usr/bin/env bun

import { existsSync, readFileSync } from "node:fs"

type JSONRecord = Record<string, unknown>

const manifest = readJson("docs/architecture-manifest.json")
const issues: string[] = []

const domains = arrayOfRecords(manifest.domains)
const jobs = arrayOfRecords(manifest.jobs)
const stores = arrayOfRecords(manifest.stores)
const rails = arrayOfRecords(manifest.rails)

const domainIds = new Set(domains.map((domain) => stringField(domain.id)))
const storeIds = new Set(stores.map((store) => stringField(store.id)))
const jobTickets = new Set<string>()

for (const domain of domains) {
  requireField(domain, "id", "domain")
  checkStatus(domain, "domain")
  for (const modulePath of stringArray(domain.modules)) {
    requirePath(modulePath, `domain ${stringField(domain.id)} module`)
  }
  for (const storeId of stringArray(domain.owns_stores)) {
    if (!storeIds.has(storeId)) {
      issues.push(`domain ${stringField(domain.id)} owns unknown store ${storeId}`)
    }
  }
}

for (const job of jobs) {
  const ticketNo = stringField(job.ticket_no)
  if (!/^J[0-9]{2}$/.test(ticketNo)) {
    issues.push(`job ${stringField(job.job_id)} has invalid ticket_no ${ticketNo}`)
  }
  if (jobTickets.has(ticketNo)) {
    issues.push(`duplicate job ticket ${ticketNo}`)
  }
  jobTickets.add(ticketNo)
  requireField(job, "job_id", "job")
  checkStatus(job, "job")
  const targetDomain = stringField(job.target_domain)
  if (!domainIds.has(targetDomain)) {
    issues.push(`job ${stringField(job.job_id)} targets unknown domain ${targetDomain}`)
  }
  requirePath(stringField(job.owner_module), `job ${stringField(job.job_id)} owner_module`)
  for (const storeId of stringArray(job.writes)) {
    if (!storeIds.has(storeId)) {
      issues.push(`job ${stringField(job.job_id)} writes unknown store ${storeId}`)
    }
  }
}

for (const expected of ["J01", "J02", "J03", "J04", "J05", "J06", "J07", "J08", "J09"]) {
  if (!jobTickets.has(expected)) {
    issues.push(`missing job ticket ${expected}`)
  }
}

for (const store of stores) {
  const storeId = stringField(store.id)
  requireField(store, "id", "store")
  checkStatus(store, "store")
  const ownerDomain = stringField(store.owner_domain)
  if (!domainIds.has(ownerDomain)) {
    issues.push(`store ${storeId} has unknown owner_domain ${ownerDomain}`)
  }
  requirePath(stringField(store.owner_module), `store ${storeId} owner_module`)
  requirePath(stringField(store.schema), `store ${storeId} schema`)
  const schemaPath = stringField(store.schema)
  const ddl = existsSync(schemaPath) ? readFileSync(schemaPath, "utf8") : ""
  if (!stringField(store.write_contract)) {
    issues.push(`store ${storeId} missing write_contract`)
  }
  const physical = asRecord(store.physical)
  if (!stringField(physical.kind)) {
    issues.push(`store ${storeId} missing physical.kind`)
  }
  if (!Array.isArray(physical.tables)) {
    issues.push(`store ${storeId} physical.tables must be an array`)
  }
  for (const table of stringArray(physical.tables)) {
    if (table && !ddlIncludesTable(ddl, table)) {
      issues.push(`store ${storeId} schema ${schemaPath} is missing table ${table}`)
    }
  }
}

for (const rail of rails) {
  requireField(rail, "id", "rail")
  checkStatus(rail, "rail")
  requirePath(stringField(rail.contract), `rail ${stringField(rail.id)} contract`)
}

const protocol = readJson("modules/contracts/protocol-fabric/src/schemas/logical-store-ref.schema.json")
const schemaStores = new Set(arrayOfStrings(asRecord(asRecord(protocol.properties).store).enum))
for (const storeId of storeIds) {
  if (!schemaStores.has(storeId)) {
    issues.push(`logical-store-ref schema is missing store ${storeId}`)
  }
}

if (issues.length > 0) {
  console.error(`architecture manifest violations:\n${issues.join("\n")}`)
  process.exit(1)
}

function readJson(path: string): JSONRecord {
  return JSON.parse(readFileSync(path, "utf8")) as JSONRecord
}

function requirePath(path: string, label: string): void {
  if (!path) {
    issues.push(`${label} path is empty`)
  } else if (!existsSync(path)) {
    issues.push(`${label} path does not exist: ${path}`)
  }
}

function requireField(record: JSONRecord, field: string, label: string): void {
  if (!stringField(record[field])) {
    issues.push(`${label} missing ${field}`)
  }
}

function checkStatus(record: JSONRecord, label: string): void {
  const status = stringField(record.status)
  if (!["implemented", "implemented-derived", "planned"].includes(status)) {
    issues.push(`${label} ${stringField(record.id) || stringField(record.job_id)} has invalid status ${status}`)
  }
}

function asRecord(value: unknown): JSONRecord {
  return value && typeof value === "object" && !Array.isArray(value) ? value as JSONRecord : {}
}

function arrayOfRecords(value: unknown): JSONRecord[] {
  return Array.isArray(value) ? value.map(asRecord) : []
}

function arrayOfStrings(value: unknown): string[] {
  return Array.isArray(value) ? value.map(String).filter(Boolean) : []
}

function stringArray(value: unknown): string[] {
  return arrayOfStrings(value)
}

function stringField(value: unknown): string {
  return typeof value === "string" ? value : ""
}

function ddlIncludesTable(ddl: string, table: string): boolean {
  const pattern = new RegExp(`CREATE\\s+TABLE\\s+(?:IF\\s+NOT\\s+EXISTS\\s+)?${escapeRegExp(table)}\\b`, "i")
  return pattern.test(ddl)
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
}
