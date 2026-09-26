import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { validResearchInstrumentIdentityV1 } from "../lib/source-research-input-contract.ts";

// The same file the R&D Owner's own test reads (research_instrument_scope_v1.rs), so this page and
// R&D cannot disagree about an identity without one side turning red.
const vectors = JSON.parse(await readFile(
  new URL("../../rd-owner-client/fixtures/research_instrument_identity_vectors_v1.json", import.meta.url),
  "utf8",
)).vectors;

function identity(parts) {
  return parts.map((part) => ("text" in part ? part.text : part.repeat.repeat(part.times))).join("");
}

test("the instrument identity validator admits exactly what R&D admits", () => {
  assert.ok(vectors.length > 40, `the vector list reads as ${vectors.length} entries`);
  for (const vector of vectors) {
    assert.equal(validResearchInstrumentIdentityV1(identity(vector.parts)), vector.admitted, vector.name);
  }
});

test("an identity that is not well-formed UTF-16 is refused, since R&D could not receive it", () => {
  assert.equal(validResearchInstrumentIdentityV1("BTCUSDT\ud800-PERP.BINANCE"), false);
  assert.equal(validResearchInstrumentIdentityV1("\udfffBTCUSDT-PERP.BINANCE"), false);
  assert.equal(validResearchInstrumentIdentityV1(null), false);
  assert.equal(validResearchInstrumentIdentityV1(["BTCUSDT-PERP.BINANCE"]), false);
});
