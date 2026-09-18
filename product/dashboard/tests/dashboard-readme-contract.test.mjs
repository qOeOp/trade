import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { exactBlueprints, maturityFor, moduleFor } from "../lib/navigation.js";
import { source } from "./doc-contract.mjs";

const readme = await readFile(new URL("../README.md", import.meta.url), "utf8");

test("Dashboard README names every module that navigation registers a DRAWABLE_EXACT surface for", () => {
  const shipped = new Set(
    Object.keys(exactBlueprints)
      .filter((href) => maturityFor(href) === "DRAWABLE_EXACT")
      .map((href) => moduleFor(href).label),
  );
  assert.ok(shipped.size > 0, "navigation registers no DRAWABLE_EXACT route");
  for (const label of shipped) {
    assert.ok(readme.includes(label), `README omits the shipped module ${label}`);
  }
});

test("Dashboard README states the image, profile, and port the Compose package binds", async () => {
  const compose = await source("../rd-workbench/docker-compose.yml");
  const image = compose.match(/image: (trade-dashboard):/u)?.[1];
  const profile = compose.match(/profiles: \["(dashboard-preview)"\]/u)?.[1];
  const port = compose.match(/127\.0\.0\.1:\$\{DASHBOARD_PORT:-(\d+)\}:/u)?.[1];
  assert.ok(image && profile && port, "Compose no longer binds the Dashboard image, profile, or port this README describes");
  for (const fact of [`\`${image}\` image`, `\`${profile}\` profile`, `127.0.0.1:${port}`]) {
    assert.ok(readme.includes(fact), `README omits ${fact}`);
  }
});

test("Dashboard README names the MCP route the app serves", async () => {
  await source("app/api/mcp/route.ts");
  assert.ok(readme.includes("/api/mcp"), "README omits the /api/mcp route");
});
