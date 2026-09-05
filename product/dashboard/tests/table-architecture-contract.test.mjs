import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import {
  columnFilteringFeature,
  constructTable,
  createFilteredRowModel,
  createPaginatedRowModel,
  createSortedRowModel,
  filterFn_includesString,
  rowPaginationFeature,
  rowSortingFeature,
  tableFeatures,
} from "@tanstack/table-core";
import { storeReactivityBindings } from "@tanstack/table-core/store-reactivity-bindings";

const dashboardRoot = fileURLToPath(new URL("../", import.meta.url));
const sourceRoots = ["app", "components", "lib"];
const sourceExtension = /\.(?:[cm]?[jt]sx?)$/u;

async function sourceFiles(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const nested = await Promise.all(entries.map((entry) => {
    const entryPath = join(directory, entry.name);
    return entry.isDirectory() ? sourceFiles(entryPath)
      : sourceExtension.test(entry.name) ? [entryPath] : [];
  }));
  return nested.flat();
}

test("all Dashboard tables stay behind the TanStack and shadcn workspace boundary", async () => {
  const paths = (await Promise.all(sourceRoots.map((root) => sourceFiles(join(dashboardRoot, root)))))
    .flat();
  let workspaceConsumerCount = 0;

  for (const filePath of paths) {
    const source = await readFile(filePath, "utf8");
    const sourcePath = relative(dashboardRoot, filePath);
    if (source.includes("DataWorkspaceTable")) workspaceConsumerCount += 1;

    if (sourcePath !== "components/ui/table.tsx") {
      assert.doesNotMatch(source, /<table(?:\s|>)/u,
        `${sourcePath} must not bypass the shadcn table atoms`);
    }
    if (sourcePath !== "components/ui/data-workspace-table.tsx") {
      assert.doesNotMatch(source, /from\s+["']@tanstack\/react-table["']/u,
        `${sourcePath} must not bypass DataWorkspaceTable's TanStack state boundary`);
      assert.doesNotMatch(source, /from\s+["'](?:\.\/table|[^"']*\/ui\/table)["']/u,
        `${sourcePath} must not consume shadcn table atoms outside DataWorkspaceTable`);
    }
    assert.doesNotMatch(source, /react-data-table-component/u,
      `${sourcePath} must not restore the retired table dependency`);
  }

  assert.ok(workspaceConsumerCount >= 2,
    "the baseline guard must cover the shared wrapper and its admitted Runs consumer");
  const packageJson = JSON.parse(await readFile(join(dashboardRoot, "package.json"), "utf8"));
  const packageLock = await readFile(join(dashboardRoot, "package-lock.json"), "utf8");
  const surfaceSource = await readFile(join(dashboardRoot, "components/ui/data-table.tsx"), "utf8");
  const globalCss = await readFile(join(dashboardRoot, "app/globals.css"), "utf8");
  assert.equal(packageJson.dependencies["@tanstack/react-table"], "^9.2.4");
  assert.equal(packageJson.dependencies["react-data-table-component"], undefined);
  assert.doesNotMatch(packageLock, /react-data-table-component/u);
  assert.doesNotMatch(surfaceSource, /export function DataTable(?:Row|Cell|Empty)?\(/u);
  assert.doesNotMatch(globalCss, /\.data-table(?:-row|-cell|-empty)?(?:\s|\[|\{)/u);

  const workspaceTableSource = await readFile(
    join(dashboardRoot, "components/ui/data-workspace-table.tsx"),
    "utf8",
  );
  assert.match(workspaceTableSource, /columnFilteringFeature/u);
  assert.match(workspaceTableSource, /filteredRowModel: createFilteredRowModel\(\)/u);
  assert.match(workspaceTableSource, /enableColumnFilter: Boolean\(column\.filterable && column\.selector\)/u);
  assert.match(workspaceTableSource, /state: controlledColumnFilters === undefined/u);
  assert.match(workspaceTableSource, /table\.getFilteredRowModel\(\)\.rows\.length/u);
  assert.match(workspaceTableSource, /aria-selected=\{conditionalRowStyles\.length \? selected : undefined\}/u);
  assert.match(workspaceTableSource, /if \(event\.target !== event\.currentTarget\) return;/u);

  const runTableSource = await readFile(
    join(dashboardRoot, "components/operations-runstore-preview.tsx"),
    "utf8",
  );
  assert.match(runTableSource, /<DataWorkspaceTable<RunListItemV1>/u);
  assert.match(runTableSource, /data=\{visibleRuns\}/u);
});

test("the TanStack filter model feeds pagination instead of filtering a rendered page", () => {
  const features = tableFeatures({
    coreReactivityFeature: storeReactivityBindings(),
    columnFilteringFeature,
    filteredRowModel: createFilteredRowModel(),
    rowSortingFeature,
    sortedRowModel: createSortedRowModel(),
    rowPaginationFeature,
    paginatedRowModel: createPaginatedRowModel(),
    filterFns: { includesString: filterFn_includesString },
    sortFns: {},
  });
  const table = constructTable({
    features,
    columns: [{
      id: "state",
      accessorFn: (row) => row.state,
      enableColumnFilter: true,
      filterFn: "includesString",
    }],
    data: [
      { id: "a", state: "succeeded" },
      { id: "b", state: "failed" },
      { id: "c", state: "succeeded" },
    ],
    initialState: { pagination: { pageIndex: 0, pageSize: 1 } },
    state: { columnFilters: [{ id: "state", value: "succeed" }] },
  });

  assert.deepEqual(
    table.getFilteredRowModel().rows.map((row) => row.original.id),
    ["a", "c"],
  );
  assert.deepEqual(table.getRowModel().rows.map((row) => row.original.id), ["a"]);
});
