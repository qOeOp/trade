#!/usr/bin/env bun

import { existsSync, mkdirSync, readFileSync } from "node:fs"
import { dirname } from "node:path"
import { Database } from "bun:sqlite"
import {
  compileExecutionContract,
  type ExecutionContract,
  type ExecutionContractInput,
} from "../../binance-order-preview/scripts/execution-contract"
import { evaluatePreflight } from "../../plan-preflight/scripts/main"
import { fetchObserveProjections, type Runner } from "./lib/observe-adapter"
import { loadJsonFile, loadStrategies } from "./lib/loaders"
import { buildObserveEvent, type ObserveEvent, type ObserveInput } from "./lib/observe-builder"
import { runArtifactGc } from "./lib/artifact-hygiene"
import { buildReconcileDrafts } from "./lib/reconcile"
import { runJsonCommand } from "./lib/skill-runner"
import { replayRegisteredStrategy } from "./lib/strategy-replay"
import type { ReplayResult } from "./lib/replay-core"
import {
  evaluateRndSignal,
  runStrategyRndBatch,
  runStrategyRndCampaign,
  runStrategyRndLoop,
  strategyRndBatchInputFromJson,
  strategyRndCampaignInputFromJson,
  strategyRndLoopInputFromJson,
  strategyRndSignalInputFromJson,
} from "./lib/strategy-rnd"
import {
  appendReplayEvidence,
  appendStrategyEvidence,
  promoteStrategy,
  reviewStrategy,
  type AntiOverfitProof,
  type EvidenceStats,
  type EvidenceKind,
  type StrategyStatus,
} from "./lib/strategy-iteration"

type EventKind = "observe" | "order_fill" | "review"
type JSONRecord = Record<string, unknown>
type RunMode = "dry-run" | "shadow"

interface PlanEvent {
  event_key: string
  chain_id: string
  kind: EventKind
  body_json: JSONRecord
  created_at: string
}

type ScriptResponse =
  | { ok: true; data: unknown }
  | { ok: false; error: string; data?: unknown }

const HELP_TEXT = `Usage:
  ./scripts/main.ts --db ./data/trade.db --init
  ./scripts/main.ts --db ./data/trade.db --append-order-fill --json '{"chain_id":"...","body_json":{...}}'
  ./scripts/main.ts --db ./data/trade.db --record-execution --json '{"preflight_result":{"verdict":"armable"},"execution_contract_input":{...},"execution_result":{...}}'
  ./scripts/main.ts --db ./data/trade.db --run --mode dry-run --json '{"plan":{...},"observe":{...},"execution_contract_input":{...}}'
  ./scripts/main.ts --db ./data/trade.db --run --mode shadow --json '{"plan":{...},"observe":{...},"execution_contract_input":{...}}'
  ./scripts/main.ts --load-runtime --account-config ./data/account_config.json --strategies-dir .agents/skills/trade-flow/strategies
  ./scripts/main.ts --build-observe --json '{"chain_id":"...","symbol":"BTCUSDT",...}'
  ./scripts/main.ts --observe-from-skills --json '{"repoRoot":"/repo","chain_id":"...","symbol":"BTCUSDT",...}'
  ./scripts/main.ts --replay-strategy --manifest ./data/ohlcv/BTCUSDT/manifest.json --strategy-id S-BTC-4H-TREND-PULLBACK
  ./scripts/main.ts --strategy-rnd-batch --json '{"manifest_path":"./data/ohlcv/BTCUSDT/manifest.json","candidates":[...]}'
  ./scripts/main.ts --strategy-rnd-loop --json '{"manifest_path":"./data/ohlcv/BTCUSDT/manifest.json","indicator_report_path":"...","factor_discover":true,"factor_compose":true,"candidates":[...]}'
  ./scripts/main.ts --strategy-rnd-campaign --json '{"campaign_id":"...","max_total_trials":10,"hypotheses":[...]}'
  ./scripts/main.ts --strategy-signal --json '{"manifest_path":"...","entry_price":60000,"candidate":{...}}'
  ./scripts/main.ts --run-shadow-from-skills --json '{"repoRoot":"/repo","chain_id":"...","symbol":"BTCUSDT",...}'
  ./scripts/main.ts --run-live-small --yes --json '{"repoRoot":"/repo","plan":{...},"observe":{...},"execution_contract_input":{...}}'
  ./scripts/main.ts --db ./data/trade.db --recover-flow --chain-id <chain_id>
  ./scripts/main.ts --db ./data/trade.db --reconcile-flow --chain-id <chain_id> --json '{"data":{"openOrders":...}}'
  ./scripts/main.ts --db ./data/trade.db --reconcile-from-skills --chain-id <chain_id> --json '{"repoRoot":"/repo","symbol":"BTCUSDT"}'
  ./scripts/main.ts --db ./data/trade.db --apply-reconcile --yes --json '{"can_reconcile":true,"drafts":[...]}'
  ./scripts/main.ts --db ./data/trade.db --cron-recover-from-skills --chain-id <chain_id> --json '{"repoRoot":"/repo","symbol":"BTCUSDT","apply_reconcile":false}'
  ./scripts/main.ts --artifact-gc --artifact-root ./data/artifacts --retention-hours 168
  ./scripts/main.ts --append-strategy-evidence --strategy <strategy.md> --ledger ./data/strategy-evidence.jsonl --json '{"kind":"shadow","stats":{...}}'
  ./scripts/main.ts --strategy-review --strategy <strategy.md> --ledger ./data/strategy-evidence.jsonl
  ./scripts/main.ts --strategy-promote --strategy <strategy.md> --ledger ./data/strategy-evidence.jsonl --to shadow --yes

Key flags:
  --db <path>              SQLite trade.db path. Default: ./data/trade.db
  --init                   Initialize plan_event schema
  --append-order-fill      Append one order_fill event
  --record-execution       Compile contract and append audited order_fill from an execute-skill result
  --run                    Run one orchestrated flow step
  --mode <dry-run|shadow>  Execution mode for --run
  --load-runtime           Load account config and strategy files
  --build-observe          Build an observe event from account / market projections
  --observe-from-skills    Call read-only snapshot skills and build an observe event
  --replay-strategy        Replay a draft strategy against manifest OHLCV
  --strategy-rnd-batch     Run a predeclared bounded R&D candidate batch; never auto-promotes
  --strategy-rnd-loop      Run one R&D loop iteration, writing artifact + JSONL ledger; never auto-promotes
  --strategy-rnd-campaign  Run bounded hypotheses through discovery and non-overlapping external validation
  --strategy-signal        Evaluate one R&D candidate on the latest closed candle; never executes
  --run-shadow-from-skills Call read-only snapshot skills, build observe, then record shadow execution
  --run-live-small         Execute one live-small main entry through binance-order-place
  --recover-flow           Reduce local plan_event history for one flow
  --reconcile-flow         Compare local flow state with a Binance account snapshot and return reconcile drafts
  --reconcile-from-skills  Call read-only account snapshot with history, then return reconcile drafts
  --apply-reconcile        Append source=reconcile drafts returned by reconcile step
  --cron-recover-from-skills Run local reduce + read-only reconcile; optionally apply local reconcile drafts
  --artifact-gc           Report or delete stale unreferenced artifact files
  --append-strategy-evidence Append replay/shadow/live-small evidence to strategy ledger
  --strategy-review       Build one strategy iteration report from ledger and optional DB reviews
  --strategy-promote      Dry-run or apply strategy status transition
  --chain-id <chain_id>    Flow id for recovery / reconcile
  --yes                    Required for --run-live-small / --apply-reconcile
  --strategy <path>        Strategy markdown path for iteration commands
  --ledger <path>          Strategy evidence JSONL ledger. Default: ./data/strategy-evidence.jsonl
  --to <status>            Target status for --strategy-promote
  --artifact-root <path>   Directory scanned by --artifact-gc
  --retention-hours <n>    Artifact GC age threshold. Default: 168
  --account-config <path>  JSON account config path
  --strategies-dir <path>  Strategy markdown directory
  --manifest <path>        OHLCV manifest for --replay-strategy
  --strategy-id <id>       Strategy id for --replay-strategy
  --timeframe <tf>         Timeframe for --replay-strategy. Default: strategy default
  --max-hold-bars <n>      Max bars to hold in replay
  --reward-risk <n>        Target R multiple in replay
  --fee-bps <n>            Round-trip side fee estimate in bps per side for replay
  --slippage-bps <n>       Slippage estimate in bps per side for replay
  --oos-split <ratio>      Replay anti-overfit OOS split ratio. Example: 0.3
  --trial-count <n>        Number of predeclared strategy trials represented by this replay
  --parameter-count <n>    Number of active strategy parameters represented by this replay
  --input <path>           JSON event input
  --json <json>            Inline JSON event input
  --help                   Show this help
`

