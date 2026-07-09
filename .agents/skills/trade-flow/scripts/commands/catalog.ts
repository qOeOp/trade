import { initDataCatalog, listStaleCatalogArtifacts, queryDataCatalog, scanDataCatalog } from "../lib/data-catalog"
import { successResponse } from "./response"
import type { CommandConfig, ScriptResponse } from "./types"

export function handleCatalogCommand(config: CommandConfig): ScriptResponse | null {
  if (config.catalogInit) {
    return successResponse(initDataCatalog(config.catalogDbPath))
  }
  if (config.catalogScan) {
    return successResponse(scanDataCatalog({
      catalogDbPath: config.catalogDbPath,
      roots: catalogRoots(config),
    }))
  }
  if (config.catalogQuery) {
    return successResponse(queryDataCatalog({
      catalogDbPath: config.catalogDbPath,
      path: stringField(config.input.path),
      artifactID: stringField(config.input.artifact_id),
      symbol: stringField(config.input.symbol),
      strategyID: stringField(config.input.strategy_id),
      reportKind: stringField(config.input.report_kind),
      limit: numberField(config.input.limit),
    }))
  }
  if (config.catalogStale || config.catalogGc) {
    return successResponse(listStaleCatalogArtifacts({
      catalogDbPath: config.catalogDbPath,
      roots: catalogRoots(config),
      retentionHours: config.retentionHours ?? numberField(config.input.retention_hours),
      ephemeralRetentionHours: config.ephemeralRetentionHours ?? numberField(config.input.ephemeral_retention_hours),
      now: stringField(config.input.now),
      limit: numberField(config.input.limit),
      yes: config.catalogGc ? config.yes : false,
    }))
  }
  return null
}

function catalogRoots(config: CommandConfig): string[] {
  const roots = config.catalogRoots.length > 0 ? config.catalogRoots : readStringArray(config.input.roots)
  return roots.length > 0 ? roots : ["./data"]
}

function readStringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string" && item.trim().length > 0) : []
}

function stringField(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : undefined
}

function numberField(value: unknown): number | undefined {
  const number = Number(value)
  return Number.isFinite(number) ? number : undefined
}
