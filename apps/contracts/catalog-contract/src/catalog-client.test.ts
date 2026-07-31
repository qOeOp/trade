import { expect, test } from "bun:test"
import { defaultCatalogDbPathForGeneratedPath } from "./catalog-client"

test("generated repository artifacts share the canonical catalog", () => {
  expect(defaultCatalogDbPathForGeneratedPath("tmp/artifacts/run.json")).toBe("./data/data_catalog.db")
})
