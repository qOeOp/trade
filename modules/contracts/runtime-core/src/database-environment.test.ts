import { describe, expect, test } from "bun:test"
import { resolve } from "node:path"
import { resolveDatabaseEnvironment, resolveEnvironmentDatabase } from "./database-environment"

describe("database environment", () => {
  test("local paths are stable across caller working directories", () => {
    const root = resolve("/tmp/trade-repository")
    const environment = resolveDatabaseEnvironment({ kind: "local", repositoryRoot: root })
    expect(environment.data_root).toBe(resolve(root, "data"))
    expect(resolveEnvironmentDatabase(environment, "rd_state.db")).toBe(resolve(root, "data/rd_state.db"))
  })

  test("test and CI require isolated instance ids", () => {
    expect(() => resolveDatabaseEnvironment({ kind: "test" })).toThrow("unique instance id")
    const first = resolveDatabaseEnvironment({ kind: "test", instanceId: "suite-a" })
    const second = resolveDatabaseEnvironment({ kind: "test", instanceId: "suite-b" })
    expect(first.data_root).not.toBe(second.data_root)
    expect(first.lifecycle).toBe("ephemeral")
  })

  test("runtime roots must be explicit and absolute", () => {
    expect(() => resolveDatabaseEnvironment({ kind: "runtime" })).toThrow("explicit data and tmp roots")
    expect(() => resolveDatabaseEnvironment({ kind: "runtime", dataRoot: "data", tmpRoot: "/tmp/trade" }))
      .toThrow("must be absolute")
  })

  test("database names cannot escape the environment root", () => {
    const environment = resolveDatabaseEnvironment({ kind: "test", instanceId: "escape" })
    expect(() => resolveEnvironmentDatabase(environment, "../trade.db")).toThrow("lowercase basename")
  })
})
