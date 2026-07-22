import { describe, expect, test } from "bun:test";
import {
  buildAdoptionInput,
  type AdoptionEvidenceInput,
} from "./adoption-input";

const implementations = ["bun", "go", "rust"] as const;

function fixture(): AdoptionEvidenceInput {
  return {
    projector: {
      schema_version: "trade.l2-language-bakeoff-evidence.v1",
      samples_per_implementation: 5,
      parity: Object.fromEntries(
        implementations.map((name) => [
          name,
          { complete: true, gap: true, source_hash: "same" },
        ]),
      ) as AdoptionEvidenceInput["projector"]["parity"],
      implementations: implementations.map((implementation, index) => ({
        implementation,
        median_internal_ns_per_event: [30, 40, 20][index],
        p95_internal_ns_per_event: [35, 45, 22][index],
        max_rss_bytes: [100, 10, 5][index]!,
      })),
    },
    segment: {
      schema_version: "trade.l2-segment-bakeoff-evidence.v1",
      samples_per_implementation: 7,
      write_parity: Object.fromEntries(
        implementations.map((name) => [
          name,
          { implementation: name, frame_count: 200, payload_hash: "same" },
        ]),
      ) as unknown as AdoptionEvidenceInput["segment"]["write_parity"],
      implementations: implementations.map((implementation, index) => ({
        implementation,
        median_write_ns_per_frame: [30, 28, 45][index],
        p95_write_ns_per_frame: [50, 55, 60][index],
        max_rss_bytes: [50, 5, 2][index]!,
      })),
    },
    crash: {
      schema_version: "trade.l2-segment-crash-evidence.v1",
      cross_recovery_parity: true,
      writers: implementations.map((writer) => ({
        writer,
        exit_code: 137,
        recovery_parity: true,
      })),
    },
    supervisedSoak: {
      schema_version: "trade.l2-soak-supervisor-evidence.v1",
      cycles: 3,
      all_cycle_recovery_parity: true,
      killed_cycles: Array.from({ length: 3 }, () => ({
        exit_code: 137,
        recovery_parity: true,
      })),
      graceful_restart: { exit_code: 0, verdict: "passed" },
    },
  };
}

describe("L2 runtime adoption input", () => {
  test("stays pending until an eligible natural soak exists", () => {
    const report = buildAdoptionInput(fixture());
    expect(report.readiness).toBe("awaiting_natural_soak");
    expect(report.relative_to_bun).toEqual({
      rust_projector_median_latency_ratio: 0.6667,
      rust_projector_rss_ratio: 0.05,
      rust_segment_median_latency_ratio: 1.5,
      rust_segment_rss_ratio: 0.04,
    });
  });

  test("becomes decision-ready only after the natural gate passes", () => {
    const input = fixture();
    input.naturalSoak = {
      schema_version: "trade.l2-natural-soak-supervisor-evidence.v1",
      gate_eligible: true,
      gate_verdict: "passed",
      checks: { duration_completed: true, all_segments_verified: true },
    };
    expect(buildAdoptionInput(input).readiness).toBe(
      "ready_for_adoption_decision",
    );
    input.naturalSoak.checks.all_segments_verified = false;
    expect(buildAdoptionInput(input).readiness).toBe("evidence_failed");
  });
});
