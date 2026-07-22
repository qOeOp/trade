import { describe, expect, test } from "bun:test"
import { findWorkspaceHygieneIssues } from "./check-workspace-hygiene"

describe("workspace hygiene", () => {
  test("rejects newly tracked SQLite sidecars", () => {
    expect(findWorkspaceHygieneIssues({
      trackedPaths: ["data/new.db-wal"],
      moduleRuntimePaths: [],
    }, [])).toEqual([
      "tracked runtime SQLite file is forbidden: data/new.db-wal",
    ])
  })

  test("rejects runtime databases under module data directories even when untracked", () => {
    expect(findWorkspaceHygieneIssues({
      trackedPaths: [],
      moduleRuntimePaths: ["modules/example/data/test.db-shm"],
    }, [])).toEqual([
      "module-local runtime SQLite file is forbidden: modules/example/data/test.db-shm",
    ])
  })

  test("keeps historical exceptions as an explicit ratchet", () => {
    const path = "modules/example/data/legacy.db"
    expect(findWorkspaceHygieneIssues({
      trackedPaths: [path],
      moduleRuntimePaths: [path],
    }, [path])).toEqual([])
  })

  test("requires stale exceptions to be removed with migrated files", () => {
    expect(findWorkspaceHygieneIssues({
      trackedPaths: [],
      moduleRuntimePaths: [],
    }, ["data/legacy.db-wal"])).toEqual([
      "remove stale legacy tracked-runtime exception: data/legacy.db-wal",
    ])
  })
})
