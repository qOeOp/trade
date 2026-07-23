import {
  existsSync,
  mkdirSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs"
import { dirname, resolve, sep } from "node:path"

export function resolveWorkerDataPath(
  root: string,
  value: string,
  label: string,
): string {
  const path = resolve(root, value)
  const dataRoot = resolve(root, "data")
  if (path !== dataRoot && !path.startsWith(`${dataRoot}${sep}`)) {
    throw new Error(`${label} escaped data root`)
  }
  return path
}

export function workerRepoPath(value: string, field: string): string {
  if (!value || value.startsWith("/") || value.split("/").includes("..")
      || value.includes("\0")) {
    throw new Error(`${field} is invalid`)
  }
  return value
}

export function workerAbsolutePath(value: string, field: string): string {
  if (!value.startsWith("/") || value.includes("\0") || value.length > 512) {
    throw new Error(`${field} is invalid`)
  }
  return value
}

export function workerBoundedInteger(
  value: string,
  minimum: number,
  maximum: number,
  field: string,
): number {
  const number = Number(value)
  if (!Number.isSafeInteger(number) || number < minimum || number > maximum) {
    throw new Error(`${field} is invalid`)
  }
  return number
}

export function workerDelay(milliseconds: number): Promise<void> {
  return new Promise((resolveDelay) => setTimeout(resolveDelay, milliseconds))
}

export function workerMarkReady(path: string): void {
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 })
  if (existsSync(path)) rmSync(path)
  writeFileSync(path, "ready\n", { flag: "wx", mode: 0o600 })
}

export function workerClearReady(path: string): void {
  if (existsSync(path)) rmSync(path)
}

export function workerWriteState(
  path: string,
  value: Readonly<Record<string, unknown>>,
): void {
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 })
  const temporary = `${path}.${process.pid}.tmp`
  writeFileSync(temporary, `${JSON.stringify(value)}\n`, { mode: 0o600 })
  renameSync(temporary, path)
}

export function workerFlagValues(
  argv: string[],
  allowed: ReadonlySet<string>,
  label: string,
): Map<string, string> {
  const values = new Map<string, string>()
  for (let index = 0; index < argv.length; index += 2) {
    const flag = argv[index]
    const value = argv[index + 1]
    if (!flag?.startsWith("--") || value == null) {
      throw new Error(`${label} arguments must be --key value pairs`)
    }
    const key = flag.slice(2)
    if (!allowed.has(key)) throw new Error(`unknown argument: ${flag}`)
    if (values.has(key)) throw new Error(`duplicate argument: ${flag}`)
    values.set(key, value)
  }
  return values
}

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
