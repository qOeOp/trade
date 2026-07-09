import { existsSync } from "node:fs"
import { isAbsolute, relative, resolve } from "node:path"

export function resolvePathFrom(path: string, fromDir: string): string {
  if (!path) return ""
  return isAbsolute(path) ? path : resolve(fromDir, path)
}

export function displayPath(path: string, base = process.cwd()): string {
  if (!path) return ""
  return relative(base, resolvePathFrom(path, process.cwd())) || "."
}

export function displayPathFrom(path: string, fromDir: string, base = process.cwd()): string {
  if (!path) return ""
  return relative(base, resolvePathFrom(path, fromDir)) || "."
}

export function resolveReadablePath(path: string, base = process.cwd()): string {
  if (!path) return ""
  const direct = resolvePathFrom(path, base)
  if (existsSync(direct)) return direct
  const fallback = panelTmpFallbackPath(path, base)
  return fallback && existsSync(fallback) ? fallback : direct
}

function panelTmpFallbackPath(path: string, base: string): string {
  const resolved = resolvePathFrom(path, base)
  const rel = relative(process.cwd(), resolved).split(/[\\/]/)
  if (rel[0] !== "data" || !isPanelDir(rel[1])) return ""
  return resolve(process.cwd(), "tmp", "panels", ...rel.slice(1))
}

function isPanelDir(name = ""): boolean {
  return /^(calibration-panel|validation-panel|external-panel|forward-holdout)-/.test(name)
}
