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
