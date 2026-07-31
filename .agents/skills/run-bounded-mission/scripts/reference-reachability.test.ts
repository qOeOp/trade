import { describe, expect, test } from "bun:test"
import { existsSync, readFileSync, readdirSync } from "node:fs"
import { basename, dirname, join, resolve } from "node:path"

const skillRoot = resolve(import.meta.dir, "..")
const skillFile = join(skillRoot, "SKILL.md")
const referencesRoot = join(skillRoot, "references")
const referenceFiles = readdirSync(referencesRoot)
  .filter((name) => name.endsWith(".md"))
  .map((name) => join(referencesRoot, name))
  .sort()
const helperFiles = readdirSync(import.meta.dir)
  .filter((name) => !name.endsWith(".test.ts"))
  .map((name) => join(import.meta.dir, name))
  .sort()
const helperOwners = new Map([
  ["git-path-history.py", "SKILL.md"],
  ["mission-impact-evidence.ts", "refactor-mission-proposal.md"],
  ["test-effectiveness-audit.ts", "test-effectiveness-governance.md"],
  ["wait-pr-codex-review.ts", "github-pr-handoff.md"],
])

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

  test("every risk reference is selected directly from SKILL.md", () => {
    const directReferences = localLinks(skillFile)
      .filter((target) => dirname(target) === referencesRoot)
      .sort()

    expect(directReferences).toEqual(referenceFiles)
  })

  test("every helper has one owning workflow invocation", () => {
    expect([...helperOwners.keys()].sort()).toEqual(helperFiles.map((file) => basename(file)))

    for (const helper of helperFiles) {
      const name = basename(helper)
      const owner = helperOwners.get(name)
      if (!owner) throw new Error(`missing workflow owner for ${name}`)
      const consumers = [skillFile, ...referenceFiles]
        .filter((file) => readFileSync(file, "utf8").includes(`scripts/${name}`))
        .map((file) => basename(file))

      expect(consumers, `${name} must have one owning workflow`).toEqual([owner])
    }
  })
})
