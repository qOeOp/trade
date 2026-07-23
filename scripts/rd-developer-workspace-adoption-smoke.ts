#!/usr/bin/env bun

import { Database } from "bun:sqlite"
import {
  mkdtempSync,
  mkdirSync,
  rmSync,
  writeFileSync,
} from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { readFamilyEvaluationProtocol } from "../modules/contracts/rd-agent-capability-contract/src/rd-agent-capability-contract"
import { readAgentArtifact } from "../modules/orchestration-ops/agent-artifact-store/src/lib/agent-artifact-store"
import { ensureAgentRunStoreSchema } from "../modules/orchestration-ops/ops-runtime-store/src/lib/agent-run-store"
import { buildPlannerProposal } from "../modules/research-strategy-development/agent-roles/planner/src/lib/planner-role"
import { PLANNER_PROPOSAL_INTAKE_REQUEST_SCHEMA_VERSION } from "../modules/research-strategy-development/research-control-plane/contracts/src/lib/planner-proposal-submission"
import { admitPlannerProposal } from "../modules/research-strategy-development/research-control-plane/state-store/src/lib/planner-proposal-intake"
import { readPlannerControlPlaneContext } from "../modules/research-strategy-development/research-control-plane/state-store/src/lib/research-control-plane-operations"
import { ensureResearchStateSchema } from "../modules/research-strategy-development/research-control-plane/state-store/src/lib/research-state-store"
import { seedDefaultResearchControlPlane } from "../modules/research-strategy-development/research-control-plane/state-store/src/lib/research-universe-default-seed"
import { runDeveloperWorkspaceCycle } from "./lib/rd-developer-workspace-cycle"

const PACKAGE_PATH =
  "modules/research-strategy-development/agent-roles/developer/strategy-family-engine"

async function main(): Promise<void> {
  const codexPath = process.env.TRADE_CODEX_PATH || Bun.which("codex")
  if (!codexPath?.startsWith("/")) {
    throw new Error("Codex executable is unavailable")
  }
  const root = fixtureRepository()
  const researchDb = new Database(":memory:")
  const opsDb = new Database(":memory:")
  try {
    ensureAgentRunStoreSchema(opsDb)
    const now = Date.now()
    const requestedAt = new Date(now - 2_000).toISOString()
    const proposal = seedProposal(researchDb, now)
    const result = await runDeveloperWorkspaceCycle({
      research_db: researchDb,
      ops_db: opsDb,
      repository_root: root,
      codex_path: codexPath,
      allowed_write_prefixes: [PACKAGE_PATH],
      package_path: PACKAGE_PATH,
      developer_run_id: `developer-adoption-${now}`,
      trace_id: `trace-developer-adoption-${now}`,
      idempotency_key: `developer-adoption-${now}`,
      source_revision: "HEAD",
      requested_at: requestedAt,
      deadline_at: new Date(now + 10 * 60_000).toISOString(),
      proposal_id: proposal.proposal_id,
      proposal_revision: 1,
      brief_id: `brief-developer-adoption-${now}`,
      poll_interval_ms: 100,
    })
    const patch = readAgentArtifact(root, result.output_refs[1]!)
    console.log(JSON.stringify({
      schema_version: "trade.rd-developer-workspace-adoption-smoke.v1",
      status: result.admission.status,
      result_hash: result.result_hash,
      scope_hash: result.scope_hash,
      output_media_types: result.output_refs.map((ref) => ref.media_type),
      patch_sha256: patch.artifact.sha256,
      patch_bytes: patch.artifact.bytes,
      expected_file_changed: patch.text.includes(
        `${PACKAGE_PATH}/src/replay-coverage.ts`,
      ),
      production_repository_changed: false,
      domain_authority: "none",
    }))
  } finally {
    researchDb.close()
    opsDb.close()
    rmSync(root, { recursive: true, force: true })
  }
}

function seedProposal(db: Database, now: number) {
  ensureResearchStateSchema(db)
  seedDefaultResearchControlPlane(db, new Date(now - 6_000).toISOString())
  const universeNodeId =
    "canonical:trend/cross-sectional-momentum/relative-weakness-momentum"
  const protocol = readFamilyEvaluationProtocol(universeNodeId)
  if (!protocol) throw new Error("adoption smoke protocol is missing")
  const proposal = buildPlannerProposal({
    proposal_id: `proposal-developer-adoption-${now}`,
    hypothesis_id: `hypothesis-developer-adoption-${now}`,
    universe_node_id: universeNodeId,
    objective: "Make the bounded family Replay coverage check pass",
    dataset_requirements: ["ohlcv"],
    candidate_space: {
      side: ["long"],
      signal_mode: ["momentum"],
      confirmation_mode: ["none"],
      lookback_bars: [20],
    },
    trial_budget: 1,
    evaluation_protocol_ref: protocol.protocol_ref,
    control_plane_context: readPlannerControlPlaneContext(db),
    created_at: new Date(now - 5_000).toISOString(),
  })
  admitPlannerProposal(db, {
    schema_version: PLANNER_PROPOSAL_INTAKE_REQUEST_SCHEMA_VERSION,
    planner_run_id: `planner-developer-adoption-${now}`,
    proposal_revision: 1,
    idempotency_key: `planner-developer-adoption-${now}`,
    submitted_at: new Date(now - 4_000).toISOString(),
    recorded_at: new Date(now - 3_000).toISOString(),
    proposal,
  })
  return proposal
}

function fixtureRepository(): string {
  const root = mkdtempSync(join(tmpdir(), "rd-developer-adoption-"))
  const packageRoot = join(root, PACKAGE_PATH)
  mkdirSync(join(packageRoot, "src"), { recursive: true })
  writeFileSync(join(root, ".gitignore"), "data/\ntmp/\n")
  writeFileSync(
    join(packageRoot, "src/replay-coverage.ts"),
    [
      "export const replayCoverage = \"partial\" as const",
      "",
    ].join("\n"),
  )
  writeFileSync(
    join(packageRoot, "src/replay-coverage.test.ts"),
    [
      "import { expect, test } from \"bun:test\"",
      "import { replayCoverage } from \"./replay-coverage\"",
      "",
      "test(\"family Replay coverage is ready\", () => {",
      "  expect(replayCoverage).toBe(\"ready\")",
      "})",
      "",
    ].join("\n"),
  )
  writeFileSync(join(packageRoot, "package.json"), JSON.stringify({
    name: "developer-adoption-fixture",
    private: true,
    type: "module",
    scripts: { check: "bun test ./src/*.test.ts" },
  }))
  git(root, ["init"])
  git(root, ["config", "user.email", "rd-adoption@example.invalid"])
  git(root, ["config", "user.name", "R&D Adoption Smoke"])
  git(root, ["add", "."])
  git(root, ["commit", "-m", "fixture"])
  return root
}

function git(cwd: string, args: string[]): void {
  const result = Bun.spawnSync({
    cmd: ["git", ...args],
    cwd,
    stdout: "pipe",
    stderr: "pipe",
  })
  if (result.exitCode !== 0) {
    throw new Error(result.stderr.toString() || `git ${args[0]} failed`)
  }
}

if (import.meta.main) {
  main().catch((error) => {
    console.error(JSON.stringify({
      schema_version: "trade.rd-developer-workspace-adoption-smoke.v1",
      status: "failed",
      error: error instanceof Error ? error.message : String(error),
    }))
    process.exit(1)
  })
}
