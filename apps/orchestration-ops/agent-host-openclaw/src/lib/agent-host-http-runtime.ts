import { Database } from "bun:sqlite"
import { mkdirSync, realpathSync } from "node:fs"
import { dirname, resolve, sep } from "node:path"
import {
  buildDatabaseIdentity,
  ensureDatabaseIdentity,
} from "../../../../contracts/runtime-core/src/database-identity"
import { ensureAgentRunStoreSchema } from "../../../ops-runtime-store/src/lib/agent-run-store"

export interface AgentHostHttpRuntimeInput {
  host: string
  port: number
  host_token_env: string
  gateway_token_env: string
  allowed_hosts: string[]
  repository_root: string
  ops_db: string
  gateway_url: string
  environment_id: string
}

export function parseAgentHostHttpRuntimeArgs(
  argv: string[],
  defaults: {
    port: number
    host_token_env: string
    argument_label: string
  },
): AgentHostHttpRuntimeInput {
  const values = new Map<string, string>()
  for (let index = 0; index < argv.length; index += 2) {
    const flag = argv[index]
    const value = argv[index + 1]
    if (!flag?.startsWith("--") || value == null) {
      throw new Error(`${defaults.argument_label} arguments must be --key value pairs`)
    }
    values.set(flag.slice(2), value)
  }
  const port = boundedPort(values.get("port") ?? String(defaults.port))
  const host = values.get("host") ?? "127.0.0.1"
  const configuredHosts = values.get("allowed-hosts")
  const allowedHosts = configuredHosts
    ? configuredHosts.split(",").map((item) => item.trim()).filter(Boolean)
    : [`127.0.0.1:${port}`, `localhost:${port}`]
  if (host === "0.0.0.0" && !configuredHosts) {
    throw new Error("private-container wildcard requires explicit --allowed-hosts")
  }
  return {
    host,
    port,
    host_token_env: environmentName(
      values.get("host-token-env") ?? defaults.host_token_env,
    ),
    gateway_token_env: environmentName(
      values.get("gateway-token-env") ?? "OPENCLAW_GATEWAY_TOKEN",
    ),
    allowed_hosts: allowedHosts,
    repository_root: values.get("repository-root")
      ?? process.env.TRADE_REPO_ROOT
      ?? process.cwd(),
    ops_db: repoPath(values.get("ops-db") ?? "data/ops_runtime.db"),
    gateway_url: httpUrl(
      values.get("gateway-url") ?? "http://127.0.0.1:18789",
    ),
    environment_id: values.get("environment-id")
      ?? process.env.TRADE_ENVIRONMENT_ID
      ?? "local:local",
  }
}

export function openAgentHostHttpRuntime(input: AgentHostHttpRuntimeInput): {
  repository_root: string
  host_token: string
  gateway_token: string
  db: Database
} {
  const repositoryRoot = realpathSync(resolve(input.repository_root))
  const databasePath = resolve(repositoryRoot, input.ops_db)
  assertInside(resolve(repositoryRoot, "data"), databasePath)
  mkdirSync(dirname(databasePath), { recursive: true, mode: 0o700 })
  const db = new Database(databasePath, { create: true })
  db.exec("PRAGMA journal_mode=WAL")
  db.exec("PRAGMA busy_timeout=5000")
  db.exec("PRAGMA foreign_keys=ON")
  ensureDatabaseIdentity(
    db,
    buildDatabaseIdentity(input.environment_id, "ops_runtime_store"),
  )
  ensureAgentRunStoreSchema(db)
  return {
    repository_root: repositoryRoot,
    host_token: requiredEnvironment(input.host_token_env),
    gateway_token: requiredEnvironment(input.gateway_token_env),
    db,
  }
}

export function installAgentHostShutdown(input: {
  stop_server(): Promise<unknown>
  close_host(): Promise<unknown>
  close_database(): void
}): void {
  let closing = false
  const shutdown = () => {
    if (closing) return
    closing = true
    void (async () => {
      await input.stop_server()
      await input.close_host()
      input.close_database()
      process.exit(0)
    })()
  }
  process.on("SIGINT", shutdown)
  process.on("SIGTERM", shutdown)
}

function requiredEnvironment(name: string): string {
  const value = process.env[name]
  if (!value) throw new Error(`required environment variable is missing: ${name}`)
  return value
}

function environmentName(value: string): string {
  if (!/^[A-Z][A-Z0-9_]{2,127}$/.test(value)) {
    throw new Error("Agent Host environment variable name is invalid")
  }
  return value
}

function boundedPort(value: string): number {
  const port = Number(value)
  if (!Number.isSafeInteger(port) || port < 0 || port > 65_535) {
    throw new Error("Agent Host port is invalid")
  }
  return port
}

function repoPath(value: string): string {
  if (!value || value.startsWith("/") || value.split("/").includes("..")) {
    throw new Error("Agent Host database path must be repository-relative")
  }
  return value
}

function httpUrl(value: string): string {
  const url = new URL(value)
  if (!["http:", "https:"].includes(url.protocol)
    || url.username || url.password || url.search || url.hash) {
    throw new Error("Agent Host Gateway URL is invalid")
  }
  return url.toString().replace(/\/$/, "")
}

function assertInside(root: string, path: string): void {
  if (path !== root && !path.startsWith(`${root}${sep}`)) {
    throw new Error("Agent Host database escaped data root")
  }
}