async function main(): Promise<void> {
  const argv = process.argv.slice(2)
  if (argv.includes("--help") || argv.includes("-h")) {
    process.stdout.write(HELP_TEXT)
    return
  }

  const response = await run(argv)
  process.stdout.write(`${JSON.stringify(response, null, 2)}\n`)
  if (!response.ok) {
    process.exit(1)
  }
}

async function run(argv: string[]): Promise<ScriptResponse> {
  try {
    const config = parseArgs(argv)

    if (config.loadRuntime) {
      return { ok: true, data: loadRuntime(config.accountConfigPath, config.strategiesDir) }
    }
    if (config.buildObserve) {
      return { ok: true, data: buildObserveEvent(config.input as unknown as ObserveInput) }
    }
    if (config.observeFromSkills) {
      return {
        ok: true,
        data: await observeFromSkills(config.input),
      }
    }
    if (config.replayStrategy) {
      if (!config.manifestPath) {
        throw new Error("--replay-strategy requires --manifest")
      }
      return {
        ok: true,
        data: replayRegisteredStrategy({
          manifestPath: config.manifestPath,
          strategyId: config.strategyId,
          timeframe: config.timeframe,
          maxHoldBars: config.maxHoldBars,
          rewardRisk: config.rewardRisk,
          feeBps: config.feeBps,
          slippageBps: config.slippageBps,
          oosSplitRatio: config.oosSplitRatio,
          trialCount: config.trialCount,
          parameterCount: config.parameterCount,
        }),
      }
    }
    if (config.strategyRndBatch) {
      return {
        ok: true,
        data: runStrategyRndBatch(strategyRndBatchInputFromJson(config.input)),
      }
    }
    if (config.strategyRndLoop) {
      return {
        ok: true,
        data: runStrategyRndLoop(strategyRndLoopInputFromJson(config.input)),
      }
    }
    if (config.strategyRndCampaign) {
      return {
        ok: true,
        data: runStrategyRndCampaign(strategyRndCampaignInputFromJson(config.input)),
      }
    }
    if (config.strategySignal) {
      return { ok: true, data: evaluateRndSignal(strategyRndSignalInputFromJson(config.input)) }
    }
    if (config.artifactGc) {
      if (!config.artifactRoot) {
        throw new Error("--artifact-gc requires --artifact-root")
      }
      return {
        ok: true,
        data: runArtifactGc({
          root: config.artifactRoot,
          retentionHours: config.retentionHours,
          yes: config.yes,
          referencedPaths: readStringArray(config.input.referenced_paths),
          now: stringField(config.input.now) || undefined,
        }),
      }
    }
    if (config.appendStrategyEvidence) {
      return { ok: true, data: appendStrategyEvidenceFromInput(config) }
    }
    if (config.strategyReview) {
      return { ok: true, data: withExistingDb(config.dbPath, (db) => reviewStrategy({
        strategyPath: config.strategyPath,
        ledgerPath: config.ledgerPath,
        db,
      })) }
    }
    if (config.strategyPromote) {
      return { ok: true, data: withExistingDb(config.dbPath, (db) => promoteStrategy({
        strategyPath: config.strategyPath,
        ledgerPath: config.ledgerPath,
        db,
        toStatus: config.promoteTo,
        yes: config.yes,
      })) }
    }

    mkdirSync(dirname(config.dbPath), { recursive: true })
    const db = new Database(config.dbPath)
    try {
      ensureSchema(db)
      if (config.init) {
        return { ok: true, data: { initialized: true, dbPath: config.dbPath } }
      }
      if (config.appendOrderFill) {
        const event = buildOrderFillEvent(config.input)
        appendPlanEvent(db, event)
        return { ok: true, data: event }
      }
      if (config.recordExecution) {
        const event = buildRecordedExecutionEvent(config.input)
        appendPlanEvent(db, event)
        return { ok: true, data: event }
      }
      if (config.run) {
        return { ok: true, data: runOneFlowStep(db, config.input, config.mode) }
      }
      if (config.runShadowFromSkills) {
        return {
          ok: true,
          data: await runShadowFromSkills(db, config.input),
        }
      }
      if (config.runLiveSmall) {
        return {
          ok: true,
          data: await runLiveSmall(db, config.input, config.yes),
        }
      }
      if (config.recoverFlow) {
        return { ok: true, data: reduceFlowState(db, config.chainId) }
      }
      if (config.reconcileFlow) {
        const localEvents = readFlowEvents(db, config.chainId)
        return {
          ok: true,
          data: buildReconcileDrafts({
            chain_id: config.chainId,
            local_events: localEvents,
            local_state: reduceFlowState(db, config.chainId),
            account_snapshot: config.input,
          }),
        }
      }
      if (config.reconcileFromSkills) {
        return { ok: true, data: await reconcileFromSkills(db, config.chainId, config.input) }
      }
      if (config.applyReconcile) {
        return { ok: true, data: applyReconcileDrafts(db, config.input, config.yes) }
      }
      if (config.cronRecoverFromSkills) {
        return { ok: true, data: await cronRecoverFromSkills(db, config.chainId, config.input, config.yes) }
      }
      throw new Error("provide --init, --append-order-fill, --record-execution, --run, --load-runtime, --build-observe, --observe-from-skills, --replay-strategy, --strategy-rnd-batch, --strategy-rnd-loop, --strategy-rnd-campaign, --strategy-signal, --artifact-gc, --append-strategy-evidence, --strategy-review, --strategy-promote, --run-shadow-from-skills, --run-live-small, --recover-flow, --reconcile-flow, --reconcile-from-skills, --apply-reconcile, or --cron-recover-from-skills")
    } finally {
      db.close()
    }
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) }
  }
}

