#!/usr/bin/env bun

import {
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  realpathSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs"
import { createHash } from "node:crypto"
import { dirname, resolve, sep } from "node:path"
import { Database } from "bun:sqlite"
import { asRecord, stringField } from "../../../../../contracts/runtime-core/src/json"
import {
  compileMarketDataDemand,
} from "../../../../../contracts/market-data-demand-contract/src/market-data-demand-contract"
import {
  buildForwardObservationMarketDataDemand,
} from "../../../../research-control-plane/contracts/src/lib/forward-observation-program"
import {
  assertFundingReplaySliceContent,
  compileFundingReplaySliceRef,
} from "../../../../../contracts/market-data-demand-contract/src/funding-replay-slice-contract"
import {
  compileFundingCoverageAudit,
} from "../../../../../contracts/market-data-demand-contract/src/funding-coverage-contract"
import {
  compileMarketDataFactRef,
} from "../../../../../contracts/market-data-demand-contract/src/market-data-fact-contract"
import {
  buildForwardFundingMarketDataDemand,
  createForwardFundingEvidenceBinding,
} from "../../../contracts/src/lib/forward-funding-evidence"
import {
  readLatestForwardDatasetCandidate,
} from "../../../../research-control-plane/state-store/src/lib/forward-dataset-candidate"
import {
  admitForwardFundingEvidenceBinding,
  ensureForwardFundingEvidenceSchema,
  readForwardFundingEvidenceBinding,
  readLatestForwardFundingDemandDelivery,
  recordForwardFundingDemandDelivery,
} from "../../../../research-control-plane/state-store/src/lib/forward-funding-evidence"
import {
  ensureForwardObservationProgramSchema,
  listCollectingForwardObservationPrograms,
  readLatestForwardMarketDataDemandDelivery,
  recordForwardMarketDataDemandDelivery,
} from "../../../../research-control-plane/state-store/src/lib/forward-observation-program"
import {
  ensureResearchControlPlaneSchema,
} from "../../../../research-control-plane/state-store/src/lib/research-control-plane-schema"
import {
  reconcileForwardObservationPrograms,
  shouldRenewForwardMarketDataDemand,
} from "../lib/forward-observation-program"
import {
  resolveWorkerDataPath,
  workerBoundedInteger,
  workerDelay,
  workerFlagValues,
  workerMarketDataOwnerCommand,
  workerResearchMarketDataPaths,
} from "../lib/resident-worker-cli"

async function main(): Promise<void> {
  const input = parseArgs(Bun.argv.slice(2))
  const root = realpathSync(resolve(input.repository_root))
  const researchPath = resolveWorkerDataPath(
    root,
    input.research_db,
    "Forward market-data worker Research DB",
  )
  mkdirSync(dirname(researchPath), { recursive: true, mode: 0o700 })
  const db = new Database(researchPath, { create: true })
  db.exec("PRAGMA journal_mode=WAL")
  db.exec("PRAGMA busy_timeout=5000")
  db.exec("PRAGMA foreign_keys=ON")
  ensureResearchControlPlaneSchema(db)
  ensureForwardObservationProgramSchema(db)
  ensureForwardFundingEvidenceSchema(db)
  let closing = false
  let currentChild: ReturnType<typeof Bun.spawn> | undefined
  const close = () => {
    closing = true
    currentChild?.kill("SIGTERM")
  }
  process.on("SIGINT", close)
  process.on("SIGTERM", close)
  mkdirSync(dirname(input.ready_file), { recursive: true, mode: 0o700 })
  if (existsSync(input.ready_file)) rmSync(input.ready_file)
  writeFileSync(input.ready_file, "ready\n", { flag: "wx", mode: 0o600 })
  let cycle = 0
  writeState(input.state_file, {
    status: "running",
    updated_at: new Date().toISOString(),
    cycle,
    active_program_count: 0,
    program_created_count: 0,
    demand_accepted_count: 0,
    funding_candidate_count: 0,
    funding_demand_accepted_count: 0,
    funding_evidence_created_count: 0,
    funding_pending_count: 0,
    funding_conflict_count: 0,
    funding_failure_count: 0,
    failure_count: 0,
  })
  try {
    while (!closing) {
      cycle += 1
      const observedAt = new Date().toISOString()
      let programCreatedCount = 0
      let demandAcceptedCount = 0
      let activeProgramCount = 0
      let fundingCandidateCount = 0
      let fundingDemandAcceptedCount = 0
      let fundingEvidenceCreatedCount = 0
      let fundingPendingCount = 0
      let fundingConflictCount = 0
      let fundingFailureCount = 0
      let failureCount = 0
      try {
        const programs = reconcileForwardObservationPrograms(db, {
          observed_at: observedAt,
        })
        programCreatedCount = programs.created.length
        failureCount += programs.failures.length
        for (const failure of programs.failures) {
          console.error(JSON.stringify({
            schema_version:
              "trade.rd-forward-market-data-program-error.v1",
            source_admission_id: failure.source_admission_id,
            failure_code: failure.failure_code,
          }))
        }
        const collecting = listCollectingForwardObservationPrograms(db)
        activeProgramCount = collecting.length
        let attemptedDemandCount = 0
        for (const program of collecting.slice(
          0,
          input.max_programs_per_cycle,
        )) {
          if (closing) break
          try {
            const latest = readLatestForwardMarketDataDemandDelivery(
              db,
              program.program_id,
            )
            if (!shouldRenewForwardMarketDataDemand(
              latest?.demand.lease.expires_at,
              observedAt,
              input.renew_before_ms,
            )) continue
            if (attemptedDemandCount >= input.max_programs_per_cycle) {
              continue
            }
            attemptedDemandCount += 1
            const demand = buildForwardObservationMarketDataDemand(program, {
              issued_at: observedAt,
              lease_duration_ms: input.lease_duration_ms,
            })
            const response = await ownerCommand(
              root,
              input,
              "put_market_data_demand",
              {
                demand,
                committed_at: new Date().toISOString(),
              },
              (child) => { currentChild = child },
            )
            currentChild = undefined
            const commitStatus = stringField(response.commit_status)
            if (response.ok !== true
                || response.action !== "put_market_data_demand"
                || response.demand_id !== demand.demand_id
                || response.demand_hash !== demand.demand_hash
                || !["created", "renewed", "existing"].includes(commitStatus)) {
              throw new Error("market-data owner response identity drifted")
            }
            recordForwardMarketDataDemandDelivery(db, {
              program_id: program.program_id,
              demand,
              owner_commit_status: commitStatus as
                "created" | "renewed" | "existing",
              accepted_at: new Date().toISOString(),
            })
            demandAcceptedCount += 1
          } catch (error) {
            currentChild = undefined
            failureCount += 1
            console.error(JSON.stringify({
              schema_version:
                "trade.rd-forward-market-data-worker-error.v1",
              program_id: program.program_id,
              error_class: error instanceof Error ? error.name : "Error",
            }))
          }
        }
        for (const program of collecting.slice(
          0,
          input.max_programs_per_cycle,
        )) {
          if (closing) break
          const candidate = readLatestForwardDatasetCandidate(
            db,
            program.program_id,
          )
          if (!candidate) continue
          fundingCandidateCount += 1
          if (readForwardFundingEvidenceBinding(
            db,
            candidate.candidate_id,
          )) continue
          try {
            let delivery = readLatestForwardFundingDemandDelivery(
              db,
              candidate.candidate_id,
            )
            if (delivery) {
              const ownerRead = await ownerCommand(
                root,
                input,
                "read_market_data_demand",
                { demand_id: delivery.demand.demand_id },
                (child) => { currentChild = child },
              )
              currentChild = undefined
              if (ownerRead.ok !== true
                  || ownerRead.action !== "read_market_data_demand") {
                throw new Error(
                  "funding demand owner read identity drifted",
                )
              }
              if (ownerRead.record == null) {
                delivery = undefined
              } else {
                const ownerRecord = asRecord(ownerRead.record)
                if (ownerRecord.status !== "active") {
                  fundingPendingCount += 1
                  continue
                }
                const ownerDemand = compileMarketDataDemand(
                  ownerRecord.demand,
                )
                if (ownerDemand.demand_hash
                    !== delivery.demand.demand_hash) {
                  recordForwardFundingDemandDelivery(db, {
                    candidate_id: candidate.candidate_id,
                    demand: ownerDemand,
                    owner_commit_status: "existing",
                    accepted_at: new Date().toISOString(),
                  })
                  delivery = readLatestForwardFundingDemandDelivery(
                    db,
                    candidate.candidate_id,
                  )
                }
              }
            }
            if (shouldRenewForwardMarketDataDemand(
              delivery?.demand.lease.expires_at,
              observedAt,
              input.renew_before_ms,
            )) {
              const demand = buildForwardFundingMarketDataDemand(
                program,
                candidate,
                {
                  issued_at: observedAt,
                  lease_duration_ms: input.lease_duration_ms,
                },
              )
              const response = await ownerCommand(
                root,
                input,
                "put_market_data_demand",
                {
                  demand,
                  committed_at: new Date().toISOString(),
                },
                (child) => { currentChild = child },
              )
              currentChild = undefined
              const commitStatus = stringField(response.commit_status)
              if (response.ok !== true
                  || response.action !== "put_market_data_demand"
                  || response.demand_id !== demand.demand_id
                  || response.demand_hash !== demand.demand_hash
                  || !["created", "renewed", "existing"]
                    .includes(commitStatus)) {
                throw new Error(
                  "funding demand owner response identity drifted",
                )
              }
              recordForwardFundingDemandDelivery(db, {
                candidate_id: candidate.candidate_id,
                demand,
                owner_commit_status: commitStatus as
                  "created" | "renewed" | "existing",
                accepted_at: new Date().toISOString(),
              })
              delivery = readLatestForwardFundingDemandDelivery(
                db,
                candidate.candidate_id,
              )
              fundingDemandAcceptedCount += 1
            }
            if (!delivery
                || Date.parse(delivery.demand.lease.expires_at)
                  < Date.parse(observedAt)) {
              fundingPendingCount += 1
              continue
            }
            const evidenceResponse = await ownerCommand(
              root,
              input,
              "resolve_funding_demand_evidence",
              {
                demand_id: delivery.demand.demand_id,
                demand_hash: delivery.demand.demand_hash,
                observed_at: observedAt,
                max_symbols: input.max_symbols,
              },
              (child) => { currentChild = child },
            )
            currentChild = undefined
            const evidence = asRecord(evidenceResponse.evidence)
            const evidenceStatus = stringField(evidence.status)
            if (evidenceResponse.ok !== true
                || evidenceResponse.action
                  !== "resolve_funding_demand_evidence") {
              throw new Error(
                "funding evidence owner response identity drifted",
              )
            }
            if (evidenceStatus === "conflict") {
              fundingConflictCount += 1
              continue
            }
            if (evidenceStatus !== "ready") {
              fundingPendingCount += 1
              continue
            }
            const resolution = asRecord(evidence.resolution)
            const audit = compileFundingCoverageAudit(resolution.audit)
            const fact = compileMarketDataFactRef(evidence.fact)
            const sliceResponse = await ownerCommand(
              root,
              input,
              "export_funding_replay_slice",
              { archive_id: audit.source.ref },
              (child) => { currentChild = child },
            )
            currentChild = undefined
            if (sliceResponse.ok !== true
                || sliceResponse.action
                  !== "export_funding_replay_slice") {
              throw new Error(
                "funding slice owner response identity drifted",
              )
            }
            const slice = compileFundingReplaySliceRef(
              sliceResponse.slice,
            )
            const sliceValue = readFundingSlice(
              root,
              slice.artifact_ref,
              slice.content_sha256,
            )
            const verifiedEvents = assertFundingReplaySliceContent(
              slice,
              sliceValue,
            )
            const binding = createForwardFundingEvidenceBinding({
              program,
              candidate,
              demand: delivery.demand,
              demand_accepted_at: delivery.accepted_at,
              owner_commit_status: delivery.owner_commit_status,
              coverage_audit: audit,
              market_data_fact: fact,
              funding_slice: slice,
              verified_events: verifiedEvents,
              created_at: new Date().toISOString(),
            })
            if (admitForwardFundingEvidenceBinding(db, {
              binding,
              verified_events: verifiedEvents,
            }) === "created") {
              fundingEvidenceCreatedCount += 1
            }
          } catch (error) {
            currentChild = undefined
            fundingFailureCount += 1
            console.error(JSON.stringify({
              schema_version:
                "trade.rd-forward-funding-evidence-worker-error.v1",
              candidate_id: candidate.candidate_id,
              error_class: error instanceof Error ? error.name : "Error",
            }))
          }
        }
      } catch (error) {
        failureCount += 1
        console.error(JSON.stringify({
          schema_version:
            "trade.rd-forward-market-data-worker-cycle-error.v1",
          error_class: error instanceof Error ? error.name : "Error",
        }))
      }
      writeState(input.state_file, {
        status: "running",
        updated_at: new Date().toISOString(),
        cycle,
        active_program_count: activeProgramCount,
        program_created_count: programCreatedCount,
        demand_accepted_count: demandAcceptedCount,
        funding_candidate_count: fundingCandidateCount,
        funding_demand_accepted_count: fundingDemandAcceptedCount,
        funding_evidence_created_count: fundingEvidenceCreatedCount,
        funding_pending_count: fundingPendingCount,
        funding_conflict_count: fundingConflictCount,
        funding_failure_count: fundingFailureCount,
        failure_count: failureCount,
      })
      if (input.max_cycles > 0 && cycle >= input.max_cycles) break
      if (!closing) await workerDelay(input.poll_interval_ms)
    }
  } finally {
    currentChild?.kill("SIGTERM")
    if (existsSync(input.ready_file)) rmSync(input.ready_file)
    writeState(input.state_file, {
      status: "stopped",
      updated_at: new Date().toISOString(),
      cycle,
      active_program_count: 0,
      program_created_count: 0,
      demand_accepted_count: 0,
      funding_candidate_count: 0,
      funding_demand_accepted_count: 0,
      funding_evidence_created_count: 0,
      funding_pending_count: 0,
      funding_conflict_count: 0,
      funding_failure_count: 0,
      failure_count: 0,
    })
    db.close()
  }
}

async function ownerCommand(
  root: string,
  input: ReturnType<typeof parseArgs>,
  action: string,
  json: Record<string, unknown>,
  setChild: (child: ReturnType<typeof Bun.spawn>) => void,
): Promise<Record<string, unknown>> {
  return workerMarketDataOwnerCommand({
    root,
    market_data_db: input.market_data_db,
    ohlcv_db: input.ohlcv_db,
    action,
    json,
    timeout_ms: input.command_timeout_ms,
    set_child: setChild,
  })
}

function readFundingSlice(
  root: string,
  artifactRef: string,
  expectedSha256: string,
): unknown {
  const path = resolve(root, artifactRef)
  if (!path.startsWith(`${root}${sep}`)
      || !existsSync(path)
      || lstatSync(path).isSymbolicLink()
      || !lstatSync(path).isFile()
      || realpathSync(path) !== path) {
    throw new Error("funding Replay slice path is unsafe")
  }
  const bytes = readFileSync(path)
  if (bytes.byteLength < 2
      || bytes.byteLength > 256 * 1024 * 1024
      || createHash("sha256").update(bytes).digest("hex")
        !== expectedSha256) {
    throw new Error("funding Replay slice bytes drifted")
  }
  return JSON.parse(bytes.toString("utf8")) as unknown
}

export function parseArgs(argv: string[]): {
  repository_root: string
  research_db: string
  market_data_db: string
  ohlcv_db: string
  ready_file: string
  state_file: string
  poll_interval_ms: number
  command_timeout_ms: number
  lease_duration_ms: number
  renew_before_ms: number
  max_programs_per_cycle: number
  max_symbols: number
  max_cycles: number
} {
  const allowed = new Set([
    "repository-root",
    "research-db",
    "market-data-db",
    "ohlcv-db",
    "ready-file",
    "state-file",
    "poll-interval-ms",
    "command-timeout-ms",
    "lease-duration-ms",
    "renew-before-ms",
    "max-programs-per-cycle",
    "max-symbols",
    "max-cycles",
  ])
  const values = workerFlagValues(
    argv,
    allowed,
    "Forward market-data worker",
  )
  return {
    ...workerResearchMarketDataPaths(
      values,
      "forward-market-data-worker",
    ),
    poll_interval_ms: workerBoundedInteger(
      values.get("poll-interval-ms") ?? "60000",
      5_000,
      3_600_000,
      "poll_interval_ms",
    ),
    command_timeout_ms: workerBoundedInteger(
      values.get("command-timeout-ms") ?? "30000",
      5_000,
      300_000,
      "command_timeout_ms",
    ),
    lease_duration_ms: workerBoundedInteger(
      values.get("lease-duration-ms") ?? "86400000",
      60_000,
      30 * 86_400_000,
      "lease_duration_ms",
    ),
    renew_before_ms: workerBoundedInteger(
      values.get("renew-before-ms") ?? "21600000",
      60_000,
      29 * 86_400_000,
      "renew_before_ms",
    ),
    max_programs_per_cycle: workerBoundedInteger(
      values.get("max-programs-per-cycle") ?? "20",
      1,
      100,
      "max_programs_per_cycle",
    ),
    max_symbols: workerBoundedInteger(
      values.get("max-symbols") ?? "20",
      1,
      100,
      "max_symbols",
    ),
    max_cycles: workerBoundedInteger(
      values.get("max-cycles") ?? "0",
      0,
      1_000_000,
      "max_cycles",
    ),
  }
}

function writeState(
  path: string,
  value: {
    status: "running" | "stopped"
    updated_at: string
    cycle: number
    active_program_count: number
    program_created_count: number
    demand_accepted_count: number
    funding_candidate_count: number
    funding_demand_accepted_count: number
    funding_evidence_created_count: number
    funding_pending_count: number
    funding_conflict_count: number
    funding_failure_count: number
    failure_count: number
  },
): void {
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 })
  const temporary = `${path}.${process.pid}.tmp`
  writeFileSync(temporary, `${JSON.stringify({
    schema_version:
      "trade.rd-forward-market-data-worker-state.v2",
    ...value,
    market_data_demand_authority: "request_only",
    funding_evidence_authority: "component_binding_only",
    forward_session_authority: "none",
    deployment_authority: "none",
    trading_authority: false,
  })}\n`, { mode: 0o600 })
  renameSync(temporary, path)
}

if (import.meta.main) {
  main().catch((error) => {
    console.error(JSON.stringify({
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    }))
    process.exit(1)
  })
}
