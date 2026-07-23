import assert from "node:assert/strict"
import { createHash } from "node:crypto"
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"
import test from "node:test"
import { Database } from "bun:sqlite"
import {
  buildAgentRunEvent,
  buildAgentRunRequest,
  buildAgentRunResult,
} from "../modules/contracts/agent-run-contract/src/agent-run-contract"
import {
  writeAgentJsonArtifact,
  writeAgentTextArtifact,
} from "../modules/orchestration-ops/agent-artifact-store/src/lib/agent-artifact-store"
import {
  createAgentWorkspace,
  createAgentWorkspaceExecutionScope,
  finalizeAgentWorkspaceEvidence,
  removeAgentWorkspace,
  type AgentWorkspacePackageCheck,
} from "../modules/orchestration-ops/agent-workspace-manager/src/lib/workspace-manager"
import {
  appendAgentRunEvent,
  completeAgentRun,
  ensureAgentRunStoreSchema,
  admitAgentRun,
} from "../modules/orchestration-ops/ops-runtime-store/src/lib/agent-run-store"
import {
  readAgentPatchAdoption,
} from "../modules/orchestration-ops/ops-runtime-store/src/lib/agent-patch-adoption-store"
import {
  SERVER_CONTAINER_SOURCE_PACKAGE_CRITICAL_REFS,
} from "../modules/orchestration-ops/trade-flow/src/scripts/lib/server-runtime-container-release-package"
import {
  registerAgentWorkspaceExecutionScope,
} from "../modules/orchestration-ops/ops-runtime-store/src/lib/agent-workspace-scope-store"
import {
  createDeveloperAgentSubmission,
  DEVELOPER_AGENT_SUBMISSION_SCHEMA,
} from "../modules/research-strategy-development/research-control-plane/contracts/src/lib/developer-agent-submission"
import {
  AdoptionError,
  runDeveloperPatchAdoption,
} from "./lib/rd-developer-patch-adoption"
import {
  queueDeveloperPatchAdoption,
} from "./lib/rd-developer-patch-adoption-queue"
import {
  createDeveloperCandidateServerPackage,
} from "./lib/rd-developer-candidate-release-package"

test("Developer patch adoption certifies an exact isolated candidate without advancing the source checkout", async () => {
  const fixture = await completedDeveloperRun(false)
  const packageRoot = `${fixture.root}-server-package`
  try {
    const sourceHead = gitText(fixture.root, ["rev-parse", "HEAD"]).trim()
    const result = await adopt(fixture)
    assert.equal(result.status, undefined)
    assert.equal(result.deployment_authority, "none")
    assert.equal(result.manifest.safety.production_checkout_modified, false)
    assert.equal(result.manifest.safety.main_branch_advanced, false)
    assert.equal(result.manifest.safety.trading_authority, false)
    assert.equal(gitText(fixture.root, ["rev-parse", "HEAD"]).trim(), sourceHead)
    assert.equal(
      gitText(fixture.root, ["show", `${result.candidate_source_revision}:modules/sample/src/value.ts`]),
      "export const value = 2\n",
    )
    const manifestPath = resolve(fixture.root, result.manifest_ref)
    const archivePath = resolve(
      fixture.root,
      result.manifest.source_archive.ref,
    )
    assert.equal(existsSync(manifestPath), true)
    assert.equal(existsSync(archivePath), true)
    assert.equal(
      createHash("sha256").update(readFileSync(archivePath)).digest("hex"),
      result.manifest.source_archive.sha256,
    )
    assert.equal(
      existsSync(join(fixture.root, "tmp", "agent-workspace-slots", "candidate")),
      false,
    )
    assert.equal(
      readAgentPatchAdoption(fixture.db, fixture.adoptionId)?.status,
      "candidate_certified",
    )

    const replayed = await adopt(fixture)
    assert.deepEqual(replayed, result)

    const packaged = createDeveloperCandidateServerPackage({
      db: fixture.db,
      repository_root: fixture.root,
      adoption_id: fixture.adoptionId,
      target_root: packageRoot,
      created_at: "2026-07-23T01:24:00.000Z",
    })
    assert.equal(
      packaged.candidate_source_revision,
      result.candidate_source_revision,
    )
    assert.equal(packaged.deployment_authority, "none")
    assert.equal(packaged.trading_authority, false)
    assert.equal(
      readFileSync(join(packageRoot, "SOURCE_COMMIT"), "utf8"),
      `${result.candidate_source_revision}\n`,
    )
    const releaseManifest = JSON.parse(
      readFileSync(join(packageRoot, "release-manifest.json"), "utf8"),
    )
    assert.equal(
      releaseManifest.source_origin.manifest_sha256,
      result.manifest_sha256,
    )
    assert.equal(
      releaseManifest.source_origin.packaged_manifest_ref,
      "source-adoption-manifest.json",
    )
    assert.deepEqual(
      readFileSync(join(packageRoot, "source-adoption-manifest.json")),
      readFileSync(manifestPath),
    )
  } finally {
    fixture.db.close()
    rmSync(fixture.root, { recursive: true, force: true })
    rmSync(packageRoot, { recursive: true, force: true })
  }
})

