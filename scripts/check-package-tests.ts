import { existsSync, readFileSync, readdirSync } from "node:fs"
import { dirname, join, relative } from "node:path"

const root = process.cwd()
const modulesRoot = join(root, "modules")
const violations: string[] = []

for (const packagePath of findFiles(modulesRoot, "package.json")) {
  const packageDir = dirname(packagePath)
  const sourceDir = join(packageDir, "src")
  if (!existsSync(sourceDir)) continue
  const sourceFiles = findTypeScript(sourceDir).filter((path) => !isTest(path) && !path.endsWith(".d.ts"))
  if (sourceFiles.length === 0) continue

  const label = relative(root, packageDir)
  const testFiles = findTypeScript(sourceDir).filter(isTest)
  if (testFiles.length === 0) violations.push(`${label}: production TypeScript has no colocated test file`)

  const manifest = JSON.parse(readFileSync(packagePath, "utf8")) as {
    scripts?: Record<string, unknown>
  }
  const testScript = typeof manifest.scripts?.test === "string" ? manifest.scripts.test : ""
  if (!testScript.includes("bun test")) violations.push(`${label}: scripts.test must execute bun test`)
  if (/no test files|if\s+find\s+src/i.test(testScript)) {
    violations.push(`${label}: scripts.test must fail closed; no empty-suite fallback is allowed`)
  }
}

if (violations.length > 0) {
  console.error("package-test judge rejected the repository:")
  for (const violation of violations) console.error(` - ${violation}`)
  process.exit(1)
}

console.log("package-test judge: every TypeScript package has executable colocated tests")

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
