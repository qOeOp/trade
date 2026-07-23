import { afterEach, expect, test } from "bun:test"
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { cacheReuseAllowed, qualityCacheKey } from "./run-cached-quality-check"

const roots: string[] = []

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

test("quality cache key changes with source bytes but not unrelated files", async () => {
  const root = fixture()
  const options = {
    cacheId: "heavy-check",
    root,
    workdir: ".",
    inputs: ["subject"],
    command: ["bun", "test"],
  }
  const initial = await qualityCacheKey(options)
  writeFileSync(join(root, "unrelated.txt"), "changed\n")
  expect(await qualityCacheKey(options)).toBe(initial)
  writeFileSync(join(root, "subject", "source.ts"), "export const value = 2\n")
  expect(await qualityCacheKey(options)).not.toBe(initial)
})

test("CI and explicit fresh mode never reuse local quality receipts", () => {
  expect(cacheReuseAllowed({})).toBe(true)
  expect(cacheReuseAllowed({ CI: "true" })).toBe(false)
  expect(cacheReuseAllowed({ QUALITY_FRESH: "1" })).toBe(false)
})

function fixture(): string {
  const root = mkdtempSync(join(tmpdir(), "trade-quality-cache-"))
  roots.push(root)
  mkdirSync(join(root, "subject"))
  writeFileSync(join(root, "subject", "source.ts"), "export const value = 1\n")
  run(root, ["git", "init", "-q"])
  run(root, ["git", "add", "subject/source.ts"])
  return root
}

function run(cwd: string, command: string[]): void {
  const result = Bun.spawnSync(command, { cwd, stdout: "pipe", stderr: "pipe" })
  if (result.exitCode !== 0) throw new Error(result.stderr.toString())
}
