import { afterEach, describe, expect, test } from "bun:test"
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"

const judge = join(import.meta.dir, "../scripts/repository-package-checks.ts")
const roots: string[] = []

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { force: true, recursive: true })
})

describe("workspace package contracts", () => {
  test("executes an owned check without assuming its directory", () => {
    const root = fixture({
      "components/moved-service/package.json": manifest("service-contract", "bun -e 'console.log(\"service-ok\")'"),
    })

    const result = run(root, ["--run-package", "service-contract"])

    expect(result.exitCode).toBe(0)
    expect(result.stdout).toContain("service-ok")
    expect(result.stdout).toContain("executed 1 of 1 package checks")
  })

  test("fails closed for a missing or duplicate interface", () => {
    const missing = fixture({
      "one/package.json": JSON.stringify({ name: "missing-check", scripts: {} }),
    })
    expect(run(missing).stderr).toContain("requires scripts.check")

    const duplicate = fixture({
      "one/package.json": manifest("duplicate", "bun -e ''"),
      "two/package.json": manifest("duplicate", "bun -e ''"),
    })
    expect(run(duplicate).stderr).toContain("duplicate package contract name")
  })

  test("propagates the package check exit status", () => {
    const root = fixture({
      "service/package.json": manifest("failing-service", "bun -e 'process.exit(7)'"),
    })

    const result = run(root, ["--run-all"])

    expect(result.exitCode).not.toBe(0)
    expect(result.stderr).toContain("package contract failed: failing-service")
  })

  test("shards by stable package name rather than directory", () => {
    const root = fixture({
      "z-location/package.json": manifest("alpha", "bun -e 'console.log(\"alpha-ran\")'"),
      "a-location/package.json": manifest("beta", "bun -e 'console.log(\"beta-ran\")'"),
    })

    const first = run(root, ["--run-shard", "0/2"])
    const second = run(root, ["--run-shard", "1/2"])
    const output = `${first.stdout}\n${second.stdout}`

    expect(first.exitCode).toBe(0)
    expect(second.exitCode).toBe(0)
    expect(output.match(/alpha-ran/g)?.length).toBe(1)
    expect(output.match(/beta-ran/g)?.length).toBe(1)
  })

  test("rejects a concurrent full repository check", async () => {
    const root = fixture({
      "service/package.json": manifest("slow-service", "bun -e 'await Bun.sleep(500)'"),
    })
    const first = Bun.spawn(["bun", judge, "--run-all"], {
      cwd: root,
      stdout: "pipe",
      stderr: "pipe",
    })
    const ownerPath = join(root, "tmp/check/repository-package-checks.lock/owner-pid")
    for (let attempt = 0; attempt < 50 && !existsSync(ownerPath); attempt += 1) {
      await Bun.sleep(10)
    }

    const second = run(root, ["--run-all"])

    expect(second.exitCode).not.toBe(0)
    expect(second.stderr).toContain("repository package check is already active")
    expect(await first.exited).toBe(0)
    expect(existsSync(ownerPath)).toBe(false)
  })
})

function fixture(files: Record<string, string>): string {
  const root = mkdtempSync(join(tmpdir(), "trade-workspace-contracts-"))
  roots.push(root)
  for (const [path, content] of Object.entries(files)) {
    const target = join(root, path)
    mkdirSync(dirname(target), { recursive: true })
    writeFileSync(target, `${content}\n`)
  }
  command(root, ["git", "init", "-q"])
  command(root, ["git", "add", "."])
  return root
}

function manifest(name: string, check: string): string {
  return JSON.stringify({ name, scripts: { check } })
}

function run(root: string, args: string[] = []): { exitCode: number; stdout: string; stderr: string } {
  const result = Bun.spawnSync({
    cmd: ["bun", judge, ...args],
    cwd: root,
    stdout: "pipe",
    stderr: "pipe",
  })
  return {
    exitCode: result.exitCode,
    stdout: result.stdout.toString(),
    stderr: result.stderr.toString(),
  }
}

function command(root: string, cmd: string[]): void {
  const result = Bun.spawnSync({ cmd, cwd: root, stdout: "pipe", stderr: "pipe" })
  if (result.exitCode !== 0) throw new Error(result.stderr.toString())
}
