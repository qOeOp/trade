#!/usr/bin/env bun

import { dirname, relative, resolve } from "node:path";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import {
  evaluateNaturalSoak,
  summarizeResourceSamples,
  type NaturalSoakWorkerEvidence,
  type ResourceSample,
} from "../bun/natural-soak-evidence";
import { recoverSegment } from "../bun/segment";

interface SegmentEvidence {
  path: string;
  frame_count: number;
  payload_bytes: number;
  segment_bytes: number;
  payload_hash: string;
}

interface WorkerEvidence extends NaturalSoakWorkerEvidence {
  connection_count: number;
  resync_count: number;
  total_received_messages: number;
  p95_event_lag_ms: number;
  max_event_lag_ms: number;
  epochs: Array<{ segments: SegmentEvidence[] }>;
}

const moduleRoot = process.cwd();
const repositoryRoot = resolve(moduleRoot, "../../..");
const arguments_ = parseArgs(process.argv.slice(2));
if (!arguments_.yesPublicNetwork)
  throw new Error("natural public soak requires explicit --yes-public-network");
const outputPath = resolve(repositoryRoot, arguments_.output);
assertTmpPath(outputPath);
const outputBase = resolve(
  repositoryRoot,
  `tmp/l2-recorder-bakeoff/natural-soak-work/${Date.now()}-${process.pid}`,
);
assertTmpPath(outputBase);
mkdirSync(outputBase, { recursive: true });

const soakRustBinary = resolve(moduleRoot, "target/release/l2-soak-rust");
runChecked(["cargo", "build", "--release", "--bin", "l2-soak-rust"]);
const child = Bun.spawn({
  cmd: [
    soakRustBinary,
    "--yes-public-network",
    "--symbol",
    arguments_.symbol,
    "--duration-seconds",
    String(arguments_.durationSeconds),
    "--queue-capacity",
    String(arguments_.queueCapacity),
    "--segment-frames",
    String(arguments_.segmentFrames),
    "--sync-every-frames",
    String(arguments_.syncEveryFrames),
    "--max-book-levels",
    String(arguments_.maxBookLevels),
    "--force-disconnect-after",
    "0",
    "--output-base",
    outputBase,
  ],
  cwd: moduleRoot,
  stdout: "pipe",
  stderr: "pipe",
});
assertChildPid(child.pid);
const startedAt = Date.now();
const samples: ResourceSample[] = [];
let lifecycleComplete = false;
let exitCode: number;
try {
  while (child.exitCode == null) {
    const sample = sampleProcess(child.pid, Date.now() - startedAt);
    if (sample != null) samples.push(sample);
    await Bun.sleep(arguments_.sampleIntervalMs);
  }
  exitCode = await child.exited;
  lifecycleComplete = true;
} finally {
  if (!lifecycleComplete && child.exitCode == null) killExact(child.pid);
}
const stdout = await new Response(child.stdout).text();
const stderr = await new Response(child.stderr).text();
if (exitCode !== 0)
  throw new Error(
    `natural soak worker failed with code ${exitCode}: ${stderr}`,
  );
const summary = JSON.parse(stdout) as { output?: string };
if (summary.output == null)
  throw new Error("natural soak worker did not return an evidence path");
const workerEvidencePath = resolve(moduleRoot, summary.output);
assertTmpPath(workerEvidencePath);
const workerEvidence = JSON.parse(
  readFileSync(workerEvidencePath, "utf8"),
) as WorkerEvidence;
const workerRunDirectory = dirname(workerEvidencePath);
const segments = workerEvidence.epochs.flatMap((epoch) => epoch.segments);
let verifiedSegmentCount = 0;
for (const segment of segments) {
  const segmentPath = resolve(workerRunDirectory, segment.path);
  assertChildPath(workerRunDirectory, segmentPath);
  const recovered = recoverSegment(segmentPath);
  if (
    recovered.status !== "complete" ||
    recovered.valid_frame_count !== segment.frame_count ||
    recovered.payload_bytes !== segment.payload_bytes ||
    recovered.segment_bytes !== segment.segment_bytes ||
    recovered.payload_hash !== segment.payload_hash
  ) {
    throw new Error(
      `finalized segment failed verification: ${relative(repositoryRoot, segmentPath)}`,
    );
  }
  verifiedSegmentCount += 1;
}
if (samples.length === 0)
  throw new Error("natural soak completed without a resource sample");
