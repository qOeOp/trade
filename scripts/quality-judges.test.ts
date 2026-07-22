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

  test("Replay capability inventory cannot grow a P30 treadmill", () => {
    const inventory = JSON.parse(readFileSync(
      join(repoRoot, "docs/research/reliability/rd-replay-capability-inventory.json"),
      "utf8",
    )) as { freeze: string; p30_creation: string }
    inventory.freeze = "M4-P30"
    inventory.p30_creation = "allowed"
    const root = temporaryRoot()
    const inventoryPath = join(root, "inventory.json")
    writeFileSync(inventoryPath, JSON.stringify(inventory))

    const result = runJudge("check-rd-replay-maturity-gate.ts", repoRoot, [], {
      RD_REPLAY_CAPABILITY_INVENTORY_PATH: inventoryPath,
    })

    expect(result.exitCode).toBe(1)
    expect(result.stderr).toContain("P30 forbidden")
  })

  test("Replay opt-in capability cannot bypass its activation registry", () => {
    const inventory = JSON.parse(readFileSync(
      join(repoRoot, "docs/research/reliability/rd-replay-capability-inventory.json"),
      "utf8",
    )) as { opt_in_activation_registry: unknown[] }
    inventory.opt_in_activation_registry = inventory.opt_in_activation_registry.slice(1)
    const root = temporaryRoot()
    const inventoryPath = join(root, "inventory.json")
    writeFileSync(inventoryPath, JSON.stringify(inventory))

    const result = runJudge("check-rd-replay-maturity-gate.ts", repoRoot, [], {
      RD_REPLAY_CAPABILITY_INVENTORY_PATH: inventoryPath,
    })

    expect(result.exitCode).toBe(1)
    expect(result.stderr).toContain("cover every opt-in capability exactly once")
  })

  test("Replay compatibility consumer cannot move back into a canonical owner", () => {
    const inventory = JSON.parse(readFileSync(
      join(repoRoot, "docs/research/reliability/rd-replay-capability-inventory.json"),
      "utf8",
    )) as { compatibility_consumer_registry: Array<{ path: string }> }
    inventory.compatibility_consumer_registry[0]!.path =
      "modules/research-strategy-development/replay-execution-plane/runner/src/lib/replay-portfolio-reallocation-runner.ts"
    const root = temporaryRoot()
    const inventoryPath = join(root, "inventory.json")
    writeFileSync(inventoryPath, JSON.stringify(inventory))

    const result = runJudge("check-rd-replay-maturity-gate.ts", repoRoot, [], {
      RD_REPLAY_CAPABILITY_INVENTORY_PATH: inventoryPath,
    })

    expect(result.exitCode).toBe(1)
    expect(result.stderr).toContain("not isolated under its declared owner")
  })

  test("Replay generic evidence writer cannot reopen an older epoch", () => {
    const registry = JSON.parse(readFileSync(
      join(repoRoot, "docs/research/reliability/rd-replay-evidence-epoch-registry.json"),
      "utf8",
    )) as { generic_epochs: Array<{ schema_version: string }> }
    registry.generic_epochs[0]!.schema_version = "trade.rd-replay-result.v52"
    const root = temporaryRoot()
    const registryPath = join(root, "evidence-epochs.json")
    writeFileSync(registryPath, JSON.stringify(registry))

    const result = runJudge("check-rd-replay-maturity-gate.ts", repoRoot, [], {
      RD_REPLAY_EVIDENCE_EPOCH_REGISTRY_PATH: registryPath,
    })

    expect(result.exitCode).toBe(1)
    expect(result.stderr).toContain("do not match the frozen writer set")
  })

  test("Replay certification owner cannot omit a Plane package", () => {
    const registry = JSON.parse(readFileSync(
      join(repoRoot, "modules/research-strategy-development/replay-execution-plane/certification/replay-certification/replay-certification-suites.json"),
      "utf8",
    )) as { suites: unknown[] }
    registry.suites.pop()
    const root = temporaryRoot()
    const registryPath = join(root, "replay-certification-suites.json")
    writeFileSync(registryPath, JSON.stringify(registry))

    const result = runJudge("check-rd-replay-maturity-gate.ts", repoRoot, [], {
      RD_REPLAY_CERTIFICATION_REGISTRY_PATH: registryPath,
    })

    expect(result.exitCode).toBe(1)
    expect(result.stderr).toContain("classify every Plane package exactly once")
  })

  test("Replay module and production consumer closure cannot drift silently", () => {
    const registry = JSON.parse(readFileSync(
      join(repoRoot, "modules/research-strategy-development/replay-execution-plane/certification/replay-certification/replay-module-consumer-closure.json"),
      "utf8",
    )) as { observed_production_consumer_edge_count: number }
    registry.observed_production_consumer_edge_count -= 1
    const root = temporaryRoot()
    const registryPath = join(root, "replay-module-consumer-closure.json")
    writeFileSync(registryPath, JSON.stringify(registry))

    const result = runJudge("check-rd-replay-maturity-gate.ts", repoRoot, [], {
      RD_REPLAY_MODULE_CONSUMER_CLOSURE_PATH: registryPath,
    })

    expect(result.exitCode).toBe(1)
    expect(result.stderr).toContain("classify every production consumer edge")
  })

  test("Replay cross-process reproducibility bundle cannot drift silently", () => {
    const bundle = JSON.parse(readFileSync(
      join(repoRoot, "modules/research-strategy-development/replay-execution-plane/certification/replay-certification/replay-cross-process-reproducibility-bundle.json"),
      "utf8",
    )) as { bundle_sha256: string }
    bundle.bundle_sha256 = "0".repeat(64)
    const root = temporaryRoot()
    const bundlePath = join(root, "replay-cross-process-reproducibility-bundle.json")
    writeFileSync(bundlePath, JSON.stringify(bundle))

    const result = runJudge("check-rd-replay-maturity-gate.ts", repoRoot, [], {
      RD_REPLAY_CROSS_PROCESS_REPRODUCIBILITY_PATH: bundlePath,
    })

    expect(result.exitCode).toBe(1)
    expect(result.stderr).toContain("reproducibility bundle hash drifted")
  }, 15_000)

  test("Replay historical Artifact read migration fixture cannot drift silently", () => {
    const fixture = JSON.parse(readFileSync(
      join(repoRoot, "modules/research-strategy-development/replay-execution-plane/certification/legacy-portfolio-cycle-certification/fixtures/historical-artifact-read-migration-v1.json"),
      "utf8",
    )) as { artifacts: Array<{ manifest: { manifest_hash: string } }> }
    fixture.artifacts[0]!.manifest.manifest_hash = "0".repeat(64)
    const root = temporaryRoot()
    const fixturePath = join(root, "historical-artifact-read-migration-v1.json")
    writeFileSync(fixturePath, JSON.stringify(fixture))

    const result = runJudge("check-rd-replay-maturity-gate.ts", repoRoot, [], {
      RD_REPLAY_HISTORICAL_ARTIFACT_READ_MIGRATION_PATH: fixturePath,
    })

    expect(result.exitCode).toBe(1)
    expect(result.stderr).toContain("Historical Artifact read migration fixture pack policy/hash drifted")
  })

  test("Replay publication crash recovery bundle cannot overclaim exactly-once execution", () => {
    const bundle = JSON.parse(readFileSync(
      join(repoRoot, "modules/research-strategy-development/replay-execution-plane/certification/replay-certification/replay-publication-crash-recovery-bundle.json"),
      "utf8",
    )) as { exactly_once_scope: string }
    bundle.exactly_once_scope = "one-process-execution"
    const root = temporaryRoot()
    const bundlePath = join(root, "replay-publication-crash-recovery-bundle.json")
    writeFileSync(bundlePath, JSON.stringify(bundle))

    const result = runJudge("check-rd-replay-maturity-gate.ts", repoRoot, [], {
      RD_REPLAY_PUBLICATION_CRASH_RECOVERY_BUNDLE_PATH: bundlePath,
    })

    expect(result.exitCode).toBe(1)
    expect(result.stderr).toContain("unsupported Replay publication crash recovery bundle")
  })

  test("Replay capacity envelope cannot become a portable SLA or silent throughput claim", () => {
    const envelope = JSON.parse(readFileSync(
      join(repoRoot, "modules/research-strategy-development/replay-execution-plane/certification/replay-certification/replay-capacity-performance-envelope.json"),
      "utf8",
    )) as { timing_policy: string }
    envelope.timing_policy = "portable-performance-sla"
    const root = temporaryRoot()
    const envelopePath = join(root, "replay-capacity-performance-envelope.json")
    writeFileSync(envelopePath, JSON.stringify(envelope))

    const result = runJudge("check-rd-replay-maturity-gate.ts", repoRoot, [], {
      RD_REPLAY_CAPACITY_PERFORMANCE_ENVELOPE_PATH: envelopePath,
    })

    expect(result.exitCode).toBe(1)
    expect(result.stderr).toContain("unsupported Replay capacity/performance envelope")
  }, 15_000)

  test("Replay corruption detection cannot be upgraded to silent automatic repair", () => {
    const bundle = JSON.parse(readFileSync(
      join(repoRoot, "modules/research-strategy-development/replay-execution-plane/certification/replay-certification/replay-fault-corruption-recovery-bundle.json"),
      "utf8",
    )) as { corruption_policy: string }
    bundle.corruption_policy = "detect-and-automatically-repair"
    const root = temporaryRoot()
    const bundlePath = join(root, "replay-fault-corruption-recovery-bundle.json")
    writeFileSync(bundlePath, JSON.stringify(bundle))

    const result = runJudge("check-rd-replay-maturity-gate.ts", repoRoot, [], {
      RD_REPLAY_FAULT_CORRUPTION_RECOVERY_BUNDLE_PATH: bundlePath,
    })

    expect(result.exitCode).toBe(1)
    expect(result.stderr).toContain("unsupported Replay fault/corruption recovery bundle")
  }, 15_000)

  test("Replay local evidence cannot be overclaimed as central observability or an SLO", () => {
    const registry = JSON.parse(readFileSync(
      join(repoRoot, "modules/research-strategy-development/replay-execution-plane/certification/replay-certification/replay-operational-readiness.json"),
      "utf8",
    )) as { telemetry_boundary: string }
    registry.telemetry_boundary = "central-metrics-traces-alerting-and-slo-complete"
    const root = temporaryRoot()
    const registryPath = join(root, "replay-operational-readiness.json")
    writeFileSync(registryPath, JSON.stringify(registry))

    const result = runJudge("check-rd-replay-maturity-gate.ts", repoRoot, [], {
      RD_REPLAY_OPERATIONAL_READINESS_REGISTRY_PATH: registryPath,
    })

    expect(result.exitCode).toBe(1)
    expect(result.stderr).toContain("unsupported Replay operational readiness registry")
  }, 15_000)

  test("Replay fixture closure cannot be overclaimed as an independent release verdict", () => {
    const pack = JSON.parse(readFileSync(
      join(repoRoot, "modules/research-strategy-development/replay-execution-plane/certification/replay-certification/replay-release-candidate-fixture-pack.json"),
      "utf8",
    )) as { verdict_policy: string }
    pack.verdict_policy = "fixture-pack-is-independent-release-verdict"
    const root = temporaryRoot()
    const packPath = join(root, "replay-release-candidate-fixture-pack.json")
    writeFileSync(packPath, JSON.stringify(pack))

    const result = runJudge("check-rd-replay-maturity-gate.ts", repoRoot, [], {
      RD_REPLAY_RELEASE_CANDIDATE_FIXTURE_PACK_PATH: packPath,
    })

    expect(result.exitCode).toBe(1)
    expect(result.stderr).toContain("unsupported Replay release candidate fixture pack")
  }, 15_000)

  test("Replay release audit cannot be captured by the fixture-pack owner", () => {
    const audit = JSON.parse(readFileSync(
      join(repoRoot, "modules/research-strategy-development/research-control-plane/certification/replay-release-audit/replay-independent-release-audit.json"),
      "utf8",
    )) as { independence_policy: string }
    audit.independence_policy = "subject-owner-self-attestation"
    const root = temporaryRoot()
    const auditPath = join(root, "replay-independent-release-audit.json")
    writeFileSync(auditPath, JSON.stringify(audit))

    const result = runJudge("check-rd-replay-maturity-gate.ts", repoRoot, [], {
      RD_REPLAY_INDEPENDENT_RELEASE_AUDIT_PATH: auditPath,
    })

    expect(result.exitCode).toBe(1)
    expect(result.stderr).toContain("unsupported Replay independent release audit manifest")
  }, 15_000)

  test("Replay historical Artifact payload reader cannot drift silently", () => {
    const registry = JSON.parse(readFileSync(
      join(repoRoot, "modules/research-strategy-development/replay-execution-plane/certification/replay-certification/replay-historical-artifact-migration.json"),
      "utf8",
    )) as { reader_source_sha256: string }
    registry.reader_source_sha256 = "0".repeat(64)
    const root = temporaryRoot()
    const registryPath = join(root, "replay-historical-artifact-migration.json")
    writeFileSync(registryPath, JSON.stringify(registry))

    const result = runJudge("check-rd-replay-maturity-gate.ts", repoRoot, [], {
      RD_REPLAY_HISTORICAL_ARTIFACT_MIGRATION_REGISTRY_PATH: registryPath,
    })

    expect(result.exitCode).toBe(1)
    expect(result.stderr).toContain("historical Artifact reader source drifted")
  })

  test("package tests cannot report success for an empty suite", () => {
    const root = temporaryRoot()
    write(root, "modules/domain-a/tool-a/package.json", JSON.stringify({
      scripts: {
        test: "bun run test:unit",
        "test:unit": "if find src -name '*.test.ts' -type f | grep -q .; then bun test ./src/**/*.test.ts; else printf 'test: no test files\\n'; fi",
      },
    }))
    write(root, "modules/domain-a/tool-a/src/main.ts", "export const value = true\n")

    const result = runJudge("check-package-tests.ts", root)

    expect(result.exitCode).toBe(1)
    expect(result.stderr).toContain("has no colocated test file")
    expect(result.stderr).toContain("no empty-suite fallback is allowed")
  })

  test("document contracts reject an invented current status even when the index agrees", () => {
    const root = documentContractFixture({ status: "invented-status" })

    const result = runJudge("check-doc-contracts.ts", root)

    expect(result.exitCode).toBe(1)
    expect(result.stderr).toContain("has unsupported current document status: invented-status")
  })

  test("document contracts reject an owner with no governance, domain, or module authority", () => {
    const root = documentContractFixture({ owner: "invented-owner" })

    const result = runJudge("check-doc-contracts.ts", root)

    expect(result.exitCode).toBe(1)
    expect(result.stderr).toContain("has unresolved current document owner: invented-owner")
  })

  test("package tests cannot omit a colocated test file", () => {
    const root = temporaryRoot()
    write(root, "modules/domain-a/tool-a/package.json", JSON.stringify({
      scripts: { test: "bun test ./src/covered.test.ts" },
    }))
    write(root, "modules/domain-a/tool-a/src/main.ts", "export const value = true\n")
    write(root, "modules/domain-a/tool-a/src/covered.test.ts", "export {}\n")
    write(root, "modules/domain-a/tool-a/src/omitted.test.ts", "export {}\n")

    const result = runJudge("check-package-tests.ts", root)

    expect(result.exitCode).toBe(1)
    expect(result.stderr).toContain("scripts.test does not cover src/omitted.test.ts")
  })

  test("Go formatting rejects an unformatted file instead of swallowing gofmt errors", () => {
    const root = temporaryRoot()
    write(root, "main.go", "package main\nfunc main(){println(\"bad\")}\n")

    const result = runCommand(["sh", join(repoRoot, "scripts/check-go-format.sh"), root], repoRoot)

    expect(result.exitCode).toBe(1)
    expect(result.stderr).toContain("gofmt required")
  })

  test("repository quality checks are single-instance and recover stale locks", () => {
    const root = temporaryRoot()
    const lock = join(root, "quality-check.lock")
    const script = join(repoRoot, "scripts/quality-lock.sh")
    const owner = String(process.pid)

    expect(runCommand(["sh", script, "acquire", lock, owner], repoRoot).exitCode).toBe(0)
    const duplicate = runCommand(["sh", script, "acquire", lock, owner], repoRoot)
    expect(duplicate.exitCode).toBe(1)
    expect(duplicate.stderr).toContain("another repository quality check is active")
    expect(runCommand(["sh", script, "release", lock, owner], repoRoot).exitCode).toBe(0)

    expect(runCommand(["sh", script, "acquire", lock, "99999999"], repoRoot).exitCode).toBe(0)
    expect(runCommand(["sh", script, "acquire", lock, owner], repoRoot).exitCode).toBe(0)
    expect(runCommand(["sh", script, "release", lock, owner], repoRoot).exitCode).toBe(0)
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

function documentContractFixture(overrides: { status?: string; owner?: string }): string {
  const root = temporaryRoot()
  const status = overrides.status ?? "active"
  const owner = overrides.owner ?? "architecture"
  const metadata = (title: string, role: string, documentStatus: string, owner: string) => [
    "---",
    `title: ${title}`,
    `role: ${role}`,
    `status: ${documentStatus}`,
    `owner: ${owner}`,
    "last_verified: 2026-07-22 CST",
    "---",
    "",
    `# ${title}`,
    "",
  ].join("\n")
  const documents = [
    { id: "docs-index", path: "docs/README.md", role: "documentation-index", status, owner },
    { id: "history-index", path: "docs/history/README.md", role: "history-index", status: "active", owner: "architecture" },
    { id: "risk-contract", path: "docs/runtime/risk-control-contract.md", role: "runtime-feature-contract", status: "active", owner: "policy-risk" },
  ]
  write(root, "docs/README.md", metadata("Documentation", "documentation-index", status, owner))
  write(root, "docs/history/README.md", metadata("History", "history-index", "active", "architecture"))
  write(root, "docs/runtime/risk-control-contract.md", metadata("Risk", "runtime-feature-contract", "active", "policy-risk"))
  write(root, "docs/engineering/doc-contract-index.json", JSON.stringify({
    schema_version: "trade.doc-contract-index.v1",
    documents,
  }))
  write(root, "docs/architecture/architecture-manifest.json", JSON.stringify({
    domains: [{ id: "policy-risk" }],
  }))
  write(root, "modules/contracts/preflight-contract/src/preflight.ts", "export const guards = []\n")
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
  return runCommand(["bun", join(repoRoot, "scripts", script), ...args], cwd, env)
}

function runCommand(
  cmd: string[],
  cwd: string,
  env: Record<string, string> = {},
): { exitCode: number; stdout: string; stderr: string } {
  const result = Bun.spawnSync({
    cmd,
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
