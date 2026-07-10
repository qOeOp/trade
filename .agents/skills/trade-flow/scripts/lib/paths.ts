import { existsSync } from "node:fs"
import { dirname, isAbsolute, relative, resolve } from "node:path"

let cachedRepoRoot = ""

export function repoRoot(): string {
  if (cachedRepoRoot) return cachedRepoRoot
  const envRoot = process.env.TRADE_REPO_ROOT
  if (envRoot) {
    cachedRepoRoot = resolve(envRoot)
    return cachedRepoRoot
  }
  let current = resolve(process.cwd())
  while (dirname(current) !== current) {
    if (existsSync(resolve(current, "AGENTS.md")) && existsSync(resolve(current, ".agents"))) {
      cachedRepoRoot = current
      return cachedRepoRoot
    }
    current = dirname(current)
  }
  cachedRepoRoot = resolve(process.cwd())
  return cachedRepoRoot
}

export function resolvePathFrom(path: string, fromDir: string): string {
  if (!path) return ""
  return isAbsolute(path) ? path : resolve(fromDir, path)
}

export function resolveRepoPath(path: string): string {
  if (!path) return ""
  return resolvePathFrom(path, repoRoot())
}

export function displayPath(path: string, base = repoRoot()): string {
  if (!path) return ""
  return relative(base, resolvePathFrom(path, repoRoot())) || "."
}

export function displayPathFrom(path: string, fromDir: string, base = repoRoot()): string {
  if (!path) return ""
  return relative(base, resolvePathFrom(path, fromDir)) || "."
}

export function resolveReadablePath(path: string, base = repoRoot()): string {
  if (!path) return ""
  const direct = resolvePathFrom(path, base)
  if (existsSync(direct)) return direct
  const fallback = panelTmpFallbackPath(path, base)
  return fallback && existsSync(fallback) ? fallback : direct
}

function panelTmpFallbackPath(path: string, base: string): string {
  const resolved = resolvePathFrom(path, base)
  const rel = relative(repoRoot(), resolved).split(/[\\/]/)
  if (rel[0] !== "data" || !isPanelDir(rel[1])) return ""
  return resolve(repoRoot(), "tmp", "panels", ...rel.slice(1))
}

function isPanelDir(name = ""): boolean {
  return /^(calibration-panel|validation-panel|external-panel|forward-holdout)-/.test(name)
}
