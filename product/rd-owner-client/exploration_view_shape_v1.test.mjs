import assert from "node:assert/strict"
import { readFile } from "node:fs/promises"
import test from "node:test"

import { validExplorationView } from "./consumer_projection_v1.ts"

const vectors = JSON.parse(await readFile(
  new URL("./fixtures/research_view_identity_vectors_v4.json", import.meta.url), "utf8",
))
const { composer_artifact: composer, exploration } = vectors.view
const clone = (value) => JSON.parse(JSON.stringify(value))

test("the pinned view's structures satisfy the shape the producing side accepts", () => {
  assert.equal(validExplorationView(composer, exploration), true)
})

// Each case names one fact and breaks only that fact. A single "a malformed view is refused" case
// would pass whenever the check fails for any reason, including a reason unrelated to the fact.
test("each derived locator is refused when it stops following its digest", () => {
  for (const [key, value] of [
    ["artifact_locator", "rd-strategy-artifact-v2-" + "0".repeat(64)],
    ["artifact_family_binding_identity", "rd-composer-artifact-family-binding-v3-" + "0".repeat(64)],
    ["artifact_family_binding_receipt_identity", "rd-exploratory-replay-receipt-v2-" + "7".repeat(64)],
  ]) {
    const broken = clone(composer)
    broken[key] = value
    assert.equal(validExplorationView(broken, exploration), false, key)
  }
})

// These three are what make "both structures describe the same family and census cut" decidable
// rather than assumed from the two sitting next to each other.
test("the two structures must agree on the family and the census cut", () => {
  for (const key of ["trial_family_identity", "census_frontier_identity", "census_frontier_digest"]) {
    const broken = clone(exploration)
    broken[key] = key === "census_frontier_digest" ? `sha256:${"9".repeat(64)}` : "other"
    assert.equal(validExplorationView(composer, broken), false, key)
  }
})

test("a structure with a field added or removed is refused", () => {
  const extra = { ...clone(composer), unexpected: "x" }
  assert.equal(validExplorationView(extra, exploration), false)
  const missing = clone(exploration)
  delete missing.replay_receipt_identity
  assert.equal(validExplorationView(composer, missing), false)
  assert.equal(validExplorationView(null, exploration), false)
  assert.equal(validExplorationView(composer, null), false)
})
