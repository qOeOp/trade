import { afterEach, describe, expect, test } from "bun:test"
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"

const judge = join(import.meta.dir, "check-test-source-boundaries.ts")
const roots: string[] = []

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

describe("test source boundaries", () => {
  test("allows test runtimes in tests and test-support", () => {
    const root = fixture({
      "modules/example/src/example.test.ts": 'import { test } from "bun:test"\n',
      "modules/example/src/test-support/fixture.ts": 'import { expect } from "bun:test"\n',
      "modules/example/src/main.ts": 'import { value } from "./value"\n',
    })
    expect(run(root).exitCode).toBe(0)
  })

  test("rejects a test runtime imported by production source", () => {
    const result = run(fixture({
      "modules/example/src/main.ts": 'import { expect } from "bun:test"\n',
    }))
    expect(result.exitCode).toBe(1)
    expect(result.stderr).toContain("production source imports test runtime bun:test")
  })

  test("rejects test-support imported by production source", () => {
    const result = run(fixture({
      "modules/example/src/main.ts": 'const fixture = require("./test-support/fixture")\n',
    }))
    expect(result.exitCode).toBe(1)
    expect(result.stderr).toContain("production source imports test-support module")
  })
})

function fixture(files: Record<string, string>): string {
  const root = mkdtempSync(join(tmpdir(), "test-source-boundaries-"))
  roots.push(root)
  for (const [path, content] of Object.entries(files)) write(root, path, content)
  return root
}

function write(root: string, relative: string, content: string): void {
  const path = join(root, relative)
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, content)
}

function run(root: string) {
  const result = Bun.spawnSync({
    cmd: ["bun", judge, "--root", root],
    cwd: root,
    stdout: "pipe",
    stderr: "pipe",
  })
  return {
    exitCode: result.exitCode,
    stderr: result.stderr.toString(),
  }
}
