import assert from "node:assert/strict"
import { readFile } from "node:fs/promises"
import test from "node:test"

const { projectResearchOwnerResultWithEvidenceV1 } = await import("./consumer_projection_v1.ts")

// Exact bytes the first-party Dashboard read API answered for one Research request the R&D Owner
// committed with the Catalog V3 seal and the Decision policy binding (2026-09-18). Every seal the
// Owner copies onto the family root, its receipt and its census frontier is present verbatim.
const accepted = JSON.parse(await readFile(new URL("./fixtures/research_accepted_catalog_v3.json", import.meta.url), "utf8"))
// The pre-seal shape the Dashboard suites were written against; it must keep projecting.
const legacy = JSON.parse(await readFile(new URL("../dashboard/tests/fixtures/research_accepted_v2.json", import.meta.url), "utf8"))

async function projected(value) {
  return projectResearchOwnerResultWithEvidenceV1(structuredClone(value), value.request_identity)
}

test("a Research custody sealed with Catalog V3 and the Decision policy projects as ACCEPTED", async () => {
  const result = await projected(accepted)
  assert.equal(result.verified, true)
  assert.equal(result.projection.resolution, "ACCEPTED")
  assert.equal(result.projection.trial_family_resolution, "AVAILABLE")
  assert.equal(result.projection.research_view.availability, "AVAILABLE")
  assert.equal(result.projection.next_legal_action, "REVIEW_ARTIFACT")
})

test("a Research custody formed before the Catalog V3 seal still projects as ACCEPTED", async () => {
  const result = await projected(legacy)
  assert.equal(result.verified, true)
  assert.equal(result.projection.resolution, "ACCEPTED")
})

test("a seal that drifts between the family root, its receipt and its census fails closed", async () => {
  for (const tamper of [
    (value) => { value.trial_family.census_frontier.replay_policy_catalog_v3.binding_digest[0] ^= 1 },
    (value) => { delete value.trial_family.root_receipt.replay_policy_catalog_v3 },
    (value) => { value.trial_family.root.policy.decision_policy_v1.replay_catalog_record_id = "another-record" },
    (value) => { value.trial_family.root.policy.decision_policy_v1.invented = true },
    (value) => { delete value.trial_family.root.policy.replay_policy_catalog_v3 },
    (value) => { value.trial_family.root.policy.replay_policy_catalog_v3.execution_profiles_v1.catalog_record_digest[3] ^= 1 },
  ]) {
    const value = structuredClone(accepted)
    tamper(value)
    const result = await projected(value)
    assert.equal(result.projection.resolution, "SUBMITTED_OR_UNKNOWN")
    assert.equal(result.verified, false)
  }
})
