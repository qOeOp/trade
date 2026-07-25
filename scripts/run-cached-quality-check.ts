#!/usr/bin/env bun

import { lstat, mkdir, readFile, readlink, rename, writeFile } from "node:fs/promises"
import { isAbsolute, join, relative, resolve, sep } from "node:path"

const SCHEMA_VERSION = "trade.local-quality-cache.v1"

interface Options {
  cacheId: string
  root: string
  workdir: string
  inputs: string[]
  command: string[]
}

export async function qualityCacheKey(options: Options): Promise<string> {
  const files = await trackedAndUntrackedInputs(options.root, options.inputs)
  if (files.length === 0) {
    throw new Error("cached quality check resolved no input files")
  }
  const hasher = new Bun.CryptoHasher("sha256")
  hasher.update(`${SCHEMA_VERSION}\0${options.cacheId}\0${options.workdir}\0`)
  hasher.update(`${process.platform}\0${process.arch}\0bun-${Bun.version}\0`)
  hasher.update(`${options.command.join("\0")}\0`)
  for (const file of files) {
    hasher.update(`${file}\0`)
    const absolute = join(options.root, file)
    try {
      const stat = await lstat(absolute)
      if (stat.isSymbolicLink()) {
        hasher.update(`symlink\0${await readlink(absolute)}\0`)
      } else if (stat.isFile()) {
        hasher.update(`file\0${stat.mode & 0o777}\0`)
        hasher.update(await readFile(absolute))
        hasher.update("\0")
      } else {
        hasher.update(`unsupported\0${stat.mode}\0`)
      }
    } catch (error) {
      if (isMissing(error)) {
        hasher.update("missing\0")
      } else {
        throw error
      }
    }
  }
  return hasher.digest("hex")
}

export function cacheReuseAllowed(env: NodeJS.ProcessEnv): boolean {
  return !env.CI && env.QUALITY_FRESH !== "1"
}

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2))
  const key = await qualityCacheKey(options)
  const cacheDir = join(options.root, "tmp", "check", "quality-cache", options.cacheId)
  const receiptPath = join(cacheDir, `${key}.json`)
  const reusable = cacheReuseAllowed(process.env)

  if (reusable && await validReceipt(receiptPath, options.cacheId, key)) {
    process.stdout.write(`quality: ${options.cacheId} cache hit ${key.slice(0, 12)}\n`)
    return
  }

  process.stdout.write(`quality: ${options.cacheId} cache ${reusable ? "miss" : "bypass"} ${key.slice(0, 12)}\n`)
  const child = Bun.spawn(options.command, {
    cwd: resolve(options.root, options.workdir),
    env: process.env,
    stdin: "inherit",
    stdout: "inherit",
    stderr: "inherit",
  })
  const exitCode = await child.exited
  if (exitCode !== 0) process.exit(exitCode)

  if (!reusable) return
  await mkdir(cacheDir, { recursive: true })
  const temporary = `${receiptPath}.tmp-${process.pid}`
  await writeFile(temporary, `${JSON.stringify({
    schema_version: SCHEMA_VERSION,
    cache_id: options.cacheId,
    input_hash: key,
    status: "passed",
  })}\n`, { flag: "wx" })
  await rename(temporary, receiptPath)
}

function parseArgs(args: string[]): Options {
  let cacheId = ""
  let root = resolve(import.meta.dir, "..")
  let workdir = "."
  const inputs: string[] = []
  let index = 0
  for (; index < args.length; index += 1) {
    const arg = args[index]
    if (arg === "--") {
      index += 1
      break
    }
    if (arg === "--cache-id") {
      cacheId = requiredValue(args, ++index, arg)
    } else if (arg === "--root") {
      root = resolve(requiredValue(args, ++index, arg))
    } else if (arg === "--workdir") {
      workdir = requiredValue(args, ++index, arg)
    } else if (arg === "--input") {
      inputs.push(requiredValue(args, ++index, arg))
    } else {
      throw new Error(`unknown argument: ${arg}`)
    }
  }
  const command = args.slice(index)
  if (!/^[a-z0-9-]+$/.test(cacheId)) throw new Error("cache id must use lowercase ASCII and hyphens")
  if (inputs.length === 0) throw new Error("at least one cache input is required")
  if (command.length === 0) throw new Error("cached quality command is required after --")
  assertRepositoryRelative(workdir, "workdir")
  for (const input of inputs) assertRepositoryRelative(input, "input")
  return { cacheId, root, workdir, inputs, command }
}

async function trackedAndUntrackedInputs(root: string, inputs: string[]): Promise<string[]> {
  const result = Bun.spawnSync([
    "git", "-C", root, "ls-files", "--cached", "--others", "--exclude-standard", "--", ...inputs,
  ], { stdout: "pipe", stderr: "pipe" })
  if (result.exitCode !== 0) {
    throw new Error(`git input enumeration failed: ${result.stderr.toString().trim()}`)
  }
  return [...new Set(result.stdout.toString().split("\n").filter(Boolean))].sort()
}

async function validReceipt(path: string, cacheId: string, key: string): Promise<boolean> {
  try {
    const value = JSON.parse(await readFile(path, "utf8")) as Record<string, unknown>
    return value.schema_version === SCHEMA_VERSION
      && value.cache_id === cacheId
      && value.input_hash === key
      && value.status === "passed"
  } catch {
    return false
  }
}

function assertRepositoryRelative(value: string, field: string): void {
  if (!value || isAbsolute(value) || value.split(/[\\/]/).includes("..")) {
    throw new Error(`${field} must be a repository-relative path`)
  }
  const normalized = relative(".", value)
  if (normalized === ".." || normalized.startsWith(`..${sep}`)) {
    throw new Error(`${field} escapes the repository`)
  }
}

function requiredValue(args: string[], index: number, flag: string): string {
  const value = args[index]
  if (!value) throw new Error(`${flag} requires a value`)
  return value
}

function isMissing(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT"
}

if (import.meta.main) {
  main().catch((error) => {
    process.stderr.write(`quality: ${error instanceof Error ? error.message : String(error)}\n`)
    process.exit(1)
  })
}
