import { createRequire } from "node:module"
import type { CallExpression, Node, ScriptKind } from "typescript"

const ts = createRequire(import.meta.url)("typescript") as typeof import("typescript")

interface SourceInspectionHandlers {
  onSpecifier(specifier: string): void
  onNonStatic(kind: "dynamic import" | "require"): void
  onForbiddenRuntime?(kind: "eval" | "new Function"): void
}

function inspectModuleReferences(node: Node, handlers: SourceInspectionHandlers): void {
  if ((ts.isImportDeclaration(node) || ts.isExportDeclaration(node))
    && node.moduleSpecifier
    && ts.isStringLiteral(node.moduleSpecifier)) {
    handlers.onSpecifier(node.moduleSpecifier.text)
  }
  if (ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword) {
    inspectCallArgument(node, "dynamic import", handlers)
  }
  if (ts.isCallExpression(node) && ts.isIdentifier(node.expression) && node.expression.text === "require") {
    inspectCallArgument(node, "require", handlers)
  }
  if (ts.isCallExpression(node) && ts.isIdentifier(node.expression) && node.expression.text === "eval") {
    handlers.onForbiddenRuntime?.("eval")
  }
  if (ts.isNewExpression(node) && ts.isIdentifier(node.expression) && node.expression.text === "Function") {
    handlers.onForbiddenRuntime?.("new Function")
  }
  ts.forEachChild(node, (child) => inspectModuleReferences(child, handlers))
}

function inspectCallArgument(
  node: CallExpression,
  kind: "dynamic import" | "require",
  handlers: SourceInspectionHandlers,
): void {
  const [argument] = node.arguments
  if (argument && ts.isStringLiteral(argument)) handlers.onSpecifier(argument.text)
  else handlers.onNonStatic(kind)
}

function isJavaScriptOrTypeScript(path: string): boolean {
  return /\.(?:ts|tsx|mts|cts|js|jsx|mjs|cjs)$/.test(path)
}

function isTestSource(path: string): boolean {
  return /(?:^|\/)(?:test|tests)(?:\/|$)/.test(path) || /\.(?:test|spec)\.[^.]+$/.test(path)
}

function scriptKind(path: string): ScriptKind {
  if (path.endsWith(".tsx")) return ts.ScriptKind.TSX
  if (path.endsWith(".jsx")) return ts.ScriptKind.JSX
  if (/\.(?:js|mjs|cjs)$/.test(path)) return ts.ScriptKind.JS
  return ts.ScriptKind.TS
}

export { inspectModuleReferences, isJavaScriptOrTypeScript, isTestSource, scriptKind }
