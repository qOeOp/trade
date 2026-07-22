import { expect, test } from "bun:test"
import { getRndFamily, listRndFamilyIds } from "./rnd-family"

test("the statically registered family catalog is unique and addressable", () => {
  const ids = listRndFamilyIds()
  expect(ids.length).toBeGreaterThan(0)
  expect(new Set(ids).size).toBe(ids.length)
  for (const id of ids) expect(getRndFamily(id).id).toBe(id)
})

test("unknown strategy families fail closed", () => {
  expect(() => getRndFamily("not-registered")).toThrow("unsupported R&D family")
})