function ensureSchema(db: Database): void {
  db.run(`
    CREATE TABLE IF NOT EXISTS plan_event (
      event_key   TEXT PRIMARY KEY,
      chain_id    TEXT NOT NULL,
      kind        TEXT NOT NULL CHECK(kind IN ('observe', 'order_fill', 'review')),
      body_json   TEXT NOT NULL CHECK(json_valid(body_json)),
      created_at  TEXT NOT NULL
    )
  `)
  db.run("CREATE INDEX IF NOT EXISTS idx_chain_time ON plan_event(chain_id, created_at)")
  db.run("CREATE INDEX IF NOT EXISTS idx_kind_chain ON plan_event(kind, chain_id)")
  db.run("CREATE INDEX IF NOT EXISTS idx_obs_symbol ON plan_event(json_extract(body_json, '$.symbol')) WHERE kind = 'observe'")
}

function appendPlanEvent(db: Database, event: PlanEvent): void {
  validatePlanEvent(event)
  db.query(`
    INSERT INTO plan_event(event_key, chain_id, kind, body_json, created_at)
    VALUES ($event_key, $chain_id, $kind, $body_json, $created_at)
  `).run({
    $event_key: event.event_key,
    $chain_id: event.chain_id,
    $kind: event.kind,
    $body_json: JSON.stringify(event.body_json),
    $created_at: event.created_at,
  })
}

function buildOrderFillEvent(input: JSONRecord): PlanEvent {
  const body = asRecord(input.body_json ?? input.body)
  const chainId = stringField(input.chain_id) || stringField(body.chain_id)
  const eventKey = stringField(input.event_key) || crypto.randomUUID()
  const createdAt = stringField(input.created_at) || new Date().toISOString()

  return {
    event_key: eventKey,
    chain_id: chainId,
    kind: "order_fill",
    body_json: body,
    created_at: createdAt,
  }
}

function buildRecordedExecutionEvent(input: JSONRecord): PlanEvent {
  const preflight = asRecord(input.preflight_result)
  if (preflight.verdict !== "armable") {
    throw new Error("record-execution requires preflight_result.verdict=armable")
  }

  const contract = compileExecutionContract(asRecord(input.execution_contract_input) as unknown as ExecutionContractInput)
  const executionResult = asRecord(input.execution_result)
  const submitResult = asRecord(executionResult.result)
  const confirmedResult = asRecord(executionResult.confirmedResult)
  const primaryEntry = contract.entries[0]
  const body: JSONRecord = {
    sub_kind: "submit",
    client_order_id: readClientOrderId(contract, executionResult, submitResult, confirmedResult),
    exchange_order_id: readExchangeOrderId(submitResult, confirmedResult),
    symbol: contract.symbol,
    side: contract.side === "long" ? "BUY" : "SELL",
    position_side: contract.position_side,
    order_type: primaryEntry?.type,
    qty: primaryEntry?.quantity,
    price: primaryEntry?.price,
    stop_price: primaryEntry?.stop_price,
    source: "trade_flow",
    source_observe_event_key: contract.source_observe_event_key,
    execution_contract_snapshot: contract,
    execution_method: stringField(executionResult.method),
    execution_result: executionResult,
  }
  removeUndefined(body)

  return {
    event_key: stringField(input.event_key) || crypto.randomUUID(),
    chain_id: contract.chain_id,
    kind: "order_fill",
    body_json: body,
    created_at: stringField(input.created_at) || new Date().toISOString(),
  }
}

function runOneFlowStep(db: Database, input: JSONRecord, mode: RunMode): JSONRecord {
  if (mode !== "dry-run" && mode !== "shadow") {
    throw new Error(`unsupported run mode: ${mode}`)
  }

  const preflightResult = evaluatePreflight({
    plan: asRecord(input.plan),
    observe: asRecord(input.observe),
    strategy: asRecord(input.strategy),
    account_config: asRecord(input.account_config),
    target_action: readTargetAction(input.target_action),
    request: asRecord(input.request),
    aggregate_view: asRecord(input.aggregate_view),
    runtime_health: asRecord(input.runtime_health),
    now: stringField(input.now) || undefined,
  })

  if (preflightResult.verdict !== "armable") {
    return {
      mode,
      preflight_result: preflightResult,
      recorded: false,
    }
  }

  const contract = compileExecutionContract(asRecord(input.execution_contract_input) as unknown as ExecutionContractInput)
  const executionResult = buildMockExecutionResult(contract, mode)
  const event = buildRecordedExecutionEvent({
    event_key: stringField(input.event_key),
    created_at: stringField(input.created_at),
    preflight_result: preflightResult,
    execution_contract_input: input.execution_contract_input,
    execution_result: executionResult,
  })
  appendPlanEvent(db, event)

  return {
    mode,
    preflight_result: preflightResult,
    execution_contract: contract,
    execution_result: executionResult,
    order_fill_event: event,
    latest_order_fill: readLatestOrderFill(db, contract.chain_id),
    recorded: true,
  }
}

