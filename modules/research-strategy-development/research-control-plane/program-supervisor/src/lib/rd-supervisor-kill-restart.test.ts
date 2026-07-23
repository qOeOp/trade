import { Database } from "bun:sqlite"
import assert from "node:assert/strict"
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"
import test from "node:test"
import { repoRoot } from "../../../../../contracts/runtime-core/src/paths"
import { candidateIdentityHash } from "../../../state-store/src/lib/research-control-plane"
import {
  IDENTITY_HASH_POLICY_VERSION,
} from "../../../state-store/src/lib/research-identity-hash"
import {
  seedControlPlaneExperiment,
  writeReplayManifest,
} from "../test-support/rd-supervisor-control-plane-fixture"

const NOW = "2026-07-23T08:00:00Z"
const MEMBER = resolve(
  repoRoot(),
  "modules/research-strategy-development/research-control-plane/program-supervisor/src/test-support/rd-supervisor-kill-restart-member.ts",
)

test("real R&D owner survives post-commit caller loss with one Trial and one Result", async () => {
  const directory = mkdtempSync(join(tmpdir(), "rd-supervisor-kill-restart-"))
  const dbPath = join(directory, "rd.db")
  const catalogDbPath = join(directory, "catalog.db")
  const artifactRoot = join(directory, "artifacts")
  const manifestPath = writeReplayManifest(directory)
  const firstMarker = join(directory, "first-result.json")
  const secondMarker = join(directory, "second-result.json")
  const firstInput = join(directory, "first-input.json")
  const secondInput = join(directory, "second-input.json")
  const db = new Database(dbPath)
  try {
    seedControlPlaneExperiment(db, NOW)
  } finally {
    db.close()
  }

  try {
    writeMemberInput(firstInput, {
      db_path: dbPath,
      manifest_path: manifestPath,
      artifact_root: artifactRoot,
      catalog_db_path: catalogDbPath,
      marker_path: firstMarker,
      hold_after_commit: true,
      payload: executionPayload(),
    })
    const first = Bun.spawn({
      cmd: [process.execPath, MEMBER, firstInput],
      cwd: repoRoot(),
      stdin: "ignore",
      stdout: "ignore",
      stderr: "pipe",
    })
    await waitForFile(firstMarker, first, 15_000)
    const committed = JSON.parse(readFileSync(firstMarker, "utf8")) as Record<string, unknown>
    assertCommittedExactlyOnce(dbPath)

    first.kill("SIGKILL")
    const firstExit = await first.exited
    assert.notEqual(firstExit, 0)

    rmSync(manifestPath)
    writeMemberInput(secondInput, {
      db_path: dbPath,
      manifest_path: manifestPath,
      artifact_root: artifactRoot,
      catalog_db_path: catalogDbPath,
      marker_path: secondMarker,
      hold_after_commit: false,
      payload: executionPayload(),
    })
    const second = Bun.spawn({
      cmd: [process.execPath, MEMBER, secondInput],
      cwd: repoRoot(),
      stdin: "ignore",
      stdout: "ignore",
      stderr: "pipe",
    })
    const secondExit = await second.exited
    const secondError = await new Response(second.stderr).text()
    assert.equal(secondExit, 0, secondError)
    const recovered = JSON.parse(readFileSync(secondMarker, "utf8"))
    assert.deepEqual(recovered, committed)
    assertCommittedExactlyOnce(dbPath)
  } finally {
    rmSync(directory, { recursive: true, force: true })
  }
})

function executionPayload(): Record<string, unknown> {
  return {
    now: NOW,
    run_id: "kill-restart-run-1",
    batch_id: "kill-restart-batch-1",
    candidates: [{
      candidate_id: "candidate-1",
      family: "trend_pullback_v1",
      params: { side: "long" },
    }],
    control_plane: {
      experiment_id: "experiment-1",
      trial_group_id: "group-1",
      run_id: "kill-restart-run-1",
      result_id: "kill-restart-result-1",
      result_idempotency_key: "kill-restart-result-key-1",
      stage_id: "historical_validation",
      result_type_id: "replay",
      completed_at: NOW,
      trials: [{
        trial_id: "kill-restart-trial-1",
        trial_group_id: "group-1",
        experiment_id: "experiment-1",
        trial_ordinal: 1,
        candidate_id: "candidate-1",
        candidate_identity_hash: candidateIdentityHash({ lookback: 20 }),
        identity_hash_policy_version: IDENTITY_HASH_POLICY_VERSION,
        run_id: "kill-restart-run-1",
        idempotency_key: "kill-restart-trial-key-1",
        created_at: NOW,
      }],
    },
  }
}

function writeMemberInput(path: string, value: Record<string, unknown>): void {
  writeFileSync(path, JSON.stringify(value))
}

async function waitForFile(
  path: string,
  child: {
    readonly exitCode: number | null
    kill(signal?: number | NodeJS.Signals): void
  },
  timeoutMs: number,
): Promise<void> {
  const deadline = Date.now() + timeoutMs
  while (!existsSync(path)) {
    if (child.exitCode != null) {
      throw new Error("kill/restart member exited before commit marker")
    }
    if (Date.now() >= deadline) {
      child.kill("SIGKILL")
      throw new Error("kill/restart member did not commit before deadline")
    }
    await Bun.sleep(10)
  }
}

function assertCommittedExactlyOnce(dbPath: string): void {
  const db = new Database(dbPath, { readonly: true })
  try {
    assert.deepEqual(db.query(`
      SELECT trial_id, status FROM rd_trial ORDER BY trial_id
    `).all(), [{ trial_id: "kill-restart-trial-1", status: "completed" }])
    assert.deepEqual(db.query(`
      SELECT result_id, run_id FROM rd_experiment_result ORDER BY result_id
    `).all(), [{
      result_id: "kill-restart-result-1",
      run_id: "kill-restart-run-1",
    }])
  } finally {
    db.close()
  }
}
