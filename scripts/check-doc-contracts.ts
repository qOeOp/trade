#!/usr/bin/env bun

import { existsSync, readFileSync, readdirSync } from "node:fs"
import { dirname, join, normalize, resolve } from "node:path"

interface DocumentEntry {
  id: string
  path: string
  role: string
  status: string
  owner: string
  implementation_refs?: string[]
}

interface ContractIndex {
  schema_version: string
  documents: DocumentEntry[]
}

interface ArchitectureManifest {
  domains: Array<{ id: string }>
}

const root = process.cwd()
const issues: string[] = []
const requiredMetadata = ["title", "role", "status", "owner", "last_verified"]
const allowedCurrentStatuses = new Set([
  "active",
  "active-partial",
  "active-migration",
  "proposed",
  "source-material",
  "implemented",
  "audit-log",
])
const allowedRoleStatuses = new Map<string, Set<string>>([
  ["documentation-index", new Set(["active"])],
  ["history-index", new Set(["active"])],
  ["product-contract", new Set(["active"])],
  ["product-source-material", new Set(["source-material"])],
  ["architecture-contract", new Set(["active"])],
  ["architecture-feature-contract", new Set(["active"])],
  ["architecture-decision", new Set(["active"])],
  ["architecture-migration", new Set(["active-migration", "proposed"])],
  ["technical-contract-index", new Set(["active"])],
  ["runtime-feature-contract", new Set(["active", "active-partial"])],
  ["research-architecture-migration", new Set(["active-migration"])],
  ["research-feature-contract", new Set(["active", "active-partial"])],
  ["research-audit-log", new Set(["audit-log"])],
  ["research-roadmap", new Set(["active"])],
  ["research-operations-runbook", new Set(["active"])],
  ["research-source-material", new Set(["source-material"])],
  ["research-migration", new Set(["proposed"])],
  ["research-implementation-record", new Set(["implemented"])],
  ["engineering-contract", new Set(["active"])],
])
const currentRoots = ["docs/product", "docs/architecture", "docs/runtime", "docs/research", "docs/engineering"]
const indexPath = "docs/engineering/doc-contract-index.json"
const index = JSON.parse(readFileSync(indexPath, "utf8")) as ContractIndex
const architectureManifest = JSON.parse(
  readFileSync("docs/architecture/architecture-manifest.json", "utf8"),
) as ArchitectureManifest
const architectureDomainIds = new Set(architectureManifest.domains.map((domain) => domain.id))
const documentationOwners = new Set(["product", "architecture", "engineering"])
const retiredCurrentPaths = [
  "docs/architecture/architecture-overview.mmd",
  "docs/architecture/assets",
  "docs/architecture/audits",
  "docs/architecture/migrations/nofx-design-absorption.md",
]

if (index.schema_version !== "trade.doc-contract-index.v1") {
  issues.push(`unsupported doc contract index schema: ${index.schema_version}`)
}

for (const path of retiredCurrentPaths) {
  if (existsSync(path)) issues.push(`historical path must not return to the current contract tree: ${path}`)
}

const implementedGuards = identifiers("modules/contracts/preflight-contract/src/preflight.ts", /G-[A-Z0-9-]+/g)
const documentedGuards = identifiers("docs/runtime/risk-control-contract.md", /G-[A-Z0-9-]+/g)
for (const guard of implementedGuards) {
  if (!documentedGuards.has(guard)) issues.push(`risk contract is missing implemented guard: ${guard}`)
}
for (const guard of documentedGuards) {
  if (!implementedGuards.has(guard)) issues.push(`risk contract claims non-implemented guard: ${guard}`)
}

const currentDocuments = ["docs/README.md", "docs/history/README.md", ...currentRoots.flatMap(walkMarkdown)]
  .filter((path) => !path.startsWith("docs/architecture/generated/"))
  .sort()
const currentDocumentPaths = new Set(currentDocuments)
const indexedPaths = new Set<string>()
const indexedIds = new Set<string>()

for (const entry of index.documents) {
  if (indexedIds.has(entry.id)) issues.push(`duplicate document id: ${entry.id}`)
  if (indexedPaths.has(entry.path)) issues.push(`duplicate document path: ${entry.path}`)
  if (!currentDocumentPaths.has(entry.path)) {
    issues.push(`indexed path is outside the current document scope: ${entry.path}`)
  }
  if (!allowedCurrentStatuses.has(entry.status)) {
    issues.push(`${entry.path} has unsupported current document status: ${entry.status}`)
  }
  const roleStatuses = allowedRoleStatuses.get(entry.role)
  if (!roleStatuses) {
    issues.push(`${entry.path} has unsupported current document role: ${entry.role}`)
  } else if (!roleStatuses.has(entry.status)) {
    issues.push(`${entry.path} role ${entry.role} does not allow status: ${entry.status}`)
  }
  if (!ownerResolves(entry.owner)) {
    issues.push(`${entry.path} has unresolved current document owner: ${entry.owner}`)
  }
  indexedIds.add(entry.id)
  indexedPaths.add(entry.path)

  if (!existsSync(entry.path)) {
    issues.push(`indexed document does not exist: ${entry.path}`)
    continue
  }
  const metadata = frontmatter(entry.path)
  for (const field of ["role", "status", "owner"] as const) {
    if (metadata[field] !== entry[field]) {
      issues.push(`${entry.path} ${field} differs from index: ${metadata[field] ?? "<missing>"} != ${entry[field]}`)
    }
  }
  for (const ref of entry.implementation_refs ?? []) {
    if (!existsSync(ref)) issues.push(`${entry.path} implementation_ref does not exist: ${ref}`)
  }
}