function validatePlanEvent(event: PlanEvent): void {
  if (!event.event_key) {
    throw new Error("event_key is required")
  }
  if (!event.chain_id) {
    throw new Error("chain_id is required")
  }
  if (!["observe", "order_fill", "review"].includes(event.kind)) {
    throw new Error(`unsupported event kind: ${event.kind}`)
  }
  if (event.kind === "order_fill") {
    validateOrderFill(event.body_json)
  }
}

function validateOrderFill(body: JSONRecord): void {
  const source = stringField(body.source)
  if (!source) {
    throw new Error("order_fill.source is required")
  }
  if (source === "trade_flow") {
    if (!stringField(body.source_observe_event_key)) {
      throw new Error("order_fill.source_observe_event_key is required for source=trade_flow")
    }
    const snapshot = body.execution_contract_snapshot
    if (!snapshot || typeof snapshot !== "object") {
      throw new Error("order_fill.execution_contract_snapshot is required for source=trade_flow")
    }
  }
}

function parseArgs(argv: string[]): {
  dbPath: string
  init: boolean
  appendOrderFill: boolean
  recordExecution: boolean
  run: boolean
  mode: RunMode
  loadRuntime: boolean
  buildObserve: boolean
  observeFromSkills: boolean
  replayStrategy: boolean
  strategyRndBatch: boolean
  strategyRndLoop: boolean
  strategyRndCampaign: boolean
  strategySignal: boolean
  artifactGc: boolean
  appendStrategyEvidence: boolean
  strategyReview: boolean
  strategyPromote: boolean
  runShadowFromSkills: boolean
  runLiveSmall: boolean
  recoverFlow: boolean
  reconcileFlow: boolean
  reconcileFromSkills: boolean
  applyReconcile: boolean
  cronRecoverFromSkills: boolean
  yes: boolean
  chainId: string
  accountConfigPath: string
  strategiesDir: string
  manifestPath: string
  strategyId: string
  timeframe: string
  maxHoldBars?: number
  rewardRisk?: number
  feeBps?: number
  slippageBps?: number
  oosSplitRatio?: number
  trialCount?: number
  parameterCount?: number
  artifactRoot: string
  retentionHours?: number
  strategyPath: string
  ledgerPath: string
  promoteTo: StrategyStatus
  input: JSONRecord
} {
  let dbPath = "./data/trade.db"
  let init = false
  let appendOrderFill = false
  let recordExecution = false
  let runFlow = false
  let mode: RunMode = "dry-run"
  let loadRuntimeConfig = false
  let buildObserve = false
  let observeFromSkillsEnabled = false
  let replayStrategy = false
  let strategyRndBatch = false
  let strategyRndLoop = false
  let strategyRndCampaign = false
  let strategySignal = false
  let artifactGc = false
  let appendStrategyEvidenceEnabled = false
  let strategyReview = false
  let strategyPromote = false
  let runShadowFromSkillsEnabled = false
  let runLiveSmallEnabled = false
  let recoverFlow = false
  let reconcileFlow = false
  let reconcileFromSkills = false
  let applyReconcile = false
  let cronRecoverFromSkills = false
  let yes = false
  let chainId = ""
  let accountConfigPath = "./data/account_config.json"
  let strategiesDir = ".agents/skills/trade-flow/strategies"
  let manifestPath = ""
  let strategyId = "S-BTC-4H-TREND-PULLBACK"
  let timeframe = ""
  let maxHoldBars: number | undefined
  let rewardRisk: number | undefined
  let feeBps: number | undefined
  let slippageBps: number | undefined
  let oosSplitRatio: number | undefined
  let trialCount: number | undefined
  let parameterCount: number | undefined
  let artifactRoot = ""
  let retentionHours: number | undefined
  let strategyPath = ""
  let ledgerPath = "./data/strategy-evidence.jsonl"
  let promoteTo: StrategyStatus = "shadow"
  let raw = ""

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]
    switch (arg) {
      case "--db":
        dbPath = readFlagValue(argv, ++index, arg)
        break
      case "--init":
        init = true
        break
      case "--append-order-fill":
        appendOrderFill = true
        break
      case "--record-execution":
        recordExecution = true
        break
      case "--run":
        runFlow = true
        break
      case "--mode":
        mode = readRunMode(readFlagValue(argv, ++index, arg))
        break
      case "--load-runtime":
        loadRuntimeConfig = true
        break
      case "--build-observe":
        buildObserve = true
        break
      case "--observe-from-skills":
        observeFromSkillsEnabled = true
        break
      case "--replay-strategy":
        replayStrategy = true
        break
      case "--strategy-rnd-batch":
        strategyRndBatch = true
        break
      case "--strategy-rnd-loop":
        strategyRndLoop = true
        break
      case "--strategy-rnd-campaign":
        strategyRndCampaign = true
        break
      case "--strategy-signal":
        strategySignal = true
        break
      case "--artifact-gc":
        artifactGc = true
        break
      case "--append-strategy-evidence":
        appendStrategyEvidenceEnabled = true
        break
      case "--strategy-review":
        strategyReview = true
        break
      case "--strategy-promote":
        strategyPromote = true
        break
      case "--run-shadow-from-skills":
        runShadowFromSkillsEnabled = true
        break
      case "--run-live-small":
        runLiveSmallEnabled = true
        break
      case "--recover-flow":
        recoverFlow = true
        break
      case "--reconcile-flow":
        reconcileFlow = true
        break
      case "--reconcile-from-skills":
        reconcileFromSkills = true
        break
      case "--apply-reconcile":
        applyReconcile = true
        break
      case "--cron-recover-from-skills":
        cronRecoverFromSkills = true
        break
      case "--chain-id":
        chainId = readFlagValue(argv, ++index, arg)
        break
      case "--yes":
        yes = true
        break
      case "--account-config":
        accountConfigPath = readFlagValue(argv, ++index, arg)
        break
      case "--strategies-dir":
        strategiesDir = readFlagValue(argv, ++index, arg)
        break
      case "--manifest":
        manifestPath = readFlagValue(argv, ++index, arg)
        break
      case "--strategy-id":
        strategyId = readFlagValue(argv, ++index, arg)
        break
      case "--timeframe":
        timeframe = readFlagValue(argv, ++index, arg)
        break
      case "--max-hold-bars":
        maxHoldBars = Number(readFlagValue(argv, ++index, arg))
        break
      case "--reward-risk":
        rewardRisk = Number(readFlagValue(argv, ++index, arg))
        break
      case "--fee-bps":
        feeBps = Number(readFlagValue(argv, ++index, arg))
        break
      case "--slippage-bps":
        slippageBps = Number(readFlagValue(argv, ++index, arg))
        break
      case "--oos-split":
        oosSplitRatio = Number(readFlagValue(argv, ++index, arg))
        break
      case "--trial-count":
        trialCount = Number(readFlagValue(argv, ++index, arg))
        break
      case "--parameter-count":
        parameterCount = Number(readFlagValue(argv, ++index, arg))
        break
      case "--artifact-root":
        artifactRoot = readFlagValue(argv, ++index, arg)
        break
      case "--retention-hours":
        retentionHours = Number(readFlagValue(argv, ++index, arg))
        break
      case "--strategy":
        strategyPath = readFlagValue(argv, ++index, arg)
        break
      case "--ledger":
        ledgerPath = readFlagValue(argv, ++index, arg)
        break
      case "--to":
        promoteTo = readStrategyStatus(readFlagValue(argv, ++index, arg))
        break
      case "--input":
        raw = readFileSync(readFlagValue(argv, ++index, arg), "utf8")
        break
      case "--json":
        raw = readFlagValue(argv, ++index, arg)
        break
      default:
        throw new Error(`unknown flag: ${arg}`)
    }
  }

  return {
    dbPath,
    init,
    appendOrderFill,
    recordExecution,
    run: runFlow,
    mode,
    loadRuntime: loadRuntimeConfig,
    buildObserve,
    observeFromSkills: observeFromSkillsEnabled,
    replayStrategy,
    strategyRndBatch,
    strategyRndLoop,
    strategyRndCampaign,
    strategySignal,
    artifactGc,
    appendStrategyEvidence: appendStrategyEvidenceEnabled,
    strategyReview,
    strategyPromote,
    runShadowFromSkills: runShadowFromSkillsEnabled,
    runLiveSmall: runLiveSmallEnabled,
    recoverFlow,
    reconcileFlow,
    reconcileFromSkills,
    applyReconcile,
    cronRecoverFromSkills,
    yes,
    chainId,
    accountConfigPath,
    strategiesDir,
    manifestPath,
    strategyId,
    timeframe,
    maxHoldBars,
    rewardRisk,
    feeBps,
    slippageBps,
    oosSplitRatio,
    trialCount,
    parameterCount,
    artifactRoot,
    retentionHours,
    strategyPath,
    ledgerPath,
    promoteTo,
    input: raw ? JSON.parse(raw) as JSONRecord : {},
  }
}

function readStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return []
  }
  return value.filter((item): item is string => typeof item === "string" && item.length > 0)
}

function appendStrategyEvidenceFromInput(config: ReturnType<typeof parseArgs>): unknown {
  if (!config.strategyPath) {
    throw new Error("--append-strategy-evidence requires --strategy")
  }
  const replayResult = asRecord(config.input.replay_result)
  if (Object.keys(replayResult).length > 0) {
    return appendReplayEvidence({
      strategyPath: config.strategyPath,
      ledgerPath: config.ledgerPath,
      replayResult: replayResult as unknown as ReplayResult,
      setupId: stringField(config.input.setup_id) || undefined,
      sourceRef: stringField(config.input.source_ref) || undefined,
      now: stringField(config.input.now) || undefined,
    })
  }
  const gate = asRecord(config.input.gate)
  const antiOverfit = asRecord(config.input.anti_overfit)
  return appendStrategyEvidence({
    strategyPath: config.strategyPath,
    ledgerPath: config.ledgerPath,
    kind: readEvidenceKind(config.input.kind),
    setupId: stringField(config.input.setup_id) || undefined,
    sourceRef: stringField(config.input.source_ref) || undefined,
    stats: asRecord(config.input.stats) as unknown as EvidenceStats,
    antiOverfit: Object.keys(antiOverfit).length > 0 ? antiOverfit as unknown as AntiOverfitProof : undefined,
    gate: Object.keys(gate).length > 0 ? gate : undefined,
    notes: stringField(config.input.notes) || undefined,
    now: stringField(config.input.now) || undefined,
  })
}

function readEvidenceKind(value: unknown): EvidenceKind {
  const kind = stringField(value)
  if (kind === "replay" || kind === "shadow" || kind === "live_small" || kind === "review_batch") {
    return kind
  }
  throw new Error("strategy evidence kind must be replay, shadow, live_small, or review_batch")
}

function withExistingDb<T>(dbPath: string, fn: (db?: Database) => T): T {
  if (!dbPath || !existsSync(dbPath)) {
    return fn(undefined)
  }
  const db = new Database(dbPath, { readonly: true })
  try {
    return fn(db)
  } finally {
    db.close()
  }
}

function readFlagValue(argv: string[], index: number, name: string): string {
  const value = argv[index]
  if (!value || value.startsWith("--")) {
    throw new Error(`${name} requires a value`)
  }
  return value
}

function readStrategyStatus(value: string): StrategyStatus {
  if (value === "draft" || value === "shadow" || value === "live-small" || value === "paused") {
    return value
  }
  throw new Error("--to must be draft, shadow, live-small, or paused")
}

function stringField(value: unknown): string {
  return typeof value === "string" ? value.trim() : ""
}

function asRecord(value: unknown): JSONRecord {
  return value && typeof value === "object" ? value as JSONRecord : {}
}

function readClientOrderId(
  contract: ExecutionContract,
  executionResult: JSONRecord,
  submitResult: JSONRecord,
  confirmedResult: JSONRecord,
): string {
  return stringField(submitResult.clientOrderId)
    || stringField(submitResult.clientAlgoId)
    || stringField(confirmedResult.clientOrderId)
    || stringField(confirmedResult.clientAlgoId)
    || stringField(executionResult.clientOrderId)
    || stringField(executionResult.clientAlgoId)
    || contract.entries[0]?.client_order_id
    || ""
}

