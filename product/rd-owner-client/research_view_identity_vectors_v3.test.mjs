import assert from "node:assert/strict"
import { readFile } from "node:fs/promises"
import test from "node:test"

import { canonicalResearchViewIdentityV3 } from "./consumer_projection_v1.ts"

// Produced by the R&D Owner's own derivation for a legacy exploration View its own validator
// accepts, and pinned by the Owner's test through this same file.
const vectors = JSON.parse(await readFile(
  new URL("./fixtures/research_view_identity_vectors_v3.json", import.meta.url), "utf8",
))

test("the legacy exploration Research View identity matches the pinned vector", async () => {
  assert.equal(await canonicalResearchViewIdentityV3(vectors.view), vectors.identity)
  assert.equal(vectors.view.projection_identity, vectors.identity)
  assert.equal(vectors.view.schema_version, 2)
  assert.equal("composer_artifact" in vectors.view, false)
})

// Each variant carries the exact identity its specific mistake produces, so this asserts the
// derivation avoids that value rather than merely avoiding equality with the right one.
test("neither a transposed key pair nor the v4 envelope key produces this identity", async () => {
  const derived = await canonicalResearchViewIdentityV3(vectors.view)
  for (const variant of ["order_sensitivity", "envelope_key_sensitivity"]) {
    assert.notEqual(vectors[variant].identity, vectors.identity, variant)
    assert.notEqual(derived, vectors[variant].identity, variant)
  }
  assert.equal(vectors.envelope_key_sensitivity.wrong_key, "view")
  assert.deepEqual(
    JSON.parse(vectors.order_sensitivity.canonical_bytes).value,
    JSON.parse(vectors.canonical_bytes).value,
    "the transposed vector carries the same data",
  )
})
