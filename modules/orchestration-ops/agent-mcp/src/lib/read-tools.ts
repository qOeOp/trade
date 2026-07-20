import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import { assertProjectRuntimePath, repoRoot } from "../../../../contracts/runtime-core/src/paths"
import { executeOwnerCli, type OwnerCliCommand, type OwnerCliExecutor } from "./owner-cli"

type JSONRecord = Record<string, unknown>

interface ToolEntry extends JSONRecord {
  id: string
  domain: string
  intent: string[]
  capability_class: string[]
  purpose: string
  writes: Record<string, boolean>
}

interface ToolManifest {
  schema_version: string
  tools: ToolEntry[]
}

export interface ReadToolServiceOptions {
  root?: string
  execute?: OwnerCliExecutor
  catalogDbPath?: string
  rdStateDbPath?: string
  opsRuntimeDbPath?: string
}

export class ReadToolService {
  private readonly root: string
  private readonly execute: OwnerCliExecutor
  private readonly catalogDbPath: string
  private readonly rdStateDbPath: string
  private readonly opsRuntimeDbPath: string

  constructor(options: ReadToolServiceOptions = {}) {
    this.root = options.root ?? repoRoot()
    this.execute = options.execute ?? executeOwnerCli
    this.catalogDbPath = runtimePath(options.catalogDbPath ?? process.env.TRADE_MCP_CATALOG_DB ?? "data/data_catalog.db")
    this.rdStateDbPath = runtimePath(options.rdStateDbPath ?? process.env.TRADE_MCP_RD_STATE_DB ?? "data/rd_state.db")
    this.opsRuntimeDbPath = runtimePath(options.opsRuntimeDbPath ?? process.env.TRADE_MCP_OPS_DB ?? "data/ops_runtime.db")
  }

  searchTools(input: { query?: string; domain?: string; capability?: string; limit?: number }): JSONRecord {
    const manifest = this.readManifest()
    const queryTokens = tokens(input.query)
    const domain = normalized(input.domain)
    const capability = normalized(input.capability).toUpperCase()
    const limit = boundedLimit(input.limit, 20)
    const tools = manifest.tools
      .filter((tool) => !domain || normalized(tool.domain) === domain)
      .filter((tool) => !capability || tool.capability_class.includes(capability))
      .map((tool) => ({ tool, score: scoreTool(tool, queryTokens) }))
      .filter((item) => queryTokens.length === 0 || item.score > 0)
      .sort((left, right) => right.score - left.score || left.tool.id.localeCompare(right.tool.id))
      .slice(0, limit)
      .map(({ tool, score }) => ({
        tool_id: tool.id,
        domain: tool.domain,
        purpose: tool.purpose,
        intent: tool.intent,
        capability_class: tool.capability_class,
        mutates_registered_surfaces: Object.values(tool.writes).some(Boolean),
        score,
      }))
    return {
      schema_version: "trade.agent-mcp.tool-search-result.v1",
      query: { query: input.query ?? "", domain: input.domain ?? "", capability: input.capability ?? "", limit },
      tools,
      execution_note: "Discovery does not authorize execution; only explicitly registered MCP tools are callable through this server.",
    }
  }

  readTool(toolId: string): JSONRecord {
    const manifest = this.readManifest()
    const tool = manifest.tools.find((candidate) => candidate.id === toolId)
    if (!tool) throw new Error(`tool not found: ${toolId}`)
    return {
      schema_version: "trade.agent-mcp.tool-read-result.v1",
      tool,
      mcp_execution_available: false,
      execution_note: "This response describes the registered capability; it does not execute the command.",
    }
  }

  queryArtifactCatalog(input: {
    path?: string
    artifact_id?: string
    symbol?: string
    strategy_id?: string
    report_kind?: string
    limit?: number
  }): Promise<JSONRecord> {
    return this.runOwner({
      script: "modules/artifact-knowledge/artifact-catalog/src/scripts/main.ts",
      args: ["--catalog-query", "--catalog-db", this.catalogDbPath, "--json", JSON.stringify(clean(input))],
    })
  }

  readRdProgram(programId = "rd-program"): Promise<JSONRecord> {
    return this.runOwner({
      script: "modules/research-strategy-development/research-control-plane/program-control/src/scripts/main.ts",
      args: ["--db", this.rdStateDbPath, "--program-id", programId, "--json", "{\"action\":\"read\"}"],
    })
  }

  readOpsCycleSummary(cycleId: string): Promise<JSONRecord> {
    return this.runOwner({
      script: "modules/orchestration-ops/ops-runtime-store/src/scripts/main.ts",
      args: ["--db", this.opsRuntimeDbPath, "--action", "summary", "--json", JSON.stringify({ cycle_id: cycleId })],
    })
  }

  private readManifest(): ToolManifest {
    const raw = JSON.parse(readFileSync(resolve(this.root, "toolset.json"), "utf8")) as ToolManifest
    if (raw.schema_version !== "trade-toolset.manifest.v1" || !Array.isArray(raw.tools)) {
      throw new Error("unsupported toolset manifest")
    }
    return raw
  }

  private runOwner(command: OwnerCliCommand): Promise<JSONRecord> {
    return this.execute(command)
  }
}

function runtimePath(path: string): string {
  assertProjectRuntimePath(path)
  return path
}

function clean(input: JSONRecord): JSONRecord {
  return Object.fromEntries(Object.entries(input).filter(([, value]) => value !== undefined && value !== ""))
}

function tokens(value: unknown): string[] {
  return normalized(value).split(/[^a-z0-9_-]+/).filter(Boolean)
}

function normalized(value: unknown): string {
  return typeof value === "string" ? value.trim().toLowerCase() : ""
}

function scoreTool(tool: ToolEntry, queryTokens: string[]): number {
  if (queryTokens.length === 0) return 1
  const id = tool.id.toLowerCase()
  const domain = tool.domain.toLowerCase()
  const intent = tool.intent.join(" ").toLowerCase()
  const purpose = tool.purpose.toLowerCase()
  return queryTokens.reduce((score, token) => score
    + (id === token ? 20 : id.includes(token) ? 10 : 0)
    + (domain.includes(token) ? 5 : 0)
    + (intent.includes(token) ? 4 : 0)
    + (purpose.includes(token) ? 2 : 0), 0)
}

function boundedLimit(value: number | undefined, fallback: number): number {
  if (!Number.isInteger(value) || (value ?? 0) <= 0) return fallback
  return Math.min(value as number, 50)
}
