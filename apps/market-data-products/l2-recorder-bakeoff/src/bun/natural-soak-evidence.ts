export interface ResourceSample {
  elapsed_ms: number;
  rss_bytes: number;
  cpu_percent: number;
}

export interface ResourceSummary {
  sample_count: number;
  initial_rss_bytes: number;
  final_rss_bytes: number;
  min_rss_bytes: number;
  max_rss_bytes: number;
  p95_rss_bytes: number;
  head_median_rss_bytes: number;
  tail_median_rss_bytes: number;
  tail_minus_head_rss_bytes: number;
  mean_cpu_percent: number;
  p95_cpu_percent: number;
  max_cpu_percent: number;
}

export interface NaturalSoakWorkerEvidence {
  schema_version: string;
  symbol: string;
  verdict: string;
  requested_duration_seconds: number;
  elapsed_ms: number;
  queue_capacity: number;
  max_queue_depth: number;
  force_disconnect_after: number;
  total_recorded_events: number;
  total_segments: number;
  incidents: Array<{ kind: string }>;
}

export interface NaturalSoakEvaluation {
  gate_eligible: boolean;
  gate_verdict: "passed" | "failed" | "ineligible";
  checks: {
    worker_schema_valid: boolean;
    symbol_matches: boolean;
    duration_matches: boolean;
    natural_disconnect_mode: boolean;
    worker_passed: boolean;
    duration_completed: boolean;
    events_recorded: boolean;
    bounded_queue_respected: boolean;
    all_segments_verified: boolean;
  };
}

export function summarizeResourceSamples(
  samples: ResourceSample[],
): ResourceSummary {
  if (samples.length === 0)
    throw new Error("at least one resource sample is required");
  const rss = samples.map((sample) => sample.rss_bytes);
  const cpu = samples.map((sample) => sample.cpu_percent);
  const windowSize = Math.max(1, Math.ceil(samples.length * 0.1));
  const headMedian = percentile(rss.slice(0, windowSize), 0.5);
  const tailMedian = percentile(rss.slice(-windowSize), 0.5);
  return {
    sample_count: samples.length,
    initial_rss_bytes: rss[0]!,
    final_rss_bytes: rss.at(-1)!,
    min_rss_bytes: Math.min(...rss),
    max_rss_bytes: Math.max(...rss),
    p95_rss_bytes: percentile(rss, 0.95),
    head_median_rss_bytes: headMedian,
    tail_median_rss_bytes: tailMedian,
    tail_minus_head_rss_bytes: tailMedian - headMedian,
    mean_cpu_percent: round(
      cpu.reduce((sum, value) => sum + value, 0) / cpu.length,
    ),
    p95_cpu_percent: percentile(cpu, 0.95),
    max_cpu_percent: Math.max(...cpu),
  };
}

export function evaluateNaturalSoak(input: {
  worker: NaturalSoakWorkerEvidence;
  expectedSymbol: string;
  requestedDurationSeconds: number;
  minimumGateDurationSeconds: number;
  verifiedSegmentCount: number;
}): NaturalSoakEvaluation {
  const checks = {
    worker_schema_valid:
      input.worker.schema_version === "trade.l2-public-soak-evidence.v1",
    symbol_matches: input.worker.symbol === input.expectedSymbol,
    duration_matches:
      input.worker.requested_duration_seconds ===
      input.requestedDurationSeconds,
    natural_disconnect_mode: input.worker.force_disconnect_after === 0,
    worker_passed: input.worker.verdict === "passed",
    duration_completed:
      input.worker.elapsed_ms >= input.requestedDurationSeconds * 1000,
    events_recorded:
      input.worker.total_recorded_events > 0 && input.worker.total_segments > 0,
    bounded_queue_respected:
      input.worker.max_queue_depth <= input.worker.queue_capacity,
    all_segments_verified:
      input.verifiedSegmentCount > 0 &&
      input.verifiedSegmentCount === input.worker.total_segments,
  };
  const passed = Object.values(checks).every(Boolean);
  const gateEligible =
    input.requestedDurationSeconds >= input.minimumGateDurationSeconds;
  return {
    gate_eligible: gateEligible,
    gate_verdict: !passed ? "failed" : gateEligible ? "passed" : "ineligible",
    checks,
  };
}

function percentile(values: number[], fraction: number): number {
  if (values.length === 0)
    throw new Error("percentile requires a non-empty sample");
  const ordered = [...values].sort((left, right) => left - right);
  return ordered[Math.ceil((ordered.length - 1) * fraction)]!;
}

function round(value: number): number {
  return Math.round(value * 1000) / 1000;
}
