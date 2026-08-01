import { resolve } from "node:path"
import {
  asRecord,
} from "../../../../../contracts/runtime-core/src/json"
import {
  workerAbsolutePath,
  workerRepoPath,
} from "../../../../../contracts/runtime-core/src/resident-worker"

export {
  resolveWorkerDataPath,
  workerAbsolutePath,
  workerBoundedInteger,
  workerClearReady,
  workerDelay,
  workerFlagValues,
  workerMarkReady,
  workerRepoPath,
  workerWriteState,
} from "../../../../../contracts/runtime-core/src/resident-worker"

export function workerResearchMarketDataPaths(
  values: ReadonlyMap<string, string>,
  runtimeDirectory: string,
): {
  repository_root: string
  research_db: string
  market_data_db: string
  ohlcv_db: string
  ready_file: string
  state_file: string
} {
  return {
    repository_root: values.get("repository-root")
      || process.env.TRADE_REPO_ROOT
      || process.cwd(),
    research_db: workerRepoPath(
      values.get("research-db")
        || process.env.TRADE_RD_STATE_DB
        || "data/rd_state.db",
      "research_db",
    ),
    market_data_db: workerRepoPath(
      values.get("market-data-db")
        || process.env.TRADE_MARKET_DATA_DB
        || "data/market_data.db",
      "market_data_db",
    ),
    ohlcv_db: workerRepoPath(
      values.get("ohlcv-db")
        || process.env.TRADE_OHLCV_DB
        || "data/ohlcv.db",
      "ohlcv_db",
    ),
    ready_file: workerAbsolutePath(
      values.get("ready-file")
        || `/app/tmp/runtime/${runtimeDirectory}/ready`,
      "ready_file",
    ),
    state_file: workerAbsolutePath(
      values.get("state-file")
        || `/app/tmp/runtime/${runtimeDirectory}/state.json`,
      "state_file",
    ),
  }
}

export async function workerMarketDataOwnerCommand(input: {
  root: string
  market_data_db: string
  ohlcv_db: string
  action: string
  json: Record<string, unknown>
  timeout_ms: number
  set_child: (
    child: ReturnType<typeof Bun.spawn>,
  ) => void
}): Promise<Record<string, unknown>> {
  const child = Bun.spawn({
    cmd: [
      process.execPath,
      resolve(
        input.root,
        "apps/market-data-products/market-data-store/src/scripts/main.ts",
      ),
      "--db",
      input.market_data_db,
      "--ohlcv-db",
      input.ohlcv_db,
      "--action",
      input.action,
      "--json",
      JSON.stringify(input.json),
    ],
    cwd: input.root,
    stdin: "ignore",
    stdout: "pipe",
    stderr: "pipe",
  })
  input.set_child(child)
  let timedOut = false
  const timer = setTimeout(() => {
    timedOut = true
    child.kill("SIGTERM")
  }, input.timeout_ms)
  try {
    const [stdout, _stderr, exitCode] = await Promise.all([
      new Response(child.stdout).text(),
      new Response(child.stderr).text(),
      child.exited,
    ])
    if (timedOut) throw new Error("market-data owner command timed out")
    if (exitCode !== 0) {
      throw new Error("market-data owner command failed")
    }
    const response = asRecord(JSON.parse(stdout))
    if (response.ok !== true || response.action !== input.action) {
      throw new Error("market-data owner response identity drifted")
    }
    return response
  } finally {
    clearTimeout(timer)
  }
}
