import { Database } from "bun:sqlite"
import { expect, test } from "bun:test"
import {
  admitStrategySourceAdoption,
  completeStrategySourceAdoption,
  ensureStrategySourceAdoptionStoreSchema,
  listCertifiedStrategySourceAdoptions,
  listRecoverableStrategySourceAdoptions,
  readStrategySourceAdoption,
  startStrategySourceAdoption,
} from "./strategy-source-adoption-store"

test("Strategy source adoption is immutable, restart-readable, and terminally bound", () => {
  const db = new Database(":memory:")
  ensureStrategySourceAdoptionStoreSchema(db)
  const accepted = admitStrategySourceAdoption(db, {
    adoption_id: "strategy:candidate-1",
    source_candidate_manifest_ref:
      "data/release-candidates/strategy-drafts/one/candidate.json",
    source_candidate_manifest_hash: "a".repeat(64),
    source_revision: "0123456789abcdef",
    strategy_source_ref: "strategies/s-candidate-1.md",
    strategy_source_hash: "b".repeat(64),
    accepted_at: "2026-07-23T02:00:00.000Z",
  })
  expect(accepted.status).toBe("accepted")
  expect(listRecoverableStrategySourceAdoptions(db, 1)).toHaveLength(1)
  expect(() => admitStrategySourceAdoption(db, {
    ...accepted,
    source_revision: "other",
  })).toThrow("identity drifted")

  startStrategySourceAdoption(
    db,
    accepted.adoption_id,
    "2026-07-23T02:01:00.000Z",
  )
  const completed = completeStrategySourceAdoption(db, {
    schema_version: "trade.strategy-source-adoption-result.v1",
    adoption_id: accepted.adoption_id,
    source_candidate_manifest_hash: accepted.source_candidate_manifest_hash,
    base_source_revision: accepted.source_revision,
    base_source_commit: "c".repeat(40),
    candidate_source_revision: "d".repeat(40),
    adopted_strategy_ref: accepted.strategy_source_ref,
    certified_manifest_ref:
      "data/release-candidates/strategy-adoptions/one/manifest.json",
    certified_manifest_hash: "e".repeat(64),
    source_archive_ref:
      "data/release-candidates/strategy-adoptions/one/source.tar",
    source_archive_hash: "f".repeat(64),
    certified_at: "2026-07-23T02:02:00.000Z",
    deployment_authority: "none",
    trading_authority: false,
  })
  expect(completed.status).toBe("candidate_certified")
  expect(listRecoverableStrategySourceAdoptions(db, 1)).toEqual([])
  expect(listCertifiedStrategySourceAdoptions(db, 1)).toEqual([completed])
  expect(readStrategySourceAdoption(db, accepted.adoption_id)?.result)
    .toEqual(completed.result)
  expect(() => db.query(`
    UPDATE strategy_source_adoption SET source_revision='drift'
  `).run()).toThrow("immutable")
  db.close()
})
