import { existsSync, readdirSync, readFileSync } from "node:fs"
import { basename, join, resolve } from "node:path"

const MAIN_TEST_MAX_LINES = 800
const SUPPORT_MAX_LINES = 260
const FIXTURE_MAX_LINES = 200
const MAIN_TEST_RELATIVE_PATH =
  "modules/research-strategy-development/replay-execution-plane/runner/src/lib/replay-decision-worker-input-assembly-v4.test.ts"
const SUPPORT_RELATIVE_ROOT =
  "modules/research-strategy-development/replay-execution-plane/runner/src/lib"

const root = resolve(readRootArgument(process.argv.slice(2)) ?? join(import.meta.dir, ".."))
const issues: string[] = []
const mainTestPath = join(root, MAIN_TEST_RELATIVE_PATH)
if (!existsSync(mainTestPath)) {
  issues.push(`missing worker-v10 main test: ${MAIN_TEST_RELATIVE_PATH}`)
} else {
  enforceLimit(mainTestPath, MAIN_TEST_RELATIVE_PATH, MAIN_TEST_MAX_LINES, "main test")
}

const supportRoot = join(root, SUPPORT_RELATIVE_ROOT)
if (!existsSync(supportRoot)) {
  issues.push(`missing worker-v10 support root: ${SUPPORT_RELATIVE_ROOT}`)
} else {
  const files = readdirSync(supportRoot, { withFileTypes: true })
    .filter((entry) => entry.isFile() && /^replay-worker-v10-.*\.ts$/.test(entry.name))
    .map((entry) => join(supportRoot, entry.name))
    .sort()
  const fixtures = files.filter((path) => basename(path).includes("-fixture."))
  const support = files.filter((path) => !basename(path).includes("-fixture."))
  if (support.length === 0) issues.push("worker-v10 support scan found no files")
  if (fixtures.length === 0) issues.push("worker-v10 fixture scan found no files")
  for (const path of support) {
    enforceLimit(path, relativePath(path), SUPPORT_MAX_LINES, "support")
  }
  for (const path of fixtures) {
    enforceLimit(path, relativePath(path), FIXTURE_MAX_LINES, "fixture")
  }
}

if (issues.length > 0) {
  console.error("quality: replay worker-v10 size violations:")
  for (const issue of issues) console.error(` - ${issue}`)
  process.exit(1)
}

console.log(
  `quality: replay worker-v10 size limits main<=${MAIN_TEST_MAX_LINES} support<=${SUPPORT_MAX_LINES} fixture<=${FIXTURE_MAX_LINES}`,
)

function enforceLimit(path: string, relative: string, limit: number, kind: string): void {
  const lines = lineCount(readFileSync(path, "utf8"))
  if (lines > limit) issues.push(`${kind} ${relative}: ${lines} > ${limit}`)
}

function lineCount(content: string): number {
  if (content === "") return 0
  const normalized = content.replace(/\r\n/g, "\n")
  return normalized.split("\n").length - (normalized.endsWith("\n") ? 1 : 0)
}

function relativePath(path: string): string {
  return path.slice(root.length + 1)
}

function readRootArgument(args: string[]): string | null {
  if (args.length === 0) return null
  if (args.length !== 2 || args[0] !== "--root" || !args[1]) {
    throw new Error("usage: bun scripts/check-replay-worker-v10-size.ts [--root <repo-root>]")
  }
  return args[1]
}
