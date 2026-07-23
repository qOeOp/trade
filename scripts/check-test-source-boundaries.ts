import { readdirSync, readFileSync } from "node:fs"
import { join, relative, resolve } from "node:path"
import ts from "typescript"
import { isTestSource, scriptKind } from "./lib/source-import-inspection"

const FORBIDDEN_TEST_RUNTIMES = new Set([
  "bun:test",
  "node:test",
  "vitest",
  "@jest/globals",
])

const root = resolve(readRootArgument(process.argv.slice(2)) ?? join(import.meta.dir, ".."))
const modulesRoot = join(root, "modules")
const issues: string[] = []

for (const path of collectSources(modulesRoot)) {
  const repoPath = relative(root, path).replaceAll("\\", "/")
  if (isTestSource(repoPath)) continue

  const source = ts.createSourceFile(
    path,
    readFileSync(path, "utf8"),
    ts.ScriptTarget.Latest,
    true,
    scriptKind(path),
  )
  for (const specifier of moduleSpecifiers(source)) {
    if (FORBIDDEN_TEST_RUNTIMES.has(specifier)) {
      issues.push(`${repoPath}: production source imports test runtime ${specifier}`)
    }
    if (specifier.split("/").includes("test-support")) {
      issues.push(`${repoPath}: production source imports test-support module ${specifier}`)
    }
  }
}

if (issues.length > 0) {
  console.error("quality: test source boundary violations:")
  for (const issue of issues.sort()) console.error(` - ${issue}`)
  process.exit(1)
}

console.log("quality: production sources do not import test runtimes or test-support modules")

function collectSources(directory: string): string[] {
  const paths: string[] = []
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name)
    if (entry.isDirectory()) paths.push(...collectSources(path))
    else if (entry.isFile() && /\.(?:ts|tsx|mts|cts|js|jsx|mjs|cjs)$/.test(entry.name)) paths.push(path)
  }
  return paths.sort()
}

function moduleSpecifiers(source: ts.SourceFile): string[] {
  const specifiers: string[] = []
  const visit = (node: ts.Node): void => {
    if ((ts.isImportDeclaration(node) || ts.isExportDeclaration(node))
        && node.moduleSpecifier && ts.isStringLiteralLike(node.moduleSpecifier)) {
      specifiers.push(node.moduleSpecifier.text)
    } else if (ts.isCallExpression(node)
        && (node.expression.kind === ts.SyntaxKind.ImportKeyword
          || (ts.isIdentifier(node.expression) && node.expression.text === "require"))
        && node.arguments.length === 1
        && ts.isStringLiteralLike(node.arguments[0]!)) {
      specifiers.push(node.arguments[0].text)
    }
    ts.forEachChild(node, visit)
  }
  visit(source)
  return specifiers
}

function readRootArgument(args: string[]): string | null {
  if (args.length === 0) return null
  if (args.length !== 2 || args[0] !== "--root" || !args[1]) {
    throw new Error("usage: bun scripts/check-test-source-boundaries.ts [--root <repo-root>]")
  }
  return args[1]
}
