#!/usr/bin/env bun

import { existsSync, readFileSync, readdirSync } from "node:fs"
import { dirname, join } from "node:path"

type JSONRecord = Record<string, unknown>

const manifest = readJson("docs/architecture/architecture-manifest.json")
const issues: string[] = []

const domains = arrayOfRecords(manifest.domains)
const jobs = arrayOfRecords(manifest.jobs)
const stores = arrayOfRecords(manifest.stores)
const rails = arrayOfRecords(manifest.rails)

const domainIds = new Set(domains.map((domain) => stringField(domain.id)))
const storeIds = new Set(stores.map((store) => stringField(store.id)))
const railIds = new Set(rails.map((rail) => stringField(rail.id)))
const jobTickets = new Set<string>()
const jobIds = new Set<string>()
const moduleOwners = new Map<string, string>()
const declaredDomainIds = new Set<string>()
const declaredStoreIds = new Set<string>()
const declaredRailIds = new Set<string>()

for (const domain of domains) {
  requireField(domain, "id", "domain")
  checkStatus(domain, "domain")
  const domainId = stringField(domain.id)
  if (declaredDomainIds.has(domainId)) issues.push(`duplicate domain id ${domainId}`)
  declaredDomainIds.add(domainId)
  for (const modulePath of stringArray(domain.modules)) {
    requirePath(modulePath, `domain ${stringField(domain.id)} module`)
    const previousOwner = moduleOwners.get(modulePath)
    if (previousOwner) issues.push(`module ${modulePath} is declared by multiple domains: ${previousOwner}, ${domainId}`)
    moduleOwners.set(modulePath, domainId)
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
  const jobId = stringField(job.job_id)
  if (jobIds.has(jobId)) issues.push(`duplicate job id ${jobId}`)
  jobIds.add(jobId)
  checkStatus(job, "job")
  const targetDomain = stringField(job.target_domain)
  if (!domainIds.has(targetDomain)) {
    issues.push(`job ${stringField(job.job_id)} targets unknown domain ${targetDomain}`)
  }
  const ownerModule = stringField(job.owner_module)
  requirePath(ownerModule, `job ${stringField(job.job_id)} owner_module`)
  const ownerDomain = moduleOwners.get(ownerModule)
  if (!ownerDomain) {
    issues.push(`job ${jobId} owner_module is not declared by any domain: ${ownerModule}`)
  } else if (ownerDomain !== targetDomain) {
    issues.push(`job ${jobId} owner_module belongs to ${ownerDomain}, not target_domain ${targetDomain}`)
  }
  for (const storeId of stringArray(job.writes)) {
    if (!storeIds.has(storeId)) {
      issues.push(`job ${stringField(job.job_id)} writes unknown store ${storeId}`)
    }
  }
}

for (const expected of expectedJobTickets(jobs.length)) {
  if (!jobTickets.has(expected)) {
    issues.push(`missing job ticket ${expected}`)
  }
}

for (const store of stores) {
  const storeId = stringField(store.id)
  requireField(store, "id", "store")
  if (declaredStoreIds.has(storeId)) issues.push(`duplicate store id ${storeId}`)
  declaredStoreIds.add(storeId)
  checkStatus(store, "store")
  const ownerDomain = stringField(store.owner_domain)
  if (!domainIds.has(ownerDomain)) {
    issues.push(`store ${storeId} has unknown owner_domain ${ownerDomain}`)
  }
  const ownerModule = stringField(store.owner_module)
  requirePath(ownerModule, `store ${storeId} owner_module`)
  const moduleOwnerDomain = moduleOwners.get(ownerModule)
  if (!moduleOwnerDomain) {
    issues.push(`store ${storeId} owner_module is not declared by any domain: ${ownerModule}`)
  } else if (moduleOwnerDomain !== ownerDomain) {
    issues.push(`store ${storeId} owner_module belongs to ${moduleOwnerDomain}, not owner_domain ${ownerDomain}`)
  }
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
  const railId = stringField(rail.id)
  if (declaredRailIds.has(railId)) issues.push(`duplicate rail id ${railId}`)
  declaredRailIds.add(railId)
  checkStatus(rail, "rail")
  requirePath(stringField(rail.contract), `rail ${stringField(rail.id)} contract`)
}

for (const domain of domains) {
  const domainId = stringField(domain.id)
  const declaredOwnedStores = new Set(stringArray(domain.owns_stores))
  const actualOwnedStores = new Set(stores.filter((store) => stringField(store.owner_domain) === domainId).map((store) => stringField(store.id)))
  compareOwnershipSets(`domain ${domainId} owns_stores`, declaredOwnedStores, actualOwnedStores)

  const declaredOwnedJobs = new Set(stringArray(domain.owns_jobs))
  const actualOwnedJobs = new Set(jobs.filter((job) => stringField(job.target_domain) === domainId).map((job) => stringField(job.ticket_no)))
  compareOwnershipSets(`domain ${domainId} owns_jobs`, declaredOwnedJobs, actualOwnedJobs)
}

const railRegistry = readJson("modules/contracts/protocol-fabric/src/schemas/rail-ownership-registry.schema.json")
const schemaRails = arrayOfStrings(asRecord(asRecord(asRecord(railRegistry.items).properties).id).enum)
for (const railId of schemaRails) {
  if (!railIds.has(railId)) {
    issues.push(`architecture manifest is missing rail ${railId}`)
  }
}
for (const railId of railIds) {
  if (!schemaRails.includes(railId)) {
    issues.push(`architecture manifest has rail not in protocol registry ${railId}`)
  }
}

const protocol = readJson("modules/contracts/protocol-fabric/src/schemas/logical-store-ref.schema.json")
const schemaStores = new Set(arrayOfStrings(asRecord(asRecord(protocol.properties).store).enum))
for (const storeId of storeIds) {
  if (!schemaStores.has(storeId)) {
    issues.push(`logical-store-ref schema is missing store ${storeId}`)
  }
}

const moduleMarkers = new Set(["package.json", "go.mod", "Cargo.toml", "requirements.txt"])
for (const markerPath of walkFiles("modules", (name) => moduleMarkers.has(name))) {
  const moduleDir = dirname(markerPath)
  if (!existsSync(join(moduleDir, "CONTRACT.md"))) {
    issues.push(`module marker has no owner contract: ${moduleDir}/CONTRACT.md`)
  }
}
for (const contractPath of walkFiles("modules", (name) => name === "CONTRACT.md")) {
  const moduleDir = dirname(contractPath)
  const sourceDir = join(moduleDir, "src")
  if (!existsSync(sourceDir) || walkFiles(sourceDir, (name) => name.endsWith(".ts")).length === 0) continue
  if (!existsSync(join(moduleDir, "tsconfig.json"))) {
    issues.push(`TypeScript module is missing tsconfig: ${moduleDir}`)
  }
  if (!existsSync(join(moduleDir, "package.json"))) {
    issues.push(`TypeScript module is missing package check entry: ${moduleDir}`)
  }
}

if (issues.length > 0) {
  console.error(`architecture manifest violations:\n${issues.join("\n")}`)
  process.exit(1)
}

function readJson(path: string): JSONRecord {
  return JSON.parse(readFileSync(path, "utf8")) as JSONRecord
}

function walkFiles(dir: string, matches: (name: string) => boolean): string[] {
  const files: string[] = []
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory() && ["node_modules", "target", "data"].includes(entry.name)) continue
    const path = join(dir, entry.name)
    if (entry.isDirectory()) {
      files.push(...walkFiles(path, matches))
    } else if (entry.isFile() && matches(entry.name)) {
      files.push(path)
    }
  }
  return files
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

function expectedJobTickets(count: number): string[] {
  return Array.from({ length: count }, (_, index) => `J${String(index + 1).padStart(2, "0")}`)
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
}

function compareOwnershipSets(label: string, declared: Set<string>, actual: Set<string>): void {
  for (const value of declared) {
    if (!actual.has(value)) issues.push(`${label} declares non-owned value ${value}`)
  }
  for (const value of actual) {
    if (!declared.has(value)) issues.push(`${label} is missing owned value ${value}`)
  }
}
