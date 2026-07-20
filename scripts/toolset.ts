#!/usr/bin/env bun

import { existsSync, readFileSync } from "node:fs"
import { join } from "node:path"

type JSONRecord = Record<string, unknown>

interface ToolEntry {
  id: string
  domain: string
  module_type: string
  owner_scope: string
  intent: string[]
  capability_class: string[]
  path: string
  purpose: string
  command: {
    cwd: string
    argv: string[]
  }
  writes: Record<string, boolean>
  entry_contract: {
    kind: string
    input_schema: string
    output_schema: string
  }
  requires_preflight: boolean
  concurrency_group: string
  forbidden_callers: string[]
  notes?: string[]
}

interface ToolManifest {
  schema_version: string
  description: string
  tools: ToolEntry[]
}

const MANIFEST_PATH = "toolset.json"
const VALID_CAPABILITIES = new Set(["R", "A", "E", "V", "T", "C"])
const VALID_WRITES = ["trade_db", "catalog", "artifacts", "binance", "config"]
const VALID_MODULE_TYPES = new Set(["suite", "atomic", "contract"])
const VALID_ENTRY_CONTRACT_KINDS = new Set(["cli-json", "mcp-stdio"])

function main(argv: string[]): void {
  const args = parseArgs(argv)
  const manifest = readManifest()
  const issues = validateManifest(manifest)
  if (args.validate) {
    if (issues.length > 0) {
      console.error(`toolset: invalid manifest\n${issues.join("\n")}`)
      process.exit(1)
    }
    console.log(JSON.stringify({ ok: true, tool_count: manifest.tools.length }, null, 2))
    return
  }
  if (issues.length > 0) {
    throw new Error(`manifest is invalid; run scripts/toolset.ts --validate`)
  }

  const tools = filterTools(manifest.tools, args)
  if (args.json) {
    console.log(JSON.stringify({ schema_version: manifest.schema_version, tools }, null, 2))
    return
  }
  printList(tools)
}

function parseArgs(argv: string[]): { validate: boolean; json: boolean; intent: string; capability: string; domain: string } {
  const args = {
    validate: false,
    json: false,
    intent: "",
    capability: "",
    domain: "",
  }
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]
    if (arg === "--validate") {
      args.validate = true
    } else if (arg === "--json") {
      args.json = true
    } else if (arg === "--intent") {
      args.intent = readValue(argv, ++index, arg)
    } else if (arg === "--capability") {
      args.capability = readValue(argv, ++index, arg)
    } else if (arg === "--domain") {
      args.domain = readValue(argv, ++index, arg)
    } else if (arg === "--help" || arg === "-h") {
      printHelp()
      process.exit(0)
    } else {
      throw new Error(`unknown flag: ${arg}`)
    }
  }
  return args
}

function readValue(argv: string[], index: number, name: string): string {
  const value = argv[index]
  if (!value || value.startsWith("--")) {
    throw new Error(`${name} requires a value`)
  }
  return value
}

function readManifest(): ToolManifest {
  return JSON.parse(readFileSync(MANIFEST_PATH, "utf8")) as ToolManifest
}

function validateManifest(manifest: ToolManifest): string[] {
  const issues: string[] = []
  if (manifest.schema_version !== "trade-toolset.manifest.v1") {
    issues.push(`schema_version must be trade-toolset.manifest.v1`)
  }
  if (!Array.isArray(manifest.tools) || manifest.tools.length === 0) {
    issues.push(`tools must be a non-empty array`)
    return issues
  }

  const ids = new Set<string>()
  for (const [index, tool] of manifest.tools.entries()) {
    const prefix = `tools[${index}]`
    validateString(tool.id, `${prefix}.id`, issues)
    validateString(tool.domain, `${prefix}.domain`, issues)
    validateModuleType(tool, prefix, issues)
    validateString(tool.owner_scope, `${prefix}.owner_scope`, issues)
    validateString(tool.path, `${prefix}.path`, issues)
    validateString(tool.purpose, `${prefix}.purpose`, issues)
    if (tool.id) {
      if (ids.has(tool.id)) {
        issues.push(`${prefix}.id duplicate: ${tool.id}`)
      }
      ids.add(tool.id)
    }
    if (!existsSync(tool.path)) {
      issues.push(`${prefix}.path does not exist: ${tool.path}`)
    }
    if (!Array.isArray(tool.intent) || tool.intent.length === 0) {
      issues.push(`${prefix}.intent must be a non-empty array`)
    }
    if (!Array.isArray(tool.capability_class) || tool.capability_class.length === 0) {
      issues.push(`${prefix}.capability_class must be a non-empty array`)
    } else {
      for (const capability of tool.capability_class) {
        if (!VALID_CAPABILITIES.has(capability)) {
          issues.push(`${prefix}.capability_class has invalid value: ${capability}`)
        }
      }
    }
    validateCommand(tool, prefix, issues)
    validateWrites(tool, prefix, issues)
    validateEntryContract(tool, prefix, issues)
    validateBoolean(tool.requires_preflight, `${prefix}.requires_preflight`, issues)
    validateString(tool.concurrency_group, `${prefix}.concurrency_group`, issues)
    validateStringArray(tool.forbidden_callers, `${prefix}.forbidden_callers`, issues)
  }
  return issues
}

function validateModuleType(tool: ToolEntry, prefix: string, issues: string[]): void {
  validateString(tool.module_type, `${prefix}.module_type`, issues)
  if (tool.module_type && !VALID_MODULE_TYPES.has(tool.module_type)) {
    issues.push(`${prefix}.module_type has invalid value: ${tool.module_type}`)
  }
}

