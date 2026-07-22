import assert from "node:assert/strict"
import { createHash } from "node:crypto"
import test from "node:test"
import { canonicalHash, canonicalJson } from "../canonical-json"

test("canonical JSON is stable across key order and negative zero", () => {
  assert.equal(canonicalJson({ b: -0, a: [2, 1], omitted: undefined }), '{"a":[2,1],"b":0}')
  assert.equal(canonicalHash({ a: 1, b: 2 }), canonicalHash({ b: 2, a: 1 }))
})

test("canonical JSON rejects non-finite and unsupported values", () => {
  assert.throws(() => canonicalJson(Number.NaN), /non-finite/)
  assert.throws(() => canonicalJson(Symbol("unsupported")), /unsupported/)
})

test("canonical hash preserves exact bytes for deeply nested evidence", () => {
  let evidence: unknown = { z: -0, a: "leaf" }
  for (let index = 0; index < 128; index += 1) {
    evidence = { source: evidence, ordinal: index, omitted: undefined }
  }
  const encoded = canonicalJson(evidence)
  assert.equal(canonicalHash(evidence), createHash("sha256").update(encoded).digest("hex"))
  assert.equal(encoded.includes('"omitted"'), false)
})
