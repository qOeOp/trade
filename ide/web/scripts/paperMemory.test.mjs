// Whether another paper run fits the memory the listing reports (model/paperMemory.ts).
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { SourceTextModule } from "node:vm";
import ts from "typescript";

const module = new SourceTextModule(ts.transpileModule(
  readFileSync(new URL("../src/model/paperMemory.ts", import.meta.url), "utf8"),
  { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext } },
).outputText);
await module.link(() => { throw new Error("model/paperMemory.ts imports only a type"); });
await module.evaluate();
const { full } = module.namespace;

test("a run fits while the free memory holds the smallest one", () => {
  assert.equal(full(undefined), null);
  assert.equal(full({ budget: 3072, reserved: 2048, host_available: null, free: 1024, smallest: 896 }), null);
});

test("a full budget and a host short of its headroom say which one stops the next run", () => {
  assert.equal(full({ budget: 3072, reserved: 2560, host_available: null, free: 512, smallest: 896 }),
    "Running paper runs reserve 2.5 GiB of the 3.0 GiB paper memory, too little for another");
  assert.equal(full({ budget: 3072, reserved: 1024, host_available: 1500, free: 476, smallest: 896 }),
    "The host has 1.5 GiB available and keeps 1 GiB free, too little for another paper run");
});
