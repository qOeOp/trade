#!/usr/bin/env bun

import { Database } from "bun:sqlite"
import { readFileSync } from "node:fs"
import {
  buildRdHoldoutUse,
  buildRdHypothesis,
  buildRdLesson,
  buildRdProgram,
  buildRdTrial,
  ensureResearchStateSchema,
  readRdProgram,
  recordRdHoldoutUse,
  recordRdLesson,
  recordRdTrial,
  upsertRdHypothesis,
  upsertRdProgram,
} from "../lib/research-state-store"
import { stringField, type JSONRecord } from "../../../../../contracts/runtime-core/src/json"
import {
  applyReviewerDecision,
  appendProposalRevision,
  materializeProposal,
  materializeGeneratedCandidate,
  registerExperiment,
  registerTrialGroup,
  transitionTrialGroup,
  type ExperimentRegistrationWrite,
  type ProposalRevisionWrite,
  type ReviewerDecisionWrite,
  type TrialGroupWrite,
} from "../lib/research-control-plane"
import {
  appendExperimentResult,
  appendResearchLesson,
  applySystemTransition,
  assertLifecycleProjection,
  linkUniverseDataSurface,
  openBlockerAndTransition,
  readPlannerControlPlaneContext,
  rebuildLifecycleProjection,
  resolveBlockerAndTransition,
  finishTrial,
  reserveTrial,
  seedUniverse,
  upsertDataSurface,
  upsertPipelineRegistryItem,
  upsertUniverseCoverage,
  type ExperimentResultWrite,
  type TrialReservation,
  type UniverseSeed,
} from "../lib/research-control-plane-operations"
import { seedDefaultResearchControlPlane } from "../lib/research-universe-default-seed"

interface Args {
  dbPath: string
  action: string
  json: JSONRecord
}

export function parseArgs(argv: string[]): Args {
  let dbPath = "data/rd_state.db"
  let action = "init"
  let json: JSONRecord = {}
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]
    if (arg === "--db") {
      dbPath = argv[++index] ?? dbPath
    } else if (arg === "--action") {
      action = argv[++index] ?? action
    } else if (arg === "--json") {
      json = JSON.parse(argv[++index] ?? "{}") as JSONRecord
    } else if (arg === "--json-file") {
      json = JSON.parse(readFileSync(argv[++index] ?? "", "utf8")) as JSONRecord
    } else if (arg === "--help") {
      printHelp()
      process.exit(0)
    } else {
      throw new Error(`unknown argument: ${arg}`)
    }
  }
  return { dbPath, action, json }
}