test("Developer patch adoption rejects dependency manifest changes before certification", async () => {
  const fixture = await completedDeveloperRun(true)
  try {
    await assert.rejects(
      adopt(fixture),
      (error: unknown) => error instanceof AdoptionError
        && error.failure_class === "validation_failed"
        && /dependency manifest/.test(error.message),
    )
    const record = readAgentPatchAdoption(fixture.db, fixture.adoptionId)
    assert.equal(record?.status, "rejected")
    assert.equal(record?.failure_class, "validation_failed")
    assert.equal(
      existsSync(join(fixture.root, "tmp", "agent-workspace-slots", "candidate")),
      false,
    )
  } finally {
    fixture.db.close()
    rmSync(fixture.root, { recursive: true, force: true })
  }
})

async function completedDeveloperRun(changeDependencyManifest: boolean): Promise<{
  root: string
  db: Database
  runId: string
  adoptionId: string
}> {
  const root = mkdtempSync(join(tmpdir(), "rd-patch-adoption-"))
  mkdirSync(join(root, "modules", "sample", "src"), { recursive: true })
  writeFileSync(
    join(root, "modules", "sample", "package.json"),
    `${JSON.stringify({
      name: "sample",
      private: true,
      type: "module",
      scripts: { check: "bun -e \"process.exit(0)\"" },
    }, null, 2)}\n`,
  )
  writeFileSync(
    join(root, "modules", "sample", "src", "value.ts"),
    "export const value = 1\n",
  )
  for (const ref of SERVER_CONTAINER_SOURCE_PACKAGE_CRITICAL_REFS) {
    const path = join(root, ref)
    mkdirSync(resolve(path, ".."), { recursive: true })
    writeFileSync(path, criticalFixture(ref))
  }
  git(root, ["init", "-q"])
  git(root, ["config", "user.name", "Fixture"])
  git(root, ["config", "user.email", "fixture@example.invalid"])
  git(root, ["add", "."])
  git(root, ["commit", "-q", "-m", "base"])
  const sourceRevision = gitText(root, ["rev-parse", "HEAD"]).trim()
  const runId = changeDependencyManifest
    ? "developer-run-dependency-rejected"
    : "developer-run-certified"
  const adoptionId = `${runId}:candidate`
  const instruction = writeAgentTextArtifact({
    repository_root: root,
    storage: "durable",
    media_type: "text/markdown",
    text: "Implement one bounded source change.",
  })
  const context = writeAgentJsonArtifact({
    repository_root: root,
    storage: "durable",
    value: { scope: "modules/sample" },
  })
  const request = buildAgentRunRequest({
    run_id: runId,
    idempotency_key: `${runId}-key`,
    trace_id: `${runId}-trace`,
    task_profile: "developer",
    objective: "Implement one bounded source change.",
    source_revision: sourceRevision,
    instruction_ref: instruction,
    input_refs: [context],
    output_schema_version: DEVELOPER_AGENT_SUBMISSION_SCHEMA,
    capabilities: [
      "owner_read",
      "research_read",
      "workspace_read",
      "workspace_patch",
      "bounded_quality_check",
    ],
    budget: {
      deadline_at: "2026-07-23T03:00:00.000Z",
      max_wall_time_ms: 3_600_000,
      max_turns: 8,
      max_tool_calls: 16,
      max_input_bytes: 1024 * 1024,
      max_output_bytes: 16 * 1024 * 1024,
    },
    data_classification: "project_internal",
  })
  const db = new Database(":memory:")
  ensureAgentRunStoreSchema(db)
  admitAgentRun(
    db,
    request,
    "openclaw-workspace-gateway",
    "2026-07-23T01:00:00.000Z",
  )
  const scope = createAgentWorkspaceExecutionScope({
    run_id: request.run_id,
    request_hash: request.request_hash,
    source_revision: request.source_revision,
    allowed_write_prefixes: ["modules/sample"],
    package_paths: ["modules/sample"],
    issued_at: "2026-07-23T01:00:01.000Z",
  })
  registerAgentWorkspaceExecutionScope(db, {
    scope,
    registered_at: "2026-07-23T01:00:02.000Z",
  })
  const workspace = createAgentWorkspace({
    repository_root: root,
    run_id: request.run_id,
    source_revision: request.source_revision,
    allowed_write_prefixes: scope.allowed_write_prefixes,
    created_at: "2026-07-23T01:01:00.000Z",
  })
  let evidence
  try {
    if (changeDependencyManifest) {
      const packagePath = join(workspace.workspace_root, "modules", "sample", "package.json")
      const packageJson = JSON.parse(readFileSync(packagePath, "utf8"))
      packageJson.description = "dependency manifest changes are release-managed"
      writeFileSync(packagePath, `${JSON.stringify(packageJson, null, 2)}\n`)
    } else {
      writeFileSync(
        join(workspace.workspace_root, "modules", "sample", "src", "value.ts"),
        "export const value = 2\n",
      )
    }
    evidence = await finalizeAgentWorkspaceEvidence({
      workspace,
      package_paths: scope.package_paths,
      checked_at: "2026-07-23T01:20:00.000Z",
      write_artifact: (mediaType, text) => writeAgentTextArtifact({
        repository_root: root,
        storage: "durable",
        media_type: mediaType,
        text,
      }),
      run_package_check: async ({ package_path }) => passedPackageCheck(package_path),
    })
  } finally {
    removeAgentWorkspace(workspace)
  }
  const submission = createDeveloperAgentSubmission({
    schema_version: DEVELOPER_AGENT_SUBMISSION_SCHEMA,
    developer_run_id: request.run_id,
    brief_id: `${runId}-brief`,
    brief_hash: "b".repeat(64),
    source_revision: request.source_revision,
    draft_revision: 1,
    predecessor_run_id: null,
    capability_assessment: {
      implementation_mode: "code_change_required",
      reason_code: "implementation_gap",
      required_capabilities: ["typescript"],
    },
    contract_draft: null,
    workspace_patch: evidence.patch_ref,
    quality_check_refs: evidence.quality_check_refs,
    replay_diagnosis_refs: [],
    created_at: "2026-07-23T01:21:00.000Z",
  })
  const submissionRef = writeAgentJsonArtifact({
    repository_root: root,
    storage: "durable",
    value: submission,
  })
  appendAgentRunEvent(db, buildAgentRunEvent({
    run_id: request.run_id,
    trace_id: request.trace_id,
    request_hash: request.request_hash,
    sequence: 2,
    occurred_at: "2026-07-23T01:02:00.000Z",
    kind: "started",
    summary: "Developer run started.",
  }))
  appendAgentRunEvent(db, buildAgentRunEvent({
    run_id: request.run_id,
    trace_id: request.trace_id,
    request_hash: request.request_hash,
    sequence: 3,
    occurred_at: "2026-07-23T01:22:00.000Z",
    kind: "terminal",
    summary: "Developer run completed.",
    status: "completed",
  }))
  const outputRefs = [
    submissionRef,
    evidence.patch_ref,
    ...evidence.quality_check_refs,
  ]
  const completedResult = buildAgentRunResult({
    run_id: request.run_id,
    trace_id: request.trace_id,
    request_hash: request.request_hash,
    terminal_sequence: 3,
    finished_at: "2026-07-23T01:22:00.000Z",
    status: "completed",
    output_refs: outputRefs,
    usage: {
      wall_time_ms: 1_320_000,
      turns: 3,
      tool_calls: 2,
      input_bytes: instruction.bytes + context.bytes,
      output_bytes: outputRefs.reduce((sum, ref) => sum + ref.bytes, 0),
    },
  })
  completeAgentRun(db, completedResult)
  const queued = queueDeveloperPatchAdoption(db, {
    run_id: request.run_id,
    request_hash: request.request_hash,
    result_hash: completedResult.result_hash,
    scope_hash: scope.scope_hash,
    admission: { status: "patch_ready" },
  }, "2026-07-23T01:22:30.000Z")
  assert.equal(queued.adoption_id, adoptionId)
  assert.equal(queued.status, "accepted")
  return { root, db, runId, adoptionId }
}

