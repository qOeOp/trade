import { expect, test } from "bun:test"
import {
  convergenceMetricKeys,
  describeSurfaceGrowth,
  type ConvergenceMetrics,
} from "./check-convergence-budget"

const metrics = (value: number): ConvergenceMetrics =>
  Object.fromEntries(convergenceMetricKeys.map((key) => [key, value])) as ConvergenceMetrics

test("convergence report has no observations for equal or smaller surfaces", () => {
  const baseline = metrics(10)
  expect(describeSurfaceGrowth(baseline, baseline)).toEqual([])
  expect(describeSurfaceGrowth(metrics(9), baseline)).toEqual([])
})

test("convergence report describes growing surfaces without judging them", () => {
  for (const key of convergenceMetricKeys) {
    const baseline = metrics(10)
    const actual = { ...baseline, [key]: 11 }
    expect(describeSurfaceGrowth(actual, baseline)).toEqual([
      `${key} changed from baseline 10 to 11`,
    ])
  }
})
