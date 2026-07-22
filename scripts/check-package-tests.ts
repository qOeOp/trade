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
  const scripts = manifest.scripts ?? {}
  if (!scriptExecutesBunTest(scripts, "test")) violations.push(`${label}: scripts.test must execute bun test`)
  if (scriptGraphContains(scripts, "test", /no test files|if\s+find\s+src/i)) {
    violations.push(`${label}: scripts.test must fail closed; no empty-suite fallback is allowed`)
  }
  const testCommands = reachableScriptCommands(scripts, "test")
  for (const testFile of testFiles) {
    const relativeTestFile = relative(packageDir, testFile).replace(/\\/g, "/")
    if (!testCommands.some((command) => bunTestCommandCovers(command, relativeTestFile))) {
      violations.push(`${label}: scripts.test does not cover ${relativeTestFile}`)
    }
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

function scriptExecutesBunTest(
  scripts: Record<string, unknown>,
  name: string,
  visited = new Set<string>(),
): boolean {
  if (visited.has(name)) return false
  visited.add(name)
  const command = typeof scripts[name] === "string" ? scripts[name] : ""
  if (/\bbun\s+test\b/.test(command)) return true
  const references = [...command.matchAll(/\bbun\s+run\s+([a-zA-Z0-9:_-]+)/g)]
    .map((match) => match[1])
  return references.some((reference) => scriptExecutesBunTest(scripts, reference, new Set(visited)))
}

function scriptGraphContains(
  scripts: Record<string, unknown>,
  name: string,
  pattern: RegExp,
  visited = new Set<string>(),
): boolean {
  if (visited.has(name)) return false
  visited.add(name)
  const command = typeof scripts[name] === "string" ? scripts[name] : ""
  if (pattern.test(command)) return true
  return [...command.matchAll(/\bbun\s+run\s+([a-zA-Z0-9:_-]+)/g)]
    .map((match) => match[1])
    .some((reference) => scriptGraphContains(scripts, reference, pattern, new Set(visited)))
}

function reachableScriptCommands(
  scripts: Record<string, unknown>,
  name: string,
  visited = new Set<string>(),
): string[] {
  if (visited.has(name)) return []
  visited.add(name)
  const command = typeof scripts[name] === "string" ? scripts[name] : ""
  const references = [...command.matchAll(/\bbun\s+run\s+([a-zA-Z0-9:_-]+)/g)]
    .map((match) => match[1])
  return [
    command,
    ...references.flatMap((reference) => reachableScriptCommands(scripts, reference, visited)),
  ]
}

function bunTestCommandCovers(command: string, testFile: string): boolean {
  for (const match of command.matchAll(/\bbun\s+test\b([^;&|]*)/g)) {
    const args = (match[1] ?? "")
      .trim()
      .split(/\s+/)
      .map((value) => value.replace(/^["']|["']$/g, ""))
      .filter(Boolean)
    const paths = args
      .filter((value) => !value.startsWith("-"))
      .map((value) => value.replace(/^\.\//, "").replace(/\\/g, "/"))
    if (paths.length === 0) return true
    for (const path of paths) {
      if (path === testFile) return true
      if (!/[?*[]/.test(path) && testFile.startsWith(`${path.replace(/\/$/, "")}/`)) return true
      if (/[?*[]/.test(path) && new Bun.Glob(path).match(testFile)) return true
    }
  }
  return false
}
