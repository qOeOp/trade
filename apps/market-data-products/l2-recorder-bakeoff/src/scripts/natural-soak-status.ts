#!/usr/bin/env bun

import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { relative, resolve } from "node:path";
import { deriveNaturalSoakStatus } from "../bun/natural-soak-status";

interface LaunchReceipt {
  schema_version: string;
  started_at: string;
  supervisor_pid: number;
  evidence_path: string;
  log_path: string;
  terminal_state_path?: string;
}

interface ObservedFile {
  path: string;
  bytes: number;
  modifiedAtMs: number;
}

const repositoryRoot = resolve(process.cwd(), "../../..");
const arguments_ = parseArgs(process.argv.slice(2));
const receiptPath = resolve(repositoryRoot, arguments_.receipt);
assertTmpPath(receiptPath);
const receipt = JSON.parse(readFileSync(receiptPath, "utf8")) as LaunchReceipt;
if (receipt.schema_version !== "trade.l2-natural-soak-launch-receipt.v1")
  throw new Error("unsupported natural soak launch receipt");
if (
  !Number.isSafeInteger(receipt.supervisor_pid) ||
  receipt.supervisor_pid <= 1
)
  throw new Error("launch receipt has an invalid supervisor pid");
const startedAtMs = Date.parse(receipt.started_at);
if (!Number.isFinite(startedAtMs))
  throw new Error("launch receipt has an invalid started_at");
const evidencePath = resolve(repositoryRoot, receipt.evidence_path);
const logPath = resolve(repositoryRoot, receipt.log_path);
assertTmpPath(evidencePath);
assertTmpPath(logPath);
const evidenceExists = existsSync(evidencePath);
const terminalStatePath = receipt.terminal_state_path == null
  ? undefined
  : resolve(repositoryRoot, receipt.terminal_state_path);
if (terminalStatePath != null) assertTmpPath(terminalStatePath);
const terminalState = terminalStatePath != null && existsSync(terminalStatePath)
  ? (JSON.parse(readFileSync(terminalStatePath, "utf8")) as {
      schema_version?: string;
      status?: "completed" | "failed";
      exit_code?: number;
    })
  : undefined;
if (terminalState != null && terminalState.schema_version !== "trade.l2-natural-soak-terminal-state.v1")
  throw new Error("unsupported natural soak terminal state");
const workRoot = resolve(
  repositoryRoot,
  "tmp/l2-recorder-bakeoff/natural-soak-work",
);
const matchingWorkDirectories = existsSync(workRoot)
  ? readdirSync(workRoot, { withFileTypes: true })
      .filter(
        (entry) =>
          entry.isDirectory() &&
          entry.name.endsWith(`-${receipt.supervisor_pid}`),
      )
      .map((entry) => resolve(workRoot, entry.name))
  : [];
if (matchingWorkDirectories.length > 1)
  throw new Error(
    "multiple natural soak work directories match one supervisor pid",
  );
const observedFiles =
  matchingWorkDirectories.length === 0
    ? []
    : listObservedFiles(matchingWorkDirectories[0]!);
const segmentFiles = observedFiles.filter((file) =>
  file.path.endsWith(".tl2s"),
);
const partialFiles = observedFiles.filter((file) =>
  file.path.includes(".tl2s.partial."),
);
const latestFile = [...observedFiles].sort(
  (left, right) => right.modifiedAtMs - left.modifiedAtMs,
)[0];
const observedAtMs = Date.now();
const completedEvidence = evidenceExists
  ? (JSON.parse(readFileSync(evidencePath, "utf8")) as {
      gate_eligible?: boolean;
      gate_verdict?: string;
    })
  : undefined;
const supervisorAlive = processIsAlive(receipt.supervisor_pid);
const status = deriveNaturalSoakStatus({
  evidenceExists,
  evidenceVerdict: completedEvidence?.gate_verdict,
  supervisorAlive,
  terminalStatus: terminalState?.status,
  observedAtMs,
  startedAtMs,
  latestDataModifiedAtMs: latestFile?.modifiedAtMs,
  staleAfterMs: arguments_.staleAfterMs,
});
process.stdout.write(
  `${JSON.stringify({
    schema_version: "trade.l2-natural-soak-status.v1",
    observed_at: new Date(observedAtMs).toISOString(),
    status: status.status,
    freshness_ms: status.freshness_ms,
    receipt_path: relative(repositoryRoot, receiptPath),
    supervisor_pid: receipt.supervisor_pid,
    supervisor_alive: supervisorAlive,
    evidence_path: receipt.evidence_path,
    evidence_exists: evidenceExists,
    gate_eligible: completedEvidence?.gate_eligible,
    gate_verdict: completedEvidence?.gate_verdict,
    log_path: receipt.log_path,
    log_exists: existsSync(logPath),
    terminal_state_path: receipt.terminal_state_path,
    terminal_state_exists: terminalState != null,
    supervisor_exit_code: terminalState?.exit_code,
    finalized_segments: segmentFiles.length,
    partial_segments: partialFiles.length,
    latest_data_path:
      latestFile == null
        ? undefined
        : relative(repositoryRoot, latestFile.path),
    latest_data_bytes: latestFile?.bytes,
    latest_data_modified_at:
      latestFile == null
        ? undefined
        : new Date(latestFile.modifiedAtMs).toISOString(),
  })}\n`,
);

function processIsAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error instanceof Error && "code" in error && error.code === "EPERM";
  }
}

function listObservedFiles(workDirectory: string): ObservedFile[] {
  const files: ObservedFile[] = [];
  for (const runEntry of readdirSync(workDirectory, { withFileTypes: true })) {
    if (!runEntry.isDirectory()) continue;
    const runDirectory = resolve(workDirectory, runEntry.name);
    for (const entry of readdirSync(runDirectory, { withFileTypes: true })) {
      if (!entry.isFile()) continue;
      const path = resolve(runDirectory, entry.name);
      const stat = statSync(path);
      files.push({ path, bytes: stat.size, modifiedAtMs: stat.mtimeMs });
    }
  }
  return files;
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

function parseArgs(argv: string[]): { receipt: string; staleAfterMs: number } {
  let receipt = "";
  let staleAfterMs = 120_000;
  for (let index = 0; index < argv.length; index += 2) {
    const name = argv[index];
    const value = argv[index + 1];
    if (name == null || value == null)
      throw new Error(`incomplete argument: ${name ?? "<missing>"}`);
    if (name === "--receipt") receipt = value;
    else if (name === "--stale-after-ms") staleAfterMs = Number(value);
    else throw new Error(`unknown argument: ${name}`);
  }
  if (receipt.length === 0) throw new Error("--receipt is required");
  if (
    !Number.isSafeInteger(staleAfterMs) ||
    staleAfterMs < 1_000 ||
    staleAfterMs > 3_600_000
  )
    throw new Error("stale-after-ms must be between 1000 and 3600000");
  return { receipt, staleAfterMs };
}
