import { expect, test } from "bun:test"
import { diffWorkspaceSnapshots } from "./workspace-snapshot"

const snapshot = (files: Record<string, string>) => ({
  schema_version: "trade.workspace-snapshot.v1" as const,
  files,
})

test("workspace snapshots detect content changes even for already dirty paths", () => {
  expect(diffWorkspaceSnapshots(
    snapshot({ "dirty.ts": "before", "stable.ts": "same" }),
    snapshot({ "dirty.ts": "after", "stable.ts": "same" }),
  )).toEqual(["dirty.ts"])
})

test("workspace snapshots detect added and removed unignored files", () => {
  expect(diffWorkspaceSnapshots(
    snapshot({ "removed.ts": "hash" }),
    snapshot({ "added.ts": "hash" }),
  )).toEqual(["added.ts", "removed.ts"])
})
