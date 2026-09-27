import assert from "node:assert/strict"
import { createHash } from "node:crypto"
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
// Owner copies onto the family root, its receipt and its census frontier is present verbatim. The
// Owner began stating `request_schema_version` and `instrument_scope` later (2026-09-27); they were
// added as the values it states for this request, a V2 one: accepted with no initial PIT request.
const accepted = JSON.parse(await readFile(new URL("./fixtures/research_accepted_catalog_v3.json", import.meta.url), "utf8"))
// The pre-seal shape the Dashboard suites were written against; it must keep projecting.
const legacy = JSON.parse(await readFile(new URL("../dashboard/tests/fixtures/research_accepted_v2.json", import.meta.url), "utf8"))

// A V3 request's scope as the Owner states it.
const scope = { schema_version: 1, identities: ["BTCUSDT-PERP.BINANCE"] }

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
  // A stated initial PIT request is a V3 request's, so each is carried on one.
  const v3 = { ...accepted, request_schema_version: 3, instrument_scope: scope }
  for (const initialPit of initialPitVectors.accepted) {
    const result = await projected({ ...v3, initial_pit: initialPit })
    assert.equal(result.verified, true, JSON.stringify(initialPit))
    assert.equal(result.projection.resolution, "ACCEPTED", JSON.stringify(initialPit))
    assert.deepEqual(result.projection.initial_pit, initialPit)
  }
  assert.ok(initialPitVectors.refused.length >= 15)
  for (const { name, value } of initialPitVectors.refused) {
    const result = await projected({ ...v3, initial_pit: value })
    assert.equal(result.projection.resolution, "SUBMITTED_OR_UNKNOWN", name)
    assert.equal(result.projection.initial_pit, null, name)
  }
  // The same states on a V2 request are not ones the Owner can state.
  for (const initialPit of initialPitVectors.accepted) {
    const result = await projected({ ...accepted, initial_pit: initialPit })
    assert.equal(result.projection.resolution, "SUBMITTED_OR_UNKNOWN", JSON.stringify(initialPit))
  }
})

// The Owner reads the request version from the Product Edge admission and refuses a result whose
// scope disagrees with it, so a stated version arrives with exactly its scope: V2 with none, V3 with
// the one it was admitted with. Anything else is not a result the Owner can state.
const refusedVersionPairs = [
  ["V2 with a scope", 2, scope],
  ["V3 without a scope", 3, null],
  ["no version on a resolved result", null, null],
  ["an invented V1", 1, null],
  ["a version stated as text", "3", scope],
  ["a scope with another key", 3, { ...scope, identity: "BTCUSDT-PERP.BINANCE" }],
  ["a scope with no identities", 3, { schema_version: 1 }],
  ["an identity that is not text", 3, { schema_version: 1, identities: [7] }],
  ["a scope schema out of range", 3, { schema_version: 65_536, identities: [] }],
]

test("an accepted Research result carries the request version the Owner states, with exactly its scope", async () => {
  for (const [version, instrumentScope] of [[2, null], [3, scope]]) {
    const result = await projected({ ...accepted, request_schema_version: version, instrument_scope: instrumentScope })
    assert.equal(result.verified, true, String(version))
    assert.equal(result.projection.resolution, "ACCEPTED", String(version))
    assert.equal(result.projection.request_schema_version, version)
    assert.deepEqual(result.projection.instrument_scope, instrumentScope)
  }
  for (const [name, version, instrumentScope] of refusedVersionPairs) {
    const result = await projected({ ...accepted, request_schema_version: version, instrument_scope: instrumentScope })
    assert.equal(result.projection.resolution, "SUBMITTED_OR_UNKNOWN", name)
    assert.equal(result.projection.request_schema_version, null, name)
  }
  const { request_schema_version: _version, instrument_scope: _scope, ...unversioned } = accepted
  assert.equal((await projected(unversioned)).projection.resolution, "SUBMITTED_OR_UNKNOWN")
})

const rejectedDigest = `sha256:${"d".repeat(64)}`
const rejected = {
  schema_version: 2,
  resolution: "REJECTED_NO_WRITE",
  request_identity: "request-1",
  owner_receipt: {
    schema_version: 1,
    receipt_identity: `rd-research-request-receipt-v2-${
      createHash("sha256").update(`v2:request-1:${rejectedDigest}`).digest("hex")
    }`,
    request_identity: "request-1",
    semantic_digest: rejectedDigest,
    disposition: "REJECTED_NO_WRITE",
    resulting_research_intent_identity: null,
    committed_at_epoch_ms: 100,
    rejection_code: "INSTRUMENT_SCOPE_NOT_RESOLVABLE",
  },
  research_view: null,
  independence_basis: null,
  protected_feedback: null,
  trial_family_resolution: "UNAVAILABLE",
  trial_family: null,
  next_legal_action: "CORRECT_INPUT_AND_CREATE_SUCCESSOR_REQUEST",
  initial_pit: null,
  request_schema_version: 3,
  instrument_scope: scope,
}

// A rejected request is still the version it was admitted as. A V3 rejection keeps the scope it was
// admitted with, which the Owner may have rejected for not being canonical, so only its shape is
// checked here.
test("a rejected Research result states its version, and a V3 one the scope it was admitted with", async () => {
  const padded = { schema_version: 1, identities: [" BTCUSDT-PERP.BINANCE"] }
  for (const [version, instrumentScope] of [[3, scope], [3, padded], [2, null]]) {
    const result = await projected({ ...rejected, request_schema_version: version, instrument_scope: instrumentScope })
    assert.equal(result.verified, true, String(version))
    assert.equal(result.projection.resolution, "REJECTED_NO_WRITE", String(version))
    assert.equal(result.projection.request_schema_version, version)
    assert.deepEqual(result.projection.instrument_scope, instrumentScope)
  }
  for (const [name, version, instrumentScope] of refusedVersionPairs) {
    const result = await projected({ ...rejected, request_schema_version: version, instrument_scope: instrumentScope })
    assert.equal(result.projection.resolution, "SUBMITTED_OR_UNKNOWN", name)
  }
})

// The Owner states no version where it holds no current admitted request, and this side never
// supplies one: an unresolved and a legacy result state `null` for both, and anything else is not
// theirs.
test("an unresolved or legacy Research result states no request version", async () => {
  const unknown = unknownResearchProjectionV1("request-1", RESEARCH_OWNER_OPERATION_V2)
  assert.equal(unknown.request_schema_version, null)
  assert.equal(unknown.instrument_scope, null)
  const legacy = {
    ...rejected,
    resolution: "LEGACY_TERMINAL_QUARANTINED",
    next_legal_action: "RESOLVE_SAME_REQUEST_IDENTITY",
    request_schema_version: null,
    instrument_scope: null,
  }
  const result = await projected(legacy)
  assert.equal(result.projection.resolution, "LEGACY_TERMINAL_QUARANTINED")
  assert.equal(result.projection.request_schema_version, null)
  for (const [version, instrumentScope] of [[2, null], [3, scope], [1, null]]) {
    const stated = await projected({ ...legacy, request_schema_version: version, instrument_scope: instrumentScope })
    assert.equal(stated.projection.resolution, "SUBMITTED_OR_UNKNOWN", String(version))
  }
})