function readExchangeOrderId(submitResult: JSONRecord, confirmedResult: JSONRecord): string {
  const candidate = submitResult.orderId ?? submitResult.algoId ?? confirmedResult.orderId ?? confirmedResult.algoId
  return candidate == null ? "" : String(candidate)
}

function removeUndefined(record: JSONRecord): void {
  for (const [key, value] of Object.entries(record)) {
    if (value === undefined || value === "") {
      delete record[key]
    }
  }
}

function compactRecord(record: JSONRecord): JSONRecord {
  removeUndefined(record)
  return record
}

function numberField(value: unknown): number {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : 0
}

function numberOrUndefined(value: unknown): number | undefined {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : undefined
}

function normalizeZero(value: number): number {
  return Math.abs(value) < 1e-12 ? 0 : value
}

function buildMockExecutionResult(contract: ExecutionContract, mode: RunMode = "dry-run"): JSONRecord {
  const entry = contract.entries[0]
  return {
    mode,
    method: ["STOP", "STOP_MARKET", "TAKE_PROFIT", "TAKE_PROFIT_MARKET"].includes(entry.type)
      ? `${mode}FuturesCreateAlgoOrder`
      : `${mode}FuturesOrder`,
    request: entry,
    result: {
      orderId: `mock-${entry.client_order_id}`,
      clientOrderId: entry.client_order_id,
      status: "NEW",
      symbol: contract.symbol,
      type: entry.type,
    },
    confirmedResult: {
      orderId: `mock-${entry.client_order_id}`,
      clientOrderId: entry.client_order_id,
      status: "NEW",
    },
  }
}

function readFlowEvents(db: Database, chainId: string): PlanEvent[] {
  if (!chainId) {
    throw new Error("chain_id is required")
  }
  const rows = db.query(`
    SELECT event_key, chain_id, kind, body_json, created_at
    FROM plan_event
    WHERE chain_id = $chain_id
    ORDER BY created_at ASC, rowid ASC
  `).all({ $chain_id: chainId }) as Array<{
    event_key: string
    chain_id: string
    kind: EventKind
    body_json: string
    created_at: string
  }>

  return rows.map((row) => ({
    event_key: row.event_key,
    chain_id: row.chain_id,
    kind: row.kind,
    body_json: JSON.parse(row.body_json) as JSONRecord,
    created_at: row.created_at,
  }))
}

function reduceFlowState(db: Database, chainId: string): JSONRecord {
  const events = readFlowEvents(db, chainId)
  const orders = new Map<string, JSONRecord>()
  const position = {
    symbol: "",
    position_side: "",
    net_qty: 0,
    avg_entry_price: 0,
    state: "flat",
  }
  let latestObserve: PlanEvent | null = null
  let latestOrderFill: PlanEvent | null = null

  for (const event of events) {
    if (event.kind === "observe") {
      latestObserve = event
      continue
    }
    if (event.kind !== "order_fill") {
      continue
    }
    latestOrderFill = event
    reduceOrderFill(event.body_json, orders, position)
  }

  return {
    chain_id: chainId,
    event_count: events.length,
    latest_observe: latestObserve,
    latest_order_fill: latestOrderFill,
    current_orders: Array.from(orders.values()),
    current_position: {
      ...position,
      net_qty: normalizeZero(position.net_qty),
      avg_entry_price: normalizeZero(position.avg_entry_price),
      state: position.net_qty > 0 ? "long" : position.net_qty < 0 ? "short" : "flat",
    },
    open_action_gap: detectOpenActionGap(latestObserve, events),
  }
}

function applyReconcileDrafts(db: Database, input: JSONRecord, yes: boolean): JSONRecord {
  if (!yes) {
    throw new Error("--apply-reconcile requires --yes")
  }
  if (input.can_reconcile !== true) {
    throw new Error("apply-reconcile requires can_reconcile=true")
  }
  const drafts = Array.isArray(input.drafts) ? input.drafts.map(asRecord) : []
  const applied: string[] = []
  for (const draft of drafts) {
    const event = draft as unknown as PlanEvent
    if (event.kind !== "order_fill" || stringField(asRecord(event.body_json).source) !== "reconcile") {
      throw new Error("apply-reconcile only accepts order_fill(source=reconcile) drafts")
    }
    appendPlanEvent(db, event)
    applied.push(event.event_key)
  }
  return {
    applied_count: applied.length,
    applied_event_keys: applied,
  }
}

function reduceOrderFill(
  body: JSONRecord,
  orders: Map<string, JSONRecord>,
  position: { symbol: string; position_side: string; net_qty: number; avg_entry_price: number; state: string },
): void {
  const clientOrderId = stringField(body.client_order_id)
  const subKind = stringField(body.sub_kind)
  if (!clientOrderId) {
    return
  }

  if (subKind === "submit" || subKind === "amend") {
    const qty = numberField(body.qty)
    const filledQty = numberField(body.filled_qty)
    orders.set(clientOrderId, compactRecord({
      client_order_id: clientOrderId,
      exchange_order_id: stringField(body.exchange_order_id),
      symbol: stringField(body.symbol),
      side: stringField(body.side),
      position_side: stringField(body.position_side),
      order_type: stringField(body.order_type),
      qty,
      price: numberOrUndefined(body.price),
      stop_price: numberOrUndefined(body.stop_price),
      remaining_qty: Math.max(qty - filledQty, 0),
    }))
    return
  }

  if (subKind === "cancel") {
    orders.delete(clientOrderId)
    return
  }

  if (subKind === "partial_fill" || subKind === "fill") {
    const fillQty = numberField(body.filled_qty) || numberField(body.qty)
    const avgFillPrice = numberField(body.avg_fill_price) || numberField(body.price)
    applyPositionFill(position, body, fillQty, avgFillPrice)
    const existing = orders.get(clientOrderId)
    if (existing) {
      const remaining = Math.max(numberField(existing.remaining_qty) - fillQty, 0)
      if (subKind === "fill" || remaining === 0) {
        orders.delete(clientOrderId)
      } else {
        orders.set(clientOrderId, {
          ...existing,
          remaining_qty: remaining,
        })
      }
    }
  }
}

