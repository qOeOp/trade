// How the About panel names what `/api/about` and the paper daemon answer (model/about.ts).
import assert from "node:assert/strict";
import { test } from "node:test";
import { namespace } from "./load.mjs";

const { ledgerGap, paperLine, placeOf, publicCopyFault, runtimeDigest } = await namespace("model/about.ts", { sources: [], packages: [] });

test("a DoltHub remote is named by its repository and links to its page; another stays as it is", () => {
  assert.deepEqual(placeOf("https://doltremoteapi.dolthub.com/owner/ledger"),
    { name: "owner/ledger", href: "https://www.dolthub.com/repositories/owner/ledger" });
  assert.deepEqual(placeOf("file:///data/backups/ledger"), { name: "file:///data/backups/ledger", href: null });
});

test("the ledger's line says why it has no place: a refusal, not readable, or published nowhere", () => {
  const ledger = (fields) => ({ build: "b", ledger: { running: true, remote: "r", unpublished: false, commit: "c", ...fields } });
  assert.equal(ledgerGap(ledger({})), null);
  assert.equal(ledgerGap(ledger({ remote: null })), "Not published");
  assert.equal(ledgerGap(ledger({ running: false, remote: null })), "Not readable");
  assert.equal(ledgerGap({ build: "b", ledger: null, refusal: { code: "LEDGER_UNKNOWN" } }), "LEDGER_UNKNOWN");
});

test("the public copy is a fault when changed elsewhere or behind past what publishing takes, not while a write publishes", () => {
  const copy = (fields) => publicCopyFault({ build: "b", ledger: { running: true, remote: "r", commit: "c", unpublished: true, behind_seconds: 0, diverged: false, ...fields } });
  assert.equal(copy({ unpublished: false, behind_seconds: null }), null);
  assert.equal(copy({ behind_seconds: 899 }), null);
  assert.equal(copy({ behind_seconds: 900 }).short, "Public copy: behind 15 min");
  assert.equal(copy({ behind_seconds: 7200 }).short, "Public copy: behind 2 h");
  assert.equal(copy({ behind_seconds: 172800 }).short, "Public copy: behind 2 d");
  assert.equal(copy({ behind_seconds: null }).short, "Public copy: behind", "origin holds no branch: no age to name");
  assert.equal(copy({ behind_seconds: null, diverged: true }).short, "Public copy: changed elsewhere");
  assert.match(copy({ behind_seconds: null, diverged: true }).long, /until you decide/);
});

test("the paper line gives the daemon's memory budget and the image its digest's start", () => {
  assert.equal(paperLine({ memory_budget: 3072, runtime: null }), "Runs reserve up to 3.0 GiB");
  assert.equal(runtimeDigest(`ghcr.io/x/runtime@sha256:${"ab".repeat(32)}`), "sha256:abababab");
  assert.equal(runtimeDigest("local-tag"), "local-tag");
});
