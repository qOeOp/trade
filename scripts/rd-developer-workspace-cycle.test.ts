import assert from "node:assert/strict"
import { existsSync, mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import test from "node:test"
import { Database } from "bun:sqlite"
import { readFamilyEvaluationProtocol } from "../modules/contracts/rd-agent-capability-contract/src/rd-agent-capability-contract"
import { ensureAgentRunStoreSchema } from "../modules/orchestration-ops/ops-runtime-store/src/lib/agent-run-store"
import type { CodexAppServerClientPort } from "../modules/orchestration-ops/agent-host-codex/src/lib/codex-app-server-client"
import { buildPlannerProposal } from "../modules/research-strategy-development/agent-roles/planner/src/lib/planner-role"
import { PLANNER_PROPOSAL_INTAKE_REQUEST_SCHEMA_VERSION } from "../modules/research-strategy-development/research-control-plane/contracts/src/lib/planner-proposal-submission"
import { admitPlannerProposal } from "../modules/research-strategy-development/research-control-plane/state-store/src/lib/planner-proposal-intake"
import { readPlannerControlPlaneContext } from "../modules/research-strategy-development/research-control-plane/state-store/src/lib/research-control-plane-operations"
import { ensureResearchStateSchema } from "../modules/research-strategy-development/research-control-plane/state-store/src/lib/research-state-store"
import { seedDefaultResearchControlPlane } from "../modules/research-strategy-development/research-control-plane/state-store/src/lib/research-universe-default-seed"
import { runDeveloperWorkspaceCycle } from "./lib/rd-developer-workspace-cycle"

const PACKAGE_PATH =
  "modules/research-strategy-development/agent-roles/developer/strategy-family-engine"

test("R&D workspace composition returns patch_ready without creating a Contract Draft", async () => {
  const root = fixtureRepository()
  const researchDb = new Database(":memory:")
  const opsDb = new Database(":memory:")
  ensureAgentRunStoreSchema(opsDb)
  const proposal = seedProposal(researchDb)
  const workspaceRoot = join(
    root,
    "tmp",
    "agent-workspaces",
    "developer-workspace-rd",
  )
  const client = new EditingClient(workspaceRoot)
  try {
    const result = await runDeveloperWorkspaceCycle({
      research_db: researchDb,
      ops_db: opsDb,
      repository_root: root,
      codex_path: "/unused/codex",
      allowed_write_prefixes: [PACKAGE_PATH],
      package_path: PACKAGE_PATH,
      developer_run_id: "developer-workspace-rd",
      trace_id: "trace-developer-workspace-rd",
      idempotency_key: "developer-workspace-rd-key",
      source_revision: "HEAD",
      requested_at: "2026-07-23T10:04:00.000Z",
      deadline_at: "2026-07-24T10:34:00.000Z",
      proposal_id: proposal.proposal_id,
      proposal_revision: 1,
      brief_id: "brief-developer-workspace-rd",
      poll_interval_ms: 10,
      create_client: (onNotification) => client.connect(onNotification),
      now: () => new Date("2026-07-23T10:05:00.000Z"),
    })
    assert.equal(result.admission.status, "patch_ready")
    assert.equal(result.admission.receipt, null)
    assert.equal(result.output_refs.length, 3)
    assert.equal(existsSync(workspaceRoot), false)
    const row = researchDb.query(
      "SELECT COUNT(*) AS count FROM rd_developer_contract_draft",
    ).get() as { count: number }
    assert.equal(row.count, 0)
  } finally {
    researchDb.close()
    opsDb.close()
    rmSync(root, { recursive: true, force: true })
  }
})

class EditingClient implements CodexAppServerClientPort {
  private onNotification: (method: string, params: unknown) => void =
    () => undefined

  constructor(private readonly workspaceRoot: string) {}

  connect(onNotification: (method: string, params: unknown) => void): this {
    this.onNotification = onNotification
    return this
  }

  async initialize(): Promise<void> {}
  async startThread(): Promise<string> {
    return "thread-rd-workspace"
  }
  async startTurn(): Promise<string> {
    writeFileSync(
      join(this.workspaceRoot, PACKAGE_PATH, "src/index.ts"),
      "export const replayCoverage = \"ready\"\n",
    )
    queueMicrotask(() => {
      this.onNotification("item/completed", {
        item: {
          id: "message-rd-workspace",
          type: "agentMessage",
          text: "Completed the bounded family implementation change.",
        },
      })
      this.onNotification("turn/completed", {
        turn: { id: "turn-rd-workspace", status: "completed" },
      })
    })
    return "turn-rd-workspace"
  }
  async steer(): Promise<void> {}
  async interrupt(): Promise<void> {}
  async close(): Promise<void> {}
}

function seedProposal(db: Database) {
  ensureResearchStateSchema(db)
  seedDefaultResearchControlPlane(db, "2026-07-23T10:00:00.000Z")
  const universeNodeId =
    "canonical:trend/cross-sectional-momentum/relative-weakness-momentum"
  const protocol = readFamilyEvaluationProtocol(universeNodeId)
  if (!protocol) throw new Error("workspace composition protocol is missing")
  const proposal = buildPlannerProposal({
    proposal_id: "proposal-developer-workspace",
    hypothesis_id: "hypothesis-developer-workspace",
    universe_node_id: universeNodeId,
    objective: "Complete one bounded relative weakness Replay implementation",
    dataset_requirements: ["ohlcv"],
    candidate_space: {
      side: ["long"],
      signal_mode: ["momentum"],
      confirmation_mode: ["none"],
      lookback_bars: [20],
    },
    trial_budget: 2,
    evaluation_protocol_ref: protocol.protocol_ref,
    control_plane_context: readPlannerControlPlaneContext(db),
    created_at: "2026-07-23T10:01:00.000Z",
  })
  admitPlannerProposal(db, {
    schema_version: PLANNER_PROPOSAL_INTAKE_REQUEST_SCHEMA_VERSION,
    planner_run_id: "planner-before-workspace",
    proposal_revision: 1,
    idempotency_key: "planner-before-workspace-key",
    submitted_at: "2026-07-23T10:02:00.000Z",
    recorded_at: "2026-07-23T10:03:00.000Z",
    proposal,
  })
  return proposal
}

function fixtureRepository(): string {
  const root = mkdtempSync(join(tmpdir(), "rd-workspace-composition-"))
  const packageRoot = join(root, PACKAGE_PATH)
  mkdirSync(join(packageRoot, "src"), { recursive: true })
  writeFileSync(join(root, ".gitignore"), "data/\ntmp/\n")
  writeFileSync(
    join(packageRoot, "src/index.ts"),
    "export const replayCoverage = \"partial\"\n",
  )
  writeFileSync(join(packageRoot, "package.json"), JSON.stringify({
    name: "fixture-strategy-family-engine",
    private: true,
    scripts: { check: "bun -e \"process.exit(0)\"" },
  }))
  git(root, ["init"])
  git(root, ["config", "user.email", "rd-workspace@example.invalid"])
  git(root, ["config", "user.name", "R&D Workspace Test"])
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
