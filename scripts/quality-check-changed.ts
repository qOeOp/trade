#!/usr/bin/env bun

import { existsSync } from "node:fs"
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path"

type PackageKind = "typescript" | "go" | "rust" | "python"

interface ChangedPackage {
  kind: PackageKind
  dir: string
}

interface ChangedPlan {
  files: string[]
  packages: ChangedPackage[]
  docsOnly: boolean
  architecture: boolean
  fullReasons: string[]
}

const ROOT = resolve(import.meta.dir, "..")
const SHARED_OR_FULL_PREFIXES = [
  ".github/",
  "modules/contracts/",
  "modules/research-strategy-development/replay-execution-plane/",
  "modules/research-strategy-development/research-control-plane/contracts/",
  "modules/research-strategy-development/research-control-plane/state-store/",
  "scripts/",
]
const ROOT_FULL_FILES = new Set([
  ".gitignore",
  "bun.lock",
  "package.json",
  "toolset.json",
  "tsconfig.json",
])

export function buildChangedPlan(files: string[], root = ROOT): ChangedPlan {
  const normalized = [...new Set(files.map(normalizePath).filter(Boolean))].sort()
  const packages = new Map<string, ChangedPackage>()
  const fullReasons = new Set<string>()
  let docsOnly = normalized.length > 0
  let architecture = false

  for (const file of normalized) {
    if (ROOT_FULL_FILES.has(file) || SHARED_OR_FULL_PREFIXES.some((prefix) => file.startsWith(prefix))) {
      fullReasons.add(`${file} affects shared, Replay, CI, or quality infrastructure`)
      docsOnly = false
      continue
    }
    if (file === "docs/architecture/architecture-manifest.json") {
      fullReasons.add(`${file} changes the machine architecture contract`)
      docsOnly = false
      architecture = true
      continue
    }
    if (isDocumentationPath(file)) {
      architecture ||= file.startsWith("docs/architecture/")
      continue
    }
    docsOnly = false
    if (!file.startsWith("modules/")) {
      fullReasons.add(`${file} has no safe changed-check owner`)
      continue
    }
    const owner = findPackageOwner(root, file)
    if (!owner) {
      fullReasons.add(`${file} has no package marker`)
      continue
    }
    packages.set(`${owner.kind}:${owner.dir}`, owner)
  }

  const kinds = new Set([...packages.values()].map((item) => item.kind))
  if (kinds.size > 1) fullReasons.add("changed packages span multiple languages")
  return {
    files: normalized,
    packages: [...packages.values()].sort((a, b) => a.dir.localeCompare(b.dir)),
    docsOnly,
    architecture,
    fullReasons: [...fullReasons].sort(),
  }
}

async function main(): Promise<void> {
  const requested = parseRequestedPaths(process.argv.slice(2))
  const workspaceFiles = changedWorkspaceFiles(ROOT)
  const selected = selectPaths(workspaceFiles, requested)
  const plan = buildChangedPlan(selected, ROOT)
  if (plan.files.length === 0) throw new Error("no changed files selected")
  if (plan.fullReasons.length > 0) {
    process.stderr.write("quality-changed: full quality check required:\n")
    for (const reason of plan.fullReasons) process.stderr.write(`- ${reason}\n`)
    process.stderr.write("run: scripts/quality-check.sh\n")
    process.exit(2)
  }

  const lockDir = join(ROOT, "tmp", "check", "quality-changed.lock")
  const snapshot = join(ROOT, "tmp", "check", `quality-changed-${process.pid}.json`)
  run(["sh", "scripts/quality-lock.sh", "acquire", lockDir, String(process.pid)])
  let snapshotCaptured = false
  try {
    run(["bun", "scripts/check-workspace-side-effects.ts", "--action", "capture", "--snapshot", snapshot])
    snapshotCaptured = true
    log(`scope ${plan.docsOnly ? "docs-only" : "targeted"} files=${plan.files.length} packages=${plan.packages.length}`)
    run(["git", "diff", "--check"])
    run(["bun", "scripts/check-workspace-hygiene.ts"])
    run(["bun", "scripts/check-secrets.ts"])
    run(["bun", "scripts/check-doc-contracts.ts"])
    run(["sh", "scripts/check-workspace-skills.sh"])

    if (plan.architecture) {
      run(["bun", "scripts/toolset.ts", "--validate"])
      run(["bun", "scripts/check-architecture-manifest.ts"])
      run(["bun", "scripts/architecture-drift-audit.ts", "--check"])
    }
    if (!plan.docsOnly) {
      run(["bun", "scripts/check-ts-tool-boundaries.ts"])
      run(["bun", "scripts/check-package-tests.ts"])
      run(["bun", "scripts/check-duplication.ts"])
      run(["bun", "scripts/check-replay-worker-v10-size.ts"])
      for (const owner of plan.packages) runPackage(owner)
    }
    log("ok")
  } finally {
    let postflightError: unknown
    if (snapshotCaptured) {
      try {
        run(["bun", "scripts/check-workspace-side-effects.ts", "--action", "check", "--snapshot", snapshot])
      } catch (error) {
        postflightError = error
      }
    }
    run(["sh", "scripts/quality-lock.sh", "release", lockDir, String(process.pid)])
    if (postflightError) throw postflightError
  }
}

