// Which runs of text without spaces the detail prose shows as copyable chips (lib/format.ts isToken).
import assert from "node:assert/strict";
import { test } from "node:test";
import { loader } from "./load.mjs";

const { isToken } = await loader().namespace("lib/format.ts");

test("hashes, IDs and paths are chips; code a reviewer quotes stays text", () => {
  for (const id of ["b0nc6rjgjo66ders6s82q8edgvlgu3cp", "sha256:3f2a9c0d1e4b5a6f7c8d9e0f1a2b3c4d",
    "add_judgment:63099925064f47f757a7fe9b41427f11193edd590ae21cf780fa33e9e8a4a033", "/tmp/research-01c4/report.json",
    "https://qoeop.github.io/trade/rd/design"]) assert.ok(isToken(id), id);
  for (const code of ["BarType.from_bar_spec_and_standard,", "subscribe_bars(bar_type),", "portfolio.equity(venue=)",
    "Money/Price/Quantity.as_decimal", "2023-04-11T00:00:59.999000+00:00", "repair-staged-entry-add-position"]) assert.ok(!isToken(code), code);
});
