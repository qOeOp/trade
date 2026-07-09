#!/usr/bin/env bun

import { readdirSync, readFileSync, statSync } from "node:fs"
import { dirname, join, normalize } from "node:path"
import ts from "typescript"

type JSONRecord = Record<string, unknown>

interface SkillPackage {
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
const skillPackages = readSkillPackages()
const skillPackageNames = new Set(skillPackages.map((pkg) => pkg.name).filter(Boolean))
const issues: string[] = []

for (const pkg of skillPackages) {
  for (const [dep, version] of Object.entries(pkg.dependencies)) {
    const rootVersion = rootDeps[dep]
    if (rootVersion == null) {
      issues.push(`root package.json is missing dependency declared by ${pkg.packagePath}: ${dep}@${version}`)
    } else if (rootVersion !== version) {
      issues.push(`${pkg.packagePath}: ${dep} version ${version} differs from root package.json ${rootVersion}`)
    }
    if (skillPackageNames.has(dep)) {
      issues.push(`${pkg.packagePath}: TS skills must not depend on other skill packages: ${dep}`)
    }
  }
}

for (const file of walkTsFiles(".agents/skills")) {
  const sourceSkill = file.split(/[\\/]/)[2]
  const content = readFileSync(file, "utf8")
  const sourceFile = ts.createSourceFile(file, content, ts.ScriptTarget.ESNext, true, ts.ScriptKind.TS)

  visit(sourceFile, (specifier) => {
    if (skillPackageNames.has(specifier)) {
      issues.push(`${file}: package import ${specifier}`)
      return
    }
    if (!specifier.startsWith(".")) {
      return
    }

    const resolved = normalize(join(dirname(file), specifier))
    const parts = resolved.split(/[\\/]/)
    if (parts[0] !== ".agents" || parts[1] !== "skills") {
      return
    }
    const targetSkill = parts[2]
    if (targetSkill && targetSkill !== sourceSkill && targetSkill !== "_shared") {
      issues.push(`${file}: ${specifier} -> ${targetSkill}`)
    }
  })
}

if (issues.length > 0) {
  console.error(`quality: TS skill boundary violations:\n${issues.join("\n")}`)
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

function readSkillPackages(): SkillPackage[] {
  const packages: SkillPackage[] = []
  for (const entry of readdirSync(".agents/skills")) {
    const packagePath = join(".agents/skills", entry, "package.json")
    try {
      if (!statSync(packagePath).isFile()) continue
    } catch {
      continue
    }
    const pkg = readJson(packagePath)
    const name = typeof pkg.name === "string" ? pkg.name : ""
    packages.push({
      entry,
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