const evaluation = evaluateNaturalSoak({
  worker: workerEvidence,
  expectedSymbol: arguments_.symbol,
  requestedDurationSeconds: arguments_.durationSeconds,
  minimumGateDurationSeconds: arguments_.minimumGateDurationSeconds,
  verifiedSegmentCount,
});
const evidence = {
  schema_version: "trade.l2-natural-soak-supervisor-evidence.v1",
  generated_at: new Date().toISOString(),
  symbol: arguments_.symbol,
  requested_duration_seconds: arguments_.durationSeconds,
  minimum_gate_duration_seconds: arguments_.minimumGateDurationSeconds,
  sample_interval_ms: arguments_.sampleIntervalMs,
  gate_eligible: evaluation.gate_eligible,
  gate_verdict: evaluation.gate_verdict,
  checks: evaluation.checks,
  worker: {
    pid: child.pid,
    exit_code: exitCode,
    evidence_path: relative(repositoryRoot, workerEvidencePath),
    verdict: workerEvidence.verdict,
    elapsed_ms: workerEvidence.elapsed_ms,
    connection_count: workerEvidence.connection_count,
    resync_count: workerEvidence.resync_count,
    total_received_messages: workerEvidence.total_received_messages,
    total_recorded_events: workerEvidence.total_recorded_events,
    total_segments: workerEvidence.total_segments,
    max_queue_depth: workerEvidence.max_queue_depth,
    queue_capacity: workerEvidence.queue_capacity,
    p95_event_lag_ms: workerEvidence.p95_event_lag_ms,
    max_event_lag_ms: workerEvidence.max_event_lag_ms,
    incident_count: workerEvidence.incidents.length,
    incident_kinds: [
      ...new Set(workerEvidence.incidents.map((incident) => incident.kind)),
    ].sort(),
  },
  segment_verification: {
    declared_segments: workerEvidence.total_segments,
    verified_complete_segments: verifiedSegmentCount,
    all_complete: evaluation.checks.all_segments_verified,
  },
  resources: summarizeResourceSamples(samples),
  resource_samples: samples,
};
mkdirSync(dirname(outputPath), { recursive: true });
writeFileSync(outputPath, `${JSON.stringify(evidence, null, 2)}\n`, {
  flag: "wx",
  mode: 0o600,
});
process.stdout.write(
  `${JSON.stringify({
    output: relative(repositoryRoot, outputPath),
    gate_eligible: evidence.gate_eligible,
    gate_verdict: evidence.gate_verdict,
    worker: evidence.worker,
    segment_verification: evidence.segment_verification,
    resources: evidence.resources,
  })}\n`,
);
if (evidence.gate_verdict === "failed")
  throw new Error(
    "natural soak evidence failed; inspect the supervisor evidence",
  );

function sampleProcess(
  pid: number,
  elapsedMs: number,
): ResourceSample | undefined {
  const sample = Bun.spawnSync({
    cmd: ["ps", "-o", "rss=,%cpu=", "-p", String(pid)],
    stdout: "pipe",
    stderr: "ignore",
  });
  if (sample.exitCode !== 0) return undefined;
  const [rssText, cpuText] = sample.stdout.toString().trim().split(/\s+/);
  const rssKiB = Number(rssText);
  const cpuPercent = Number(cpuText);
  if (!Number.isFinite(rssKiB) || !Number.isFinite(cpuPercent))
    return undefined;
  return {
    elapsed_ms: elapsedMs,
    rss_bytes: rssKiB * 1024,
    cpu_percent: cpuPercent,
  };
}

function runChecked(command: string[]): void {
  const result = Bun.spawnSync({
    cmd: command,
    cwd: moduleRoot,
    stdout: "inherit",
    stderr: "inherit",
  });
  if (result.exitCode !== 0)
    throw new Error(`build failed: ${command.join(" ")}`);
}

function assertChildPid(pid: number): void {
  if (!Number.isSafeInteger(pid) || pid <= 1)
    throw new Error(`invalid child pid: ${pid}`);
}

function killExact(pid: number): void {
  assertChildPid(pid);
  try {
    process.kill(pid, "SIGKILL");
  } catch (error) {
    if (
      !(error instanceof Error) ||
      !("code" in error) ||
      error.code !== "ESRCH"
    )
      throw error;
  }
}

