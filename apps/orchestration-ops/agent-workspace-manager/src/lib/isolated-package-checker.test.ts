import assert from "node:assert/strict"
import {
  mkdtempSync,
  mkdirSync,
  rmSync,
  writeFileSync,
} from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import test from "node:test"
import {
  runIsolatedAgentWorkspacePackageCheck,
  runIsolatedAgentWorkspaceSuiteCheck,
  startIsolatedAgentWorkspaceChecker,
} from "./isolated-package-checker"
import type { AgentWorkspace } from "./workspace-manager"

test("isolated package checker exchanges only bounded check evidence over Unix socket", async () => {
  const root = mkdtempSync(join(tmpdir(), "agent-workspace-checker-"))
  const workspaceRoot = join(root, "workspace")
  const packageRoot = join(workspaceRoot, "apps", "sample")
  const dependencyRoot = join(root, "dependencies")
  mkdirSync(packageRoot, { recursive: true })
  mkdirSync(dependencyRoot)
  mkdirSync(join(
    workspaceRoot,
    "apps",
    "research-strategy-development",
    "research-control-plane",
    "certification",
    "replay-release-audit",
    "src",
    "scripts",
  ), { recursive: true })
  writeFileSync(join(packageRoot, "package.json"), JSON.stringify({
    name: "sample",
    private: true,
    scripts: { check: "bun -e \"process.exit(0)\"" },
  }))
  writeFileSync(join(workspaceRoot, "package.json"), JSON.stringify({
    name: "sample-workspace",
    private: true,
    scripts: {
      check: "bun -e \"import { lstatSync } from 'node:fs'; if (!lstatSync('node_modules').isSymbolicLink()) process.exit(1)\"",
    },
  }))
  writeFileSync(
    join(
      workspaceRoot,
      "apps",
      "research-strategy-development",
      "research-control-plane",
      "certification",
      "replay-release-audit",
      "src",
      "scripts",
      "main.ts",
    ),
    "import { lstatSync } from 'node:fs'\n"
      + "if (!lstatSync('node_modules').isSymbolicLink()) process.exit(1)\n",
  )
  const socketPath = join(root, "control.sock")
  let checkerError: Error | null = null
  const server = await startIsolatedAgentWorkspaceChecker({
    socket_path: socketPath,
    workspace_root: workspaceRoot,
    dependency_root: dependencyRoot,
    report_error: (error) => {
      checkerError = error
    },
  })
  try {
    const check = await runIsolatedAgentWorkspacePackageCheck({
      socket_path: socketPath,
      workspace: workspace(),
      package_path: "apps/sample",
      timeout_ms: 10_000,
    }).catch((error) => {
      throw checkerError ?? error
    })
    assert.equal(check.exit_code, 0)
    assert.equal(check.timed_out, false)
    assert.equal(check.output_sha256.length, 64)
    const quality = await runIsolatedAgentWorkspaceSuiteCheck({
      socket_path: socketPath,
      workspace: workspace(),
      suite: "repository_quality",
      timeout_ms: 10_000,
    })
    const replayAudit = await runIsolatedAgentWorkspaceSuiteCheck({
      socket_path: socketPath,
      workspace: workspace(),
      suite: "replay_independent_release_audit",
      timeout_ms: 10_000,
    })
    assert.equal(quality.exit_code, 0)
    assert.equal(replayAudit.exit_code, 0)
    assert.equal(quality.output_sha256.length, 64)
    assert.equal(replayAudit.output_sha256.length, 64)
  } finally {
    await server.close()
    rmSync(root, { recursive: true, force: true })
  }

  function workspace(): AgentWorkspace {
    return {
      schema_version: "trade.agent-workspace.v2",
      run_id: "isolated-check",
      workspace_slot: "active",
      source_revision: "HEAD",
      source_commit: "a".repeat(40),
      repository_root: root,
      workspace_root: workspaceRoot,
      allowed_write_prefixes: ["apps/sample"],
      created_at: "2026-07-23T00:00:00.000Z",
    }
  }
})
