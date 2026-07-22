import { describe, expect, test } from "bun:test"
import { join } from "node:path"
import {
  assertHistoricalArtifactReadMigrationFixturePack,
  loadHistoricalArtifactReadMigrationFixturePack,
  readHistoricalArtifactManifest,
  type HistoricalArtifactReadMigrationFixturePack,
} from "./historical-artifact-read-migration"

const FIXTURE_PATH = join(import.meta.dir, "../../fixtures/historical-artifact-read-migration-v1.json")

describe("historical Artifact read migration", () => {
  test("stored P10/P11/P13 manifests remain exactly readable without current-epoch writes", () => {
    const pack = loadHistoricalArtifactReadMigrationFixturePack(FIXTURE_PATH)
    const before = JSON.stringify(pack)

    assertHistoricalArtifactReadMigrationFixturePack(pack)
    const first = pack.artifacts.map((entry) =>
      readHistoricalArtifactManifest(entry.capability, entry.manifest))
    const second = pack.artifacts.map((entry) =>
      readHistoricalArtifactManifest(entry.capability, entry.manifest))

    expect(first).toEqual(second)
    expect(first.map((entry) => entry.capability)).toEqual(["M4-P10", "M4-P11", "M4-P13"])
    expect(first.every((entry) => entry.migration_status === "readable-legacy-no-write")).toBeTrue()
    expect(JSON.stringify(pack)).toBe(before)
    expect(pack.read_policy.current_epoch_write).toBe("forbidden")
    expect(pack.read_policy.economic_reinterpretation).toBe("forbidden")
  })

  test("reader fails closed on unknown schema, role drift, or manifest tamper", () => {
    const source = loadHistoricalArtifactReadMigrationFixturePack(FIXTURE_PATH)

    const schemaTamper = structuredClone(source)
    schemaTamper.artifacts[0]!.manifest.schema_version =
      "trade.rd-replay-portfolio-reallocation-artifact-manifest.v2" as never
    expect(() => readHistoricalArtifactManifest(
      schemaTamper.artifacts[0]!.capability,
      schemaTamper.artifacts[0]!.manifest,
    ))
      .toThrow("exact frozen version")

    const roleTamper = structuredClone(source)
    roleTamper.artifacts[1]!.manifest.files[0]!.role = "two_cycle_result" as never
    expect(() => readHistoricalArtifactManifest(
      roleTamper.artifacts[1]!.capability,
      roleTamper.artifacts[1]!.manifest,
    ))
      .toThrow("Artifact Manifest")

    const hashTamper = structuredClone(source)
    hashTamper.artifacts[2]!.manifest.manifest_hash = "0".repeat(64)
    expect(() => readHistoricalArtifactManifest(
      hashTamper.artifacts[2]!.capability,
      hashTamper.artifacts[2]!.manifest,
    ))
      .toThrow("Artifact Manifest")

    expect(() => readHistoricalArtifactManifest(
      "M4-P99" as never,
      source.artifacts[0]!.manifest,
    )).toThrow("capability is not certified")
  })

  test("fixture pack hash prevents silent expected-projection rewrites", () => {
    const pack = loadHistoricalArtifactReadMigrationFixturePack(FIXTURE_PATH)
    const tampered = structuredClone(pack) as HistoricalArtifactReadMigrationFixturePack
    tampered.artifacts[0]!.expected_projection.portfolio_id = "rewritten"

    expect(() => assertHistoricalArtifactReadMigrationFixturePack(tampered))
      .toThrow("fixture pack policy/hash drifted")
  })
})
