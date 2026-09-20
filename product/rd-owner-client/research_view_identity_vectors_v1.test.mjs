import assert from "node:assert/strict"
import { readFile } from "node:fs/promises"
import test from "node:test"

import { canonicalResearchViewIdentityV2 } from "./consumer_projection_v1.ts"

const vectors = JSON.parse(await readFile(
  new URL("./fixtures/research_view_identity_vectors_v1.json", import.meta.url), "utf8",
))

// This side and the producing side each compute the identity independently, and agreeing is the
// whole point: one shared implementation would remove the duplication and the check with it. The
// file both read is what makes a drift on either side visible from the other.
test("the Research View identity matches the pinned vector", async () => {
  assert.equal(await canonicalResearchViewIdentityV2(vectors.view), vectors.identity)
})

test("the identity the producing Owner assigned is the one this side derives", async () => {
  assert.equal(vectors.view.projection_identity, vectors.identity)
})

// A vector that only maps an input to an identity proves the mapping exists. It says nothing about
// whether the field order that produced it matters, and the order is the thing that silently drifts.
test("transposing two keys changes the identity", () => {
  const canonical = JSON.parse(vectors.canonical_bytes)
  const transposed = JSON.parse(vectors.order_sensitivity.canonical_bytes)
  assert.deepEqual(transposed, canonical, "the transposed vector must carry the same data")
  assert.notEqual(vectors.order_sensitivity.canonical_bytes, vectors.canonical_bytes)
  assert.notEqual(vectors.order_sensitivity.identity, vectors.identity)
  assert.deepEqual(
    Object.keys(transposed.value).slice(0, 3),
    ["schema_version", ...[...vectors.order_sensitivity.transposed_keys].reverse()],
  )
})

test("the vector's canonical bytes are what this side encodes", () => {
  assert.equal(JSON.stringify(JSON.parse(vectors.canonical_bytes)), vectors.canonical_bytes)
})
