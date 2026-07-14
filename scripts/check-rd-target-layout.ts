#!/usr/bin/env bun

import { existsSync, lstatSync, readFileSync, readdirSync } from "node:fs"
import { join } from "node:path"

interface Disposition {
  schema_version: string
  root_policy: string
  target_roots: string[]
  relocations: Array<{ legacy_module: string; current_path: string; semantic_status: string; retirement: string }>
}

const root = "modules/research-strategy-development"
const disposition = JSON.parse(readFileSync("docs/rd-module-disposition.json", "utf8")) as Disposition
const issues: string[] = []

if (disposition.schema_version !== "trade.rd-module-disposition.v2") issues.push("unsupported disposition schema")
if (disposition.root_policy !== "exactly-four-direct-children") issues.push("RD root policy must require exactly four children")
const targetRoots = new Set(disposition.target_roots)
for (const required of ["research-control-plane", "replay-execution-plane", "forward-evidence-plane", "agent-roles"]) {
  if (!targetRoots.has(required) || !existsSync(join(root, required))) issues.push(`missing target root: ${required}`)
}

const immediateNodes = readdirSync(root, { withFileTypes: true }).map((entry) => entry.name)
for (const node of immediateNodes) {
  if (!targetRoots.has(node)) issues.push(`RD root contains non-target child: ${node}`)
}
if (immediateNodes.length !== targetRoots.size) issues.push(`RD root child count must be ${targetRoots.size}, got ${immediateNodes.length}`)

const legacyNames = new Set<string>()
const currentPaths = new Set<string>()
for (const item of disposition.relocations) {
  if (legacyNames.has(item.legacy_module)) issues.push(`duplicate legacy module: ${item.legacy_module}`)
  if (currentPaths.has(item.current_path)) issues.push(`duplicate current path: ${item.current_path}`)
  legacyNames.add(item.legacy_module)
  currentPaths.add(item.current_path)
  const current = join(root, item.current_path)
  if (!existsSync(current) && !isSymlink(current)) issues.push(`relocation target does not exist: ${item.current_path}`)
  if (!item.semantic_status || !item.retirement) issues.push(`incomplete relocation: ${item.legacy_module}`)
}

for (const file of walkTypeScript(root)) {
  const source = readFileSync(file, "utf8")
  if (source.includes("research/research-state-store/src")) issues.push(`canonical State Store import still uses migration path: ${file}`)
}

if (issues.length > 0) {
  console.error(`RD target layout violations:\n${issues.join("\n")}`)
  process.exit(1)
}

function isSymlink(path: string): boolean {
  try { return lstatSync(path).isSymbolicLink() } catch { return false }
}

function walkTypeScript(dir: string): string[] {
  const files: string[] = []
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === "data" || entry.isSymbolicLink()) continue
    const path = join(dir, entry.name)
    if (entry.isDirectory()) files.push(...walkTypeScript(path))
    else if (entry.isFile() && path.endsWith(".ts")) files.push(path)
  }
  return files
}
