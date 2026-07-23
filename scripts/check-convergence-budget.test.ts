import { expect, test } from "bun:test"
import {
  assessConvergence,
  convergenceMetricKeys,
  type ConvergenceMetrics,
} from "./check-convergence-budget"

const baseline = metrics(10)

test("convergence budget accepts equal or smaller surfaces", () => {
  expect(assessConvergence(baseline, baseline)).toEqual([])
  expect(assessConvergence(metrics(9), baseline)).toEqual([])
})

test("convergence budget rejects every growing surface", () => {
  for (const key of convergenceMetricKeys) {
    const actual = { ...baseline, [key]: 11 }
    expect(assessConvergence(actual, baseline)).toEqual([`${key} grew from ceiling 10 to 11`])
  }
})

function metrics(value: number): ConvergenceMetrics {
  return {
    module_owners: value,
    registered_tools: value,
    architecture_domains: value,
    architecture_stores: value,
    architecture_jobs: value,
    architecture_rails: value,
  }
}
