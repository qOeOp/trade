import { randomUUID } from "node:crypto"
import { join } from "node:path"
import { defaultCatalogDbPathForGeneratedPath, registerCatalogArtifact } from "../../../../contracts/catalog-contract/src/catalog-client"
import { displayPath, resolveRepoPath } from "../../../../contracts/runtime-core/src/paths"
import {
  readRdProgramState,
  updateRdProgramStateFromResearchResult,
  writeRdProgramState,
  type RdProgramStateCommandResult,
} from "../../../rd-program-state/src/lib/rd-program-state"
import {
  runStrategyRndBatch,
  type StrategyRndBatchReport,
} from "../../../candidate-batch-engine/src/lib/strategy-rnd-batch"
import type { StrategyRndLoopInput } from "../../../candidate-batch-engine/src/lib/strategy-rnd-inputs"
import {
  appendRndLedgerRecord,
  assertHoldoutUnused,
  assertRunIdUnused,
  buildRndLedgerRecord,
  holdoutKeyForInput,
  redactLoopInputForArtifact,
  safeFileName,
  writeJsonFile,
  type StrategyRndLedgerRecord,
} from "../../../strategy-rd/src/lib/strategy-rnd-ledger"

type JSONRecord = Record<string, unknown>

interface StrategyRndLoopReport {
  run_id: string
  created_at: string
  artifact_ref: string
  ledger_ref: string
  batch: StrategyRndBatchReport
  ledger_record: StrategyRndLedgerRecord
  stop_reason: "candidate_found" | "no_promote"
  rd_program_state?: RdProgramStateCommandResult
}

function runStrategyRndLoop(input: StrategyRndLoopInput): StrategyRndLoopReport {
  const created_at = input.now || new Date().toISOString()
  const runId = input.runId || `rnd-${created_at.replace(/[^0-9]/g, "").slice(0, 14)}-${randomUUID().slice(0, 8)}`
  const artifactRoot = resolveRepoPath(input.artifactRoot || "./tmp/artifacts/strategy-rnd")
  const artifactPath = join(artifactRoot, `${safeFileName(runId)}.json`)
  const artifactRef = displayPath(artifactPath)
  const catalogDbPath = input.catalogDbPath || defaultCatalogDbPathForGeneratedPath(artifactRef)
  const ledgerRef = catalogDbPath
  if (input.antiOverfitStage === "locked_holdout") {
    assertHoldoutUnused({ catalogDbPath, ledgerPath: input.ledgerPath }, holdoutKeyForInput(input))
  }
  assertRunIdUnused({ catalogDbPath, ledgerPath: input.ledgerPath }, runId)
  const batch = runStrategyRndBatch(input)
  const ledgerRecord = buildRndLedgerRecord({
    input,
    runId,
    created_at,
    artifactRef,
    batch,
  })

  writeJsonFile(artifactPath, {
    run_id: runId,
    created_at,
    artifact_ref: artifactRef,
    ledger_ref: ledgerRef,
    input: redactLoopInputForArtifact(input),
    batch,
    ledger_record: ledgerRecord,
    stop_reason: batch.outcome,
  })
  registerCatalogArtifact({
    catalogDbPath,
    path: artifactRef,
    now: created_at,
    referrerType: "run",
    referrerID: runId,
    role: "output",
  })
  appendRndLedgerRecord({ catalogDbPath, ledgerPath: input.ledgerPath }, ledgerRecord)

  const report: StrategyRndLoopReport = {
    run_id: runId,
    created_at,
    artifact_ref: artifactRef,
    ledger_ref: ledgerRef,
    batch,
    ledger_record: ledgerRecord,
    stop_reason: batch.outcome,
  }
  const rdProgramState = maybeUpdateRdProgramState(input.rdProgramStatePath, catalogDbPath, report as unknown as JSONRecord, created_at)
  return rdProgramState ? { ...report, rd_program_state: rdProgramState } : report
}

function maybeUpdateRdProgramState(path: string | undefined, catalogDbPath: string, result: JSONRecord, now: string): RdProgramStateCommandResult | undefined {
  if (!path) {
    return undefined
  }
  const state = readRdProgramState(path)
  const updated = updateRdProgramStateFromResearchResult(state, result, now)
  const written = writeRdProgramState(path, updated, catalogDbPath)
  return {
    schema_version: "trade-flow.rd-program-state-result.v1",
    action: "update",
    state_ref: written.path,
    catalog_db_path: written.catalog_db_path,
    artifact_id: written.artifact_id,
    state: updated,
    goal: {
      objective: updated.objective,
      status: updated.status,
      budget: updated.budget,
      usage: updated.usage,
      stop_conditions: updated.stop_conditions,
      latest_failure_summary: updated.latest_failure_summary,
      latest_reliability_gate: updated.latest_reliability_gate,
      rejected_mechanisms: updated.rejected_mechanisms,
      universe_lessons: updated.universe_lessons,
      next_hypothesis_queue: updated.next_hypothesis_queue,
      artifact_refs: updated.artifact_refs,
    },
  }
}

export {
  maybeUpdateRdProgramState,
  runStrategyRndLoop,
  type StrategyRndLoopReport,
}