export function run(args: Args): JSONRecord {
  const db = new Database(args.dbPath)
  try {
    ensureResearchStateSchema(db)
    if (args.action === "init") {
      return { ok: true, action: "init", db: args.dbPath }
    }
    if (args.action === "upsert_program") {
      const program = buildRdProgram(args.json)
      upsertRdProgram(db, program)
      return { ok: true, action: args.action, program }
    }
    if (args.action === "upsert_hypothesis") {
      const hypothesis = buildRdHypothesis(args.json)
      upsertRdHypothesis(db, hypothesis)
      return { ok: true, action: args.action, hypothesis }
    }
    if (args.action === "record_trial") {
      const trial = buildRdTrial(args.json)
      recordRdTrial(db, trial)
      return { ok: true, action: args.action, trial }
    }
    if (args.action === "record_holdout_use") {
      const holdout_use = buildRdHoldoutUse(args.json)
      recordRdHoldoutUse(db, holdout_use)
      return { ok: true, action: args.action, holdout_use }
    }
    if (args.action === "record_lesson") {
      const lesson = buildRdLesson(args.json)
      recordRdLesson(db, lesson)
      return { ok: true, action: args.action, lesson }
    }
    if (args.action === "read_program") {
      return { ok: true, action: args.action, program: readRdProgram(db, stringField(args.json.program_id)) }
    }
    if (args.action === "append_proposal_revision") {
      appendProposalRevision(db, args.json as unknown as ProposalRevisionWrite)
      return { ok: true, action: args.action, proposal_id: args.json.proposal_id, revision: args.json.revision }
    }
    if (args.action === "seed_universe") {
      seedUniverse(db, args.json as unknown as UniverseSeed)
      return { ok: true, action: args.action, node_count: Array.isArray(args.json.nodes) ? args.json.nodes.length : 0 }
    }
    if (args.action === "seed_default_control_plane") {
      const now = stringField(args.json.now)
      const counts = seedDefaultResearchControlPlane(db, now)
      return { ok: true, action: args.action, ...counts }
    }
    if (args.action === "upsert_data_surface") {
      upsertDataSurface(db, args.json as unknown as Parameters<typeof upsertDataSurface>[1])
      return { ok: true, action: args.action, surface_id: args.json.surface_id }
    }
    if (args.action === "link_universe_data_surface") {
      linkUniverseDataSurface(db, args.json as unknown as Parameters<typeof linkUniverseDataSurface>[1])
      return { ok: true, action: args.action, node_id: args.json.node_id, surface_id: args.json.surface_id }
    }
    if (args.action === "upsert_pipeline_registry_item") {
      upsertPipelineRegistryItem(db, args.json as unknown as Parameters<typeof upsertPipelineRegistryItem>[1])
      return { ok: true, action: args.action, item_id: args.json.item_id }
    }
    if (args.action === "upsert_universe_coverage") {
      upsertUniverseCoverage(db, args.json as unknown as Parameters<typeof upsertUniverseCoverage>[1])
      return { ok: true, action: args.action, coverage_id: args.json.coverage_id }
    }
    if (args.action === "read_planning_context") {
      return { ok: true, action: args.action, context: readPlannerControlPlaneContext(db) }
    }
    if (args.action === "materialize_proposal") {
      materializeProposal(db, args.json as unknown as Parameters<typeof materializeProposal>[1])
      return { ok: true, action: args.action, proposal_id: args.json.proposal_id }
    }
    if (args.action === "register_trial_group") {
      registerTrialGroup(db, args.json as unknown as TrialGroupWrite)
      return { ok: true, action: args.action, trial_group_id: args.json.trial_group_id }
    }
    if (args.action === "materialize_generated_candidate") {
      materializeGeneratedCandidate(db, args.json as unknown as Parameters<typeof materializeGeneratedCandidate>[1])
      return { ok: true, action: args.action, candidate_id: (args.json.candidate as JSONRecord)?.candidate_id }
    }
    if (args.action === "transition_trial_group") {
      transitionTrialGroup(db, args.json as unknown as Parameters<typeof transitionTrialGroup>[1])
      return { ok: true, action: args.action, trial_group_id: args.json.trial_group_id }
    }
    if (args.action === "register_experiment") {
      registerExperiment(db, args.json as unknown as ExperimentRegistrationWrite)
      return { ok: true, action: args.action, experiment_id: args.json.experiment_id }
    }
    if (args.action === "reserve_trial") {
      reserveTrial(db, args.json as unknown as TrialReservation)
      return { ok: true, action: args.action, trial_id: args.json.trial_id }
    }
    if (args.action === "finish_trial") {
      finishTrial(db, args.json as unknown as Parameters<typeof finishTrial>[1])
      return { ok: true, action: args.action, trial_id: args.json.trial_id }
    }
    if (args.action === "append_result") {
      appendExperimentResult(db, args.json as unknown as ExperimentResultWrite)
      return { ok: true, action: args.action, result_id: args.json.result_id }
    }
    if (args.action === "append_lesson") {
      appendResearchLesson(db, args.json as unknown as Parameters<typeof appendResearchLesson>[1])
      return { ok: true, action: args.action, lesson_id: args.json.lesson_id }
    }
    if (args.action === "apply_reviewer_decision") {
      applyReviewerDecision(db, args.json as unknown as ReviewerDecisionWrite)
      return { ok: true, action: args.action, decision_id: args.json.decision_id }
    }
    if (args.action === "apply_system_transition") {
      applySystemTransition(db, args.json as unknown as Parameters<typeof applySystemTransition>[1])
      return { ok: true, action: args.action, event_id: args.json.event_id }
    }
    if (args.action === "open_blocker") {
      openBlockerAndTransition(db, args.json as unknown as Parameters<typeof openBlockerAndTransition>[1])
      return { ok: true, action: args.action, blocker_id: args.json.blocker_id }
    }
    if (args.action === "close_blocker") {
      resolveBlockerAndTransition(db, args.json as unknown as Parameters<typeof resolveBlockerAndTransition>[1])
      return { ok: true, action: args.action, blocker_id: args.json.blocker_id }
    }
    if (args.action === "check_lifecycle_projection") {
      const experimentId = stringField(args.json.experiment_id)
      assertLifecycleProjection(db, experimentId)
      return { ok: true, action: args.action, experiment_id: experimentId }
    }
    if (args.action === "rebuild_lifecycle_projection") {
      const experimentId = stringField(args.json.experiment_id)
      rebuildLifecycleProjection(db, experimentId, stringField(args.json.rebuilt_at))
      return { ok: true, action: args.action, experiment_id: experimentId }
    }
    throw new Error(`unsupported action: ${args.action}`)
  } finally {
    db.close()
  }
}

function printHelp(): void {
  console.log([
    "usage: bun src/scripts/main.ts --db data/rd_state.db --action init",
    "actions: init | upsert_program | upsert_hypothesis | record_trial | record_holdout_use | record_lesson | read_program",
    "control-plane: seed_default_control_plane | seed_universe | upsert_data_surface | link_universe_data_surface | upsert_pipeline_registry_item | upsert_universe_coverage | read_planning_context | append_proposal_revision | materialize_proposal | register_trial_group | materialize_generated_candidate | transition_trial_group | register_experiment | reserve_trial | finish_trial | append_result | append_lesson | apply_reviewer_decision | apply_system_transition | open_blocker | close_blocker | check_lifecycle_projection | rebuild_lifecycle_projection",
  ].join("\n"))
}

if (import.meta.main) {
  try {
    console.log(JSON.stringify(run(parseArgs(Bun.argv.slice(2))), null, 2))
  } catch (error) {
    console.error(JSON.stringify({ ok: false, error: error instanceof Error ? error.message : String(error) }))
    process.exit(1)
  }
}
