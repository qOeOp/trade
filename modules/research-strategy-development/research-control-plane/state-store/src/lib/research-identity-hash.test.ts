import assert from "node:assert/strict"
import test from "node:test"
import { canonicalizeIdentityPayload, hashIdentityPayload } from "./research-identity-hash"

test("identity hashing is stable across key order, NFC, and negative zero", () => {
  const left = { schema_version: "v1", label: "e\u0301", value: -0, nested: { b: 2, a: 1 } }
  const right = { nested: { a: 1, b: 2 }, value: 0, label: "é", schema_version: "v1" }
  assert.equal(canonicalizeIdentityPayload(left), canonicalizeIdentityPayload(right))
  assert.equal(hashIdentityPayload(left), hashIdentityPayload(right))
})

test("identity hashing rejects non-finite values", () => {
  assert.throws(() => hashIdentityPayload({ value: Number.NaN }), /finite/)
})
