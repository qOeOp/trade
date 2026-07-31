import { readFileSync } from "node:fs"
import { describe, expect, test } from "bun:test"
import { normalizeDecimal, parseFixture, projectFixture, runBakeoff } from "./projector"

describe("L2 Bun bake-off projector", () => {
  for (const fixtureName of ["complete", "gap"]) {
    test(`matches the frozen ${fixtureName} fixture`, () => {
      const raw = readFileSync(`fixtures/${fixtureName}.json`, "utf8")
      const fixture = parseFixture(raw)
      expect(projectFixture(fixture)).toEqual(fixture.expected)
      const result = runBakeoff(raw, 3)
      expect(result.outcome).toEqual(fixture.expected)
      expect(result.processed_event_count).toBe(fixture.expected.applied_event_count * 3)
    })
  }

  test("normalizes decimal strings without floating point", () => {
    expect(normalizeDecimal("100.000")).toBe("100")
    expect(normalizeDecimal("0.7500")).toBe("0.75")
    expect(() => normalizeDecimal("1e-8")).toThrow("invalid unsigned decimal")
  })
})