function assertTmpPath(path: string): void {
  const repositoryRelative = relative(repositoryRoot, path).replaceAll(
    "\\",
    "/",
  );
  if (
    !repositoryRelative.startsWith("tmp/") ||
    repositoryRelative.includes("../")
  )
    throw new Error("path must be inside repository tmp/");
}

function assertChildPath(parent: string, path: string): void {
  const childRelative = relative(parent, path).replaceAll("\\", "/");
  if (
    childRelative === "" ||
    childRelative.startsWith("../") ||
    childRelative.includes("/../")
  ) {
    throw new Error("segment path must remain inside its worker run directory");
  }
}

function parseArgs(argv: string[]): {
  yesPublicNetwork: boolean;
  symbol: string;
  durationSeconds: number;
  minimumGateDurationSeconds: number;
  sampleIntervalMs: number;
  queueCapacity: number;
  segmentFrames: number;
  syncEveryFrames: number;
  maxBookLevels: number;
  output: string;
} {
  const result = {
    yesPublicNetwork: false,
    symbol: "BTCUSDT",
    durationSeconds: 3600,
    minimumGateDurationSeconds: 3600,
    sampleIntervalMs: 5000,
    queueCapacity: 64,
    segmentFrames: 1000,
    syncEveryFrames: 100,
    maxBookLevels: 20_000,
    output: `tmp/l2-recorder-bakeoff/natural-soak-evidence-${Date.now()}.json`,
  };
  let index = 0;
  while (index < argv.length) {
    if (argv[index] === "--yes-public-network") {
      result.yesPublicNetwork = true;
      index += 1;
      continue;
    }
    const value = argv[index + 1];
    if (value == null) throw new Error(`incomplete argument: ${argv[index]}`);
    if (argv[index] === "--symbol") result.symbol = value;
    else if (argv[index] === "--duration-seconds")
      result.durationSeconds = Number(value);
    else if (argv[index] === "--minimum-gate-duration-seconds")
      result.minimumGateDurationSeconds = Number(value);
    else if (argv[index] === "--sample-interval-ms")
      result.sampleIntervalMs = Number(value);
    else if (argv[index] === "--queue-capacity")
      result.queueCapacity = Number(value);
    else if (argv[index] === "--segment-frames")
      result.segmentFrames = Number(value);
    else if (argv[index] === "--sync-every-frames")
      result.syncEveryFrames = Number(value);
    else if (argv[index] === "--max-book-levels")
      result.maxBookLevels = Number(value);
    else if (argv[index] === "--output") result.output = value;
    else throw new Error(`unknown argument: ${argv[index]}`);
    index += 2;
  }
  if (!/^[A-Z0-9]{5,20}$/.test(result.symbol))
    throw new Error("symbol must be an uppercase Binance symbol");
  if (
    !Number.isSafeInteger(result.durationSeconds) ||
    result.durationSeconds < 5 ||
    result.durationSeconds > 86_400
  )
    throw new Error("duration-seconds must be between 5 and 86400");
  if (
    !Number.isSafeInteger(result.minimumGateDurationSeconds) ||
    result.minimumGateDurationSeconds < 5 ||
    result.minimumGateDurationSeconds > 86_400
  )
    throw new Error(
      "minimum-gate-duration-seconds must be between 5 and 86400",
    );
  if (
    !Number.isSafeInteger(result.sampleIntervalMs) ||
    result.sampleIntervalMs < 250 ||
    result.sampleIntervalMs > 60_000
  )
    throw new Error("sample-interval-ms must be between 250 and 60000");
  if (!Number.isSafeInteger(result.queueCapacity) || result.queueCapacity < 1)
    throw new Error("queue-capacity must be positive");
  if (!Number.isSafeInteger(result.segmentFrames) || result.segmentFrames < 1)
    throw new Error("segment-frames must be positive");
  if (
    !Number.isSafeInteger(result.syncEveryFrames) ||
    result.syncEveryFrames < 1 ||
    result.syncEveryFrames > result.segmentFrames
  )
    throw new Error("sync-every-frames must be between 1 and segment-frames");
  if (
    !Number.isSafeInteger(result.maxBookLevels) ||
    result.maxBookLevels < 2000
  )
    throw new Error("max-book-levels must be at least 2000");
  return result;
}