function criticalFixture(
  ref: typeof SERVER_CONTAINER_SOURCE_PACKAGE_CRITICAL_REFS[number],
): string {
  if (ref === "deploy/server/container-acceptance.sh") {
    return "#!/bin/sh\nset -eu\n"
  }
  if (ref.endsWith(".json") || ref === "package.json") return "{}\n"
  return `${ref}\n`
}

function adopt(fixture: {
  root: string
  db: Database
  runId: string
  adoptionId: string
}) {
  const times = [
    "2026-07-23T01:23:00.000Z",
    "2026-07-23T01:23:01.000Z",
    "2026-07-23T01:23:02.000Z",
    "2026-07-23T01:23:03.000Z",
  ]
  return runDeveloperPatchAdoption({
    db: fixture.db,
    repository_root: fixture.root,
    adoption_id: fixture.adoptionId,
    run_id: fixture.runId,
    now: () => new Date(times.shift() ?? "2026-07-23T01:23:04.000Z"),
    run_package_check: async ({ package_path }) => passedPackageCheck(package_path),
    run_suite_check: async ({ suite }) => ({
      schema_version: "trade.agent-workspace-suite-check.v1",
      suite,
      exit_code: 0,
      timed_out: false,
      output_sha256: createHash("sha256").update(suite).digest("hex"),
      output_bytes: suite.length,
    }),
  })
}

function passedPackageCheck(packagePath: string): AgentWorkspacePackageCheck {
  return {
    schema_version: "trade.agent-workspace-check.v1",
    package_path: packagePath,
    exit_code: 0,
    timed_out: false,
    output_sha256: createHash("sha256").update(packagePath).digest("hex"),
    output_bytes: packagePath.length,
  }
}

function git(cwd: string, args: string[]): void {
  const result = Bun.spawnSync({
    cmd: ["git", ...args],
    cwd,
    stdin: "ignore",
    stdout: "pipe",
    stderr: "pipe",
  })
  if (result.exitCode !== 0) {
    throw new Error(result.stderr.toString() || `git ${args[0]} failed`)
  }
}

function gitText(cwd: string, args: string[]): string {
  const result = Bun.spawnSync({
    cmd: ["git", ...args],
    cwd,
    stdin: "ignore",
    stdout: "pipe",
    stderr: "pipe",
  })
  if (result.exitCode !== 0) {
    throw new Error(result.stderr.toString() || `git ${args[0]} failed`)
  }
  return result.stdout.toString()
}
