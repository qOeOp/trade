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
import { join } from "node:path"
import test from "node:test"
import { Database } from "bun:sqlite"
import { canonicalJson } from "../apps/contracts/runtime-core/src/canonical-json"
import {
  readStrategySourceAdoption,
} from "../apps/orchestration-ops/ops-runtime-store/src/lib/strategy-source-adoption-store"
import {
  SERVER_CONTAINER_SOURCE_PACKAGE_CRITICAL_REFS,
} from "../apps/orchestration-ops/trade-flow/src/scripts/lib/server-runtime-container-release-package"
import {
  createStrategyCandidateServerPackage,
} from "./lib/rd-strategy-candidate-release-package"
import {
  createStrategySourceCandidate,
} from "../apps/research-strategy-development/research-control-plane/contracts/src/lib/strategy-source-candidate-contract"
import {
  SOURCE_SCHEMA_VERSION,
  renderStrategyPolicyMarkdown,
} from "../apps/research-strategy-development/research-control-plane/strategy-policy-writer/src/lib/strategy-policy-writer"
import {
  discoverAndQueueStrategySourceCandidates,
  queueStrategySourceCandidate,
  runStrategySourceAdoption,
  StrategyAdoptionError,
} from "./lib/rd-strategy-source-adoption"
import {
  admitCertifiedStrategyAdoptionToForward,
} from "./lib/rd-forward-source-admission"

