import { describe, expect, test } from "bun:test";
import {
  evaluateNaturalSoak,
  summarizeResourceSamples,
  type NaturalSoakWorkerEvidence,
} from "./natural-soak-evidence";

const passingWorker: NaturalSoakWorkerEvidence = {
  schema_version: "trade.l2-public-soak-evidence.v1",
  symbol: "BTCUSDT",
  verdict: "passed",
  requested_duration_seconds: 3600,
  elapsed_ms: 3_600_100,
  queue_capacity: 64,
  max_queue_depth: 2,
  force_disconnect_after: 0,
  total_recorded_events: 35_000,
  total_segments: 35,
  incidents: [],
};

describe("natural soak evidence", () => {
  test("summarizes head and tail RSS without inventing a leak threshold", () => {
    const summary = summarizeResourceSamples([
      { elapsed_ms: 0, rss_bytes: 10, cpu_percent: 1 },
      { elapsed_ms: 1, rss_bytes: 20, cpu_percent: 2 },
      { elapsed_ms: 2, rss_bytes: 30, cpu_percent: 3 },
      { elapsed_ms: 3, rss_bytes: 40, cpu_percent: 4 },
      { elapsed_ms: 4, rss_bytes: 50, cpu_percent: 5 },
      { elapsed_ms: 5, rss_bytes: 60, cpu_percent: 6 },
      { elapsed_ms: 6, rss_bytes: 70, cpu_percent: 7 },
      { elapsed_ms: 7, rss_bytes: 80, cpu_percent: 8 },
      { elapsed_ms: 8, rss_bytes: 90, cpu_percent: 9 },
      { elapsed_ms: 9, rss_bytes: 100, cpu_percent: 10 },
    ]);
    expect(summary.max_rss_bytes).toBe(100);
    expect(summary.p95_rss_bytes).toBe(100);
    expect(summary.tail_minus_head_rss_bytes).toBe(90);
    expect(summary.mean_cpu_percent).toBe(5.5);
  });

  test("passes only an hour-eligible, fully verified natural run", () => {
    const result = evaluateNaturalSoak({
      worker: passingWorker,
      expectedSymbol: "BTCUSDT",
      requestedDurationSeconds: 3600,
      minimumGateDurationSeconds: 3600,
      verifiedSegmentCount: 35,
    });
    expect(result.gate_eligible).toBe(true);
    expect(result.gate_verdict).toBe("passed");
    expect(Object.values(result.checks).every(Boolean)).toBe(true);
  });

  test("marks a short smoke as ineligible and a corrupt segment set as failed", () => {
    const shortWorker = {
      ...passingWorker,
      requested_duration_seconds: 10,
      elapsed_ms: 10_100,
      total_segments: 1,
    };
    expect(
      evaluateNaturalSoak({
        worker: shortWorker,
        expectedSymbol: "BTCUSDT",
        requestedDurationSeconds: 10,
        minimumGateDurationSeconds: 3600,
        verifiedSegmentCount: 1,
      }).gate_verdict,
    ).toBe("ineligible");
    expect(
      evaluateNaturalSoak({
        worker: passingWorker,
        expectedSymbol: "BTCUSDT",
        requestedDurationSeconds: 3600,
        minimumGateDurationSeconds: 3600,
        verifiedSegmentCount: 34,
      }).gate_verdict,
    ).toBe("failed");
  });
});
