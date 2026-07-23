import assert from "node:assert/strict"
import { existsSync, mkdtempSync, mkdirSync, rmSync, symlinkSync, utimesSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import test from "node:test"
import {
  buildAgentWorkspaceMountPlan,
  captureAgentWorkspacePatch,
  createAgentWorkspace,
  listStaleAgentWorkspaces,
  removeAgentWorkspace,
  removeStaleAgentWorkspaces,
  runAgentWorkspacePackageCheck,
} from "./workspace-manager"

test("Developer workspace freezes source, bounds writes, captures patch, and cleans up", async () => {
  const root = fixtureRepository()
  const workspace = createAgentWorkspace({
    repository_root: root,
    run_id: "developer-run-1",
    source_revision: "HEAD",
    allowed_write_prefixes: ["modules/sample"],
    created_at: "2026-07-23T01:00:00.000Z",
  })
  try {
    writeFileSync(join(workspace.workspace_root, "modules/sample/index.ts"), "export const value = 2\n")
    writeFileSync(join(workspace.workspace_root, "modules/sample/new.test.ts"), "export const testValue = 3\n")
    const patch = captureAgentWorkspacePatch(workspace)
    assert.deepEqual(patch.changed_files, ["modules/sample/index.ts", "modules/sample/new.test.ts"])
    assert.ok(patch.patch_text.includes("value = 2"))
    assert.equal(patch.patch_sha256.length, 64)
    const check = await runAgentWorkspacePackageCheck({
      workspace,
      package_path: "modules/sample",
      timeout_ms: 10_000,
    })
    assert.equal(check.exit_code, 0)
    const output = join(root, "tmp", "agent-outputs", workspace.run_id)
    mkdirSync(output, { recursive: true })
    const mounts = buildAgentWorkspaceMountPlan(workspace, output)
    assert.deepEqual(mounts.mounts.map((mount) => mount.target), ["/workspace", "/output"])
    assert.equal(mounts.production_repository, false)
    assert.equal(mounts.network, "none")
  } finally {
    removeAgentWorkspace(workspace)
    assert.equal(Bun.spawnSync({ cmd: ["git", "worktree", "list", "--porcelain"], cwd: root }).stdout.toString().includes(workspace.workspace_root), false)
    rmSync(root, { recursive: true, force: true })
  }
})

test("workspace GC preserves active runs and removes only old scoped worktrees", () => {
  const root = fixtureRepository()
  const active = createAgentWorkspace({
    repository_root: root,
    run_id: "developer-active",
    source_revision: "HEAD",
    allowed_write_prefixes: ["modules/sample"],
  })
  const stale = createAgentWorkspace({
    repository_root: root,
    run_id: "developer-stale",
    source_revision: "HEAD",
    allowed_write_prefixes: ["modules/sample"],
  })
  const old = new Date("2026-07-20T00:00:00.000Z")
  utimesSync(stale.workspace_root, old, old)
  try {
    const candidates = listStaleAgentWorkspaces({
      repository_root: root,
      active_run_ids: [active.run_id],
      older_than: "2026-07-22T00:00:00.000Z",
    })
    assert.deepEqual(candidates.map((item) => item.run_id), [stale.run_id])
    const result = removeStaleAgentWorkspaces({
      repository_root: root,
      active_run_ids: [active.run_id],
      older_than: "2026-07-22T00:00:00.000Z",
      apply: true,
    })
    assert.deepEqual(result.removed, [stale.run_id])
    assert.equal(existsSync(active.workspace_root), true)
  } finally {
    removeAgentWorkspace(active)
    rmSync(root, { recursive: true, force: true })
  }
})

test("Developer workspace rejects paths outside policy and escaping symlinks", () => {
  const root = fixtureRepository()
  const outside = mkdtempSync(join(tmpdir(), "agent-workspace-outside-"))
  const workspace = createAgentWorkspace({
    repository_root: root,
    run_id: "developer-run-2",
    source_revision: "HEAD",
    allowed_write_prefixes: ["modules/sample"],
  })
  try {
    writeFileSync(join(workspace.workspace_root, "README.md"), "unauthorized\n")
    assert.throws(() => captureAgentWorkspacePatch(workspace), /outside allowed prefixes/)
    Bun.spawnSync({ cmd: ["git", "checkout", "--", "README.md"], cwd: workspace.workspace_root })
    symlinkSync(outside, join(workspace.workspace_root, "modules/sample/escape"))
    assert.throws(() => captureAgentWorkspacePatch(workspace), /escapes its root/)
  } finally {
    removeAgentWorkspace(workspace)
    rmSync(root, { recursive: true, force: true })
    rmSync(outside, { recursive: true, force: true })
  }
})

function fixtureRepository(): string {
  const root = mkdtempSync(join(tmpdir(), "agent-workspace-repo-"))
  mkdirSync(join(root, "modules/sample"), { recursive: true })
  writeFileSync(join(root, ".gitignore"), "tmp/\n")
  writeFileSync(join(root, "README.md"), "fixture\n")
  writeFileSync(join(root, "modules/sample/index.ts"), "export const value = 1\n")
  writeFileSync(join(root, "modules/sample/package.json"), JSON.stringify({
    name: "sample",
    private: true,
    scripts: { check: "bun -e \"process.exit(0)\"" },
  }))
  run(root, ["init"])
  run(root, ["config", "user.email", "agent-workspace@example.invalid"])
  run(root, ["config", "user.name", "Agent Workspace Test"])
  run(root, ["add", "."])
  run(root, ["commit", "-m", "fixture"])
  return root
}

function run(cwd: string, args: string[]): void {
  const result = Bun.spawnSync({ cmd: ["git", ...args], cwd, stdout: "pipe", stderr: "pipe" })
  if (result.exitCode !== 0) throw new Error(result.stderr.toString() || `git ${args[0]} failed`)
}
