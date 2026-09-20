import assert from "node:assert/strict"
import { readFile } from "node:fs/promises"
import test from "node:test"

import { canonicalResearchViewIdentityV4 } from "./consumer_projection_v1.ts"

const vectors = JSON.parse(await readFile(
  new URL("./fixtures/research_view_identity_vectors_v4.json", import.meta.url), "utf8",
))

test("the schema 3 Research View identity matches the pinned vector", async () => {
  assert.equal(await canonicalResearchViewIdentityV4(vectors.view), vectors.identity)
})

test("the identity the producing side assigned is the one this side derives", async () => {
  assert.equal(vectors.view.projection_identity, vectors.identity)
})

// Not "the identity differs when something changes", which any unrelated failure would also satisfy.
// Each variant carries the exact identity its specific mistake produces, so this asserts the
// derivation avoids that value rather than merely avoiding equality with the right one.
test("neither a transposed key pair nor the v2 envelope key produces this identity", async () => {
  const derived = await canonicalResearchViewIdentityV4(vectors.view)
  for (const variant of ["order_sensitivity", "envelope_key_sensitivity"]) {
    assert.notEqual(vectors[variant].identity, vectors.identity, variant)
    assert.notEqual(derived, vectors[variant].identity, variant)
  }
  assert.equal(vectors.envelope_key_sensitivity.wrong_key, "value")
  assert.deepEqual(
    JSON.parse(vectors.order_sensitivity.canonical_bytes).view,
    JSON.parse(vectors.canonical_bytes).view,
    "the transposed vector must carry the same data",
  )
})

test("the vector's canonical bytes are what this side encodes", () => {
  assert.equal(JSON.stringify(JSON.parse(vectors.canonical_bytes)), vectors.canonical_bytes)
  assert.equal(Object.keys(JSON.parse(vectors.canonical_bytes))[1], "view")
})
