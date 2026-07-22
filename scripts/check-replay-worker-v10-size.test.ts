import { afterEach, describe, expect, test } from "bun:test"
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"

const judge = join(import.meta.dir, "check-replay-worker-v10-size.ts")
const roots: string[] = []

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

describe("replay worker-v10 size judge", () => {
  test("accepts files at the fixed limits", () => {
    const root = fixture({ main: 800, support: 260, fixture: 200 })
    expect(run(root).exitCode).toBe(0)
  })

  test("rejects a main test above 800 lines", () => {
    const result = run(fixture({ main: 801, support: 1, fixture: 1 }))
    expect(result.exitCode).toBe(1)
    expect(result.stderr).toContain("main test")
    expect(result.stderr).toContain("801 > 800")
  })

  test("rejects support code above 260 lines", () => {
    const result = run(fixture({ main: 1, support: 261, fixture: 1 }))
    expect(result.exitCode).toBe(1)
    expect(result.stderr).toContain("support")
    expect(result.stderr).toContain("261 > 260")
  })

  test("rejects fixtures above 200 lines", () => {
    const result = run(fixture({ main: 1, support: 1, fixture: 201 }))
    expect(result.exitCode).toBe(1)
    expect(result.stderr).toContain("fixture")
    expect(result.stderr).toContain("201 > 200")
  })
})

function fixture(lines: { main: number; support: number; fixture: number }): string {
  const root = mkdtempSync(join(tmpdir(), "worker-v10-size-"))
  roots.push(root)
  write(root,
    "modules/research-strategy-development/replay-execution-plane/runner/src/lib/replay-decision-worker-input-assembly-v4.test.ts",
    source(lines.main))
  write(root,
    "modules/research-strategy-development/replay-execution-plane/runner/src/lib/replay-worker-v10-support.ts",
    source(lines.support))
  write(root,
    "modules/research-strategy-development/replay-execution-plane/runner/src/lib/replay-worker-v10-data-fixture.ts",
    source(lines.fixture))
  return root
}

function source(lines: number): string {
  return Array.from({ length: lines }, (_, index) => `export const line${index} = ${index}`).join("\n") + "\n"
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
