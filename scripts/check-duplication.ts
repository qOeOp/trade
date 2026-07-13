#!/usr/bin/env bun

import { existsSync, readFileSync, rmSync } from "node:fs"
import { join } from "node:path"

type JSONRecord = Record<string, unknown>

const MAX_DUPLICATES = 30
const OUTPUT_DIR = "tmp/check/duplication"
const REPORT_PATH = join(OUTPUT_DIR, "jscpd-report.json")

const args = [
  "jscpd",
  "--min-lines",
  "20",
  "--min-tokens",
  "140",
  "--reporters",
  "json",
  "--output",
  OUTPUT_DIR,
  "--format",
  "typescript,javascript,go",
  "--ignore",
  "**/node_modules/**,**/dist/**,**/docs/**,**/data/**,**/tmp/**,**/*.test.ts",
  "modules",
  "scripts",
]

rmSync(OUTPUT_DIR, { recursive: true, force: true })
const result = Bun.spawnSync(["bunx", ...args], {
  stdout: "pipe",
  stderr: "pipe",
})
const stderr = new TextDecoder().decode(result.stderr).trim()
if (!result.success) {
  if (stderr) console.error(stderr)
  throw new Error(`jscpd failed with exit=${result.exitCode}`)
}
if (!existsSync(REPORT_PATH)) {
  throw new Error(`jscpd report missing: ${REPORT_PATH}`)
}

const report = JSON.parse(readFileSync(REPORT_PATH, "utf8")) as JSONRecord
const duplicates = Array.isArray(report.duplicates) ? report.duplicates : []
if (duplicates.length > MAX_DUPLICATES) {
  console.error(`quality: duplicated code fragments increased: ${duplicates.length} > ${MAX_DUPLICATES}`)
  for (const duplicate of duplicates.slice(0, 10).map(asRecord)) {
    const first = asRecord(duplicate.firstFile)
    const second = asRecord(duplicate.secondFile)
    console.error(` - ${duplicate.lines} lines: ${first.name}:${first.start}-${first.end} <> ${second.name}:${second.start}-${second.end}`)
  }
  process.exit(1)
}

console.log(`quality: duplicated code fragments ${duplicates.length}/${MAX_DUPLICATES}`)

function asRecord(value: unknown): JSONRecord {
  return value && typeof value === "object" && !Array.isArray(value) ? value as JSONRecord : {}
}
