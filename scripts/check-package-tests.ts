import { existsSync, readdirSync } from "node:fs"
import { dirname, join, relative } from "node:path"

interface TypeScriptPackage {
  dir: string
  label: string
  testFiles: string[]
}

const root = process.cwd()
const violations: string[] = []
const packages = findFiles(join(root, "modules"), "package.json")
  .flatMap(inspectPackage)
  .sort((left, right) => left.label.localeCompare(right.label))

if (violations.length > 0) {
  console.error("package-test judge rejected the repository:")
  for (const violation of violations) console.error(` - ${violation}`)
  process.exit(1)
}

const [mode, requestedTarget, extra] = process.argv.slice(2)
if (extra || (mode && !["--run-all", "--run-package", "--run-shard"].includes(mode))) {
  throw new Error(`unsupported package-test argument: ${process.argv.slice(2).join(" ")}`)
}
if (mode === "--run-package" && !requestedTarget) {
  throw new Error("--run-package requires a repository-relative package path")
}
if (mode === "--run-shard" && !requestedTarget) {
  throw new Error("--run-shard requires <zero-based-index>/<count>")
}

const selected = mode === "--run-all"
  ? packages
  : mode === "--run-package"
    ? packages.filter((item) => item.label === normalizePath(requestedTarget!))
    : mode === "--run-shard"
      ? selectShard(packages, requestedTarget!)
      : []
if (mode === "--run-package" && selected.length !== 1) {
  throw new Error(`unknown production TypeScript package: ${requestedTarget}`)
}
for (const packageInfo of selected) runPackage(packageInfo)

console.log(mode
  ? `package-test judge: compiled and tested ${selected.length} TypeScript packages directly`
  : `package-test judge: ${packages.length} TypeScript packages have colocated tests`)

function inspectPackage(packagePath: string): TypeScriptPackage[] {
  const packageDir = dirname(packagePath)
  const sourceDir = join(packageDir, "src")
  if (!existsSync(sourceDir)) return []
  const sourceFiles = findTypeScript(sourceDir).filter((path) => !isTest(path) && !path.endsWith(".d.ts"))
  if (sourceFiles.length === 0) return []

  const label = relative(root, packageDir).replaceAll("\\", "/")
  const testFiles = findTypeScript(sourceDir).filter(isTest).sort()
  if (!existsSync(join(packageDir, "tsconfig.json"))) {
    violations.push(`${label}: production TypeScript has no tsconfig.json`)
  }
  if (testFiles.length === 0) {
    violations.push(`${label}: production TypeScript has no colocated test file`)
  }
  return [{ dir: packageDir, label, testFiles }]
}

function runPackage(packageInfo: TypeScriptPackage): void {
  console.log(`package-test: ${packageInfo.label}`)
  run([
    join(root, "node_modules", ".bin", "tsc"),
    "--noEmit",
    "--project",
    join(packageInfo.dir, "tsconfig.json"),
  ], root)

  const workerPath = join(
    root,
    "modules/research-strategy-development/replay-execution-plane/runner",
    "src/lib/replay-decision-worker-input-assembly-v4.test.ts",
  )
  let commands = [[
    "bun",
    "test",
    ...packageInfo.testFiles.map((path) => relative(packageInfo.dir, path).replaceAll("\\", "/")),
  ]]
  if (packageInfo.label === "modules/research-strategy-development/replay-execution-plane/runner") {
    if (!packageInfo.testFiles.includes(workerPath)) {
      throw new Error(`Replay semantic-owned worker test is missing: ${relative(root, workerPath)}`)
    }
    const protectiveStopPath = join(
      packageInfo.dir,
      "src/lib/replay-independent-lane-batch-runner.test.ts",
    )
    if (!packageInfo.testFiles.includes(protectiveStopPath)) {
      throw new Error(`Replay isolated protective-stop test is missing: ${relative(root, protectiveStopPath)}`)
    }
    const remainingTests = packageInfo.testFiles.filter((path) => path !== workerPath)
    if (remainingTests.length === 0) throw new Error("Replay runner has no non-semantic package tests")
    const exclusivePrefix = [
      "sh",
      join(root, "scripts/run-exclusive-test.sh"),
      "replay-runner-heavyweight",
      "bun",
      "test",
    ]
    const protectiveStopTest =
      "protective-stop cancel releases admission risk only after full-flat and rolls four committed cycles"
    commands = [
      [
        ...exclusivePrefix,
        ...remainingTests.map((path) =>
          relative(packageInfo.dir, path).replaceAll("\\", "/")),
        "--test-name-pattern",
        `^(?!${protectiveStopTest}$).*`,
      ],
      [
        ...exclusivePrefix,
        relative(packageInfo.dir, protectiveStopPath).replaceAll("\\", "/"),
        "--test-name-pattern",
        `^${protectiveStopTest}$`,
      ],
    ]
  }
  const output = commands.map((command) => run(command, packageInfo.dir)).join("\n")
  const counts = [...output.matchAll(/Ran (\d+) tests? across/g)].map((match) => Number(match[1]))
  if (counts.length === 0 || counts.at(-1) === 0) {
    throw new Error(`${packageInfo.label}: direct Bun test execution ran zero tests`)
  }
}

function run(command: string[], cwd: string): string {
  const result = Bun.spawnSync(command, {
    cwd,
    env: process.env,
    stdin: "inherit",
    stdout: "pipe",
    stderr: "pipe",
  })
  const stdout = result.stdout.toString()
  const stderr = result.stderr.toString()
  process.stdout.write(stdout)
  process.stderr.write(stderr)
  if (result.exitCode !== 0) {
    throw new Error(`command failed (${result.exitCode}): ${command.join(" ")}`)
  }
  return `${stdout}\n${stderr}`
}

function findFiles(directory: string, name: string): string[] {
  if (!existsSync(directory)) return []
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name)
    if (entry.isDirectory()) return findFiles(path, name)
    return entry.isFile() && entry.name === name ? [path] : []
  })
}

function findTypeScript(directory: string): string[] {
  if (!existsSync(directory)) return []
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name)
    if (entry.isDirectory()) return findTypeScript(path)
    return entry.isFile() && /\.[cm]?tsx?$/.test(entry.name) ? [path] : []
  })
}

function isTest(path: string): boolean {
  return /\.(test|spec)\.[cm]?tsx?$/.test(path)
}

function normalizePath(value: string): string {
  return value.replaceAll("\\", "/").replace(/^\.\//, "").replace(/\/$/, "")
}

function selectShard(items: TypeScriptPackage[], value: string): TypeScriptPackage[] {
  const match = /^(\d+)\/(\d+)$/.exec(value)
  if (!match) throw new Error("--run-shard requires <zero-based-index>/<count>")
  const index = Number(match[1])
  const count = Number(match[2])
  if (!Number.isSafeInteger(index) || !Number.isSafeInteger(count) || count < 1 || index >= count) {
    throw new Error(`invalid package-test shard: ${value}`)
  }
  return items.filter((_, itemIndex) => itemIndex % count === index)
}
