import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const dashboardRoot = fileURLToPath(new URL("../", import.meta.url));
const componentsRoot = join(dashboardRoot, "components");
const atomPath = join(componentsRoot, "ui/data-workspace-empty.tsx");

async function sourceFiles(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const nested = await Promise.all(entries.map((entry) => {
    const entryPath = join(directory, entry.name);
    return entry.isDirectory() ? sourceFiles(entryPath)
      : entry.name.endsWith(".tsx") ? [entryPath] : [];
  }));
  return nested.flat();
}

test("table empty rows compose the shared DataWorkspaceEmpty atom", async () => {
  const atom = await readFile(atomPath, "utf8");
  const atomStyles = await readFile(join(componentsRoot, "ui/data-workspace-empty.module.css"), "utf8");
  const globalStyles = await readFile(join(dashboardRoot, "app/globals.css"), "utf8");
  const sources = await sourceFiles(componentsRoot);
  let usages = 0;

  assert.match(atom, /export type DataWorkspaceEmptyProps/u);
  assert.match(atom, /DataWorkspaceEmptyState = "empty" \| "loading" \| "unavailable"/u);
  assert.match(atom, /data-state=\{state\}/u);
  assert.match(atom, /data-ui="data-workspace-empty"/u);
  assert.match(atom, /styles\.root/u);
  assert.match(atomStyles, /\.root \{[^}]*min-height: 180px;[^}]*align-items: center;[^}]*justify-content: center;/u);
  assert.doesNotMatch(globalStyles, /\.data-workspace-empty/u);
  assert.doesNotMatch(globalStyles, /\.service-log-empty/u);
  assert.match(globalStyles, /\[data-ui="data-workspace-empty"\]/u);

  for (const filePath of sources) {
    const source = await readFile(filePath, "utf8");
    const sourcePath = relative(componentsRoot, filePath);
    if (filePath !== atomPath) {
      assert.doesNotMatch(source, /className="data-workspace-empty/u,
        `${sourcePath} must compose DataWorkspaceEmpty instead of recreating its structure`);
      usages += source.match(/<DataWorkspaceEmpty(?:\s|>)/gu)?.length ?? 0;
    }
  }

  assert.equal(usages, 10);
  const table = await readFile(join(componentsRoot, "ui/data-workspace-table.tsx"), "utf8");
  assert.match(table, /noDataComponent \?\? <DataWorkspaceEmpty>No data<\/DataWorkspaceEmpty>/u);
});
