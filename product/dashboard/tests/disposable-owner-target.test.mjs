import assert from "node:assert/strict";
import test from "node:test";

import { disposableOwnerUrlV1 } from "../lib/disposable-owner-target.ts";

test("disposable Owner targets accept only exact loopback and Compose Owner roots", () => {
  for (const [raw, expected] of [
    ["http://localhost", "http://localhost"],
    ["http://localhost:8080/", "http://localhost:8080"],
    ["http://127.0.0.1:8080", "http://127.0.0.1:8080"],
    ["http://[::1]:8080/", "http://[::1]:8080"],
    ["http://rd-owner-api:8080/", "http://rd-owner-api:8080"],
  ]) assert.equal(disposableOwnerUrlV1(raw), expected, raw);
});

test("disposable Owner targets fail closed outside the exact local root allowlist", () => {
  for (const raw of [
    undefined,
    "",
    "not-a-url",
    "https://localhost/",
    "http://localhost.example/",
    "http://127.0.0.2/",
    "http://rd-owner-api.example/",
    "http://user@localhost/",
    "http://user:secret@localhost/",
    "http://localhost/v1",
    "http://localhost/?mode=write",
    "http://localhost/#fragment",
  ]) assert.equal(disposableOwnerUrlV1(raw), null, String(raw));
});
