#!/usr/bin/env bun

import { existsSync, mkdirSync, renameSync, rmSync, writeFileSync } from "node:fs"
import { homedir } from "node:os"
import { resolve } from "node:path"
import { repoRoot } from "../../../../contracts/runtime-core/src/paths"
import {
  PROGRAM_SHADOW_LAUNCHD_LABEL,
  isMacOsProtectedUserPath,
  renderProgramShadowLaunchAgent,
} from "./lib/program-shadow-launchd"

const action = process.argv[2] || "status"
const repositoryRoot = repoRoot()
const launchAgentsDirectory = resolve(homedir(), "Library", "LaunchAgents")
const plistPath = resolve(launchAgentsDirectory, `${PROGRAM_SHADOW_LAUNCHD_LABEL}.plist`)
const serviceTarget = `gui/${process.getuid?.() ?? 0}/${PROGRAM_SHADOW_LAUNCHD_LABEL}`
const domainTarget = `gui/${process.getuid?.() ?? 0}`
const logDirectory = resolve(repositoryRoot, "tmp", "runtime", "program-shadow-supervisor")
const plist = renderProgramShadowLaunchAgent({
  bun_path: process.execPath,
  repository_root: repositoryRoot,
  main_script_path: resolve(repositoryRoot, "modules/orchestration-ops/trade-flow/src/scripts/main.ts"),
  trade_db_path: resolve(repositoryRoot, "data", "trade.db"),
  ops_runtime_db_path: resolve(repositoryRoot, "data", "ops_runtime.db"),
  stdout_path: resolve(logDirectory, "stdout.log"),
  stderr_path: resolve(logDirectory, "stderr.log"),
  interval_seconds: 60,
})

if (action === "render") {
  process.stdout.write(plist)
} else if (action === "install") {
  if (isMacOsProtectedUserPath(repositoryRoot, homedir()) && process.env.TRADE_ALLOW_PROTECTED_LAUNCHD_PATH !== "1") {
    throw new Error(
      "launchd cannot reliably open source under macOS Desktop, Documents, or Downloads without an explicit privacy grant; move the repository or set TRADE_ALLOW_PROTECTED_LAUNCHD_PATH=1 after granting access",
    )
  }
  mkdirSync(launchAgentsDirectory, { recursive: true })
  mkdirSync(logDirectory, { recursive: true })
  const temporaryPath = `${plistPath}.tmp-${process.pid}`
  writeFileSync(temporaryPath, plist, { mode: 0o600 })
  renameSync(temporaryPath, plistPath)
  launchctl(["bootout", serviceTarget], true)
  launchctl(["bootstrap", domainTarget, plistPath])
  process.stdout.write(`${JSON.stringify({
    schema_version: "trade-flow.program-shadow-launchd-operation.v1",
    action,
    label: PROGRAM_SHADOW_LAUNCHD_LABEL,
    installed: true,
    plist_path: plistPath,
    process_authority: "launchd",
    pid_file: false,
  }, null, 2)}\n`)
} else if (action === "status") {
  const result = launchctl(["print", serviceTarget], true)
  process.stdout.write(result.stdout)
  if (result.exitCode !== 0) process.exit(result.exitCode)
} else if (action === "uninstall") {
  launchctl(["bootout", serviceTarget], true)
  if (existsSync(plistPath)) rmSync(plistPath)
  process.stdout.write(`${JSON.stringify({
    schema_version: "trade-flow.program-shadow-launchd-operation.v1",
    action,
    label: PROGRAM_SHADOW_LAUNCHD_LABEL,
    installed: false,
  }, null, 2)}\n`)
} else {
  throw new Error("action must be render, install, status, or uninstall")
}

function launchctl(arguments_: string[], allowFailure = false): { exitCode: number; stdout: string } {
  const result = Bun.spawnSync(["/bin/launchctl", ...arguments_], {
    cwd: repositoryRoot,
    stdout: "pipe",
    stderr: "pipe",
  })
  const stdout = result.stdout.toString()
  const stderr = result.stderr.toString()
  if (!allowFailure && result.exitCode !== 0) {
    throw new Error(`launchctl ${arguments_[0]} failed (${result.exitCode}): ${stderr.trim()}`)
  }
  return { exitCode: result.exitCode, stdout: stdout || stderr }
}
