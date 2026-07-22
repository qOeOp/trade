#!/usr/bin/env bun

import {
  closeSync,
  existsSync,
  mkdirSync,
  openSync,
  writeFileSync,
} from "node:fs";
import { relative, resolve } from "node:path";

const moduleRoot = process.cwd();
const repositoryRoot = resolve(moduleRoot, "../../..");
const forwardedArguments = process.argv.slice(2);
const outputArgumentIndex = forwardedArguments.indexOf("--output");
const outputArgument =
  outputArgumentIndex < 0
    ? undefined
    : forwardedArguments[outputArgumentIndex + 1];
if (outputArgument == null)
  throw new Error("detached natural soak requires an explicit --output path");
const outputPath = resolve(repositoryRoot, outputArgument);
assertTmpPath(outputPath);
if (existsSync(outputPath))
  throw new Error(
    `refusing to overwrite existing evidence: ${relative(repositoryRoot, outputPath)}`,
  );

const launchToken = `${Date.now()}-${process.pid}`;
const launchDirectory = resolve(
  repositoryRoot,
  `tmp/l2-recorder-bakeoff/natural-soak-launch/${launchToken}`,
);
assertTmpPath(launchDirectory);
mkdirSync(launchDirectory, { recursive: true });
const logPath = resolve(launchDirectory, "supervisor.log");
const terminalStatePath = resolve(launchDirectory, "terminal-state.json");
const receiptPath = resolve(launchDirectory, "launch-receipt.json");
const descriptor = openSync(logPath, "wx", 0o600);
let child: ReturnType<typeof Bun.spawn>;
try {
  child = Bun.spawn({
    cmd: [
      process.execPath,
      resolve(moduleRoot, "src/scripts/natural-soak-supervisor.ts"),
      ...forwardedArguments,
      "--terminal-state",
      relative(repositoryRoot, terminalStatePath),
    ],
    cwd: moduleRoot,
    stdin: "ignore",
    stdout: descriptor,
    stderr: descriptor,
    detached: true,
  });
  child.unref();
} finally {
  closeSync(descriptor);
}
if (!Number.isSafeInteger(child.pid) || child.pid <= 1)
  throw new Error(`invalid detached supervisor pid: ${child.pid}`);
const receipt = {
  schema_version: "trade.l2-natural-soak-launch-receipt.v1",
  started_at: new Date().toISOString(),
  supervisor_pid: child.pid,
  evidence_path: relative(repositoryRoot, outputPath),
  log_path: relative(repositoryRoot, logPath),
  terminal_state_path: relative(repositoryRoot, terminalStatePath),
};
writeFileSync(receiptPath, `${JSON.stringify(receipt, null, 2)}\n`, {
  flag: "wx",
  mode: 0o600,
});
process.stdout.write(
  `${JSON.stringify({ ...receipt, receipt_path: relative(repositoryRoot, receiptPath) })}\n`,
);

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