function runPackage(owner: ChangedPackage): void {
  log(`${owner.kind} ${owner.dir}`)
  if (owner.kind === "typescript") {
    run(["bun", "run", "check"], owner.dir)
  } else if (owner.kind === "go") {
    run(["sh", resolve(ROOT, "scripts/check-go-format.sh"), resolve(ROOT, owner.dir)], owner.dir)
    run(["go", "test", "./..."], owner.dir)
    run(["go", "vet", "./..."], owner.dir)
  } else if (owner.kind === "rust") {
    run(["cargo", "fmt", "--all", "--", "--check"], owner.dir)
    run(["cargo", "check"], owner.dir)
    run(["cargo", "clippy", "--all-targets", "--", "-D", "warnings"], owner.dir)
    run(["cargo", "test"], owner.dir)
  } else {
    const python = commandOutput(["sh", "scripts/resolve-python.sh"])
    run([python, "-m", "compileall", "-q", "scripts"], owner.dir)
    run([python, "-W", "error", "-m", "unittest", "discover", "-s", "scripts", "-p", "test*.py"], owner.dir)
  }
}

function findPackageOwner(root: string, file: string): ChangedPackage | null {
  let current = dirname(resolve(root, file))
  const modulesRoot = resolve(root, "modules")
  while (current === modulesRoot || current.startsWith(`${modulesRoot}${sep}`)) {
    const relativeDir = normalizePath(relative(root, current))
    if (existsSync(join(current, "package.json"))) return { kind: "typescript", dir: relativeDir }
    if (existsSync(join(current, "go.mod"))) return { kind: "go", dir: relativeDir }
    if (existsSync(join(current, "Cargo.toml"))) return { kind: "rust", dir: relativeDir }
    if (existsSync(join(current, "requirements.txt"))) return { kind: "python", dir: relativeDir }
    if (current === modulesRoot) break
    current = dirname(current)
  }
  return null
}

function changedWorkspaceFiles(root: string): string[] {
  const tracked = commandOutput(["git", "diff", "--name-only", "--diff-filter=ACMRD", "HEAD"], root)
  const untracked = commandOutput(["git", "ls-files", "--others", "--exclude-standard"], root)
  return [...new Set(`${tracked}\n${untracked}`.split("\n").map(normalizePath).filter(Boolean))].sort()
}

function selectPaths(files: string[], requested: string[]): string[] {
  if (requested.length === 0) return files
  const selected = files.filter((file) => requested.some((path) => file === path || file.startsWith(`${path}/`)))
  const unmatched = requested.filter((path) => !selected.some((file) => file === path || file.startsWith(`${path}/`)))
  if (unmatched.length > 0) throw new Error(`requested paths are not changed: ${unmatched.join(", ")}`)
  return selected
}

function parseRequestedPaths(args: string[]): string[] {
  const paths: string[] = []
  for (let index = 0; index < args.length; index += 1) {
    if (args[index] !== "--path") throw new Error(`unknown argument: ${args[index]}`)
    const value = args[++index]
    if (!value) throw new Error("--path requires a value")
    if (isAbsolute(value) || value.split(/[\\/]/).includes("..")) {
      throw new Error("--path must be repository-relative")
    }
    paths.push(normalizePath(value).replace(/\/$/, ""))
  }
  return [...new Set(paths)].sort()
}

function isDocumentationPath(file: string): boolean {
  return file.startsWith("docs/")
    || file === "README.md"
    || file === "AGENTS.md"
    || file.startsWith(".agents/")
}

function run(command: string[], cwd = ROOT): void {
  const result = Bun.spawnSync(command, { cwd: resolve(ROOT, cwd), env: process.env, stdin: "inherit", stdout: "inherit", stderr: "inherit" })
  if (result.exitCode !== 0) throw new Error(`command failed (${result.exitCode}): ${command.join(" ")}`)
}

function commandOutput(command: string[], cwd = ROOT): string {
  const result = Bun.spawnSync(command, { cwd, env: process.env, stdout: "pipe", stderr: "pipe" })
  if (result.exitCode !== 0) throw new Error(result.stderr.toString().trim() || `command failed: ${command.join(" ")}`)
  return result.stdout.toString().trim()
}

function normalizePath(value: string): string {
  return value.trim().replaceAll("\\", "/").replace(/^\.\//, "")
}

function log(message: string): void {
  process.stdout.write(`quality-changed: ${message}\n`)
}

if (import.meta.main) {
  main().catch((error) => {
    process.stderr.write(`quality-changed: ${error instanceof Error ? error.message : String(error)}\n`)
    process.exit(1)
  })
}
