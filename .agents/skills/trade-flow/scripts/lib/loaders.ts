import { existsSync, readdirSync, readFileSync } from "node:fs"
import { join } from "node:path"

type JSONRecord = Record<string, unknown>

interface StrategyPolicy {
  strategy_id: string
  name: string
  status: string
  tags: string[]
  body: string
  path: string
}

function loadJsonFile(path: string): JSONRecord {
  if (!existsSync(path)) return {}
  return JSON.parse(readFileSync(path, "utf8")) as JSONRecord
}

function loadStrategyFile(path: string): StrategyPolicy {
  const raw = readFileSync(path, "utf8")
  const { frontmatter, body } = parseFrontmatter(raw)
  return {
    strategy_id: stringField(frontmatter.strategy_id) || stringField(frontmatter.id),
    name: stringField(frontmatter.name),
    status: stringField(frontmatter.status) || "draft",
    tags: arrayOfStrings(frontmatter.tags),
    body,
    path,
  }
}

function loadStrategies(dir: string): StrategyPolicy[] {
  return readdirSync(dir, { withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith(".md"))
    .map((entry) => loadStrategyFile(join(dir, entry.name)))
}

function parseFrontmatter(raw: string): { frontmatter: JSONRecord; body: string } {
  if (!raw.startsWith("---\n")) {
    return { frontmatter: {}, body: raw }
  }
  const end = raw.indexOf("\n---", 4)
  if (end < 0) {
    return { frontmatter: {}, body: raw }
  }
  const frontmatterText = raw.slice(4, end).trim()
  const body = raw.slice(end + 4).trimStart()
  return {
    frontmatter: parseSimpleYaml(frontmatterText),
    body,
  }
}

function parseSimpleYaml(text: string): JSONRecord {
  const result: JSONRecord = {}
  for (const line of text.split("\n")) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith("#")) {
      continue
    }
    const colon = trimmed.indexOf(":")
    if (colon < 0) {
      continue
    }
    const key = trimmed.slice(0, colon).trim()
    const rawValue = trimmed.slice(colon + 1).trim()
    result[key] = parseYamlValue(rawValue)
  }
  return result
}

function parseYamlValue(value: string): unknown {
  if (value.startsWith("[") && value.endsWith("]")) {
    return value
      .slice(1, -1)
      .split(",")
      .map((item) => item.trim())
      .filter(Boolean)
  }
  return value.replace(/^["']|["']$/g, "")
}

function stringField(value: unknown): string {
  return typeof value === "string" ? value.trim() : ""
}

function arrayOfStrings(value: unknown): string[] {
  return Array.isArray(value) ? value.map((item) => String(item).trim()).filter(Boolean) : []
}

export {
  loadJsonFile,
  loadStrategies,
  loadStrategyFile,
  parseFrontmatter,
  parseSimpleYaml,
  type StrategyPolicy,
}
