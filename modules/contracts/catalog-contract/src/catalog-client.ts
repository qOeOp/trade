import { spawnSync } from "node:child_process"
import { dirname, join } from "node:path"
import { displayPath, repoRoot, resolveRepoPath } from "../../runtime-core/src/paths"

type JSONRecord = Record<string, unknown>

interface CatalogRegisterArtifactInput {
  catalogDbPath?: string
  path: string
  now?: string | Date
  maxHashBytes?: number
  referrerType?: string
  referrerID?: string
  role?: string
}

interface CatalogRegisterArtifactResult extends JSONRecord {
  catalog_db_path: string
  artifact_id: string
  path: string
}

interface CatalogStoredRecordInput {
  catalogDbPath: string
  record: JSONRecord
  now?: string | Date
}

function registerCatalogArtifact(input: CatalogRegisterArtifactInput): CatalogRegisterArtifactResult {
  return runArtifactCatalog("--catalog-register-artifact", {
    catalog_db_path: input.catalogDbPath,
    path: input.path,
    now: isoDate(input.now),
    max_hash_bytes: input.maxHashBytes,
    referrer_type: input.referrerType,
    referrer_id: input.referrerID,
    role: input.role,
  }) as CatalogRegisterArtifactResult
}

function upsertCatalogStrategyEvidence(input: CatalogStoredRecordInput): { catalog_db_path: string; evidence_id: string } {
  return runArtifactCatalog("--catalog-upsert-strategy-evidence", {
    catalog_db_path: input.catalogDbPath,
    record: input.record,
    now: isoDate(input.now),
  }) as { catalog_db_path: string; evidence_id: string }
}

function listCatalogStrategyEvidence(input: { catalogDbPath: string; strategyID?: string; limit?: number }): JSONRecord[] {
  return runArtifactCatalog("--catalog-list-strategy-evidence", {
    catalog_db_path: input.catalogDbPath,
    strategy_id: input.strategyID,
    limit: input.limit,
  }) as JSONRecord[]
}

function upsertCatalogStrategyRndRun(input: CatalogStoredRecordInput): { catalog_db_path: string; run_id: string } {
  return runArtifactCatalog("--catalog-upsert-strategy-rnd-run", {
    catalog_db_path: input.catalogDbPath,
    record: input.record,
    now: isoDate(input.now),
  }) as { catalog_db_path: string; run_id: string }
}

function listCatalogStrategyRndRuns(input: { catalogDbPath: string; limit?: number }): JSONRecord[] {
  return runArtifactCatalog("--catalog-list-strategy-rnd-runs", {
    catalog_db_path: input.catalogDbPath,
    limit: input.limit,
  }) as JSONRecord[]
}

function defaultCatalogDbPathForGeneratedPath(path: string): string {
  const rel = displayPath(path)
  if (!rel.startsWith("../")) {
    return "./data/data_catalog.db"
  }
  return join(dirname(resolveRepoPath(path)), "data_catalog.db")
}

function runArtifactCatalog(flag: string, payload: JSONRecord): unknown {
  const result = spawnSync("bun", ["modules/ops/artifact-catalog/src/scripts/main.ts", flag, "--json", JSON.stringify(clean(payload))], {
    cwd: repoRoot(),
    encoding: "utf8",
  })
  const parsed = parseJson(result.stdout)
  if (result.status !== 0 || !parsed.ok) {
    const message = typeof parsed.error === "string" ? parsed.error : result.stderr.trim() || `artifact-catalog ${flag} failed`
    throw new Error(message)
  }
  return parsed.data
}

function clean(value: JSONRecord): JSONRecord {
  return Object.fromEntries(Object.entries(value).filter(([, item]) => item !== undefined))
}

function parseJson(raw: string): JSONRecord {
  const parsed = JSON.parse(raw)
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("artifact-catalog returned non-object JSON")
  }
  return parsed as JSONRecord
}

function isoDate(value: string | Date | undefined): string | undefined {
  if (!value) return undefined
  return value instanceof Date ? value.toISOString() : value
}

export {
  defaultCatalogDbPathForGeneratedPath,
  listCatalogStrategyEvidence,
  listCatalogStrategyRndRuns,
  registerCatalogArtifact,
  upsertCatalogStrategyEvidence,
  upsertCatalogStrategyRndRun,
}
