import { existsSync, mkdirSync, readFileSync, rmdirSync, unlinkSync, writeFileSync } from "node:fs"
import { dirname, join, relative } from "node:path"

interface PackageContract {
  check: string
  directory: string
  manifestPath: string
  name: string
}

const rootResult = Bun.spawnSync({
  cmd: ["git", "rev-parse", "--show-toplevel"],
  stdout: "pipe",
  stderr: "pipe",
})
if (rootResult.exitCode !== 0) {
  throw new Error(`unable to resolve repository root: ${rootResult.stderr.toString()}`)
}
const root = rootResult.stdout.toString().trim()
const contracts = discoverContracts(root)
const [mode, target, extra] = process.argv.slice(2)

if (extra || (mode && !["--run-all", "--run-package", "--run-shard"].includes(mode))) {
  throw new Error(`usage: repository-package-checks [--run-all|--run-package <name>|--run-shard <index>/<count>]`)
}

const selected = mode === "--run-all"
  ? contracts
  : mode === "--run-package"
    ? selectPackage(contracts, target)
    : mode === "--run-shard"
      ? selectShard(contracts, target)
      : []

const releaseRunAllLock = mode === "--run-all" ? acquireRunAllLock(root) : () => {}
try {
  for (const contract of selected) runContract(contract)
} finally {
  releaseRunAllLock()
}

console.log(mode
  ? `workspace contracts: executed ${selected.length} of ${contracts.length} package checks`
  : `workspace contracts: ${contracts.length} packages expose check`)

function discoverContracts(cwd: string): PackageContract[] {
  const listed = Bun.spawnSync({
    cmd: ["git", "ls-files", "--cached", "--others", "--exclude-standard", "-z", "**/package.json"],
    cwd,
    stdout: "pipe",
    stderr: "pipe",
  })
  if (listed.exitCode !== 0) {
    throw new Error(`unable to discover repository-visible package contracts: ${listed.stderr.toString().trim()}`)
  }

  const contracts = listed.stdout.toString().split("\0")
    .filter((path) => path && path !== "package.json" && existsSync(`${cwd}/${path}`))
    .map((manifestPath) => readContract(cwd, manifestPath))
    .sort((left, right) => left.name.localeCompare(right.name))

  const names = new Set<string>()
  for (const contract of contracts) {
    if (names.has(contract.name)) throw new Error(`duplicate package contract name: ${contract.name}`)
    names.add(contract.name)
  }
  return contracts
}

function readContract(cwd: string, manifestPath: string): PackageContract {
  const value = JSON.parse(readFileSync(`${cwd}/${manifestPath}`, "utf8")) as {
    name?: unknown
    scripts?: { check?: unknown }
  }
  if (typeof value.name !== "string" || value.name.trim() === "") {
    throw new Error(`${manifestPath}: package contract requires a non-empty name`)
  }
  if (typeof value.scripts?.check !== "string" || value.scripts.check.trim() === "") {
    throw new Error(`${manifestPath}: package contract ${value.name} requires scripts.check`)
  }
  return {
    check: value.scripts.check,
    directory: dirname(manifestPath),
    manifestPath,
    name: value.name,
  }
}

function selectPackage(contracts: PackageContract[], name: string | undefined): PackageContract[] {
  if (!name) throw new Error("--run-package requires a package name")
  const selected = contracts.filter((contract) => contract.name === name)
  if (selected.length !== 1) throw new Error(`unknown package contract: ${name}`)
  return selected
}

function selectShard(contracts: PackageContract[], value: string | undefined): PackageContract[] {
  const match = /^(\d+)\/(\d+)$/.exec(value ?? "")
  if (!match) throw new Error("--run-shard requires <zero-based-index>/<count>")
  const index = Number(match[1])
  const count = Number(match[2])
  if (!Number.isInteger(index) || !Number.isInteger(count) || count < 1 || index < 0 || index >= count) {
    throw new Error("--run-shard requires 0 <= index < count")
  }
  return contracts.filter((_, contractIndex) => contractIndex % count === index)
}

function runContract(contract: PackageContract): void {
  console.log(`package contract: ${contract.name}`)
  const result = Bun.spawnSync({
    cmd: ["bun", "run", "check"],
    cwd: `${root}/${contract.directory}`,
    env: process.env,
    stdin: "inherit",
    stdout: "inherit",
    stderr: "inherit",
  })
  if (result.exitCode !== 0) {
    throw new Error(`package contract failed: ${contract.name} (${relative(root, `${root}/${contract.manifestPath}`)})`)
  }
}

function acquireRunAllLock(cwd: string): () => void {
  const lockDir = join(cwd, "tmp/check/repository-package-checks.lock")
  const ownerPath = join(lockDir, "owner-pid")
  mkdirSync(dirname(lockDir), { recursive: true })

  try {
    mkdirSync(lockDir)
  } catch (error) {
    if (errorCode(error) !== "EEXIST") throw error
    const owner = readOwnerPid(ownerPath)
    if (owner !== null && processIsRunning(owner)) {
      throw new Error(`repository package check is already active (pid ${owner})`, { cause: error })
    }
    if (existsSync(ownerPath)) unlinkSync(ownerPath)
    try {
      rmdirSync(lockDir)
    } catch (error) {
      throw new Error("stale repository package check lock cannot be recovered safely", { cause: error })
    }
    mkdirSync(lockDir)
  }

  writeFileSync(ownerPath, `${process.pid}\n`)
  return () => {
    if (readOwnerPid(ownerPath) !== process.pid) return
    unlinkSync(ownerPath)
    rmdirSync(lockDir)
  }
}

function readOwnerPid(path: string): number | null {
  try {
    const value = readFileSync(path, "utf8").trim()
    return /^\d+$/.test(value) ? Number(value) : null
  } catch {
    return null
  }
}

function processIsRunning(pid: number): boolean {
  try {
    process.kill(pid, 0)
    return true
  } catch (error) {
    return errorCode(error) === "EPERM"
  }
}

function errorCode(error: unknown): string {
  return error && typeof error === "object" && "code" in error ? String(error.code) : ""
}
