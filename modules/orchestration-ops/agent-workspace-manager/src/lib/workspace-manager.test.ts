import assert from "node:assert/strict"
import { createHash } from "node:crypto"
import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, symlinkSync, utimesSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import test from "node:test"
import {
  buildAgentWorkspaceMountPlan,
  captureAgentWorkspacePatch,
  cleanupAgentWorkspaceSlot,
  createAgentWorkspaceExecutionScope,
  createAgentWorkspace,
  finalizeAgentWorkspaceEvidence,
  listStaleAgentWorkspaces,
  removeAgentWorkspace,
  removeStaleAgentWorkspaces,
  runAgentWorkspacePackageCheck,
  seedAgentWorkspacePatch,
} from "./workspace-manager"

test("workspace execution scope binds one request to exact source and bounded check paths", () => {
  const scope = createAgentWorkspaceExecutionScope({
    run_id: "developer-run-scope",
    request_hash: "a".repeat(64),
    source_revision: "0123456789abcdef",
    allowed_write_prefixes: ["modules/sample"],
    package_paths: ["modules/sample"],
    issued_at: "2026-07-23T01:00:00.000Z",
  })
  assert.equal(scope.scope_hash.length, 64)
  assert.equal(scope.domain_authority, "none")
  assert.equal(scope.seed_patch, null)
  assert.deepEqual(scope.package_paths, ["modules/sample"])
  assert.throws(() => createAgentWorkspaceExecutionScope({
    run_id: "developer-run-scope",
    request_hash: "a".repeat(64),
    source_revision: "0123456789abcdef",
    allowed_write_prefixes: ["modules/sample"],
    package_paths: ["modules/other"],
    issued_at: "2026-07-23T01:00:00.000Z",
  }), /outside allowed prefixes/)
})

test("workspace seed patch reconstructs one exact cumulative revision", () => {
  const root = fixtureRepository()
  const first = createAgentWorkspace({
    repository_root: root,
    run_id: "developer-seed-source",
    source_revision: "HEAD",
    allowed_write_prefixes: ["modules/sample"],
  })
  let artifact
  let patchText
  try {
    writeFileSync(
      join(first.workspace_root, "modules/sample/index.ts"),
      "export const value = 2\n",
    )
    const patch = captureAgentWorkspacePatch(first)
    artifact = {
      ref: `agent-artifact://durable/${patch.patch_sha256}`,
      sha256: patch.patch_sha256,
      media_type: "text/x-diff" as const,
      bytes: patch.patch_bytes,
    }
    patchText = patch.patch_text
  } finally {
    removeAgentWorkspace(first)
  }
  const second = createAgentWorkspace({
    repository_root: root,
    run_id: "developer-seed-target",
    source_revision: "HEAD",
    allowed_write_prefixes: ["modules/sample"],
  })
  try {
    const seeded = seedAgentWorkspacePatch({
      workspace: second,
      artifact,
      patch_text: patchText,
    })
    assert.equal(seeded.patch_sha256, artifact.sha256)
    assert.match(
      readFileSync(join(second.workspace_root, "modules/sample/index.ts"), "utf8"),
      /value = 2/,
    )
  } finally {
    removeAgentWorkspace(second)
    rmSync(root, { recursive: true, force: true })
  }
})

test("one fixed workspace slot supports a separately mounted coding agent", () => {
  const root = fixtureRepository()
  const slot = "openclaw-developer-code"
  const slotRoot = join(root, "tmp", "agent-workspace-slots", slot)
  mkdirSync(slotRoot, { recursive: true })
  const workspace = createAgentWorkspace({
    repository_root: root,
    run_id: "developer-fixed-slot",
    source_revision: "HEAD",
    allowed_write_prefixes: ["modules/sample"],
    workspace_slot: slot,
  })
  assert.equal(workspace.workspace_slot, slot)
  assert.equal(
    workspace.workspace_root,
    join(
      workspace.repository_root,
      "tmp",
      "agent-workspace-slots",
      slot,
    ),
  )
  assert.equal(cleanupAgentWorkspaceSlot({
    repository_root: root,
    workspace_slot: slot,
  }), true)
  assert.equal(existsSync(slotRoot), false)
  assert.equal(cleanupAgentWorkspaceSlot({
    repository_root: root,
    workspace_slot: slot,
  }), false)
  rmSync(root, { recursive: true, force: true })
})

test("container source mapping binds an external revision to the internal snapshot", () => {
  const root = fixtureRepository()
  const internalCommit = Bun.spawnSync({
    cmd: ["git", "rev-parse", "HEAD"],
    cwd: root,
  }).stdout.toString().trim()
  const sourceRevision = "f".repeat(40)
  writeFileSync(
    join(root, ".trade-source-revision.json"),
    JSON.stringify({
      schema_version: "trade.container-source-revision.v1",
      source_revision: sourceRevision,
      internal_commit: internalCommit,
    }),
  )
  const workspace = createAgentWorkspace({
    repository_root: root,
    run_id: "developer-container-source",
    source_revision: sourceRevision,
    allowed_write_prefixes: ["modules/sample"],
  })
  assert.equal(workspace.source_revision, sourceRevision)
  assert.equal(workspace.source_commit, internalCommit)
  removeAgentWorkspace(workspace)
  assert.throws(() => createAgentWorkspace({
    repository_root: root,
    run_id: "developer-container-source-drift",
    source_revision: "e".repeat(40),
    allowed_write_prefixes: ["modules/sample"],
  }), /mapping drifted/)
  rmSync(root, { recursive: true, force: true })
})

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
    const artifactTexts = new Map<string, string>()
    const finalized = await finalizeAgentWorkspaceEvidence({
      workspace,
      package_paths: ["modules/sample"],
      checked_at: "2026-07-23T01:05:00.000Z",
      write_artifact(mediaType, text) {
        const bytes = Buffer.from(text)
        const sha256 = createHash("sha256").update(bytes).digest("hex")
        const ref = `agent-artifact://temporary/${sha256}`
        artifactTexts.set(ref, text)
        return { ref, sha256, media_type: mediaType, bytes: bytes.byteLength }
      },
    })
    assert.equal(finalized.patch_ref.media_type, "text/x-diff")
    assert.deepEqual(finalized.changed_files, patch.changed_files)
    assert.equal(finalized.patch_sha256, patch.patch_sha256)
    const checkEvidence = JSON.parse(
      artifactTexts.get(finalized.quality_check_refs[0]!.ref)!,
    )
    assert.equal(checkEvidence.patch_sha256, patch.patch_sha256)
    assert.equal(checkEvidence.exit_code, 0)
    assert.equal(checkEvidence.domain_authority, "none")
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
