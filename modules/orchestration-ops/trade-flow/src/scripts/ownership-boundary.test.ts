import { expect, test } from "bun:test"
import { existsSync, readFileSync, readdirSync } from "node:fs"
import { join, resolve } from "node:path"

const root = resolve(import.meta.dir, "../../../../..")
const tradeFlowRoot = join(root, "modules/orchestration-ops/trade-flow")

test("retired research, review, and catalog ownership does not return to trade-flow", () => {
  const manifest = readFileSync(join(root, "toolset.json"), "utf8")
  for (const id of ["trade-flow.research", "trade-flow.artifact", "trade-flow.review"]) {
    expect(manifest).not.toContain(`"id": "${id}"`)
  }

  for (const path of [
    "src/domain",
    "src/scripts/commands/research.ts",
    "src/scripts/commands/evidence.ts",
    "src/scripts/commands/catalog.ts",
    "src/scripts/lib/data-catalog.ts",
    "src/scripts/lib/strategy-iteration.ts",
    "src/scripts/lib/replay-core.ts",
    "src/scripts/lib/rd-program-state.ts",
    "src/scripts/lib/strategy-rnd.ts",
  ]) {
    expect(existsSync(join(tradeFlowRoot, path))).toBeFalse()
  }

  const forbidden = /handle(Catalog|Evidence|Research)Command|from "\.\/commands\/(catalog|evidence|research)"|from "\.\/lib\/(data-catalog|strategy-iteration|replay-core|rd-program-state|strategy-rnd)"/
  for (const path of typeScriptFiles(join(tradeFlowRoot, "src"))) {
    if (path.endsWith("ownership-boundary.test.ts")) continue
    expect(readFileSync(path, "utf8")).not.toMatch(forbidden)
  }
})

function typeScriptFiles(dir: string): string[] {
  const files: string[] = []
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name)
    if (entry.isDirectory()) files.push(...typeScriptFiles(path))
    if (entry.isFile() && entry.name.endsWith(".ts")) files.push(path)
  }
  return files
}
