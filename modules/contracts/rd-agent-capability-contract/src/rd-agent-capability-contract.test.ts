import { describe, expect, test } from "bun:test"
import {
  DEVELOPER_DATA_SNAPSHOT_BINDING_SCHEMA_VERSION,
  createDeveloperDataSnapshotBinding,
  listStrategyFamilyCapabilities,
  readFamilyEvaluationProtocol,
  readStrategyFamilyCapability,
} from "./rd-agent-capability-contract"

describe("R&D Agent capability contract", () => {
  test("publishes self-hashed family implementations", () => {
    const capabilities = listStrategyFamilyCapabilities()
    expect(capabilities).toHaveLength(7)
    expect(capabilities.every((item) => /^[a-f0-9]{64}$/.test(item.capability_hash))).toBe(true)
    expect(readStrategyFamilyCapability(
      "canonical:trend/time-series-trend/time-series-momentum",
    )?.implementation_contract.feature_definition).toMatchObject({
      visibility: "closed_candle_only",
    })
  })

  test("binds each family to one owner-resolved evaluation protocol", () => {
    const protocol = readFamilyEvaluationProtocol(
      "canonical:trend/time-series-trend/time-series-momentum",
    )
    expect(protocol?.protocol_ref).toBe("protocol:time-series-momentum-eval-v1")
    expect(protocol?.execution_profile).toBe("compatibility_mechanical_candidate_batch_v1")
    expect(protocol?.discovery_policy.exact_cost_policy_resolution).toBe("replay_reservation")
    expect(protocol?.protocol_hash).toMatch(/^[a-f0-9]{64}$/)
  })

  test("binds an exact self-hashed data snapshot identity", () => {
    const binding = createDeveloperDataSnapshotBinding({
      schema_version: DEVELOPER_DATA_SNAPSHOT_BINDING_SCHEMA_VERSION,
      snapshot_ref: "dataset-split://split/BTCUSDT/discovery/4h",
      snapshot_hash: "a".repeat(64),
      dataset_kinds: ["ohlcv"],
      hypothesis_id: "hypothesis-1",
      symbol: "BTCUSDT",
      exchange: "binanceusdm",
      segment: "discovery",
      timeframe: "4h",
      manifest_ref: "data/rd-datasets/split/btcusdt/discovery/manifest.json",
      evidence_ref: "agent-artifact://durable/evidence",
    })
    expect(binding.binding_hash).toMatch(/^[a-f0-9]{64}$/)
    expect(binding.dataset_kinds).toEqual(["ohlcv"])
  })
})
