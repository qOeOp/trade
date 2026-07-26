import { afterEach, describe, expect, test } from "bun:test"
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs"
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

  test("TS boundaries do not grant tests a blanket cross-tool import pass", () => {
    const root = architectureFixture()
    write(root, "modules/domain-a/tool-a/src/main.test.ts", 'import "../../../domain-b/tool-b/src/main"\n')

    const result = runJudge("check-ts-tool-boundaries.ts", root)

    expect(result.exitCode).toBe(1)
    expect(result.stderr).toContain("modules/domain-a/tool-a/src/main.test.ts")
    expect(result.stderr).toContain("modules/domain-b/tool-b")
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
    )) as { reader_export: string }
    registry.reader_export = "missingHistoricalReader"
    const root = temporaryRoot()
    const registryPath = join(root, "replay-historical-artifact-migration.json")
    writeFileSync(registryPath, JSON.stringify(registry))

    const result = runJudge("check-rd-replay-maturity-gate.ts", repoRoot, [], {
      RD_REPLAY_HISTORICAL_ARTIFACT_MIGRATION_REGISTRY_PATH: registryPath,
    })

    expect(result.exitCode).toBe(1)
    expect(result.stderr).toContain("historical Artifact reader export is missing")
  })

  test("production TypeScript packages require colocated tests", () => {
    const root = temporaryRoot()
    write(root, "modules/domain-a/tool-a/package.json", "{}\n")
    write(root, "modules/domain-a/tool-a/tsconfig.json", "{}\n")
    write(root, "modules/domain-a/tool-a/src/main.ts", "export const value = true\n")

    const result = runJudge("check-package-tests.ts", root)

    expect(result.exitCode).toBe(1)
    expect(result.stderr).toContain("has no colocated test file")
  })

  test("direct package execution ignores no-op scripts and observes compiler and test outcomes", () => {
    const root = temporaryRoot()
    symlinkSync(join(repoRoot, "node_modules"), join(root, "node_modules"), "dir")
    write(root, "modules/domain-a/tool-a/package.json", JSON.stringify({
      scripts: {
        test: "bun test --only",
        check: "true || bun test ./src/main.test.ts # && tsc --noEmit",
      },
    }))
    write(root, "modules/domain-a/tool-a/tsconfig.json", JSON.stringify({
      compilerOptions: { strict: true, skipLibCheck: true, types: ["bun"] },
      include: ["src/**/*.ts"],
    }))
    write(root, "modules/domain-a/tool-a/src/main.ts", "export const value: string = 1\n")
    write(root, "modules/domain-a/tool-a/src/main.test.ts", [
      'import { expect, test } from "bun:test"',
      'test("fixture", () => expect(true).toBe(true))',
      "",
    ].join("\n"))

    const typeFailure = runJudge(
      "check-package-tests.ts",
      root,
      ["--run-package", "modules/domain-a/tool-a"],
    )
    expect(typeFailure.exitCode).toBe(1)
    expect(`${typeFailure.stdout}\n${typeFailure.stderr}`).toContain(
      "Type 'number' is not assignable to type 'string'",
    )

    write(root, "modules/domain-a/tool-a/src/main.ts", 'export const value = "valid"\n')
    write(root, "modules/domain-a/tool-a/src/main.test.ts", [
      'import { expect, test } from "bun:test"',
      'test("fixture", () => expect(false).toBe(true))',
      "",
    ].join("\n"))
    const testFailure = runJudge(
      "check-package-tests.ts",
      root,
      ["--run-package", "modules/domain-a/tool-a"],
    )
    expect(testFailure.exitCode).toBe(1)
    expect(`${testFailure.stdout}\n${testFailure.stderr}`).toContain("1 fail")

    write(root, "modules/domain-a/tool-a/src/main.test.ts", [
      'import { expect, test } from "bun:test"',
      'test("fixture", () => expect(true).toBe(true))',
      "",
    ].join("\n"))
    const pass = runJudge(
      "check-package-tests.ts",
      root,
      ["--run-package", "modules/domain-a/tool-a"],
    )
    expect(pass.exitCode).toBe(0)
    expect(pass.stdout).toContain("compiled and tested 1 TypeScript packages directly")
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

  test("document contracts reject an invented role even when the index agrees", () => {
    const root = documentContractFixture({ role: "invented-role" })

    const result = runJudge("check-doc-contracts.ts", root)

    expect(result.exitCode).toBe(1)
    expect(result.stderr).toContain("has unsupported current document role: invented-role")
  })

  test("document contracts reject a known role paired with the wrong status", () => {
    const root = documentContractFixture({ role: "product-source-material" })

    const result = runJudge("check-doc-contracts.ts", root)

    expect(result.exitCode).toBe(1)
    expect(result.stderr).toContain("role product-source-material does not allow status: active")
  })

  test("document contracts reject duplicate frontmatter fields", () => {
    const root = documentContractFixture({})
    const path = join(root, "docs/README.md")
    writeFileSync(path, readFileSync(path, "utf8").replace("status: active", "status: proposed\nstatus: active"))

    const result = runJudge("check-doc-contracts.ts", root)

    expect(result.exitCode).toBe(1)
    expect(result.stderr).toContain("docs/README.md has duplicate frontmatter field: status")
  })

  test("document contracts reject a non-existent last_verified calendar date", () => {
    const root = documentContractFixture({ lastVerified: "2026-02-30 CST" })

    const result = runJudge("check-doc-contracts.ts", root)

    expect(result.exitCode).toBe(1)
    expect(result.stderr).toContain("has invalid last_verified: 2026-02-30 CST")
  })

  test("document contracts keep last_verified on the project CST date convention", () => {
    const root = documentContractFixture({ lastVerified: "2026-07-22 JST" })

    const result = runJudge("check-doc-contracts.ts", root)

    expect(result.exitCode).toBe(1)
    expect(result.stderr).toContain("expected YYYY-MM-DD CST")
  })

  test("document contracts require an index verification date", () => {
    const root = documentContractFixture({})
    const path = join(root, "docs/engineering/doc-contract-index.json")
    const index = JSON.parse(readFileSync(path, "utf8")) as { last_verified?: string }
    delete index.last_verified
    writeFileSync(path, JSON.stringify(index))

    const result = runJudge("check-doc-contracts.ts", root)

    expect(result.exitCode).toBe(1)
    expect(result.stderr).toContain("docs/engineering/doc-contract-index.json missing required field: last_verified")
  })

  test("document contracts reject an invalid index verification date", () => {
    const root = documentContractFixture({})
    const path = join(root, "docs/engineering/doc-contract-index.json")
    const index = JSON.parse(readFileSync(path, "utf8")) as { last_verified: string }
    index.last_verified = "2026-02-30 CST"
    writeFileSync(path, JSON.stringify(index))

    const result = runJudge("check-doc-contracts.ts", root)

    expect(result.exitCode).toBe(1)
    expect(result.stderr).toContain("docs/engineering/doc-contract-index.json has invalid last_verified: 2026-02-30 CST")
  })

  test("document contracts reject a current document without a top-level heading", () => {
    const root = documentContractFixture({})
    const path = join(root, "docs/README.md")
    writeFileSync(path, readFileSync(path, "utf8").replace("# Documentation", "## Documentation"))

    const result = runJudge("check-doc-contracts.ts", root)

    expect(result.exitCode).toBe(1)
    expect(result.stderr).toContain("must contain exactly one top-level heading; found 0")
  })

  test("document contracts reject multiple top-level headings in a current document", () => {
    const root = documentContractFixture({})
    const path = join(root, "docs/README.md")
    writeFileSync(path, `${readFileSync(path, "utf8")}# Duplicate\n`)

    const result = runJudge("check-doc-contracts.ts", root)

    expect(result.exitCode).toBe(1)
    expect(result.stderr).toContain("must contain exactly one top-level heading; found 2")
  })

  test("document contracts reject generated evidence masquerading as a current contract", () => {
    const root = documentContractFixture({})
    const generatedPath = "docs/architecture/generated/report.md"
    write(root, generatedPath, [
      "---",
      "title: Generated Report",
      "role: architecture-contract",
      "status: active",
      "owner: architecture",
      "last_verified: 2026-07-22 CST",
      "---",
      "",
      "# Generated Report",
      "",
    ].join("\n"))
    const indexPath = join(root, "docs/engineering/doc-contract-index.json")
    const index = JSON.parse(readFileSync(indexPath, "utf8")) as { documents: unknown[] }
    index.documents.push({
      id: "generated-report",
      path: generatedPath,
      role: "architecture-contract",
      status: "active",
      owner: "architecture",
    })
    writeFileSync(indexPath, JSON.stringify(index))

    const result = runJudge("check-doc-contracts.ts", root)

    expect(result.exitCode).toBe(1)
    expect(result.stderr).toContain(`indexed path is outside the current document scope: ${generatedPath}`)
  })

  test("document contracts reject an unstable document id", () => {
    const root = documentContractFixture({ id: "Docs Index" })

    const result = runJudge("check-doc-contracts.ts", root)

    expect(result.exitCode).toBe(1)
    expect(result.stderr).toContain("invalid document id: Docs Index")
  })

  test("document contracts bind document ids to their path namespace", () => {
    const root = documentContractFixture({ id: "runtime.documentation" })

    const result = runJudge("check-doc-contracts.ts", root)

    expect(result.exitCode).toBe(1)
    expect(result.stderr).toContain("docs/README.md document id must use docs namespace: runtime.documentation")
  })

  test("document contracts reject an absolute implementation reference", () => {
    const root = documentContractFixture({})
    const indexPath = join(root, "docs/engineering/doc-contract-index.json")
    const index = JSON.parse(readFileSync(indexPath, "utf8")) as {
      documents: Array<{ implementation_refs?: string[] }>
    }
    index.documents[0].implementation_refs = [root]
    writeFileSync(indexPath, JSON.stringify(index))

    const result = runJudge("check-doc-contracts.ts", root)

    expect(result.exitCode).toBe(1)
    expect(result.stderr).toContain("implementation_ref must be a normalized repository-relative path")
  })

  test("document contracts reject a non-canonical implementation reference", () => {
    const root = documentContractFixture({})
    const indexPath = join(root, "docs/engineering/doc-contract-index.json")
    const index = JSON.parse(readFileSync(indexPath, "utf8")) as {
      documents: Array<{ implementation_refs?: string[] }>
    }
    index.documents[0].implementation_refs = ["docs/../docs/README.md"]
    writeFileSync(indexPath, JSON.stringify(index))

    const result = runJudge("check-doc-contracts.ts", root)

    expect(result.exitCode).toBe(1)
    expect(result.stderr).toContain("implementation_ref must be a normalized repository-relative path")
  })

  test("document contracts reject duplicate implementation references", () => {
    const root = documentContractFixture({})
    const indexPath = join(root, "docs/engineering/doc-contract-index.json")
    const index = JSON.parse(readFileSync(indexPath, "utf8")) as {
      documents: Array<{ implementation_refs?: string[] }>
    }
    index.documents[0].implementation_refs = ["docs/README.md", "docs/README.md"]
    writeFileSync(indexPath, JSON.stringify(index))

    const result = runJudge("check-doc-contracts.ts", root)

    expect(result.exitCode).toBe(1)
    expect(result.stderr).toContain("has duplicate implementation_ref: docs/README.md")
  })

  test("document contracts reject an implementation symlink escaping the repository", () => {
    const root = documentContractFixture({})
    const external = temporaryRoot()
    symlinkSync(external, join(root, "external-link"), "dir")
    const indexPath = join(root, "docs/engineering/doc-contract-index.json")
    const index = JSON.parse(readFileSync(indexPath, "utf8")) as {
      documents: Array<{ implementation_refs?: string[] }>
    }
    index.documents[0].implementation_refs = ["external-link"]
    writeFileSync(indexPath, JSON.stringify(index))

    const result = runJudge("check-doc-contracts.ts", root)

    expect(result.exitCode).toBe(1)
    expect(result.stderr).toContain("implementation_ref resolves outside repository: external-link")
  })

  test("document contracts reject a local Markdown absolute path", () => {
    const root = documentContractFixture({})
    const path = join(root, "docs/README.md")
    writeFileSync(path, `${readFileSync(path, "utf8")}\n[local](${root})\n`)

    const result = runJudge("check-doc-contracts.ts", root)

    expect(result.exitCode).toBe(1)
    expect(result.stderr).toContain(`docs/README.md has non-repository local link: ${root}`)
  })

  test("document contracts reject a local Markdown link escaping the repository", () => {
    const root = documentContractFixture({})
    const path = join(root, "README.md")
    writeFileSync(path, "# Root\n\n[escape](../outside.md)\n")

    const result = runJudge("check-doc-contracts.ts", root)

    expect(result.exitCode).toBe(1)
    expect(result.stderr).toContain("README.md has local link escaping repository: ../outside.md")
  })

  test("document contracts reject a Markdown symlink escaping the repository", () => {
    const root = documentContractFixture({})
    const external = temporaryRoot()
    symlinkSync(external, join(root, "external-link"), "dir")
    writeFileSync(join(root, "README.md"), "# Root\n\n[escape](external-link)\n")

    const result = runJudge("check-doc-contracts.ts", root)

    expect(result.exitCode).toBe(1)
    expect(result.stderr).toContain("README.md has local link resolving outside repository: external-link")
  })

  test("document contracts contain workspace skill Markdown links", () => {
    const root = documentContractFixture({})
    write(root, ".agents/skills/example/SKILL.md", `# Example\n\n[local machine](${root})\n`)

    const result = runJudge("check-doc-contracts.ts", root)

    expect(result.exitCode).toBe(1)
    expect(result.stderr).toContain(`.agents/skills/example/SKILL.md has non-repository local link: ${root}`)
  })

  test("package tests cannot omit a colocated test file", () => {
    const root = temporaryRoot()
    symlinkSync(join(repoRoot, "node_modules"), join(root, "node_modules"), "dir")
    write(root, "modules/domain-a/tool-a/package.json", JSON.stringify({
      scripts: { test: "bun test ./src/covered.test.ts" },
    }))
    write(root, "modules/domain-a/tool-a/tsconfig.json", JSON.stringify({
      compilerOptions: { strict: true, skipLibCheck: true, types: ["bun"] },
      include: ["src/**/*.ts"],
    }))
    write(root, "modules/domain-a/tool-a/src/main.ts", "export const value = true\n")
    write(root, "modules/domain-a/tool-a/src/covered.test.ts", [
      'import { expect, test } from "bun:test"',
      'test("covered", () => expect(true).toBe(true))',
      "",
    ].join("\n"))
    write(root, "modules/domain-a/tool-a/src/omitted.test.ts", [
      'import { expect, test } from "bun:test"',
      'test("omitted", () => expect(false).toBe(true))',
      "",
    ].join("\n"))

    const result = runJudge(
      "check-package-tests.ts",
      root,
      ["--run-package", "modules/domain-a/tool-a"],
    )

    expect(result.exitCode).toBe(1)
    expect(`${result.stdout}\n${result.stderr}`).toContain("omitted.test.ts")
  })

  test("Replay package isolation cannot omit a colocated test file", () => {
    const root = temporaryRoot()
    const packageDir =
      "modules/research-strategy-development/replay-execution-plane/runner"
    symlinkSync(join(repoRoot, "node_modules"), join(root, "node_modules"), "dir")
    write(root, `${packageDir}/package.json`, JSON.stringify({
      scripts: { "test:remaining": "bun test ./src/lib/covered.test.ts" },
    }))
    write(root, `${packageDir}/tsconfig.json`, JSON.stringify({
      compilerOptions: { strict: true, skipLibCheck: true, types: ["bun"] },
      include: ["src/**/*.ts"],
    }))
    write(root, `${packageDir}/src/lib/main.ts`, "export const value = true\n")
    write(root, `${packageDir}/src/lib/covered.test.ts`, [
      'import { expect, test } from "bun:test"',
      'test("covered", () => expect(true).toBe(true))',
      "",
    ].join("\n"))
    write(root, `${packageDir}/src/lib/omitted.test.ts`, [
      'import { expect, test } from "bun:test"',
      "test(",
      '  "protective-stop cancel releases admission risk only after full-flat and rolls four committed cycles",',
      "  () => expect(false).toBe(true),",
      ")",
      "",
    ].join("\n"))
    write(root, `${packageDir}/src/lib/replay-decision-worker-input-assembly-v4.test.ts`, [
      'import { expect, test } from "bun:test"',
      'test("semantic worker", () => expect(true).toBe(true))',
      "",
    ].join("\n"))
    write(root, `${packageDir}/src/lib/replay-independent-lane-batch-runner.test.ts`, [
      'import { expect, test } from "bun:test"',
      "test(",
      '  "protective-stop cancel releases admission risk only after full-flat and rolls four committed cycles",',
      "  () => expect(true).toBe(true),",
      ")",
      "",
    ].join("\n"))

    const result = runJudge(
      "check-package-tests.ts",
      root,
      ["--run-package", packageDir],
    )

    expect(result.exitCode).toBe(1)
    expect(`${result.stdout}\n${result.stderr}`).toContain("omitted.test.ts")
  })

  test("package test shards are complete and mutually exclusive", () => {
    const root = temporaryRoot()
    symlinkSync(join(repoRoot, "node_modules"), join(root, "node_modules"), "dir")
    for (const name of ["tool-a", "tool-b"]) {
      write(root, `modules/domain-a/${name}/package.json`, JSON.stringify({ name, private: true }))
      write(root, `modules/domain-a/${name}/tsconfig.json`, JSON.stringify({
        compilerOptions: { strict: true, skipLibCheck: true, types: ["bun"] },
        include: ["src/**/*.ts"],
      }))
      write(root, `modules/domain-a/${name}/src/main.ts`, `export const value = ${JSON.stringify(name)}\n`)
      write(root, `modules/domain-a/${name}/src/main.test.ts`, [
        'import { expect, test } from "bun:test"',
        `test(${JSON.stringify(name)}, () => expect(true).toBe(true))`,
        "",
      ].join("\n"))
    }

    const first = runJudge("check-package-tests.ts", root, ["--run-shard", "0/2"])
    const second = runJudge("check-package-tests.ts", root, ["--run-shard", "1/2"])

    expect(first.exitCode).toBe(0)
    expect(second.exitCode).toBe(0)
    expect(first.stdout).toContain("package-test: modules/domain-a/tool-a")
    expect(first.stdout).not.toContain("package-test: modules/domain-a/tool-b")
    expect(second.stdout).toContain("package-test: modules/domain-a/tool-b")
    expect(second.stdout).not.toContain("package-test: modules/domain-a/tool-a")
  })

  test("ESLint rejects a TypeScript error with zero-warning policy", () => {
    const result = runCommand(
      [
        join(repoRoot, "node_modules", ".bin", "eslint"),
        "--max-warnings",
        "0",
        "--stdin",
        "--stdin-filename",
        "modules/quality-judge.ts",
      ],
      repoRoot,
      {},
      "const unsafe: any = 1\nconsole.log(unsafe)\n",
    )

    expect(result.exitCode).toBe(1)
    expect(result.stdout).toContain("@typescript-eslint/no-explicit-any")
  })

  test("duplication judge includes test code and permits zero clones", () => {
    const root = temporaryRoot()
    const duplicate = Array.from({ length: 24 }, (_, index) =>
      `  const duplicatedValue${index} = sourceValue + ${index}`
    ).join("\n")
    write(root, "modules/domain-a/tool-a/src/first.test.ts", [
      "export function first(sourceValue: number) {",
      duplicate,
      "  return duplicatedValue23",
      "}",
      "",
    ].join("\n"))
    write(root, "modules/domain-a/tool-a/src/second.test.ts", [
      "export function second(sourceValue: number) {",
      duplicate,
      "  return duplicatedValue23",
      "}",
      "",
    ].join("\n"))

    const result = runJudge("check-duplication.ts", repoRoot, ["--root", root])

    expect(result.exitCode).toBe(1)
    expect(result.stderr).toContain("duplicated code fragments increased")
  })

  test("Replay heavyweight tests are serial and individually exclusive", () => {
    const packageJson = JSON.parse(readFileSync(join(repoRoot,
      "modules/research-strategy-development/replay-execution-plane/runner/package.json"), "utf8")) as {
      scripts: Record<string, string>
    }
    const scripts = packageJson.scripts

    expect(scripts.test).toBe("bun run test:worker-v10 && bun run test:remaining")
    expect(scripts["test:remaining"]).toBe(
      "bun run test:remaining:main && bun run test:remaining:protective-stop-cancel-cycle",
    )
    expect(scripts["test:remaining:main"]).toContain("^(?!protective-stop cancel releases")
    for (const name of [
      "test:worker-v10",
      "test:remaining:main",
      "test:remaining:protective-stop-cancel-cycle",
    ]) {
      expect(scripts[name]).toContain("run-exclusive-test.sh replay-runner-heavyweight")
    }
    const semantic = readFileSync(join(repoRoot, "scripts/check-replay-semantic.sh"), "utf8")
    expect(semantic).toContain("REPLAY_TEST_PROFILE=1")
    expect(semantic).toContain("replay-decision-worker-input-assembly-v4.test.ts")
    expect(semantic).not.toContain("bun run test:worker-v10")
  })

  test("Go formatting rejects an unformatted file instead of swallowing gofmt errors", () => {
    const root = temporaryRoot()
    write(root, "main.go", "package main\nfunc main(){println(\"bad\")}\n")

    const result = runCommand(["sh", join(repoRoot, "scripts/check-go-format.sh"), root], repoRoot)

    expect(result.exitCode).toBe(1)
    expect(result.stderr).toContain("gofmt required")
  })

  test("repository dependencies are installed before quality judges run", () => {
    const script = readFileSync(join(repoRoot, "scripts/quality-check.sh"), "utf8")
    const packageJson = JSON.parse(readFileSync(join(repoRoot, "package.json"), "utf8")) as {
      scripts: Record<string, string>
    }

    expect(script).toContain([
      "  check_project_hygiene",
      "  check_shell",
      "  check_helpers",
      "  check_secrets",
      "  check_lint",
      "  check_toolset_manifest",
    ].join("\n"))
    expect(script).toContain([
      "  env \\",
      "    -u BINANCE_API_KEY \\",
      "    -u BINANCE_API_SECRET \\",
      "    -u SILICONFLOW_API_KEY \\",
      "    bun --no-env-file install --frozen-lockfile --ignore-scripts",
    ].join("\n"))
    expect(script.match(/bun --no-env-file install --frozen-lockfile --ignore-scripts/g)).toHaveLength(1)
    expect(script).toContain('quality_home="$HOME"')
    expect(script).toContain('while [ "${quality_home%/}" != "$quality_home" ]; do')
    expect(script).toContain('quality_home="${quality_home%/}"')
    expect(script).toContain("previous_boundary && next_boundary")
    expect(script).toContain("exit(found ? 0 : 1)")
    expect(script).toContain('quality_home_candidates="$(')
    expect(script).toContain("rg --no-config")
    expect(script).toContain('home = ENVIRON["QUALITY_HOME"]')
    expect(script).toContain('if [ "$quality_home_scan_status" -ne 1 ]; then')
    expect(script.match(/find_local_home_paths/g)).toHaveLength(2)
    expect(script).toContain("bun scripts/check-package-tests.ts --run-all")
    expect(script).toContain('bun scripts/check-package-tests.ts --run-shard "$QUALITY_TS_SHARD"')
    expect(script).toContain("git ls-files --cached --others --exclude-standard -- '*.sh'")
    expect(packageJson.scripts["lint:shell"]).toContain(
      "git ls-files --cached --others --exclude-standard -z -- '*.sh'",
    )
    expect(packageJson.scripts["lint:shell"]).not.toContain("scripts/*.sh")
    expect(script).not.toContain("bun run check")
    expect(script).toContain('git diff --no-renames --check "$QUALITY_DIFF_BASE"...HEAD')
    expect(script).toContain("git diff --no-renames --check HEAD")
  })

  test("HOME path scanning is boundary-aware and fails closed on scan errors", () => {
    const script = readFileSync(join(repoRoot, "scripts/quality-check.sh"), "utf8")
    const functionStart = script.indexOf("find_local_home_paths()")
    const functionEnd = script.indexOf("\ncheck_dependencies()", functionStart)
    const functionSource = script.slice(functionStart, functionEnd)
    const root = temporaryRoot()
    const rootHome = ["/ro", "ot"].join("")

    write(root, "README.md", [
      "catalog DB/roots",
      `cache_root=${rootHome}`,
      `{"cache_root":"${rootHome}"}`,
      `${rootHome}/project/file`,
      `link=file://${rootHome}/private/report.json`,
      `link=file://localhost${rootHome}/private/report.json`,
      `CACHE_DIR=\${CACHE_DIR:-${rootHome}/cache}`,
      `CACHE_DIR=\${CACHE_DIR-${rootHome}/cache}`,
      `CACHE_DIR=\${1-${rootHome}/cache}`,
      `CACHE_DIR=\${?-${rootHome}/cache}`,
      `CACHE=$PREFIX${rootHome}/private`,
      `cc -I${rootHome}/include`,
      `cc -isystem${rootHome}/include`,
      `cache_root=/tmp/..${rootHome}/private`,
      `cache_root=/${rootHome}/private`,
      "catalog/root/root",
      `catalog-${rootHome}`,
      `catalog$PREFIX${rootHome}/private`,
      `catalog-I${rootHome}/include`,
      `link=file://example.com${rootHome}/private/report.json`,
      `cache_root=/tmp/project/..${rootHome}/private`,
      `cache_root=/tmp/${rootHome}/private`,
      "/tmp/root",
      "/roots",
      "data/root.db",
      "",
    ].join("\n"))
    write(root, "AGENTS.md", "fixture\n")
    write(root, "docs/fixture.md", "fixture\n")
    write(root, "scripts/fixture.sh", "fixture\n")
    write(root, "modules/fixture.txt", "fixture\n")
    write(root, ".agents/fixture.md", "fixture\n")
    write(root, "toolset.json", "{}\n")
    write(root, "rg.conf", "--color=always\n")

    const boundary = runCommand(
      ["sh", "-c", `${functionSource}\nfind_local_home_paths`],
      root,
      { HOME: `${rootHome}/`, RIPGREP_CONFIG_PATH: join(root, "rg.conf") },
    )
    expect(boundary.exitCode).toBe(0)
    expect(boundary.stdout).toContain(`cache_root=${rootHome}`)
    expect(boundary.stdout).toContain(`{"cache_root":"${rootHome}"}`)
    expect(boundary.stdout).toContain(`${rootHome}/project/file`)
    expect(boundary.stdout).toContain(`link=file://${rootHome}/private/report.json`)
    expect(boundary.stdout).toContain(`link=file://localhost${rootHome}/private/report.json`)
    expect(boundary.stdout).toContain(`CACHE_DIR=\${CACHE_DIR:-${rootHome}/cache}`)
    expect(boundary.stdout).toContain(`CACHE_DIR=\${CACHE_DIR-${rootHome}/cache}`)
    expect(boundary.stdout).toContain(`CACHE_DIR=\${1-${rootHome}/cache}`)
    expect(boundary.stdout).toContain(`CACHE_DIR=\${?-${rootHome}/cache}`)
    expect(boundary.stdout).toContain(`CACHE=$PREFIX${rootHome}/private`)
    expect(boundary.stdout).toContain(`cc -I${rootHome}/include`)
    expect(boundary.stdout).toContain(`cc -isystem${rootHome}/include`)
    expect(boundary.stdout).toContain(`cache_root=/tmp/..${rootHome}/private`)
    expect(boundary.stdout).toContain(`cache_root=/${rootHome}/private`)
    expect(boundary.stdout).not.toContain("catalog/root/root")
    expect(boundary.stdout).not.toContain(`catalog-${rootHome}`)
    expect(boundary.stdout).not.toContain(`catalog$PREFIX${rootHome}/private`)
    expect(boundary.stdout).not.toContain(`catalog-I${rootHome}/include`)
    expect(boundary.stdout).not.toContain(`link=file://example.com${rootHome}/private/report.json`)
    expect(boundary.stdout).not.toContain(`cache_root=/tmp/project/..${rootHome}/private`)
    expect(boundary.stdout).not.toContain(`cache_root=/tmp/${rootHome}/private`)
    expect(boundary.stdout).not.toContain("DB/roots")
    expect(boundary.stdout).not.toContain("/tmp/root")
    expect(boundary.stdout).not.toContain("/roots")
    expect(boundary.stdout).not.toContain("data/root.db")

    const redundantTrailingSeparators = runCommand(
      ["sh", "-c", `${functionSource}\nfind_local_home_paths`],
      root,
      { HOME: `${rootHome}//` },
    )
    expect(redundantTrailingSeparators.exitCode).toBe(0)
    expect(redundantTrailingSeparators.stdout).toContain(`cache_root=${rootHome}`)

    const enterpriseHome = "/home/DOMAIN\\user"
    write(root, "README.md", `cache_root=${enterpriseHome}/project\n`)
    const enterprise = runCommand(
      ["sh", "-c", `${functionSource}\nfind_local_home_paths`],
      root,
      { HOME: enterpriseHome },
    )
    expect(enterprise.exitCode).toBe(0)
    expect(enterprise.stdout).toContain(enterpriseHome)

    const filesystemRoot = runCommand(
      ["sh", "-c", `${functionSource}\nfind_local_home_paths`],
      root,
      { HOME: "/" },
    )
    expect(filesystemRoot.exitCode).toBe(2)

    rmSync(join(root, "toolset.json"))
    const scanError = runCommand(
      ["sh", "-c", `${functionSource}\nfind_local_home_paths`],
      root,
      { HOME: `${rootHome}/` },
    )
    expect(scanError.exitCode).toBe(2)
    expect(scanError.stderr).toContain("toolset.json")
  })

  test("dependency bootstrap cannot run lifecycle scripts with credentials reloaded from dotenv", () => {
    const root = temporaryRoot()
    write(root, "package.json", JSON.stringify({
      private: true,
      scripts: {
        postinstall: [
          "bun -e",
          `"require('node:fs').writeFileSync('credential.txt',`,
          "process.env.SILICONFLOW_API_KEY || 'missing')\"",
        ].join(" "),
      },
    }))
    expect(runCommand(["bun", "install", "--ignore-scripts"], root).exitCode).toBe(0)
    write(root, ".env", "SILICONFLOW_API_KEY=dotenv-secret\n")

    const result = runCommand([
      "env",
      "-u",
      "BINANCE_API_KEY",
      "-u",
      "BINANCE_API_SECRET",
      "-u",
      "SILICONFLOW_API_KEY",
      "bun",
      "--no-env-file",
      "install",
      "--frozen-lockfile",
      "--ignore-scripts",
    ], root, { SILICONFLOW_API_KEY: "process-secret" })

    expect(result.exitCode).toBe(0)
    expect(existsSync(join(root, "credential.txt"))).toBeFalse()
  })

  test("repository workflow checks the fetched candidate range", () => {
    const workflow = readFileSync(join(repoRoot, ".github/workflows/quality.yml"), "utf8")

    expect(workflow).toContain("fetch-depth: 0")
    expect(workflow).toContain(
      "QUALITY_DIFF_BASE: ${{ github.event.pull_request.base.sha || github.event.before }}",
    )
    expect(workflow).toContain("name: typescript-${{ matrix.name }}")
    expect(workflow).toContain("- name: even-packages\n            shard: 0/2")
    expect(workflow).toContain("- name: odd-packages\n            shard: 1/2")
    expect(workflow).toContain("QUALITY_TS_SHARD: ${{ matrix.shard }}")
    expect(workflow).toContain("if: ${{ always() }}")
    for (const result of [
      "needs.policy.result",
      "needs.typescript.result",
      "needs.replay.result",
      "needs.native.result",
    ]) {
      expect(workflow).toContain(result)
    }
  })

  test("CodeQL merge gate uses the high-precision default query suite", () => {
    const workflow = readFileSync(join(repoRoot, ".github/workflows/codeql.yml"), "utf8")

    for (const language of ["javascript-typescript", "python", "rust", "go"]) {
      expect(workflow).toContain(`language: ${language}`)
    }
    expect(workflow).not.toContain("queries:")
    expect(workflow).not.toContain("config-file:")
    expect(workflow).not.toContain("disable-default-queries:")
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

function documentContractFixture(
  overrides: { id?: string; status?: string; owner?: string; role?: string; lastVerified?: string },
): string {
  const root = temporaryRoot()
  const status = overrides.status ?? "active"
  const owner = overrides.owner ?? "architecture"
  const role = overrides.role ?? "documentation-index"
  const lastVerified = overrides.lastVerified ?? "2026-07-22 CST"
  const metadata = (
    title: string,
    role: string,
    documentStatus: string,
    owner: string,
    verified = "2026-07-22 CST",
  ) => [
    "---",
    `title: ${title}`,
    `role: ${role}`,
    `status: ${documentStatus}`,
    `owner: ${owner}`,
    `last_verified: ${verified}`,
    "---",
    "",
    `# ${title}`,
    "",
  ].join("\n")
  const documents = [
    { id: overrides.id ?? "docs.index", path: "docs/README.md", role, status, owner },
    { id: "docs.history-index", path: "docs/history/README.md", role: "history-index", status: "active", owner: "architecture" },
    { id: "runtime.risk-contract", path: "docs/runtime/risk-control-contract.md", role: "runtime-feature-contract", status: "active", owner: "policy-risk" },
  ]
  write(root, "docs/README.md", metadata("Documentation", role, status, owner, lastVerified))
  write(root, "docs/history/README.md", metadata("History", "history-index", "active", "architecture"))
  write(root, "docs/runtime/risk-control-contract.md", metadata("Risk", "runtime-feature-contract", "active", "policy-risk"))
  write(root, "docs/engineering/doc-contract-index.json", JSON.stringify({
    schema_version: "trade.doc-contract-index.v1",
    last_verified: "2026-07-22 CST",
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
  stdin?: string,
): { exitCode: number; stdout: string; stderr: string } {
  const result = Bun.spawnSync({
    cmd,
    cwd,
    env: { ...process.env, ...env },
    stdin: stdin === undefined ? "ignore" : new TextEncoder().encode(stdin),
    stdout: "pipe",
    stderr: "pipe",
  })
  return {
    exitCode: result.exitCode,
    stdout: result.stdout.toString(),
    stderr: result.stderr.toString(),
  }
}