for (const path of currentDocuments) {
  const metadata = frontmatter(path)
  for (const field of requiredMetadata) {
    if (!metadata[field]) issues.push(`${path} missing frontmatter field: ${field}`)
  }
  checkTitleStructure(path, metadata.title, "current")
  checkLastVerified(path, metadata.last_verified)
  if (!indexedPaths.has(path)) issues.push(`current document is missing from ${indexPath}: ${path}`)
}

for (const path of walkMarkdown("docs/history").filter((path) => path !== "docs/history/README.md")) {
  const metadata = frontmatter(path)
  for (const field of requiredMetadata) {
    if (!metadata[field]) issues.push(`${path} missing frontmatter field: ${field}`)
  }
  checkTitleStructure(path, metadata.title, "historical")
  checkLastVerified(path, metadata.last_verified)
  if (!["completed-historical", "legacy-reference"].includes(metadata.status ?? "")) {
    issues.push(`${path} must use completed-historical or legacy-reference status`)
  }
}

for (const path of repositoryMarkdown()) checkLinks(path)

if (issues.length > 0) {
  console.error(`doc contract violations:\n${issues.join("\n")}`)
  process.exit(1)
}

console.log(`doc contracts ok: ${currentDocuments.length} current, ${walkMarkdown("docs/history").length - 1} historical`)

function frontmatter(path: string): Record<string, string> {
  const source = readFileSync(path, "utf8")
  if (!source.startsWith("---\n")) return {}
  const end = source.indexOf("\n---\n", 4)
  if (end < 0) return {}
  const result: Record<string, string> = {}
  for (const line of source.slice(4, end).split("\n")) {
    const match = line.match(/^([a-z][a-z0-9_-]*):\s*(.+?)\s*$/)
    if (match) result[match[1]] = match[2].replace(/^['"]|['"]$/g, "")
  }
  return result
}

function walkMarkdown(path: string): string[] {
  if (!existsSync(path)) return []
  const files: string[] = []
  for (const entry of readdirSync(path, { withFileTypes: true })) {
    const child = join(path, entry.name)
    if (entry.isDirectory()) files.push(...walkMarkdown(child))
    else if (entry.isFile() && child.endsWith(".md")) files.push(child)
  }
  return files
}

function repositoryMarkdown(): string[] {
  const files = ["README.md", "AGENTS.md"]
  for (const path of ["docs", "modules", "strategies"]) files.push(...walkMarkdown(path))
  return files.filter(existsSync)
}

function identifiers(path: string, pattern: RegExp): Set<string> {
  return new Set(readFileSync(path, "utf8").match(pattern) ?? [])
}

function checkLinks(path: string): void {
  const source = readFileSync(path, "utf8")
  const links = source.matchAll(/\[[^\]]*\]\(([^)]+)\)/g)
  for (const match of links) {
    const raw = match[1].trim().replace(/^<|>$/g, "")
    if (!raw || raw.startsWith("#") || /^(?:https?:|mailto:|app:)/.test(raw)) continue
    const target = decodePath(raw.split("#", 1)[0])
    if (!target) continue
    const resolved = normalize(resolve(root, dirname(path), target))
    if (!existsSync(resolved)) issues.push(`${path} has broken link: ${raw}`)
  }
}

function decodePath(value: string): string {
  try {
    return decodeURIComponent(value)
  } catch {
    return value
  }
}

function ownerResolves(owner: string): boolean {
  if (documentationOwners.has(owner) || architectureDomainIds.has(owner)) return true
  return [...architectureDomainIds].some((domainId) => existsSync(join("modules", domainId, owner)))
}

function checkLastVerified(path: string, value: string | undefined): void {
  if (!value) return
  const match = /^(\d{4})-(\d{2})-(\d{2}) CST$/.exec(value)
  if (match) {
    const year = Number(match[1])
    const month = Number(match[2])
    const day = Number(match[3])
    const date = new Date(Date.UTC(year, month - 1, day))
    if (date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day) return
  }
  issues.push(`${path} has invalid last_verified: ${value} (expected YYYY-MM-DD CST)`)
}

function checkTitleStructure(path: string, title: string | undefined, lifecycle: "current" | "historical"): void {
  if (!title) return
  const headingCount = [...readFileSync(path, "utf8").matchAll(/^#\s+\S.*$/gm)].length
  if (lifecycle === "current" && headingCount !== 1) {
    issues.push(`${path} must contain exactly one top-level heading; found ${headingCount}`)
  } else if (lifecycle === "historical" && headingCount === 0) {
    issues.push(`${path} must contain at least one top-level heading`)
  }
}
