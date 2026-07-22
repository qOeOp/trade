import { afterEach, describe, expect, test } from "bun:test"
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"

const repoRoot = join(import.meta.dir, "..")
const temporaryRoots: string[] = []

afterEach(() => {
  for (const root of temporaryRoots.splice(0)) rmSync(root, { recursive: true, force: true })
})

describe("quality judges fail closed", () => {
  test("architecture drift rejects a static cross-domain import", () => {
    const root = architectureFixture()
    write(root, "modules/domain-a/tool-a/src/main.ts", 'import "../../../domain-b/tool-b/src/main"\n')

    const result = runJudge("architecture-drift-audit.ts", root)

    expect(result.exitCode).toBe(1)
    expect(result.stderr).toContain("cross-domain source import")
  })

  test("architecture drift and TS boundaries reject computed runtime imports", () => {
    const root = architectureFixture()
    write(root, "modules/domain-a/tool-a/src/main.ts", [
      'const target = "../../../domain-b/tool-b/src/main"',
      "export const load = () => import(target)",
      "",
    ].join("\n"))

    const drift = runJudge("architecture-drift-audit.ts", root)
    const boundary = runJudge("check-ts-tool-boundaries.ts", root)

    expect(drift.exitCode).toBe(1)
    expect(drift.stderr).toContain("dynamic import must use a static string literal")
    expect(boundary.exitCode).toBe(1)
    expect(boundary.stderr).toContain("dynamic import must use a static string literal")
  })

  test("architecture drift rejects job owner and target-domain mismatch", () => {
    const root = architectureFixture({
      jobs: [{
        ticket_no: "J01",
        job_id: "wrong_owner",
        target_domain: "domain-b",
        owner_module: "modules/domain-a/tool-a",
        writes: [],
      }],
    })

    const result = runJudge("architecture-drift-audit.ts", root)

    expect(result.exitCode).toBe(1)
    expect(result.stderr).toContain("job owner/target mismatch")
  })

  test("blueprint changes invalidate generated architecture evidence", () => {
    const root = architectureFixture()
    expect(runJudge("architecture-drift-audit.ts", root, ["--write"]).exitCode).toBe(0)
    write(root, "docs/architecture/architecture-overview-v2.mmd", "flowchart LR\n  changed --> blueprint\n")

    const result = runJudge("architecture-drift-audit.ts", root, ["--check"])

    expect(result.exitCode).toBe(1)
    expect(result.stderr).toContain("generated report is stale")
  })

  test("Replay maturity evidence must resolve to a real file", () => {
    const sourcePath = join(repoRoot, "docs/research/reliability/rd-replay-maturity-gate.json")
    const manifest = JSON.parse(readFileSync(sourcePath, "utf8")) as { evidence_refs: string[] }
    manifest.evidence_refs = ["does/not/exist/auditor-evidence.ts", ...manifest.evidence_refs.slice(1)]
    const root = temporaryRoot()
    const manifestPath = join(root, "gate.json")
    writeFileSync(manifestPath, JSON.stringify(manifest))

    const result = runJudge("check-rd-replay-maturity-gate.ts", repoRoot, [], {
      RD_REPLAY_MATURITY_GATE_PATH: manifestPath,
    })

    expect(result.exitCode).toBe(1)
    expect(result.stderr).toContain("evidence ref does not exist as a file")
  })

  test("package tests cannot report success for an empty suite", () => {
    const root = temporaryRoot()
    write(root, "modules/domain-a/tool-a/package.json", JSON.stringify({
      scripts: {
        test: "if find src -name '*.test.ts' -type f | grep -q .; then bun test ./src/**/*.test.ts; else printf 'test: no test files\\n'; fi",
      },
    }))
    write(root, "modules/domain-a/tool-a/src/main.ts", "export const value = true\n")

    const result = runJudge("check-package-tests.ts", root)

    expect(result.exitCode).toBe(1)
    expect(result.stderr).toContain("has no colocated test file")
    expect(result.stderr).toContain("no empty-suite fallback is allowed")
  })
})

function architectureFixture(overrides: { jobs?: unknown[] } = {}): string {
  const root = temporaryRoot()
  const manifest = {
    domains: [
      { id: "domain-a", status: "implemented", modules: ["modules/domain-a/tool-a"] },
      { id: "domain-b", status: "implemented", modules: ["modules/domain-b/tool-b"] },
    ],
    jobs: overrides.jobs ?? [],
    stores: [],
    rails: [],
  }
  write(root, "docs/architecture/architecture-manifest.json", JSON.stringify(manifest))
  write(root, "docs/architecture/architecture-overview-v2.mmd", "flowchart LR\n  a --> b\n")
  for (const [domain, tool] of [["domain-a", "tool-a"], ["domain-b", "tool-b"]]) {
    write(root, `modules/${domain}/${tool}/package.json`, JSON.stringify({ name: tool }))
    write(root, `modules/${domain}/${tool}/CONTRACT.md`, `# ${tool}\n`)
    write(root, `modules/${domain}/${tool}/src/main.ts`, "export const value = true\n")
  }
  write(root, "package.json", JSON.stringify({ dependencies: {}, devDependencies: {} }))
  return root
}

function temporaryRoot(): string {
  const root = mkdtempSync(join(tmpdir(), "trade-quality-judge-"))
  temporaryRoots.push(root)
  return root
}

function write(root: string, path: string, content: string): void {
  const target = join(root, path)
  mkdirSync(dirname(target), { recursive: true })
  writeFileSync(target, content)
}

function runJudge(
  script: string,
  cwd: string,
  args: string[] = [],
  env: Record<string, string> = {},
): { exitCode: number; stdout: string; stderr: string } {
  const result = Bun.spawnSync({
    cmd: ["bun", join(repoRoot, "scripts", script), ...args],
    cwd,
    env: { ...process.env, ...env },
    stdout: "pipe",
    stderr: "pipe",
  })
  return {
    exitCode: result.exitCode,
    stdout: result.stdout.toString(),
    stderr: result.stderr.toString(),
  }
}
