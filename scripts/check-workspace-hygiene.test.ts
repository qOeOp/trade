import { describe, expect, test } from "bun:test"
import { findWorkspaceHygieneIssues } from "./check-workspace-hygiene"

describe("workspace hygiene", () => {
  test("rejects newly tracked SQLite sidecars", () => {
    expect(findWorkspaceHygieneIssues({
      trackedPaths: ["data/new.db-wal"],
      moduleRuntimePaths: [],
    })).toEqual([
      "tracked runtime SQLite file is forbidden: data/new.db-wal",
    ])
  })

  test("rejects runtime databases under module data directories even when untracked", () => {
    expect(findWorkspaceHygieneIssues({
      trackedPaths: [],
      moduleRuntimePaths: ["modules/example/data/test.db-shm"],
    })).toEqual([
      "module-local runtime SQLite file is forbidden: modules/example/data/test.db-shm",
    ])
  })

  test("reports a tracked module-local runtime database through both zero-exception rules", () => {
    const path = "modules/example/data/legacy.db"
    expect(findWorkspaceHygieneIssues({
      trackedPaths: [path],
      moduleRuntimePaths: [path],
    })).toEqual([
      `module-local runtime SQLite file is forbidden: ${path}`,
      `tracked runtime SQLite file is forbidden: ${path}`,
    ])
  })
})
