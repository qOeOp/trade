import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("DataWorkspaceTable owns one reusable controlled row-detail disclosure", async () => {
  const [table, entity, css] = await Promise.all([
    readFile(new URL("../components/ui/data-workspace-table.tsx", import.meta.url), "utf8"),
    readFile(new URL("../components/ui/entity-reference.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/globals.css", import.meta.url), "utf8"),
  ]);

  for (const token of [
    "rowDisclosure?:", "detailsId: (row: T) => string", "isExpanded: (row: T) => boolean",
    "render: (row: T) => ReactNode", "aria-expanded={rowDisclosure ? expanded : undefined}",
    "aria-controls={rowDisclosure ? detailsId : undefined}", "colSpan={row.getAllCells().length}",
    'role="region"', "onDismiss?: () => void", "rowDisclosure?.onDismiss?.()", "workspace-table-row-details",
  ]) assert.ok(table.includes(token), `shared row disclosure missing ${token}`);
  assert.match(entity, /disclosure\?: \{ controls: string; expanded: boolean \}/u);
  assert.match(entity, /aria-controls=\{disclosure\?\.controls\}/u);
  assert.match(entity, /aria-expanded=\{disclosure\?\.expanded\}/u);
  assert.match(css, /\.data-workspace-row-details \{[^}]*background: var\(--surface-panel\)/su);
  assert.match(css, /@media \(max-width: 760px\)[\s\S]*\.data-workspace-row-details[\s\S]*position: sticky;/u);
  assert.doesNotMatch(css, /\.research[^}]*data-workspace-row-details/iu);
});
