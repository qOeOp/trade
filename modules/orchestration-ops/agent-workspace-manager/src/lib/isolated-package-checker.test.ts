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
  startIsolatedAgentWorkspaceChecker,
} from "./isolated-package-checker"
import type { AgentWorkspace } from "./workspace-manager"

test("isolated package checker exchanges only bounded check evidence over Unix socket", async () => {
  const root = mkdtempSync(join(tmpdir(), "agent-workspace-checker-"))
  const workspaceRoot = join(root, "workspace")
  const packageRoot = join(workspaceRoot, "modules", "sample")
  mkdirSync(packageRoot, { recursive: true })
  writeFileSync(join(packageRoot, "package.json"), JSON.stringify({
    name: "sample",
    private: true,
    scripts: { check: "bun -e \"process.exit(0)\"" },
  }))
  const socketPath = join(root, "control.sock")
  let checkerError: Error | null = null
  const server = await startIsolatedAgentWorkspaceChecker({
    socket_path: socketPath,
    workspace_root: workspaceRoot,
    report_error: (error) => {
      checkerError = error
    },
  })
  try {
    const check = await runIsolatedAgentWorkspacePackageCheck({
      socket_path: socketPath,
      workspace: {
        schema_version: "trade.agent-workspace.v2",
        run_id: "isolated-check",
        workspace_slot: "active",
        source_revision: "HEAD",
        source_commit: "a".repeat(40),
        repository_root: root,
        workspace_root: workspaceRoot,
        allowed_write_prefixes: ["modules/sample"],
        created_at: "2026-07-23T00:00:00.000Z",
      } satisfies AgentWorkspace,
      package_path: "modules/sample",
      timeout_ms: 10_000,
    }).catch((error) => {
      throw checkerError ?? error
    })
    assert.equal(check.exit_code, 0)
    assert.equal(check.timed_out, false)
    assert.equal(check.output_sha256.length, 64)
  } finally {
    await server.close()
    rmSync(root, { recursive: true, force: true })
  }
})