test("Strategy source adoption certifies an isolated source revision without hot loading", async () => {
  const root = mkdtempSync(join(tmpdir(), "rd-strategy-adoption-"))
  const packageRoot = `${root}-strategy-server-package`
  const db = new Database(":memory:")
  try {
    writeFileSync(join(root, "README.md"), "fixture\n")
    for (const ref of SERVER_CONTAINER_SOURCE_PACKAGE_CRITICAL_REFS) {
      const path = join(root, ref)
      mkdirSync(join(path, ".."), { recursive: true })
      writeFileSync(path, criticalFixture(ref))
    }
    git(root, ["init", "-q"])
    git(root, ["config", "user.name", "Fixture"])
    git(root, ["config", "user.email", "fixture@example.invalid"])
    git(root, ["add", "."])
    git(root, ["commit", "-q", "-m", "base"])
    const base = gitText(root, ["rev-parse", "HEAD"]).trim()
    const candidateRoot = join(
      root,
      "data",
      "release-candidates",
      "strategy-drafts",
      "candidate-one",
    )
    const sourceRef = "strategies/s-candidate-one.md"
    const sourcePath = join(candidateRoot, sourceRef)
    mkdirSync(join(candidateRoot, "strategies"), { recursive: true })
    const source = renderStrategyPolicyMarkdown({
      schema_version: SOURCE_SCHEMA_VERSION,
      program_id: "control-plane:experiment-1",
      objective: "Test one bounded momentum mechanism.",
      drafted_at: "2026-07-23T02:00:00.000Z",
      evidence_refs: [
        "agent-artifact://review-1",
        "artifact://formal-result-1",
      ],
      candidate: {
        candidate_id: "candidate-one",
        family: "time_series_momentum_v1",
        timeframe: "4h",
        validation_run_ref: "artifact://formal-result-1",
        params: {
          lookback_bars: 20,
          reward_risk: 2,
          side: "long",
          stop_atr: 1,
        },
      },
    })
    writeFileSync(sourcePath, source)
    const sourceHash = createHash("sha256").update(source).digest("hex")
    const manifest = createStrategySourceCandidate({
      schema_version: "trade.rd-strategy-source-candidate.v1",
      candidate_kind: "draft_strategy_source",
      compiler: {
        version: "trade.rd-draft-strategy-compiler.v1",
        input_hash: "1".repeat(64),
      },
      decision: {
        decision_id: "decision-1",
        draft_id: "draft-1",
        strategy_id: "S-CANDIDATE-ONE",
        strategy_version: "draft-1",
        primary_result_id: "result-1",
        primary_result_hash: "2".repeat(64),
      },
      source_provenance: {
        source_revision: base,
        provenance_hash: "3".repeat(64),
        agent_run_request_hash: "4".repeat(64),
        agent_run_result_hash: "5".repeat(64),
      },
      replay_code_evidence: {
        decision_harness_build_artifact_hash: "6".repeat(64),
        decision_harness_runtime_executable_hash: "7".repeat(64),
      },
      strategy_source: {
        ref: sourceRef,
        sha256: sourceHash,
        bytes: Buffer.byteLength(source),
      },
      authority: {
        release_authority: "candidate_source_only",
        deployment_authority: "none",
        trading_authority: false,
      },
      created_at: "2026-07-23T02:00:00.000Z",
    })
    const manifestRef =
      "data/release-candidates/strategy-drafts/candidate-one/candidate.json"
    writeFileSync(
      join(root, manifestRef),
      `${canonicalJson(manifest)}\n`,
    )
    const poison = join(
      root,
      "data",
      "release-candidates",
      "strategy-drafts",
      "000-poison",
    )
    mkdirSync(poison, { recursive: true })
    writeFileSync(join(poison, "candidate.json"), "{}\n")
    assert.throws(
      () => discoverAndQueueStrategySourceCandidates({
        db,
        repository_root: root,
        observed_at: "2026-07-23T02:01:00.000Z",
      }),
      StrategyAdoptionError,
    )
    const queued = queueStrategySourceCandidate({
      db,
      repository_root: root,
      manifest_ref: manifestRef,
      accepted_at: "2026-07-23T02:01:00.000Z",
    })
    const result = await runStrategySourceAdoption({
      db,
      repository_root: root,
      adoption_id: queued.adoption_id,
      now: clock([
        "2026-07-23T02:02:00.000Z",
        "2026-07-23T02:03:00.000Z",
        "2026-07-23T02:04:00.000Z",
      ]),
      run_suite_check: async ({ suite }) => ({
        schema_version: "trade.agent-workspace-suite-check.v1",
        suite,
        exit_code: 0,
        timed_out: false,
        output_sha256: suite === "repository_quality"
          ? "8".repeat(64)
          : "9".repeat(64),
        output_bytes: 10,
      }),
    })
    assert.equal(result.status, "candidate_certified")
    assert.equal(result.manifest.safety.runtime_hot_load, false)
    assert.equal(result.manifest.safety.deployment_authority, "none")
    assert.equal(gitText(root, ["rev-parse", "HEAD"]).trim(), base)
    assert.equal(existsSync(join(root, sourceRef)), false)
    assert.equal(
      gitText(
        root,
        ["show", `${result.result!.candidate_source_revision}:${sourceRef}`],
      ),
      source,
    )
    assert.equal(
      readStrategySourceAdoption(db, queued.adoption_id)?.status,
      "candidate_certified",
    )
    assert.equal(
      existsSync(join(root, result.result!.source_archive_ref)),
      true,
    )
    const researchDb = forwardResearchFixture({
      candidate_manifest_ref: manifestRef,
      candidate_manifest_hash: manifest.manifest_hash,
      strategy_ref: sourcePath,
      strategy_hash: sourceHash,
    })
    try {
      const binding = admitCertifiedStrategyAdoptionToForward({
        research_db: researchDb,
        ops_db: db,
        repository_root: root,
        adoption_id: queued.adoption_id,
        admitted_at: "2026-07-23T02:05:00.000Z",
      })
      assert.equal(binding.source_adoption_id, queued.adoption_id)
      assert.equal(
        binding.candidate_source_revision,
        result.result!.candidate_source_revision,
      )
      assert.deepEqual(researchDb.query(`
        SELECT lifecycle_state, lifecycle_version
        FROM rd_experiment_contract WHERE experiment_id='experiment-1'
      `).get(), {
        lifecycle_state: "forward_observation",
        lifecycle_version: 5,
      })
      assert.deepEqual(
        admitCertifiedStrategyAdoptionToForward({
          research_db: researchDb,
          ops_db: db,
          repository_root: root,
          adoption_id: queued.adoption_id,
          admitted_at: "2026-07-23T02:06:00.000Z",
        }),
        binding,
      )
    } finally {
      researchDb.close()
    }
    const packaged = createStrategyCandidateServerPackage({
      db,
      repository_root: root,
      adoption_id: queued.adoption_id,
      target_root: packageRoot,
      created_at: "2026-07-23T02:05:00.000Z",
    })
    assert.equal(
      packaged.candidate_source_revision,
      result.result!.candidate_source_revision,
    )
    const releaseManifest = JSON.parse(
      readFileSync(join(packageRoot, "release-manifest.json"), "utf8"),
    )
    assert.equal(
      releaseManifest.source_origin.kind,
      "certified_strategy_source_candidate",
    )
    assert.equal(releaseManifest.safety.live_writes_allowed, false)
    const replayed = await runStrategySourceAdoption({
      db,
      repository_root: root,
      adoption_id: queued.adoption_id,
      run_suite_check: async () => {
        throw new Error("terminal replay must not rerun checks")
      },
    })
    assert.deepEqual(replayed, result)
  } finally {
    db.close()
    rmSync(packageRoot, { recursive: true, force: true })
    rmSync(root, { recursive: true, force: true })
  }
})

test("Strategy source queue rejects byte drift before durable admission", () => {
  const root = mkdtempSync(join(tmpdir(), "rd-strategy-drift-"))
  const db = new Database(":memory:")
  try {
    mkdirSync(join(root, "data", "release-candidates", "one", "strategies"), {
      recursive: true,
    })
    writeFileSync(
      join(root, "data", "release-candidates", "one", "candidate.json"),
      "{}\n",
    )
    assert.throws(
      () => queueStrategySourceCandidate({
        db,
        repository_root: root,
        manifest_ref: "data/release-candidates/one/candidate.json",
      }),
      (error: unknown) => error instanceof StrategyAdoptionError
        && error.failure_class === "validation_failed",
    )
  } finally {
    db.close()
    rmSync(root, { recursive: true, force: true })
  }
})

function clock(values: string[]): () => Date {
  let index = 0
  return () => new Date(values[Math.min(index++, values.length - 1)]!)
}

