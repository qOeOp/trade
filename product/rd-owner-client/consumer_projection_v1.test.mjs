import assert from "node:assert/strict"
import { readFile } from "node:fs/promises"
import test from "node:test"

const {
  projectResearchOwnerResultWithEvidenceV1,
  RESEARCH_OWNER_OPERATION_V2,
  RESEARCH_OWNER_OPERATION_V3,
  unknownResearchProjectionV1,
} = await import("./consumer_projection_v1.ts")

// Exact bytes the first-party Dashboard read API answered for one Research request the R&D Owner
// committed with the Catalog V3 seal and the Decision policy binding (2026-09-18). Every seal the
// Owner copies onto the family root, its receipt and its census frontier is present verbatim.
const accepted = JSON.parse(await readFile(new URL("./fixtures/research_accepted_catalog_v3.json", import.meta.url), "utf8"))
// The pre-seal shape the Dashboard suites were written against; it must keep projecting.
const legacy = JSON.parse(await readFile(new URL("../dashboard/tests/fixtures/research_accepted_v2.json", import.meta.url), "utf8"))

async function projected(value, operation = RESEARCH_OWNER_OPERATION_V2) {
  return projectResearchOwnerResultWithEvidenceV1(structuredClone(value), value.request_identity, operation)
}

// V2 and V3 answer in one shape, so the stamp says which operation the caller invoked, and a stamped
// projection verifies only as that operation.
test("a Research result is stamped with the operation the caller invoked, and verifies only as it", async () => {
  for (const [operation, schema] of [
    [RESEARCH_OWNER_OPERATION_V2, "sourced-research-goal-v2"],
    [RESEARCH_OWNER_OPERATION_V3, "sourced-research-goal-v3"],
  ]) {
    const result = await projected(accepted, operation)
    assert.equal(result.verified, true)
    assert.equal(result.projection.resolution, "ACCEPTED")
    assert.deepEqual(result.projection.consumer_projection, {
      schema_version: 1,
      operation: "research_goal.consumer_projection.v1",
      owner_operation: operation,
      owner_schema: schema,
    })
    // The same stamped projection presented as the other operation is not that operation's answer.
    const other = operation === RESEARCH_OWNER_OPERATION_V2 ? RESEARCH_OWNER_OPERATION_V3 : RESEARCH_OWNER_OPERATION_V2
    const crossed = await projectResearchOwnerResultWithEvidenceV1(
      structuredClone(result.projection), accepted.request_identity, other,
    )
    assert.equal(crossed.projection.resolution, "SUBMITTED_OR_UNKNOWN")
    assert.equal(crossed.verified, false)
    assert.equal(crossed.projection.consumer_projection.owner_operation, other)
  }
})

test("a stamp that pairs one operation with the other operation's schema verifies as neither", async () => {
  const stamped = (await projected(accepted, RESEARCH_OWNER_OPERATION_V3)).projection
  const mixed = {
    ...stamped,
    consumer_projection: { ...stamped.consumer_projection, owner_schema: "sourced-research-goal-v2" },
  }
  for (const operation of [RESEARCH_OWNER_OPERATION_V2, RESEARCH_OWNER_OPERATION_V3]) {
    const result = await projectResearchOwnerResultWithEvidenceV1(structuredClone(mixed), accepted.request_identity, operation)
    assert.equal(result.projection.resolution, "SUBMITTED_OR_UNKNOWN")
    assert.equal(result.verified, false)
  }
  // The unknown projection names the operation it stands in for.
  assert.equal(
    unknownResearchProjectionV1(accepted.request_identity, RESEARCH_OWNER_OPERATION_V3).consumer_projection.owner_schema,
    "sourced-research-goal-v3",
  )
})

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

// The same vectors the R&D Owner's test reads: it states exactly the accepted values, and this
// projection must carry each of them and fail closed on every refused one.
const initialPitVectors = JSON.parse(await readFile(
  new URL("./fixtures/research_initial_pit_state_vectors_v1.json", import.meta.url), "utf8",
))

test("an accepted Research result carries exactly the initial PIT states the Owner can state", async () => {
  assert.equal(initialPitVectors.accepted.length, 8)
  for (const initialPit of initialPitVectors.accepted) {
    const result = await projected({ ...accepted, initial_pit: initialPit })
    assert.equal(result.verified, true, JSON.stringify(initialPit))
    assert.equal(result.projection.resolution, "ACCEPTED", JSON.stringify(initialPit))
    assert.deepEqual(result.projection.initial_pit, initialPit)
  }
  assert.ok(initialPitVectors.refused.length >= 15)
  for (const { name, value } of initialPitVectors.refused) {
    const result = await projected({ ...accepted, initial_pit: value })
    assert.equal(result.projection.resolution, "SUBMITTED_OR_UNKNOWN", name)
    assert.equal(result.projection.initial_pit, null, name)
  }
})
