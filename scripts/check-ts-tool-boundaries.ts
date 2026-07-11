#!/usr/bin/env bun

import { readdirSync, readFileSync, statSync } from "node:fs"
import { dirname, join, normalize } from "node:path"
import ts from "typescript"

type JSONRecord = Record<string, unknown>

interface ToolPackage {
  entry: string
  packagePath: string
  name: string
  dependencies: Record<string, string>
}

const rootPkg = readJson("package.json")
const rootDeps = {
  ...stringMap(rootPkg.dependencies),
  ...stringMap(rootPkg.devDependencies),
}
const toolPackages = readToolPackages()
const toolPackageNames = new Set(toolPackages.map((pkg) => pkg.name).filter(Boolean))
const toolPackageRoots = toolPackages.map((pkg) => dirname(pkg.packagePath).replace(/\\/g, "/"))
const issues: string[] = []

for (const pkg of toolPackages) {
  for (const [dep, version] of Object.entries(pkg.dependencies)) {
    const rootVersion = rootDeps[dep]
    if (rootVersion == null) {
      issues.push(`root package.json is missing dependency declared by ${pkg.packagePath}: ${dep}@${version}`)
    } else if (rootVersion !== version) {
      issues.push(`${pkg.packagePath}: ${dep} version ${version} differs from root package.json ${rootVersion}`)
    }
    if (toolPackageNames.has(dep)) {
      issues.push(`${pkg.packagePath}: TS tools must not depend on other tool packages: ${dep}`)
    }
  }
}

for (const file of walkTsFiles("modules")) {
  const sourceTool = owningToolRoot(file)
  const content = readFileSync(file, "utf8")
  const sourceFile = ts.createSourceFile(file, content, ts.ScriptTarget.ESNext, true, ts.ScriptKind.TS)

  visit(sourceFile, (specifier) => {
    if (toolPackageNames.has(specifier)) {
      issues.push(`${file}: package import ${specifier}`)
      return
    }
    if (!specifier.startsWith(".")) {
      return
    }

    const resolved = normalize(join(dirname(file), specifier)).replace(/\\/g, "/")
    const parts = resolved.split(/[\\/]/)
    if (parts[0] !== "modules") {
      return
    }
    if (parts[1] === "common" || parts[1] === "contracts") {
      return
    }
    const targetTool = owningToolRoot(resolved)
    if (targetTool && sourceTool && targetTool !== sourceTool) {
      issues.push(`${file}: ${specifier} -> ${targetTool}`)
    }
  })
}

if (issues.length > 0) {
  console.error(`quality: TS tool boundary violations:\n${issues.join("\n")}`)
  process.exit(1)
}

function visit(node: ts.Node, onSpecifier: (specifier: string) => void): void {
  if ((ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) && node.moduleSpecifier && ts.isStringLiteral(node.moduleSpecifier)) {
    onSpecifier(node.moduleSpecifier.text)
  }
  if (ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword) {
    const [arg] = node.arguments
    if (arg && ts.isStringLiteral(arg)) {
      onSpecifier(arg.text)
    }
  }
  ts.forEachChild(node, (child) => visit(child, onSpecifier))
}

function readToolPackages(): ToolPackage[] {
  const packages: ToolPackage[] = []
  for (const packagePath of findPackageJson("modules")) {
    const pkg = readJson(packagePath)
    const name = typeof pkg.name === "string" ? pkg.name : ""
    packages.push({
      entry: dirname(packagePath).replace(/^modules\//, ""),
      packagePath,
      name,
      dependencies: {
        ...stringMap(pkg.dependencies),
        ...stringMap(pkg.devDependencies),
      },
    })
  }
  return packages
}

function findPackageJson(dir: string): string[] {
  const files: string[] = []
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === "node_modules" || entry.name === "data") continue
    const path = join(dir, entry.name)
    if (entry.isDirectory()) {
      files.push(...findPackageJson(path))
    } else if (entry.isFile() && entry.name === "package.json") {
      files.push(path)
    }
  }
  return files
}

function owningToolRoot(file: string): string {
  const normalized = file.replace(/\\/g, "/")
  const sorted = [...toolPackageRoots].sort((a, b) => b.length - a.length)
  return sorted.find((root) => normalized === root || normalized.startsWith(`${root}/`)) || ""
}

function walkTsFiles(dir: string): string[] {
  const files: string[] = []
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === "node_modules" || entry.name === "data") continue
    const path = join(dir, entry.name)
    if (entry.isDirectory()) {
      files.push(...walkTsFiles(path))
    } else if (entry.isFile() && path.endsWith(".ts")) {
      files.push(path)
    }
  }
  return files
}

function readJson(path: string): JSONRecord {
  return JSON.parse(readFileSync(path, "utf8")) as JSONRecord
}

function stringMap(value: unknown): Record<string, string> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {}
  }
  return Object.fromEntries(
    Object.entries(value as JSONRecord)
      .filter((entry): entry is [string, string] => typeof entry[1] === "string"),
  )
}