function applyPositionFill(
  position: { symbol: string; position_side: string; net_qty: number; avg_entry_price: number; state: string },
  body: JSONRecord,
  fillQty: number,
  avgFillPrice: number,
): void {
  if (fillQty <= 0) {
    return
  }
  const signedQty = stringField(body.side) === "SELL" ? -fillQty : fillQty
  const oldQty = position.net_qty
  const newQty = oldQty + signedQty
  position.symbol = stringField(body.symbol) || position.symbol
  position.position_side = stringField(body.position_side) || position.position_side

  if (oldQty === 0 || Math.sign(oldQty) === Math.sign(signedQty)) {
    const totalAbs = Math.abs(oldQty) + Math.abs(signedQty)
    position.avg_entry_price = totalAbs > 0
      ? ((Math.abs(oldQty) * position.avg_entry_price) + (Math.abs(signedQty) * avgFillPrice)) / totalAbs
      : 0
  } else if (newQty === 0) {
    position.avg_entry_price = 0
  } else if (Math.sign(newQty) !== Math.sign(oldQty)) {
    position.avg_entry_price = avgFillPrice
  }

  position.net_qty = newQty
}

function detectOpenActionGap(latestObserve: PlanEvent | null, events: PlanEvent[]): JSONRecord {
  if (!latestObserve) {
    return {
      exists: false,
      reason: "no_observe",
    }
  }
  const actionIntent = asRecord(latestObserve.body_json.action_intent)
  const targetAction = stringField(actionIntent.target_action) || "no_action"
  if (targetAction === "no_action") {
    return {
      exists: false,
      latest_observe_event_key: latestObserve.event_key,
      target_action: targetAction,
    }
  }
  const hasMatchingFill = events.some((event) => (
    event.kind === "order_fill"
    && stringField(event.body_json.source_observe_event_key) === latestObserve.event_key
  ))
  return {
    exists: !hasMatchingFill,
    latest_observe_event_key: latestObserve.event_key,
    target_action: targetAction,
    reason: hasMatchingFill ? "matched_order_fill" : "action_intent_without_order_fill",
  }
}

function readLatestOrderFill(db: Database, chainId: string): JSONRecord | null {
  const row = db.query(`
    SELECT event_key, chain_id, kind, body_json, created_at
    FROM plan_event
    WHERE chain_id = $chain_id AND kind = 'order_fill'
    ORDER BY created_at DESC
    LIMIT 1
  `).get({ $chain_id: chainId }) as {
    event_key: string
    chain_id: string
    kind: EventKind
    body_json: string
    created_at: string
  } | null
  if (!row) {
    return null
  }
  return {
    event_key: row.event_key,
    chain_id: row.chain_id,
    kind: row.kind,
    body_json: JSON.parse(row.body_json) as JSONRecord,
    created_at: row.created_at,
  }
}

function readRunMode(value: string): RunMode {
  if (value === "dry-run" || value === "shadow") {
    return value
  }
  throw new Error(`unsupported --mode ${value}`)
}

function readTargetAction(value: unknown): "no_action" | "place_entry" | "cancel_order" | "sync_protection" | "adjust_position" {
  const candidate = stringField(value)
  if (["no_action", "place_entry", "cancel_order", "sync_protection", "adjust_position"].includes(candidate)) {
    return candidate as "no_action" | "place_entry" | "cancel_order" | "sync_protection" | "adjust_position"
  }
  return "place_entry"
}

function buildOrderPlaceCommand(contract: ExecutionContract): string[] {
  const entry = contract.entries[0]
  const command = [
    "bun",
    "scripts/main.ts",
    "--symbol",
    contract.symbol,
    "--side",
    contract.side === "long" ? "BUY" : "SELL",
    "--type",
    entry.type,
    "--quantity",
    String(entry.quantity),
    "--position-side",
    contract.position_side,
    "--leverage",
    String(contract.target_leverage),
    "--new-client-order-id",
    entry.client_order_id,
    "--yes",
  ]
  if (entry.price != null) {
    command.push("--price", String(entry.price))
  }
  if (entry.stop_price != null) {
    command.push("--stop-price", String(entry.stop_price))
  }
  return command
}

function unwrapSkillResponse(value: unknown): JSONRecord {
  const response = asRecord(value)
  if (response.ok === false) {
    throw new Error(stringField(response.error) || "skill returned ok=false")
  }
  return asRecord(response.data ?? response)
}

function loadRuntime(accountConfigPath: string, strategiesDir: string): JSONRecord {
  const accountConfig = loadJsonFile(accountConfigPath)
  const strategies = loadStrategies(strategiesDir)
  return {
    account_config: accountConfig,
    strategies,
    loaded_at: new Date().toISOString(),
  }
}

async function observeFromSkills(input: JSONRecord): Promise<ObserveEvent> {
  const symbol = stringField(input.symbol)
  const repoRoot = stringField(input.repoRoot) || process.cwd()
  if (!symbol) {
    throw new Error("symbol is required")
  }
  const projections = await fetchObserveProjections({
    repoRoot,
    symbol,
    timeoutMs: Number(input.timeoutMs) || undefined,
  })
  return buildObserveEvent({
    chain_id: stringField(input.chain_id),
    symbol,
    side: readSide(input.side),
    strategy_ref: stringField(input.strategy_ref),
    setup_id: stringField(input.setup_id) || undefined,
    account_snapshot: projections.account_snapshot,
    market_snapshot: projections.market_snapshot,
    market_refs: projections.market_refs,
    plan_seed: asRecord(input.plan_seed),
    created_at: stringField(input.created_at) || undefined,
  })
}

async function runShadowFromSkills(
  db: Database,
  input: JSONRecord,
  runner?: Runner,
): Promise<JSONRecord> {
  const observe = await observeFromSkillsWithRunner(input, runner)
  const contractInput = {
    ...asRecord(input.execution_contract_input),
    source_observe_event_key: observe.event_key,
    chain_id: observe.chain_id,
    symbol: stringField(observe.body_json.symbol),
    side: stringField(observe.body_json.side),
    setup_id: stringField(observe.body_json.setup_id) || stringField(asRecord(input.execution_contract_input).setup_id),
  }
  return runOneFlowStep(db, {
    ...input,
    observe: observe.body_json,
    execution_contract_input: contractInput,
  }, "shadow")
}

