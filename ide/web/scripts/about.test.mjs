// How the About panel names what `/api/about` and the paper daemon answer (model/about.ts).
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { SourceTextModule } from "node:vm";
import ts from "typescript";

const module = new SourceTextModule(ts.transpileModule(
  readFileSync(new URL("../src/model/about.ts", import.meta.url), "utf8"),
  { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext } },
).outputText);
await module.link(() => { throw new Error("model/about.ts imports nothing"); });
await module.evaluate();
const { ledgerGap, paperLine, placeOf, runtimeDigest } = module.namespace;

test("a DoltHub remote is named by its repository and links to its page; another stays as it is", () => {
  assert.deepEqual(placeOf("https://doltremoteapi.dolthub.com/owner/ledger"),
    { name: "owner/ledger", href: "https://www.dolthub.com/repositories/owner/ledger" });
  assert.deepEqual(placeOf("file:///data/backups/ledger"), { name: "file:///data/backups/ledger", href: null });
});

test("the ledger's line says why it has no place: a refusal, not readable, or published nowhere", () => {
  const ledger = (fields) => ({ build: "b", ledger: { running: true, remote: "r", commit: "c", ...fields } });
  assert.equal(ledgerGap(ledger({})), null);
  assert.equal(ledgerGap(ledger({ remote: null })), "Not published");
  assert.equal(ledgerGap(ledger({ running: false, remote: null })), "Not readable");
  assert.equal(ledgerGap({ build: "b", ledger: null, refusal: { code: "LEDGER_UNKNOWN" } }), "LEDGER_UNKNOWN");
});

test("the paper line gives the daemon's limit and the image its digest's start", () => {
  assert.equal(paperLine({ limit: 5, runtime: null }), "Up to 5 runs at once");
  assert.equal(runtimeDigest(`ghcr.io/x/runtime@sha256:${"ab".repeat(32)}`), "sha256:abababab");
  assert.equal(runtimeDigest("local-tag"), "local-tag");
});
