import { describe, expect, test } from "bun:test"
import { existsSync, readFileSync, readdirSync } from "node:fs"
import { dirname, join, resolve } from "node:path"

const skillRoot = resolve(import.meta.dir, "..")
const skillFile = join(skillRoot, "SKILL.md")
const referencesRoot = join(skillRoot, "references")
const referenceFiles = readdirSync(referencesRoot)
  .filter((name) => name.endsWith(".md"))
  .map((name) => join(referencesRoot, name))
  .sort()

function localLinks(file: string): string[] {
  const source = readFileSync(file, "utf8")
  const links: string[] = []
  const pattern = /\[[^\]]*\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g

  for (const match of source.matchAll(pattern)) {
    const target = match[1]
    if (!target || target.startsWith("#") || /^[a-z][a-z0-9+.-]*:/i.test(target)) {
      continue
    }
    links.push(resolve(dirname(file), target.split("#", 1)[0]!))
  }

  return links
}

describe("run-bounded-mission reference routing", () => {
  test("local Markdown links resolve", () => {
    for (const file of [skillFile, ...referenceFiles]) {
      for (const target of localLinks(file)) {
        expect(existsSync(target), `${file} links to missing ${target}`).toBe(true)
      }
    }
  })

  test("every reference is reachable from SKILL.md", () => {
    const reachable = new Set<string>()
    const pending = [skillFile]

    while (pending.length > 0) {
      const file = pending.pop()!
      if (reachable.has(file)) {
        continue
      }
      reachable.add(file)
      for (const target of localLinks(file)) {
        if (target.endsWith(".md") && target.startsWith(skillRoot)) {
          pending.push(target)
        }
      }
    }

    expect(referenceFiles.filter((file) => !reachable.has(file))).toEqual([])
  })
})