async function runLiveSmall(
  db: Database,
  input: JSONRecord,
  yes: boolean,
  runner: Runner = runJsonCommand,
): Promise<JSONRecord> {
  if (!yes) {
    throw new Error("--run-live-small requires --yes")
  }

  const preflightResult = evaluatePreflight({
    plan: asRecord(input.plan),
    observe: asRecord(input.observe),
    strategy: asRecord(input.strategy),
    account_config: asRecord(input.account_config),
    target_action: readTargetAction(input.target_action),
    request: asRecord(input.request),
    aggregate_view: asRecord(input.aggregate_view),
    runtime_health: asRecord(input.runtime_health),
    now: stringField(input.now) || undefined,
  })
  if (preflightResult.verdict !== "armable") {
    return {
      mode: "live-small",
      preflight_result: preflightResult,
      recorded: false,
    }
  }

  const contract = compileExecutionContract(asRecord(input.execution_contract_input) as unknown as ExecutionContractInput)
  const repoRoot = stringField(input.repoRoot) || process.cwd()
  const execution = await runner(buildOrderPlaceCommand(contract), {
    cwd: `${repoRoot}/.agents/skills/binance-order-place`,
  })
  if (!execution.ok) {
    throw new Error(`live-small execution failed: ${execution.error}`)
  }

  const executionResult = unwrapSkillResponse(execution.data)
  const event = buildRecordedExecutionEvent({
    event_key: stringField(input.event_key),
    created_at: stringField(input.created_at),
    preflight_result: preflightResult,
    execution_contract_input: input.execution_contract_input,
    execution_result: executionResult,
  })
  appendPlanEvent(db, event)
  return {
    mode: "live-small",
    preflight_result: preflightResult,
    execution_contract: contract,
    execution_result: executionResult,
    order_fill_event: event,
    latest_order_fill: readLatestOrderFill(db, contract.chain_id),
    recorded: true,
  }
}

async function reconcileFromSkills(
  db: Database,
  chainId: string,
  input: JSONRecord,
  runner: Runner = runJsonCommand,
): Promise<JSONRecord> {
  const localEvents = readFlowEvents(db, chainId)
  const localState = reduceFlowState(db, chainId)
  const symbol = stringField(input.symbol) || inferFlowSymbol(localEvents, localState)
  if (!symbol) {
    throw new Error("symbol is required")
  }
  const repoRoot = stringField(input.repoRoot) || process.cwd()
  const historyLimit = Number(input.historyLimit) || 50
  const snapshot = await runner([
    "bun",
    "scripts/main.ts",
    "--symbol",
    symbol,
    "--include-history",
    "--history-limit",
    String(historyLimit),
  ], {
    cwd: `${repoRoot}/.agents/skills/binance-account-snapshot`,
  })
  if (!snapshot.ok) {
    throw new Error(`reconcile snapshot failed: ${snapshot.error}`)
  }
  const accountSnapshot = unwrapSkillResponse(snapshot.data)
  return buildReconcileDrafts({
    chain_id: chainId,
    local_events: localEvents,
    local_state: localState,
    account_snapshot: accountSnapshot,
  }) as unknown as JSONRecord
}

async function cronRecoverFromSkills(
  db: Database,
  chainId: string,
  input: JSONRecord,
  yes: boolean,
  runner: Runner = runJsonCommand,
): Promise<JSONRecord> {
  const before = reduceFlowState(db, chainId)
  const reconcile = await reconcileFromSkills(db, chainId, input, runner)
  if (Array.isArray(reconcile.unmatched) && reconcile.unmatched.length > 0) {
    return {
      status: "abort_unmatched_reconcile",
      before,
      reconcile,
      after: before,
    }
  }
  const drafts = Array.isArray(reconcile.drafts) ? reconcile.drafts : []
  if (drafts.length === 0) {
    return {
      status: "recovered_noop",
      before,
      reconcile,
      after: before,
    }
  }
  if (input.apply_reconcile === true) {
    const apply_result = applyReconcileDrafts(db, reconcile, yes)
    return {
      status: "recovered_applied",
      before,
      reconcile,
      apply_result,
      after: reduceFlowState(db, chainId),
    }
  }
  return {
    status: "reconcile_draft_ready",
    before,
    reconcile,
    after: before,
  }
}

function inferFlowSymbol(events: PlanEvent[], localState: JSONRecord): string {
  for (let index = events.length - 1; index >= 0; index -= 1) {
    const symbol = stringField(events[index].body_json.symbol)
    if (symbol) {
      return symbol
    }
  }
  const position = asRecord(localState.current_position)
  return stringField(position.symbol)
}

async function observeFromSkillsWithRunner(input: JSONRecord, runner?: Runner): Promise<ObserveEvent> {
  const symbol = stringField(input.symbol)
  const repoRoot = stringField(input.repoRoot) || process.cwd()
  if (!symbol) {
    throw new Error("symbol is required")
  }
  const projections = await fetchObserveProjections({
    repoRoot,
    symbol,
    timeoutMs: Number(input.timeoutMs) || undefined,
  }, runner)
  return buildObserveEvent({
    chain_id: stringField(input.chain_id),
    symbol,
    side: readSide(input.side),
    strategy_ref: stringField(input.strategy_ref),
    setup_id: stringField(input.setup_id) || undefined,
    account_snapshot: projections.account_snapshot,
    market_snapshot: projections.market_snapshot,
    market_refs: projections.market_refs,
    plan_seed: asRecord(input.plan),
    created_at: stringField(input.created_at) || undefined,
  })
}

function readSide(value: unknown): "long" | "short" {
  const side = stringField(value)
  if (side === "long" || side === "short") {
    return side
  }
  throw new Error("side must be long or short")
}

export {
  appendPlanEvent,
  applyReconcileDrafts,
  buildOrderFillEvent,
  buildRecordedExecutionEvent,
  buildMockExecutionResult,
  cronRecoverFromSkills,
  ensureSchema,
  readFlowEvents,
  readLatestOrderFill,
  reduceFlowState,
  loadRuntime,
  observeFromSkills,
  observeFromSkillsWithRunner,
  run,
  reconcileFromSkills,
  runLiveSmall,
  runShadowFromSkills,
  runOneFlowStep,
  validateOrderFill,
  validatePlanEvent,
  type PlanEvent,
}

if (process.argv[1] && import.meta.url === new URL(process.argv[1], "file:").href) {
  void main()
}
