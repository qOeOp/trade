import { afterEach, expect, test } from "bun:test"
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { buildChangedPlan } from "./quality-check-changed"

const roots: string[] = []

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

test("docs-only changes avoid package and Replay tests", () => {
  const plan = buildChangedPlan(["docs/product/vision.md", "docs/runtime/example.md"], fixture())
  expect(plan.docsOnly).toBe(true)
  expect(plan.packages).toEqual([])
  expect(plan.fullReasons).toEqual([])
})

test("one TypeScript module selects only its package check", () => {
  const root = fixture()
  packageMarker(root, "modules/domain/tool", "package.json")
  const plan = buildChangedPlan(["modules/domain/tool/src/main.ts"], root)
  expect(plan.docsOnly).toBe(false)
  expect(plan.packages).toEqual([{ kind: "typescript", dir: "modules/domain/tool" }])
  expect(plan.fullReasons).toEqual([])
})

test("Replay, shared contracts, scripts, and cross-language work require the full gate", () => {
  const root = fixture()
  packageMarker(root, "modules/domain/ts-tool", "package.json")
  packageMarker(root, "modules/domain/rust-tool", "Cargo.toml")
  const cases = [
    ["modules/research-strategy-development/replay-execution-plane/runner/src/main.ts"],
    ["modules/contracts/runtime-core/src/main.ts"],
    ["scripts/quality-check.sh"],
    ["modules/domain/ts-tool/src/main.ts", "modules/domain/rust-tool/src/main.rs"],
  ]
  for (const files of cases) expect(buildChangedPlan(files, root).fullReasons.length).toBeGreaterThan(0)
})

function fixture(): string {
  const root = mkdtempSync(join(tmpdir(), "trade-quality-plan-"))
  roots.push(root)
  return root
}

function packageMarker(root: string, dir: string, marker: string): void {
  mkdirSync(join(root, dir, "src"), { recursive: true })
  writeFileSync(join(root, dir, marker), "{}\n")
}
