import { mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import assert from "node:assert/strict"
import test from "node:test"

import {
  composeFactorCandidates,
  loadFactorFeatureStore,
  passesFactorConditions,
  readFactorConditions,
  transformFactor,
} from "../../../../../agent-roles/developer/strategy-family-engine/src/lib/factor-engine"

test("factor transforms are causal and bounded to available history", () => {
  const values = [1, 2, 3, 4, 5]
  assert.equal(transformFactor(values, 4, "level", 1), 5)
  assert.equal(transformFactor(values, 4, "delta", 2), 2)
  assert.equal(transformFactor(values, 4, "slope", 2), 1)
  assert.equal(transformFactor(values, 1, "zscore", 3), undefined)
  assert.equal(transformFactor(values, 4, "percentile", 5), 1)
})

test("factor store reads new factor ids and legacy aliases", () => {
  const dir = mkdtempSync(join(tmpdir(), "factor-engine-"))
  try {
    const path = join(dir, "report.json")
    writeFileSync(path, JSON.stringify({ data: { timeframes: { "4h": { features: {
      "vpci.value": {
        status: "ok",
        factor_id: "vpci.value",
        source_indicator: "vpci",
        output: "value",
        category: "volume",
        roles: ["confirmation"],
        allowed_transforms: ["level", "slope"],
        legacy_alias: "vpci",
        values: [1, 2, 3, 4].map((value, index) => ({ timestamp: `t${index}`, value })),
      },
    } } } } }))
    const store = loadFactorFeatureStore(path)
    assert.equal(store.read("4h", "vpci.value", "t3", "delta", 2), 2)
    assert.equal(store.read("4h", "vpci", "t3"), 4)
    assert.equal(store.definitions()[0].factor_id, "vpci.value")
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test("factor conditions evaluate generic transforms", () => {
  const conditions = readFactorConditions([{ factor_id: "momentum.x", role: "confirmation", transform: "slope", lookback: 2, op: "gt", value: 0 }])
  const store = {
    definitions: () => [],
    series: () => undefined,
    read: () => 0.5,
  }
  assert.equal(passesFactorConditions(conditions, store, "4h", "t3"), true)
})

test("bounded composer avoids same-role combinations and enforces parameter budget", () => {
  const seeds = readFactorConditions([
    { factor_id: "trend.a", role: "regime", op: "gt", value: 0 },
    { factor_id: "trend.b", role: "regime", op: "gt", value: 0 },
    { factor_id: "volume.a", role: "confirmation", op: "gt", value: 0 },
  ])
  const candidates = composeFactorCandidates([{
    candidateId: "BASE",
    family: "trend_pullback_v1",
    parameterCount: 5,
    params: { side: "long" },
  }], seeds, { maxFactorsPerCandidate: 2, maxCandidates: 10, maxParameterCount: 7 })

  assert.equal(candidates.length, 5)
  assert.equal(new Set(candidates.map((candidate) => candidate.candidateId)).size, candidates.length)
  assert.ok(candidates.some((candidate) => candidate.candidateId.includes("gt-0")))
  assert.ok(candidates.every((candidate) => Number(candidate.parameterCount) <= 7))
  assert.ok(candidates.every((candidate) => !candidate.candidateId.includes("trend-a-level-trend-b-level")))
})
