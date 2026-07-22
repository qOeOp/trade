type Implementation = "bun" | "go" | "rust";

interface ImplementationMetrics {
  implementation: Implementation;
  median_internal_ns_per_event?: number;
  p95_internal_ns_per_event?: number;
  median_write_ns_per_frame?: number;
  p95_write_ns_per_frame?: number;
  max_rss_bytes: number;
}

interface ProjectorEvidence {
  schema_version: string;
  samples_per_implementation: number;
  parity: Record<
    Implementation,
    { complete: boolean; gap: boolean; source_hash: string }
  >;
  implementations: ImplementationMetrics[];
}

interface SegmentEvidence {
  schema_version: string;
  samples_per_implementation: number;
  write_parity: Record<Implementation, Record<string, unknown>>;
  implementations: ImplementationMetrics[];
}

interface CrashEvidence {
  schema_version: string;
  cross_recovery_parity: boolean;
  writers: Array<{
    writer: Implementation;
    exit_code: number;
    recovery_parity: boolean;
  }>;
}

interface SupervisedSoakEvidence {
  schema_version: string;
  cycles: number;
  all_cycle_recovery_parity: boolean;
  killed_cycles: Array<{ exit_code: number; recovery_parity: boolean }>;
  graceful_restart: { exit_code: number; verdict: string };
}

interface NaturalSoakEvidence {
  schema_version: string;
  gate_eligible: boolean;
  gate_verdict: string;
  checks: Record<string, boolean>;
}

export interface AdoptionEvidenceInput {
  projector: ProjectorEvidence;
  segment: SegmentEvidence;
  crash: CrashEvidence;
  supervisedSoak: SupervisedSoakEvidence;
  naturalSoak?: NaturalSoakEvidence;
}