function validateCommand(tool: ToolEntry, prefix: string, issues: string[]): void {
  if (!tool.command || typeof tool.command !== "object") {
    issues.push(`${prefix}.command is required`)
    return
  }
  validateString(tool.command.cwd, `${prefix}.command.cwd`, issues)
  if (tool.command.cwd && !existsSync(tool.command.cwd)) {
    issues.push(`${prefix}.command.cwd does not exist: ${tool.command.cwd}`)
  }
  if (!Array.isArray(tool.command.argv) || tool.command.argv.length === 0) {
    issues.push(`${prefix}.command.argv must be a non-empty array`)
  }
  if (tool.command.cwd && isLocalScriptArg(tool.command.argv?.[1])) {
    const scriptPath = join(tool.command.cwd, tool.command.argv[1])
    if (!existsSync(scriptPath)) {
      issues.push(`${prefix}.command script does not exist: ${scriptPath}`)
    }
  }
}

function isLocalScriptArg(value: unknown): value is string {
  return typeof value === "string" && (value.startsWith("scripts/") || value.startsWith("src/scripts/"))
}

function validateWrites(tool: ToolEntry, prefix: string, issues: string[]): void {
  if (!tool.writes || typeof tool.writes !== "object" || Array.isArray(tool.writes)) {
    issues.push(`${prefix}.writes is required`)
    return
  }
  for (const key of VALID_WRITES) {
    if (typeof tool.writes[key] !== "boolean") {
      issues.push(`${prefix}.writes.${key} must be boolean`)
    }
  }
  if (tool.capability_class.includes("T") && tool.writes.binance !== true) {
    issues.push(`${prefix} has T capability but writes.binance is not true`)
  }
  if (!tool.capability_class.includes("T") && tool.writes.binance === true) {
    issues.push(`${prefix} writes Binance but is not class T`)
  }
}

function validateEntryContract(tool: ToolEntry, prefix: string, issues: string[]): void {
  if (!tool.entry_contract || typeof tool.entry_contract !== "object" || Array.isArray(tool.entry_contract)) {
    issues.push(`${prefix}.entry_contract is required`)
    return
  }
  validateString(tool.entry_contract.kind, `${prefix}.entry_contract.kind`, issues)
  if (tool.entry_contract.kind && !VALID_ENTRY_CONTRACT_KINDS.has(tool.entry_contract.kind)) {
    issues.push(`${prefix}.entry_contract.kind has invalid value: ${tool.entry_contract.kind}`)
  }
  validateOptionalSchemaPath(tool.entry_contract.input_schema, `${prefix}.entry_contract.input_schema`, issues)
  validateOptionalSchemaPath(tool.entry_contract.output_schema, `${prefix}.entry_contract.output_schema`, issues)
}

function validateOptionalSchemaPath(value: unknown, field: string, issues: string[]): void {
  if (typeof value !== "string") {
    issues.push(`${field} must be a string`)
    return
  }
  if (value !== "" && !existsSync(value)) {
    issues.push(`${field} does not exist: ${value}`)
  }
}

function validateBoolean(value: unknown, field: string, issues: string[]): void {
  if (typeof value !== "boolean") {
    issues.push(`${field} must be boolean`)
  }
}

function validateStringArray(value: unknown, field: string, issues: string[]): void {
  if (!Array.isArray(value)) {
    issues.push(`${field} must be an array`)
    return
  }
  for (const [index, item] of value.entries()) {
    if (typeof item !== "string" || item.trim() === "") {
      issues.push(`${field}[${index}] must be a non-empty string`)
    }
  }
}

function validateString(value: unknown, field: string, issues: string[]): void {
  if (typeof value !== "string" || value.trim() === "") {
    issues.push(`${field} must be a non-empty string`)
  }
}

function filterTools(
  tools: ToolEntry[],
  args: { intent: string; capability: string; domain: string },
): ToolEntry[] {
  return tools.filter((tool) => {
    if (args.intent && !tool.intent.some((intent) => intent.includes(args.intent))) {
      return false
    }
    if (args.capability && !tool.capability_class.includes(args.capability)) {
      return false
    }
    if (args.domain && tool.domain !== args.domain) {
      return false
    }
    return true
  })
}

function printList(tools: ToolEntry[]): void {
  for (const tool of tools) {
    const writes = Object.entries(tool.writes)
      .filter(([, value]) => value)
      .map(([key]) => key)
      .join(",") || "none"
    console.log(`${tool.id} [${tool.capability_class.join("/")}] ${tool.domain}`)
    console.log(`  ${tool.purpose}`)
    console.log(`  path=${tool.path}`)
    console.log(`  module_type=${tool.module_type} owner_scope=${tool.owner_scope}`)
    console.log(`  command=(cd ${tool.command.cwd} && ${tool.command.argv.join(" ")})`)
    console.log(`  writes=${writes} concurrency_group=${tool.concurrency_group}`)
  }
}

function printHelp(): void {
  console.log(`Usage:
  bun scripts/toolset.ts --validate
  bun scripts/toolset.ts --json
  bun scripts/toolset.ts --intent rd
  bun scripts/toolset.ts --capability T
  bun scripts/toolset.ts --domain exchange-read
`)
}

try {
  main(process.argv.slice(2))
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error))
  process.exit(1)
}
