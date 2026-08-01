#!/usr/bin/env bun

import { createHash } from "node:crypto"
import { execFileSync } from "node:child_process"
import { existsSync, lstatSync, mkdirSync, readFileSync, readlinkSync, writeFileSync } from "node:fs"
import { dirname, resolve } from "node:path"

export interface WorkspaceSnapshot {
  schema_version: "trade.workspace-snapshot.v1"
  files: Record<string, string>
}

export function diffWorkspaceSnapshots(before: WorkspaceSnapshot, after: WorkspaceSnapshot): string[] {
  const paths = new Set([...Object.keys(before.files), ...Object.keys(after.files)])
  return [...paths].filter((path) => before.files[path] !== after.files[path]).sort()
}

function capture(root: string): WorkspaceSnapshot {
  const tracked = gitPaths(root, ["ls-files", "-z"])
  const untracked = gitPaths(root, ["ls-files", "--others", "--exclude-standard", "-z"])
  const files: Record<string, string> = {}
  for (const path of [...new Set([...tracked, ...untracked])].sort()) {
    const absolute = resolve(root, path)
    files[path] = existsSync(absolute) ? pathHash(absolute) : "<missing>"
  }
  return { schema_version: "trade.workspace-snapshot.v1", files }
}

function gitPaths(root: string, args: string[]): string[] {
  return execFileSync("git", args, { cwd: root, encoding: "utf8" }).split("\0").filter(Boolean)
}

function pathHash(path: string): string {
  const stat = lstatSync(path)
  if (stat.isSymbolicLink()) return `symlink:${readlinkSync(path)}`
  if (stat.isDirectory()) return "<directory>"
  if (!stat.isFile()) return `<non-file:${stat.mode}>`
  const hash = createHash("sha256")
  hash.update(readFileSync(path))
  return hash.digest("hex")
}

function main(): void {
  const action = flag("--action")
  const snapshotPath = resolve(flag("--snapshot"))
  const root = resolve(process.cwd())
  if (!snapshotPath.startsWith(resolve(root, "tmp") + "/")) throw new Error("workspace snapshot must stay under tmp/")
  if (action === "capture") {
    if (process.argv.includes("--require-clean")) {
      const status = execFileSync("git", ["status", "--porcelain", "--untracked-files=normal"], { cwd: root, encoding: "utf8" }).trim()
      if (status) throw new Error(`CI quality requires a clean checkout before checks:\n${status}`)
    }
    const snapshot = capture(root)
    mkdirSync(dirname(snapshotPath), { recursive: true })
    writeFileSync(snapshotPath, `${JSON.stringify(snapshot)}\n`)
    console.log(`workspace snapshot captured: ${Object.keys(snapshot.files).length} files`)
    return
  }
  if (action === "check") {
    const before = JSON.parse(readFileSync(snapshotPath, "utf8")) as WorkspaceSnapshot
    const changed = diffWorkspaceSnapshots(before, capture(root))
    if (changed.length > 0) {
      console.error(`quality check changed tracked or unignored workspace files:\n${changed.join("\n")}`)
      process.exit(1)
    }
    console.log("workspace side-effect check ok")
    return
  }
  throw new Error("--action must be capture or check")
}

function flag(name: string): string {
  const index = process.argv.indexOf(name)
  const value = index >= 0 ? process.argv[index + 1] : ""
  if (!value || value.startsWith("--")) throw new Error(`${name} requires a value`)
  return value
}

if (import.meta.main) {
  try {
    main()
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error))
    process.exit(1)
  }
}