export function buildAdoptionInput(
  input: AdoptionEvidenceInput,
): Record<string, unknown> {
  const projectorImplementations = orderedImplementations(
    input.projector.implementations,
  );
  const segmentImplementations = orderedImplementations(
    input.segment.implementations,
  );
  const projectorParity =
    implementationNames.every((name) => {
      const parity = input.projector.parity[name];
      return parity?.complete === true && parity.gap === true;
    }) &&
    new Set(
      implementationNames.map(
        (name) => input.projector.parity[name]?.source_hash,
      ),
    ).size === 1;
  const segmentParityValues = implementationNames.map((name) =>
    stableStringify(input.segment.write_parity[name]),
  );
  const segmentByteParity = segmentParityValues.every(
    (value) => value === segmentParityValues[0],
  );
  const writerNames = new Set(
    input.crash.writers.map((writer) => writer.writer),
  );
  const crashRecoveryParity =
    input.crash.cross_recovery_parity &&
    implementationNames.every((name) => writerNames.has(name)) &&
    input.crash.writers.every(
      (writer) => writer.exit_code !== 0 && writer.recovery_parity,
    );
  const supervisedRestart =
    input.supervisedSoak.cycles >= 3 &&
    input.supervisedSoak.all_cycle_recovery_parity &&
    input.supervisedSoak.killed_cycles.length === input.supervisedSoak.cycles &&
    input.supervisedSoak.killed_cycles.every(
      (cycle) => cycle.exit_code !== 0 && cycle.recovery_parity,
    ) &&
    input.supervisedSoak.graceful_restart.exit_code === 0 &&
    input.supervisedSoak.graceful_restart.verdict === "passed";
  const naturalSoakPassed =
    input.naturalSoak != null &&
    input.naturalSoak.schema_version ===
      "trade.l2-natural-soak-supervisor-evidence.v1" &&
    input.naturalSoak.gate_eligible &&
    input.naturalSoak.gate_verdict === "passed" &&
    Object.values(input.naturalSoak.checks).every(Boolean);
  const checks = {
    projector_schema:
      input.projector.schema_version ===
      "trade.l2-language-bakeoff-evidence.v1",
    projector_parity: projectorParity,
    segment_schema:
      input.segment.schema_version === "trade.l2-segment-bakeoff-evidence.v1",
    segment_byte_parity: segmentByteParity,
    crash_schema:
      input.crash.schema_version === "trade.l2-segment-crash-evidence.v1",
    crash_recovery_parity: crashRecoveryParity,
    supervised_soak_schema:
      input.supervisedSoak.schema_version ===
      "trade.l2-soak-supervisor-evidence.v1",
    supervised_kill_restart: supervisedRestart,
    natural_soak_present: input.naturalSoak != null,
    natural_soak_passed: naturalSoakPassed,
  };
  const basePassed = Object.entries(checks)
    .filter(([name]) => !name.startsWith("natural_soak_"))
    .every(([, passed]) => passed);
  const readiness =
    !basePassed || (input.naturalSoak != null && !naturalSoakPassed)
      ? "evidence_failed"
      : input.naturalSoak == null
        ? "awaiting_natural_soak"
        : "ready_for_adoption_decision";
  const projectorByName = byImplementation(projectorImplementations);
  const segmentByName = byImplementation(segmentImplementations);
  return {
    schema_version: "trade.l2-runtime-adoption-input.v1",
    readiness,
    checks,
    candidates: implementationNames.map((implementation) => ({
      implementation,
      projector: {
        median_ns_per_event:
          projectorByName[implementation].median_internal_ns_per_event,
        p95_ns_per_event:
          projectorByName[implementation].p95_internal_ns_per_event,
        max_rss_bytes: projectorByName[implementation].max_rss_bytes,
      },
      segment_writer: {
        median_ns_per_frame:
          segmentByName[implementation].median_write_ns_per_frame,
        p95_ns_per_frame: segmentByName[implementation].p95_write_ns_per_frame,
        max_rss_bytes: segmentByName[implementation].max_rss_bytes,
      },
    })),
    relative_to_bun: {
      rust_projector_median_latency_ratio: ratio(
        projectorByName.rust.median_internal_ns_per_event,
        projectorByName.bun.median_internal_ns_per_event,
      ),
      rust_projector_rss_ratio: ratio(
        projectorByName.rust.max_rss_bytes,
        projectorByName.bun.max_rss_bytes,
      ),
      rust_segment_median_latency_ratio: ratio(
        segmentByName.rust.median_write_ns_per_frame,
        segmentByName.bun.median_write_ns_per_frame,
      ),
      rust_segment_rss_ratio: ratio(
        segmentByName.rust.max_rss_bytes,
        segmentByName.bun.max_rss_bytes,
      ),
    },
  };
}

const implementationNames: Implementation[] = ["bun", "go", "rust"];

function orderedImplementations(
  values: ImplementationMetrics[],
): ImplementationMetrics[] {
  const indexed = new Map(values.map((value) => [value.implementation, value]));
  return implementationNames.map((name) => {
    const value = indexed.get(name);
    if (value == null)
      throw new Error(`missing implementation evidence: ${name}`);
    return value;
  });
}

function byImplementation(
  values: ImplementationMetrics[],
): Record<Implementation, ImplementationMetrics> {
  return Object.fromEntries(
    values.map((value) => [value.implementation, value]),
  ) as Record<Implementation, ImplementationMetrics>;
}

function stableStringify(value: Record<string, unknown> | undefined): string {
  if (value == null) return "";
  const { implementation: _, elapsed_ns: __, ...stable } = value;
  return JSON.stringify(
    Object.fromEntries(
      Object.entries(stable).sort(([left], [right]) =>
        left.localeCompare(right),
      ),
    ),
  );
}

function ratio(
  numerator: number | undefined,
  denominator: number | undefined,
): number {
  if (numerator == null || denominator == null || denominator === 0)
    throw new Error("ratio inputs must be present and non-zero");
  return Math.round((numerator / denominator) * 10_000) / 10_000;
}
