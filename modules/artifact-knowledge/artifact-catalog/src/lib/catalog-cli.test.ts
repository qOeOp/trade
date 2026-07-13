import assert from "node:assert/strict"
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import test from "node:test"
import { run } from "../scripts/main"
import { repoRoot } from "./paths"

type JSONRecord = Record<string, unknown>

test("artifact catalog CLI exposes direct register and stored record commands", () => {
  const dir = mkdtempSync(join(tmpdir(), "artifact-catalog-cli-"))
  const catalogDbPath = join(dir, "data_catalog.db")
  const artifactPath = join(dir, "research-report.json")
  writeFileSync(artifactPath, JSON.stringify({ report_kind: "cli_contract", created_at: "2026-07-11T00:00:00.000Z" }))

  const registered = run([
    "--catalog-register-artifact",
    "--json",
    JSON.stringify({
      catalog_db_path: catalogDbPath,
      path: artifactPath,
      now: "2026-07-11T00:00:00.000Z",
      referrer_type: "run",
      referrer_id: "rnd-cli-1",
      role: "output",
    }),
  ])
  assert.equal(registered.ok, true)
  assert.equal(asRecord(registered.data).artifacts_upserted, 1)

  const evidenceRecord = {
    evidence_id: "ev-cli-1",
    strategy_id: "S-CLI",
    setup_id: "default",
    kind: "shadow",
    policy_hash: "policy-cli",
    source_ref: artifactPath,
    created_at: "2026-07-11T00:00:00.000Z",
    stats: { sample_count: 3, avg_r: 0.2, total_r: 0.6 },
  }
  const evidenceUpsert = run([
    "--catalog-upsert-strategy-evidence",
    "--json",
    JSON.stringify({ catalog_db_path: catalogDbPath, record: evidenceRecord, now: "2026-07-11T00:00:00.000Z" }),
  ])
  assert.equal(evidenceUpsert.ok, true)
  assert.equal(asRecord(evidenceUpsert.data).evidence_id, "ev-cli-1")

  const evidenceList = run([
    "--catalog-list-strategy-evidence",
    "--json",
    JSON.stringify({ catalog_db_path: catalogDbPath, strategy_id: "S-CLI", limit: 10 }),
  ])
  assert.equal(evidenceList.ok, true)
  assert.equal(asArray(evidenceList.data).length, 1)
  assert.equal(asRecord(asArray(evidenceList.data)[0]).evidence_id, "ev-cli-1")

  const rndRecord = {
    run_id: "rnd-cli-1",
    created_at: "2026-07-11T00:00:00.000Z",
    artifact_ref: artifactPath,
    outcome: "no_promote",
    trial_count: 1,
    accepted_count: 0,
    stage: "selection_validation",
  }
  const rndUpsert = run([
    "--catalog-upsert-strategy-rnd-run",
    "--json",
    JSON.stringify({ catalog_db_path: catalogDbPath, record: rndRecord, now: "2026-07-11T00:00:00.000Z" }),
  ])
  assert.equal(rndUpsert.ok, true)
  assert.equal(asRecord(rndUpsert.data).run_id, "rnd-cli-1")

  const rndList = run([
    "--catalog-list-strategy-rnd-runs",
    "--json",
    JSON.stringify({ catalog_db_path: catalogDbPath, limit: 10 }),
  ])
  assert.equal(rndList.ok, true)
  assert.equal(asArray(rndList.data).length, 1)
  assert.equal(asRecord(asArray(rndList.data)[0]).run_id, "rnd-cli-1")
})

test("artifact catalog CLI exposes native J06 catalog hygiene job result", () => {
  const root = join(repoRoot(), "tmp", `artifact-catalog-j06-${Date.now()}`)
  const catalogDbPath = join(root, "data_catalog.db")
  try {
    mkdirSync(root, { recursive: true })
    writeFileSync(join(root, "sample-report.json"), JSON.stringify({ report_kind: "j06_contract", created_at: "2026-07-11T00:00:00.000Z" }))

    const result = run([
      "--catalog-hygiene-job",
      "--catalog-db",
      catalogDbPath,
      "--catalog-root",
      root,
      "--json",
      JSON.stringify({
        cycle_id: "cycle-j06-cli",
        ticket_no: "J06",
        job_id: "catalog_hygiene_scan",
        now: "2026-07-11T00:00:00.000Z",
      }),
    ])

    assert.equal(result.ok, true)
    const data = asRecord(result.data)
    const runtimeResult = asRecord(data.runtime_result)
    assert.equal(runtimeResult.schema_id, "trade.domain-runtime.domain-job-result.v1")
    assert.equal(runtimeResult.domain, "artifact-knowledge")
    assert.equal(runtimeResult.job_id, "catalog_hygiene_scan")
    assert.equal(runtimeResult.status, "ok")
    assert.deepEqual(runtimeResult.writes, { artifact_catalog: true })
    assert.equal(asRecord(data.scan).artifacts_upserted, 1)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

function asRecord(value: unknown): JSONRecord {
  return value && typeof value === "object" && !Array.isArray(value) ? value as JSONRecord : {}
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : []
}
