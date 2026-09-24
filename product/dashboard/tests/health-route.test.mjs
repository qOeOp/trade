// The health route is public and deployed. Test servers pass it DASHBOARD_INSTANCE_NONCE so a
// test can tell its own server from another one on the same address (tests/preview-instance.mjs);
// a deployment never sets it, and then the route must answer exactly what it answered before the
// nonce existed. Its real NextResponse is loaded, so the headers asserted are the ones it sends.

import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import test from "node:test";

import ts from "typescript";

import { INSTANCE_NONCE_HEADER } from "./preview-instance.mjs";

const NONCE_ENV = "DASHBOARD_INSTANCE_NONCE";
// The route's answer before the nonce was added, byte for byte.
const BODY = '{"schema_version":1,"status":"ok"}';

const source = await readFile(new URL("../app/api/health/route.ts", import.meta.url), "utf8");
const route = {};
new Function("require", "exports", ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText)(createRequire(import.meta.url), route);

async function answer(nonce) {
  const saved = process.env[NONCE_ENV];
  if (nonce === undefined) delete process.env[NONCE_ENV];
  else process.env[NONCE_ENV] = nonce;
  try {
    const response = route.GET();
    return { status: response.status, headers: [...response.headers], body: await response.text() };
  } finally {
    if (saved === undefined) delete process.env[NONCE_ENV];
    else process.env[NONCE_ENV] = saved;
  }
}

test("without an instance nonce the health route answers exactly what it did before one existed", async () => {
  assert.deepEqual(await answer(undefined), {
    status: 200,
    headers: [["cache-control", "no-store"], ["content-type", "application/json"]],
    body: BODY,
  });
  // An empty value is not a nonce, so it is not echoed either.
  assert.deepEqual(await answer(""), await answer(undefined));
});

test("with an instance nonce only the echo header is added, and the body is unchanged", async () => {
  const nonce = "0123456789abcdef0123456789abcdef";
  assert.deepEqual(await answer(nonce), {
    status: 200,
    headers: [
      ["cache-control", "no-store"],
      ["content-type", "application/json"],
      [INSTANCE_NONCE_HEADER, nonce],
    ],
    body: BODY,
  });
});