function forwardResearchFixture(input: {
  candidate_manifest_ref: string
  candidate_manifest_hash: string
  strategy_ref: string
  strategy_hash: string
}): Database {
  const db = new Database(":memory:")
  db.exec(`
    PRAGMA foreign_keys=ON;
    CREATE TABLE rd_experiment_contract(
      experiment_id TEXT PRIMARY KEY,
      lifecycle_state TEXT NOT NULL,
      lifecycle_version INTEGER NOT NULL,
      lifecycle_rule_version TEXT NOT NULL,
      suspended_from_state TEXT,
      last_lifecycle_event_id TEXT,
      updated_at TEXT NOT NULL
    );
    CREATE TABLE rd_review_decision(
      decision_id TEXT PRIMARY KEY,
      experiment_id TEXT NOT NULL,
      decision TEXT NOT NULL
    );
    CREATE TABLE rd_strategy_draft(
      draft_id TEXT PRIMARY KEY,
      strategy_id TEXT NOT NULL,
      strategy_version TEXT NOT NULL,
      strategy_ref TEXT NOT NULL,
      strategy_policy_hash TEXT NOT NULL,
      materialization_status TEXT NOT NULL
    );
    CREATE TABLE rd_strategy_registry_job(
      job_id TEXT PRIMARY KEY,
      decision_id TEXT NOT NULL,
      status TEXT NOT NULL,
      draft_id TEXT,
      strategy_ref TEXT,
      strategy_policy_hash TEXT,
      candidate_manifest_ref TEXT,
      candidate_manifest_hash TEXT
    );
    CREATE TABLE rd_lifecycle_transition_rule(
      rule_id TEXT PRIMARY KEY,
      rule_version TEXT NOT NULL,
      current_state TEXT NOT NULL,
      trigger_type TEXT NOT NULL,
      trigger_value TEXT NOT NULL,
      next_state TEXT NOT NULL,
      requires_result_stage_id TEXT NOT NULL,
      requires_fresh_fingerprint INTEGER NOT NULL
    );
    CREATE TABLE rd_lifecycle_event(
      event_id TEXT PRIMARY KEY,
      experiment_id TEXT NOT NULL,
      sequence_no INTEGER NOT NULL,
      transition_rule_id TEXT NOT NULL,
      trigger_ref TEXT NOT NULL,
      current_state TEXT NOT NULL,
      next_state TEXT NOT NULL,
      idempotency_key TEXT NOT NULL UNIQUE,
      created_at TEXT NOT NULL
    );
  `)
  db.query(`
    INSERT INTO rd_experiment_contract VALUES(
      'experiment-1', 'draft_frozen', 4,
      'trade-flow.rd-lifecycle-rules.v1', NULL, NULL,
      '2026-07-23T02:00:00.000Z'
    )
  `).run()
  db.query(`
    INSERT INTO rd_review_decision VALUES(
      'decision-1', 'experiment-1', 'accept_for_draft'
    )
  `).run()
  db.query(`
    INSERT INTO rd_strategy_draft VALUES(
      'draft-1', 'S-CANDIDATE-ONE', 'draft-1',
      $strategy_ref, $strategy_hash, 'ready'
    )
  `).run({
    $strategy_ref: input.strategy_ref,
    $strategy_hash: input.strategy_hash,
  })
  db.query(`
    INSERT INTO rd_strategy_registry_job VALUES(
      'registry:decision-1', 'decision-1', 'completed', 'draft-1',
      $strategy_ref, $strategy_hash, $candidate_ref, $candidate_hash
    )
  `).run({
    $strategy_ref: input.strategy_ref,
    $strategy_hash: input.strategy_hash,
    $candidate_ref: input.candidate_manifest_ref,
    $candidate_hash: input.candidate_manifest_hash,
  })
  db.query(`
    INSERT INTO rd_lifecycle_transition_rule VALUES(
      'trade-flow.rd-lifecycle-rules.v1:start-forward-certified-source',
      'trade-flow.rd-lifecycle-rules.v1', 'draft_frozen', 'system',
      'certified_source_admitted', 'forward_observation', '__any__', 0
    )
  `).run()
  return db
}

function criticalFixture(
  ref: typeof SERVER_CONTAINER_SOURCE_PACKAGE_CRITICAL_REFS[number],
): string {
  if (ref === "deploy/server/container-acceptance.sh") {
    return "#!/bin/sh\nset -eu\n"
  }
  if (ref.endsWith(".json")) return "{}\n"
  if (ref === ".dockerignore") {
    return ".git\n.secrets\ndata\ntmp\nnode_modules\n"
  }
  return `${ref}\n`
}

function git(cwd: string, args: string[]): void {
  const result = Bun.spawnSync({ cmd: ["git", ...args], cwd })
  if (result.exitCode !== 0) {
    throw new Error(result.stderr.toString())
  }
}

function gitText(cwd: string, args: string[]): string {
  const result = Bun.spawnSync({ cmd: ["git", ...args], cwd })
  if (result.exitCode !== 0) {
    throw new Error(result.stderr.toString())
  }
  return result.stdout.toString()
}
