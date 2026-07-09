import { createHash } from "node:crypto"
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync } from "node:fs"
import { dirname, extname, join, resolve } from "node:path"
import { Database } from "bun:sqlite"
import { displayPath } from "./paths"

type JSONRecord = Record<string, unknown>
type SQLiteBindingValue = string | number | boolean | null

interface CatalogScanInput {
  catalogDbPath: string
  roots: string[]
  now?: string | Date
  maxHashBytes?: number
}

interface CatalogScanResult {
  catalog_db_path: string
  roots: string[]
  scanned_files: number
  artifacts_upserted: number
  datasets_upserted: number
  runs_upserted: number
  artifact_refs_upserted: number
  strategy_rnd_runs_upserted: number
  strategy_evidence_upserted: number
  panels_upserted: number
  panel_members_upserted: number
  feature_reports_upserted: number
  cron_runs_upserted: number
  research_reports_upserted: number
}

interface CatalogQueryInput {
  catalogDbPath: string
  path?: string
  artifactID?: string
  symbol?: string
  strategyID?: string
  reportKind?: string
  limit?: number
}

interface CatalogStaleInput {
  catalogDbPath: string
  roots?: string[]
  retentionHours?: number
  ephemeralRetentionHours?: number
  now?: string | Date
  limit?: number
  yes?: boolean
}

interface CatalogRegisterArtifactInput {
  catalogDbPath?: string
  path: string
  now?: string | Date
  maxHashBytes?: number
  referrerType?: string
  referrerID?: string
  role?: string
}

interface CatalogRegisterArtifactResult {
  catalog_db_path: string
  artifact_id: string
  path: string
  artifacts_upserted: number
  artifact_refs_upserted: number
  datasets_upserted: number
  runs_upserted: number
  strategy_rnd_runs_upserted: number
  strategy_evidence_upserted: number
  panels_upserted: number
  panel_members_upserted: number
  feature_reports_upserted: number
  research_reports_upserted: number
}

interface CatalogQueryResult {
  catalog_db_path: string
  query: {
    path?: string
    artifact_id?: string
    symbol?: string
    strategy_id?: string
    report_kind?: string
    limit: number
  }
  artifacts: JSONRecord[]
  datasets: JSONRecord[]
  feature_reports: JSONRecord[]
  research_reports: JSONRecord[]
  panels: JSONRecord[]
  refs: JSONRecord[]
  strategy_evidence: JSONRecord[]
}

interface CatalogStoredRecordInput {
  catalogDbPath: string
  record: JSONRecord
  now?: string | Date
}

interface CatalogStaleResult {
  catalog_db_path: string
  mode: "dry-run" | "delete"
  roots: string[]
  retention_hours: number
  ephemeral_retention_hours: number
  limit: number
  candidate_count: number
  kept_count: number
  deleted_count: number
  candidates: JSONRecord[]
  kept: JSONRecord[]
  deleted: JSONRecord[]
}

const DATA_CATALOG_SCHEMA_VERSION = 3
const DEFAULT_MAX_HASH_BYTES = 50 * 1024 * 1024
const DEFAULT_MAX_PARSE_BYTES = 40 * 1024 * 1024
const DEFAULT_RETENTION_HOURS = 168
const DEFAULT_EPHEMERAL_RETENTION_HOURS = 24
const SKIP_DIRS = new Set([".git", "node_modules", ".venv", "__pycache__"])

function initDataCatalog(catalogDbPath: string): { initialized: true; catalog_db_path: string } {
  mkdirSync(dirname(catalogDbPath), { recursive: true })
  const db = new Database(catalogDbPath)
  try {
    ensureDataCatalogSchema(db)
  } finally {
    db.close()
  }
  return { initialized: true, catalog_db_path: displayPath(catalogDbPath) }
}

function scanDataCatalog(input: CatalogScanInput): CatalogScanResult {
  const catalogDbPath = input.catalogDbPath || "./data/data_catalog.db"
  const roots = (input.roots.length > 0 ? input.roots : ["./data"]).map((root) => resolve(root))
  const now = input.now ? new Date(input.now) : new Date()
  if (!Number.isFinite(now.getTime())) {
    throw new Error("catalog scan now must be a valid date")
  }

  mkdirSync(dirname(catalogDbPath), { recursive: true })
  const db = new Database(catalogDbPath)
  const result: CatalogScanResult = {
    catalog_db_path: displayPath(catalogDbPath),
    roots: roots.map((root) => displayPath(root)),
    scanned_files: 0,
    artifacts_upserted: 0,
    datasets_upserted: 0,
    runs_upserted: 0,
    artifact_refs_upserted: 0,
    strategy_rnd_runs_upserted: 0,
    strategy_evidence_upserted: 0,
    panels_upserted: 0,
    panel_members_upserted: 0,
    feature_reports_upserted: 0,
    research_reports_upserted: 0,
    cron_runs_upserted: 0,
  }

  try {
    ensureDataCatalogSchema(db)
    const scanOne = db.transaction((files: string[]) => {
      for (const path of files) {
        result.scanned_files += 1
        const artifact = artifactRecord(path, input.maxHashBytes ?? DEFAULT_MAX_HASH_BYTES, now)
        upsertArtifact(db, artifact)
        result.artifacts_upserted += 1

        addExtractionCounts(result, extractArtifactMetadata(db, artifact.artifact_id, path, now))
      }
    })
    for (const root of roots) {
      if (!existsSync(root)) {
        continue
      }
      scanOne(walkFiles(root).filter((path) => resolve(path) !== resolve(catalogDbPath)))
    }
  } finally {
    db.close()
  }
  return result
}

function registerCatalogArtifact(input: CatalogRegisterArtifactInput): CatalogRegisterArtifactResult {
  const catalogDbPath = input.catalogDbPath || defaultCatalogDbPathForGeneratedPath(input.path)
  const now = input.now ? new Date(input.now) : new Date()
  if (!Number.isFinite(now.getTime())) {
    throw new Error("catalog register now must be a valid date")
  }
  mkdirSync(dirname(catalogDbPath), { recursive: true })
  const db = new Database(catalogDbPath)
  try {
    ensureDataCatalogSchema(db)
    const artifact = artifactRecord(input.path, input.maxHashBytes ?? DEFAULT_MAX_HASH_BYTES, now)
    upsertArtifact(db, artifact)
    const counts = extractArtifactMetadata(db, artifact.artifact_id, input.path, now)
    let refs = counts.artifactRefs
    if (input.referrerType && input.referrerID) {
      upsertArtifactRef(db, input.referrerType, input.referrerID, artifact.artifact_id, input.role || "output", now)
      refs += 1
    }
    return {
      catalog_db_path: displayPath(catalogDbPath),
      artifact_id: artifact.artifact_id,
      path: artifact.path,
      artifacts_upserted: 1,
      artifact_refs_upserted: refs,
      datasets_upserted: counts.datasets,
      runs_upserted: counts.runs,
      strategy_rnd_runs_upserted: counts.strategyRndRuns,
      strategy_evidence_upserted: counts.strategyEvidence,
      panels_upserted: counts.panels,
      panel_members_upserted: counts.panelMembers,
      feature_reports_upserted: counts.featureReports,
      research_reports_upserted: counts.researchReports,
    }
  } finally {
    db.close()
  }
}

function upsertCatalogStrategyEvidence(input: CatalogStoredRecordInput): { catalog_db_path: string; evidence_id: string } {
  const now = input.now ? new Date(input.now) : new Date()
  if (!Number.isFinite(now.getTime())) {
    throw new Error("strategy evidence catalog now must be a valid date")
  }
  mkdirSync(dirname(input.catalogDbPath), { recursive: true })
  const db = new Database(input.catalogDbPath)
  try {
    ensureDataCatalogSchema(db)
    const evidenceID = upsertStrategyEvidenceRecord(db, input.record, artifactIDForPath(db, stringField(input.record.source_ref)), now)
    return { catalog_db_path: displayPath(input.catalogDbPath), evidence_id: evidenceID }
  } finally {
    db.close()
  }
}

function listCatalogStrategyEvidence(input: { catalogDbPath: string; strategyID?: string; limit?: number }): JSONRecord[] {
  const limit = boundedLimit(input.limit, 1000)
  mkdirSync(dirname(input.catalogDbPath), { recursive: true })
  const db = new Database(input.catalogDbPath)
  try {
    ensureDataCatalogSchema(db)
    const rows = input.strategyID
      ? db.query(`
        SELECT evidence_id, strategy_id, kind, source_ref, artifact_id, created_at, summary_json, record_json
        FROM strategy_evidence
        WHERE strategy_id = $strategy_id
        ORDER BY created_at ASC
        LIMIT $limit
      `).all({ $strategy_id: input.strategyID, $limit: limit }) as JSONRecord[]
      : db.query(`
        SELECT evidence_id, strategy_id, kind, source_ref, artifact_id, created_at, summary_json, record_json
        FROM strategy_evidence
        ORDER BY created_at ASC
        LIMIT $limit
      `).all({ $limit: limit }) as JSONRecord[]
    return rows.map(recordFromStoredRow)
  } finally {
    db.close()
  }
}

function upsertCatalogStrategyRndRun(input: CatalogStoredRecordInput): { catalog_db_path: string; run_id: string } {
  const now = input.now ? new Date(input.now) : new Date()
  if (!Number.isFinite(now.getTime())) {
    throw new Error("strategy R&D catalog now must be a valid date")
  }
  mkdirSync(dirname(input.catalogDbPath), { recursive: true })
  const db = new Database(input.catalogDbPath)
  try {
    ensureDataCatalogSchema(db)
    const runID = upsertStrategyRndRunRecord(db, input.record, artifactIDForPath(db, stringField(input.record.artifact_ref)), now).runID
    return { catalog_db_path: displayPath(input.catalogDbPath), run_id: runID }
  } finally {
    db.close()
  }
}

function listCatalogStrategyRndRuns(input: { catalogDbPath: string; limit?: number }): JSONRecord[] {
  const limit = boundedLimit(input.limit, 1000)
  mkdirSync(dirname(input.catalogDbPath), { recursive: true })
  const db = new Database(input.catalogDbPath)
  try {
    ensureDataCatalogSchema(db)
    const rows = db.query(`
      SELECT sr.run_id, sr.strategy_id, sr.candidate_id, sr.family, sr.stage, sr.accepted, sr.holdout_key, sr.artifact_id, run.started_at AS created_at, run.summary_json, sr.record_json
      FROM strategy_rnd_run sr
      JOIN run ON run.run_id = sr.run_id
      ORDER BY run.started_at ASC
      LIMIT $limit
    `).all({ $limit: limit }) as JSONRecord[]
    return rows.map(recordFromStoredRow)
  } finally {
    db.close()
  }
}

function defaultCatalogDbPathForGeneratedPath(path: string): string {
  const rel = displayPath(path)
  if (!rel.startsWith("../")) {
    return "./data/data_catalog.db"
  }
  return join(dirname(resolve(path)), "data_catalog.db")
}

function queryDataCatalog(input: CatalogQueryInput): CatalogQueryResult {
  const limit = boundedLimit(input.limit)
  const query = {
    path: input.path ? displayPath(input.path) : undefined,
    artifact_id: input.artifactID || undefined,
    symbol: input.symbol || undefined,
    strategy_id: input.strategyID || undefined,
    report_kind: input.reportKind || undefined,
    limit,
  }
  const db = new Database(input.catalogDbPath)
  try {
    ensureDataCatalogSchema(db)
    const artifactIDs = new Set<string>()
    const artifacts = listArtifactsForQuery(db, query, limit)
    for (const artifact of artifacts) {
      const artifactID = stringField(artifact.artifact_id)
      if (artifactID) artifactIDs.add(artifactID)
    }
    const datasets = listDatasetsForQuery(db, query, limit)
    for (const dataset of datasets) {
      for (const artifact of artifactsByPath(db, stringField(dataset.manifest_path), limit)) {
        const artifactID = stringField(artifact.artifact_id)
        if (artifactID) artifactIDs.add(artifactID)
      }
    }
    const featureReports = listFeatureReportsForQuery(db, query, limit)
    for (const report of featureReports) {
      const artifactID = stringField(report.artifact_id)
      if (artifactID) artifactIDs.add(artifactID)
    }
    const researchReports = listResearchReportsForQuery(db, query, limit)
    for (const report of researchReports) {
      const artifactID = stringField(report.artifact_id)
      if (artifactID) artifactIDs.add(artifactID)
    }
    const panels = listPanelsForQuery(db, query, limit)
    for (const panel of panels) {
      const artifactID = stringField(panel.artifact_id)
      if (artifactID) artifactIDs.add(artifactID)
    }
    const evidence = listStrategyEvidenceForQuery(db, query, limit)
    for (const item of evidence) {
      const artifactID = stringField(item.artifact_id)
      if (artifactID) artifactIDs.add(artifactID)
    }

    return {
      catalog_db_path: displayPath(input.catalogDbPath),
      query,
      artifacts,
      datasets,
      feature_reports: featureReports,
      research_reports: researchReports,
      panels,
      refs: listRefsForArtifacts(db, [...artifactIDs], limit),
      strategy_evidence: evidence,
    }
  } finally {
    db.close()
  }
}

function listStaleCatalogArtifacts(input: CatalogStaleInput): CatalogStaleResult {
  const retentionHours = input.retentionHours ?? DEFAULT_RETENTION_HOURS
  if (!Number.isFinite(retentionHours) || retentionHours <= 0) {
    throw new Error("retentionHours must be a positive number")
  }
  const ephemeralRetentionHours = input.ephemeralRetentionHours ?? Math.min(DEFAULT_EPHEMERAL_RETENTION_HOURS, retentionHours)
  if (!Number.isFinite(ephemeralRetentionHours) || ephemeralRetentionHours <= 0) {
    throw new Error("ephemeralRetentionHours must be a positive number")
  }
  const now = input.now ? new Date(input.now) : new Date()
  if (!Number.isFinite(now.getTime())) {
    throw new Error("catalog stale now must be a valid date")
  }

  const roots = (input.roots ?? []).map((root) => displayPath(root)).filter(Boolean)
  const limit = boundedLimit(input.limit, 500)
  const candidates: JSONRecord[] = []
  const kept: JSONRecord[] = []
  const deleted: JSONRecord[] = []
  let candidateCount = 0
  let keptCount = 0
  let deletedCount = 0
  const db = new Database(input.catalogDbPath)
  try {
    ensureDataCatalogSchema(db)
    const rows = db.query(`
      SELECT
        a.artifact_id,
        a.path,
        a.type,
        a.bytes,
        a.retention_class,
        a.created_at,
        a.summary_json,
        count(r.artifact_id) AS ref_count
      FROM artifact a
      LEFT JOIN artifact_ref r ON r.artifact_id = a.artifact_id
      GROUP BY a.artifact_id
      ORDER BY a.created_at ASC
    `).all() as JSONRecord[]

    for (const row of rows) {
      const item = staleDecision(row, now, retentionHours, ephemeralRetentionHours, roots)
      if (stringField(item.record.reason) === "outside_requested_roots") {
        continue
      }
      if (item.candidate) {
        candidateCount += 1
        if (candidates.length < limit) candidates.push(item.record)
        if (input.yes) {
          const deletedRecord = deleteCatalogArtifactCandidate(db, item.record, now)
          deletedCount += 1
          if (deleted.length < limit) deleted.push(deletedRecord)
        }
      } else if (kept.length < limit) {
        keptCount += 1
        kept.push(item.record)
      } else {
        keptCount += 1
      }
    }
  } finally {
    db.close()
  }

  return {
    catalog_db_path: displayPath(input.catalogDbPath),
    mode: input.yes ? "delete" : "dry-run",
    roots,
    retention_hours: retentionHours,
    ephemeral_retention_hours: ephemeralRetentionHours,
    limit,
    candidate_count: candidateCount,
    kept_count: keptCount,
    deleted_count: deletedCount,
    candidates,
    kept,
    deleted,
  }
}

function deleteCatalogArtifactCandidate(db: Database, record: JSONRecord, now: Date): JSONRecord {
  const artifactID = stringField(record.artifact_id)
  const path = stringField(record.path)
  const existed = record.exists === true
  if (existed && path) {
    rmSync(resolve(path), { force: true })
  }
  if (artifactID) {
    db.query("DELETE FROM artifact_ref WHERE artifact_id = $artifact_id").run({ $artifact_id: artifactID })
    db.query("DELETE FROM strategy_rnd_run WHERE artifact_id = $artifact_id").run({ $artifact_id: artifactID })
    db.query("DELETE FROM strategy_evidence WHERE artifact_id = $artifact_id").run({ $artifact_id: artifactID })
    db.query("DELETE FROM panel_member WHERE artifact_id = $artifact_id").run({ $artifact_id: artifactID })
    db.query("DELETE FROM feature_report WHERE artifact_id = $artifact_id").run({ $artifact_id: artifactID })
    db.query("DELETE FROM research_report WHERE artifact_id = $artifact_id").run({ $artifact_id: artifactID })
  }
  if (path) {
    db.query("DELETE FROM panel_member WHERE manifest_path = $path OR funding_report_path = $path").run({ $path: path })
    db.query("DELETE FROM dataset WHERE manifest_path = $path").run({ $path: path })
    db.query("DELETE FROM panel WHERE manifest_path = $path").run({ $path: path })
  }
  if (artifactID) {
    db.query("DELETE FROM artifact WHERE artifact_id = $artifact_id").run({ $artifact_id: artifactID })
  }
  pruneCatalogOrphans(db)
  return {
    ...record,
    deleted_at: now.toISOString(),
    existed,
  }
}

function pruneCatalogOrphans(db: Database): void {
  db.run(`
    DELETE FROM dataset
    WHERE NOT EXISTS (
      SELECT 1 FROM artifact a WHERE a.path = dataset.manifest_path
    )
  `)
  db.run(`
    DELETE FROM panel_member
    WHERE artifact_id IS NOT NULL
      AND NOT EXISTS (
        SELECT 1 FROM artifact a WHERE a.artifact_id = panel_member.artifact_id
      )
  `)
  db.run(`
    DELETE FROM panel_member
    WHERE manifest_path IS NOT NULL
      AND NOT EXISTS (
        SELECT 1 FROM artifact a WHERE a.path = panel_member.manifest_path
      )
  `)
  db.run(`
    DELETE FROM panel
    WHERE NOT EXISTS (
      SELECT 1 FROM artifact a WHERE a.path = panel.manifest_path
    )
  `)
}

function ensureDataCatalogSchema(db: Database): void {
  db.run(`
    CREATE TABLE IF NOT EXISTS schema_migration (
      component  TEXT PRIMARY KEY,
      version    INTEGER NOT NULL,
      applied_at TEXT NOT NULL
    )
  `)
  db.run(`
    CREATE TABLE IF NOT EXISTS run (
      run_id       TEXT PRIMARY KEY,
      kind         TEXT NOT NULL,
      status       TEXT NOT NULL,
      started_at   TEXT NOT NULL,
      ended_at     TEXT,
      input_hash   TEXT,
      summary_json TEXT CHECK(summary_json IS NULL OR json_valid(summary_json))
    )
  `)
  db.run(`
    CREATE TABLE IF NOT EXISTS dataset (
      dataset_id    TEXT PRIMARY KEY,
      kind          TEXT NOT NULL,
      symbol        TEXT,
      timeframe     TEXT,
      source        TEXT,
      first_ts      INTEGER,
      last_ts       INTEGER,
      rows          INTEGER,
      content_hash  TEXT,
      manifest_path TEXT NOT NULL,
      created_at    TEXT NOT NULL
    )
  `)
  db.run(`
    CREATE TABLE IF NOT EXISTS artifact (
      artifact_id     TEXT PRIMARY KEY,
      path            TEXT NOT NULL UNIQUE,
      type            TEXT NOT NULL,
      bytes           INTEGER NOT NULL,
      content_hash    TEXT,
      schema_id       TEXT,
      retention_class TEXT NOT NULL,
      created_at      TEXT NOT NULL,
      summary_json    TEXT CHECK(summary_json IS NULL OR json_valid(summary_json))
    )
  `)
  db.run(`
    CREATE TABLE IF NOT EXISTS artifact_ref (
      referrer_type TEXT NOT NULL,
      referrer_id   TEXT NOT NULL,
      artifact_id   TEXT NOT NULL,
      role          TEXT NOT NULL,
      created_at    TEXT NOT NULL,
      PRIMARY KEY (referrer_type, referrer_id, artifact_id, role),
      FOREIGN KEY (artifact_id) REFERENCES artifact(artifact_id)
    )
  `)
  db.run(`
    CREATE TABLE IF NOT EXISTS strategy_rnd_run (
      run_id       TEXT PRIMARY KEY,
      strategy_id  TEXT,
      candidate_id TEXT,
      family       TEXT,
      stage        TEXT,
      accepted     INTEGER NOT NULL CHECK(accepted IN (0, 1)),
      holdout_key  TEXT,
      artifact_id  TEXT,
      record_json  TEXT CHECK(record_json IS NULL OR json_valid(record_json)),
      FOREIGN KEY (run_id) REFERENCES run(run_id),
      FOREIGN KEY (artifact_id) REFERENCES artifact(artifact_id)
    )
  `)
  db.run(`
    CREATE TABLE IF NOT EXISTS strategy_evidence (
      evidence_id  TEXT PRIMARY KEY,
      strategy_id  TEXT NOT NULL,
      setup_id     TEXT,
      kind         TEXT NOT NULL,
      policy_hash  TEXT,
      source_ref   TEXT NOT NULL,
      artifact_id  TEXT,
      created_at   TEXT NOT NULL,
      summary_json TEXT CHECK(summary_json IS NULL OR json_valid(summary_json)),
      record_json  TEXT CHECK(record_json IS NULL OR json_valid(record_json)),
      FOREIGN KEY (artifact_id) REFERENCES artifact(artifact_id)
    )
  `)
  ensureColumn(db, "strategy_rnd_run", "record_json", "ALTER TABLE strategy_rnd_run ADD COLUMN record_json TEXT CHECK(record_json IS NULL OR json_valid(record_json))")
  ensureColumn(db, "strategy_evidence", "setup_id", "ALTER TABLE strategy_evidence ADD COLUMN setup_id TEXT")
  ensureColumn(db, "strategy_evidence", "policy_hash", "ALTER TABLE strategy_evidence ADD COLUMN policy_hash TEXT")
  ensureColumn(db, "strategy_evidence", "record_json", "ALTER TABLE strategy_evidence ADD COLUMN record_json TEXT CHECK(record_json IS NULL OR json_valid(record_json))")
  db.run(`
    CREATE TABLE IF NOT EXISTS panel (
      panel_id      TEXT PRIMARY KEY,
      purpose       TEXT,
      timeframe     TEXT,
      dataset_count INTEGER,
      symbol_count  INTEGER,
      manifest_path TEXT NOT NULL,
      created_at    TEXT NOT NULL,
      summary_json  TEXT CHECK(summary_json IS NULL OR json_valid(summary_json))
    )
  `)
  db.run(`
    CREATE TABLE IF NOT EXISTS panel_member (
      panel_id            TEXT NOT NULL,
      dataset_id          TEXT NOT NULL,
      symbol              TEXT,
      manifest_path       TEXT,
      funding_report_path TEXT,
      rows                INTEGER,
      first_ts            INTEGER,
      last_ts             INTEGER,
      artifact_id         TEXT,
      PRIMARY KEY (panel_id, dataset_id),
      FOREIGN KEY (artifact_id) REFERENCES artifact(artifact_id)
    )
  `)
  db.run(`
    CREATE TABLE IF NOT EXISTS feature_report (
      artifact_id       TEXT PRIMARY KEY,
      symbol            TEXT,
      exchange          TEXT,
      source_manifest   TEXT,
      generated_at      TEXT,
      indicator_count   INTEGER,
      timeframe_count   INTEGER,
      has_market_events INTEGER NOT NULL CHECK(has_market_events IN (0, 1)),
      summary_json      TEXT CHECK(summary_json IS NULL OR json_valid(summary_json)),
      FOREIGN KEY (artifact_id) REFERENCES artifact(artifact_id)
    )
  `)
  db.run(`
    CREATE TABLE IF NOT EXISTS research_report (
      artifact_id  TEXT PRIMARY KEY,
      report_kind  TEXT NOT NULL,
      report_id    TEXT NOT NULL,
      status       TEXT,
      generated_at TEXT,
      summary_json TEXT CHECK(summary_json IS NULL OR json_valid(summary_json)),
      FOREIGN KEY (artifact_id) REFERENCES artifact(artifact_id)
    )
  `)
  db.query(`
    INSERT INTO schema_migration(component, version, applied_at)
    VALUES ('data_catalog', $version, $applied_at)
    ON CONFLICT(component) DO UPDATE SET
      version = max(version, excluded.version),
      applied_at = excluded.applied_at
  `).run({ $version: DATA_CATALOG_SCHEMA_VERSION, $applied_at: new Date().toISOString() })
  db.run("CREATE INDEX IF NOT EXISTS idx_artifact_retention ON artifact(retention_class, created_at)")
  db.run("CREATE INDEX IF NOT EXISTS idx_dataset_symbol_timeframe ON dataset(symbol, timeframe, last_ts DESC)")
  db.run("CREATE INDEX IF NOT EXISTS idx_strategy_evidence_strategy ON strategy_evidence(strategy_id, created_at DESC)")
  db.run("CREATE INDEX IF NOT EXISTS idx_panel_member_symbol ON panel_member(symbol)")
  db.run("CREATE INDEX IF NOT EXISTS idx_feature_report_symbol ON feature_report(symbol, generated_at DESC)")
  db.run("CREATE INDEX IF NOT EXISTS idx_research_report_kind ON research_report(report_kind, generated_at DESC)")
}

function ensureColumn(db: Database, table: string, column: string, ddl: string): void {
  const rows = db.query(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>
  if (!rows.some((row) => row.name === column)) {
    db.run(ddl)
  }
}

interface ArtifactExtractionCounts {
  datasets: number
  runs: number
  artifactRefs: number
  strategyRndRuns: number
  strategyEvidence: number
  panels: number
  panelMembers: number
  featureReports: number
  researchReports: number
  cronRuns: number
}

function emptyExtractionCounts(): ArtifactExtractionCounts {
  return {
    datasets: 0,
    runs: 0,
    artifactRefs: 0,
    strategyRndRuns: 0,
    strategyEvidence: 0,
    panels: 0,
    panelMembers: 0,
    featureReports: 0,
    researchReports: 0,
    cronRuns: 0,
  }
}

function extractArtifactMetadata(db: Database, artifactID: string, path: string, now: Date): ArtifactExtractionCounts {
  const counts = emptyExtractionCounts()
  const json = readJsonIfSmall(path)
  counts.datasets += upsertDatasetsFromManifest(db, path, json, now)
  const panel = upsertPanelFromJson(db, artifactID, path, json, now)
  counts.panels += panel.panels
  counts.panelMembers += panel.members
  counts.featureReports += upsertFeatureReport(db, artifactID, json)
  counts.researchReports += upsertResearchReport(db, artifactID, path, json, now)
  const rndRecord = upsertRndLedgerRecordFromArtifact(db, artifactID, path, json, now)
  counts.strategyRndRuns += rndRecord.runs
  counts.runs += rndRecord.runRows
  counts.artifactRefs += rndRecord.refs
  const runUpsert = upsertRunFromArtifact(db, artifactID, path, json, now)
  counts.runs += runUpsert.runs
  counts.artifactRefs += runUpsert.refs

  if (path.endsWith("cron.log")) {
    const cron = upsertCronLogRuns(db, artifactID, path, now)
    counts.cronRuns += cron.runs
    counts.runs += cron.runs
    counts.artifactRefs += cron.refs
  }
  if (path.endsWith("strategy-rnd-ledger.jsonl")) {
    const ledger = upsertRndLedger(db, path, now)
    counts.strategyRndRuns += ledger.runs
    counts.runs += ledger.runRows
    counts.artifactRefs += ledger.refs
  }
  if (path.endsWith("strategy-evidence.jsonl")) {
    const evidence = upsertEvidenceLedger(db, path, now)
    counts.strategyEvidence += evidence.evidence
    counts.artifactRefs += evidence.refs
  }
  return counts
}

function addExtractionCounts(result: CatalogScanResult, counts: ArtifactExtractionCounts): void {
  result.datasets_upserted += counts.datasets
  result.runs_upserted += counts.runs
  result.artifact_refs_upserted += counts.artifactRefs
  result.strategy_rnd_runs_upserted += counts.strategyRndRuns
  result.strategy_evidence_upserted += counts.strategyEvidence
  result.panels_upserted += counts.panels
  result.panel_members_upserted += counts.panelMembers
  result.feature_reports_upserted += counts.featureReports
  result.research_reports_upserted += counts.researchReports
  result.cron_runs_upserted += counts.cronRuns
}

function artifactRecord(path: string, maxHashBytes: number, now: Date): {
  artifact_id: string
  path: string
  type: string
  bytes: number
  content_hash: string | null
  schema_id: string | null
  retention_class: string
  created_at: string
  summary_json: string
} {
  const stat = statSync(path)
  const relPath = displayPath(path)
  const contentHash = stat.size <= maxHashBytes ? sha256File(path) : null
  const summary = {
    mtime: stat.mtime.toISOString(),
    hash_skipped: contentHash === null,
  }
  return {
    artifact_id: stableID("artifact", relPath),
    path: relPath,
    type: artifactType(path),
    bytes: stat.size,
    content_hash: contentHash,
    schema_id: schemaIDFor(path),
    retention_class: retentionClassFor(relPath),
    created_at: now.toISOString(),
    summary_json: JSON.stringify(summary),
  }
}

function upsertArtifact(db: Database, artifact: ReturnType<typeof artifactRecord>): void {
  db.query(`
    INSERT INTO artifact(artifact_id, path, type, bytes, content_hash, schema_id, retention_class, created_at, summary_json)
    VALUES ($artifact_id, $path, $type, $bytes, $content_hash, $schema_id, $retention_class, $created_at, $summary_json)
    ON CONFLICT(path) DO UPDATE SET
      type = excluded.type,
      bytes = excluded.bytes,
      content_hash = excluded.content_hash,
      schema_id = excluded.schema_id,
      retention_class = excluded.retention_class,
      summary_json = excluded.summary_json
  `).run(bind(artifact))
}

function upsertDatasetsFromManifest(db: Database, path: string, json: JSONRecord | null, now: Date): number {
  if (!json) return 0
  const relPath = displayPath(path)
  let count = 0
  const symbol = stringField(json.symbol)
  const source = stringField(asRecord(json.source).provider) || stringField(json.exchange)
  const timeframes = asRecord(json.timeframes)
  for (const [timeframe, raw] of Object.entries(timeframes)) {
    const entry = asRecord(raw)
    const dataset = {
      dataset_id: stableID("dataset", `${relPath}:${timeframe}`),
      kind: "ohlcv",
      symbol,
      timeframe,
      source,
      first_ts: nullableNumber(entry.first_open_ts),
      last_ts: nullableNumber(entry.last_open_ts),
      rows: nullableNumber(entry.rows),
      content_hash: nullableString(entry.content_sha256),
      manifest_path: relPath,
      created_at: now.toISOString(),
    }
    upsertDataset(db, dataset)
    count += 1
  }

  const panelDatasets = asArray(json.datasets)
  if (panelDatasets.length > 0) {
    upsertDataset(db, {
      dataset_id: stableID("dataset", `${relPath}:panel`),
      kind: "panel",
      symbol: null,
      timeframe: null,
      source: "panel-manifest",
      first_ts: null,
      last_ts: null,
      rows: panelDatasets.length,
      content_hash: null,
      manifest_path: relPath,
      created_at: now.toISOString(),
    })
    count += 1
  }
  return count
}

function upsertPanelFromJson(db: Database, artifactID: string, path: string, json: JSONRecord | null, now: Date): { panels: number; members: number } {
  if (!json) return { panels: 0, members: 0 }
  const datasets = asArray(json.datasets).map(asRecord)
  if (datasets.length === 0) return { panels: 0, members: 0 }

  const relPath = displayPath(path)
  const panelID = stringField(json.panel_id) || stableID("panel", relPath)
  db.query(`
    INSERT INTO panel(panel_id, purpose, timeframe, dataset_count, symbol_count, manifest_path, created_at, summary_json)
    VALUES ($panel_id, $purpose, $timeframe, $dataset_count, $symbol_count, $manifest_path, $created_at, $summary_json)
    ON CONFLICT(panel_id) DO UPDATE SET
      purpose = excluded.purpose,
      timeframe = excluded.timeframe,
      dataset_count = excluded.dataset_count,
      symbol_count = excluded.symbol_count,
      manifest_path = excluded.manifest_path,
      summary_json = excluded.summary_json
  `).run({
    $panel_id: panelID,
    $purpose: nullableString(json.purpose),
    $timeframe: nullableString(json.timeframe),
    $dataset_count: nullableNumber(json.dataset_count) ?? datasets.length,
    $symbol_count: nullableNumber(json.symbol_count),
    $manifest_path: relPath,
    $created_at: stringField(json.generated_at) || now.toISOString(),
    $summary_json: JSON.stringify({
      target_dataset_count: nullableNumber(json.target_dataset_count),
      since_ts: nullableNumber(json.since_ts),
      suite_input_path: nullableString(json.suite_input_path),
    }),
  })

  let members = 0
  for (const item of datasets) {
    const datasetID = stringField(item.dataset_id) || stringField(item.symbol) || stableID("dataset-member", JSON.stringify(item))
    db.query(`
      INSERT INTO panel_member(panel_id, dataset_id, symbol, manifest_path, funding_report_path, rows, first_ts, last_ts, artifact_id)
      VALUES ($panel_id, $dataset_id, $symbol, $manifest_path, $funding_report_path, $rows, $first_ts, $last_ts, $artifact_id)
      ON CONFLICT(panel_id, dataset_id) DO UPDATE SET
        symbol = excluded.symbol,
        manifest_path = excluded.manifest_path,
        funding_report_path = excluded.funding_report_path,
        rows = excluded.rows,
        first_ts = excluded.first_ts,
        last_ts = excluded.last_ts,
        artifact_id = excluded.artifact_id
    `).run({
      $panel_id: panelID,
      $dataset_id: datasetID,
      $symbol: nullableString(item.symbol),
      $manifest_path: nullableString(displayMaybePath(item.manifest_path)),
      $funding_report_path: nullableString(displayMaybePath(item.funding_report_path)),
      $rows: nullableNumber(item.rows),
      $first_ts: nullableNumber(item.first_open_ts),
      $last_ts: nullableNumber(item.last_open_ts),
      $artifact_id: artifactID,
    })
    members += 1
  }
  return { panels: 1, members }
}

function upsertFeatureReport(db: Database, artifactID: string, json: JSONRecord | null): number {
  if (!json) return 0
  const data = asRecord(json.data ?? json)
  if (!stringField(data.source_manifest) || Object.keys(asRecord(data.timeframes)).length === 0) {
    return 0
  }
  const selectedIndicators = asRecord(data.selected_indicators)
  db.query(`
    INSERT INTO feature_report(artifact_id, symbol, exchange, source_manifest, generated_at, indicator_count, timeframe_count, has_market_events, summary_json)
    VALUES ($artifact_id, $symbol, $exchange, $source_manifest, $generated_at, $indicator_count, $timeframe_count, $has_market_events, $summary_json)
    ON CONFLICT(artifact_id) DO UPDATE SET
      symbol = excluded.symbol,
      exchange = excluded.exchange,
      source_manifest = excluded.source_manifest,
      generated_at = excluded.generated_at,
      indicator_count = excluded.indicator_count,
      timeframe_count = excluded.timeframe_count,
      has_market_events = excluded.has_market_events,
      summary_json = excluded.summary_json
  `).run({
    $artifact_id: artifactID,
    $symbol: nullableString(data.symbol),
    $exchange: nullableString(data.exchange),
    $source_manifest: displayPath(stringField(data.source_manifest)),
    $generated_at: nullableString(data.generated_at),
    $indicator_count: Object.keys(selectedIndicators).length,
    $timeframe_count: Object.keys(asRecord(data.timeframes)).length,
    $has_market_events: Object.keys(asRecord(data.market_events)).length > 0 ? 1 : 0,
    $summary_json: JSON.stringify({
      summary: asRecord(data.summary),
      selected_indicators: Object.keys(selectedIndicators).sort(),
      market_feature_coverage: asRecord(data.market_feature_coverage),
    }),
  })
  return 1
}

function upsertResearchReport(db: Database, artifactID: string, path: string, json: JSONRecord | null, now: Date): number {
  if (!json) return 0
  const data = asRecord(json.data ?? json)
  const report = researchReportSummary(path, data, now)
  if (!report) return 0
  db.query(`
    INSERT INTO research_report(artifact_id, report_kind, report_id, status, generated_at, summary_json)
    VALUES ($artifact_id, $report_kind, $report_id, $status, $generated_at, $summary_json)
    ON CONFLICT(artifact_id) DO UPDATE SET
      report_kind = excluded.report_kind,
      report_id = excluded.report_id,
      status = excluded.status,
      generated_at = excluded.generated_at,
      summary_json = excluded.summary_json
  `).run({
    $artifact_id: artifactID,
    $report_kind: report.report_kind,
    $report_id: report.report_id,
    $status: report.status,
    $generated_at: report.generated_at,
    $summary_json: JSON.stringify(report.summary),
  })
  return 1
}

function researchReportSummary(path: string, data: JSONRecord, now: Date): {
  report_kind: string
  report_id: string
  status: string | null
  generated_at: string
  summary: JSONRecord
} | null {
  if (stringField(data.campaign_id)) {
    return {
      report_kind: "strategy_rnd_campaign",
      report_id: stringField(data.campaign_id),
      status: stringField(data.outcome) || stringField(data.stop_reason) || null,
      generated_at: stringField(data.created_at) || now.toISOString(),
      summary: {
        stop_reason: nullableString(data.stop_reason),
        trial_budget: nullableNumber(data.trial_budget),
        trials_used: nullableNumber(data.trials_used),
        hypotheses_run: nullableNumber(data.hypotheses_run),
        holdout_evaluations: nullableNumber(data.holdout_evaluations),
        validated_candidate: asRecord(data.validated_candidate),
      },
    }
  }
  if (stringField(data.run_id) && asRecord(data.batch).outcome) {
    const batch = asRecord(data.batch)
    const ledger = asRecord(data.ledger_record)
    return {
      report_kind: "strategy_rnd_loop",
      report_id: stringField(data.run_id),
      status: stringField(data.stop_reason) || stringField(batch.outcome) || null,
      generated_at: stringField(data.created_at) || now.toISOString(),
      summary: {
        batch_id: nullableString(batch.batch_id),
        hypothesis: nullableString(batch.hypothesis),
        candidate_source: nullableString(batch.candidate_source),
        trial_count: nullableNumber(batch.trial_count),
        accepted_count: nullableNumber(batch.accepted_count),
        winner_candidate_id: nullableString(asRecord(batch.winner).candidate_id) || nullableString(ledger.winner_candidate_id),
        stage: nullableString(ledger.stage),
        holdout_key: nullableString(ledger.holdout_key),
      },
    }
  }
  if (stringField(data.benchmark_id)) {
    return {
      report_kind: "strategy_benchmark",
      report_id: stringField(data.benchmark_id),
      status: data.calibrated === true ? "calibrated" : "blocked",
      generated_at: stringField(asRecord(data.period).last) || now.toISOString(),
      summary: {
        purpose: nullableString(data.purpose),
        calibrated: data.calibrated === true,
        blocked_by: asArray(data.blocked_by),
        dataset_count: asArray(data.datasets).length,
        period: asRecord(data.period),
        observed: asRecord(data.observed),
      },
    }
  }
  if (data.calibrated !== undefined && asRecord(data.failure_analysis).findings) {
    return {
      report_kind: "strategy_calibration_suite",
      report_id: stringField(data.suite_id) || stableID("calibration", path),
      status: data.calibrated === true ? "calibrated" : "blocked",
      generated_at: stringField(data.generated_at) || now.toISOString(),
      summary: {
        calibrated: data.calibrated === true,
        report_hash: nullableString(data.report_hash),
        finding_count: asArray(asRecord(data.failure_analysis).findings).length,
        data_panel: compactDataPanel(asRecord(data.data_panel)),
      },
    }
  }
  if (stringField(data.panel_id) && asArray(data.candidates).length > 0) {
    return {
      report_kind: "strategy_panel_rnd",
      report_id: stringField(data.panel_id),
      status: stringField(data.outcome) || null,
      generated_at: stringField(data.generated_at) || now.toISOString(),
      summary: {
        hypothesis: nullableString(data.hypothesis),
        diagnostic_mode: data.diagnostic_mode === true,
        dataset_count: nullableNumber(data.dataset_count),
        trial_count: nullableNumber(data.trial_count),
        accepted_count: asArray(data.candidates).map(asRecord).filter((candidate) => asRecord(candidate.gate).accepted === true).length,
      },
    }
  }
  if (stringField(data.tracker_id) && asArray(data.paper_positions).length >= 0 && data.schema_version === 1) {
    return {
      report_kind: "rd_shadow_tracker",
      report_id: stringField(data.tracker_id),
      status: stringField(data.status) || null,
      generated_at: stringField(data.updated_at) || stringField(data.created_at) || now.toISOString(),
      summary: {
        source_forward_holdout_result_ref: nullableString(data.source_forward_holdout_result_ref),
        summary: asRecord(data.summary),
      },
    }
  }
  return null
}

function compactDataPanel(panel: JSONRecord): JSONRecord {
  return {
    dataset_count: nullableNumber(panel.dataset_count),
    target_dataset_count: nullableNumber(panel.target_dataset_count),
    timeframe: nullableString(panel.timeframe),
    aligned_rows: nullableNumber(panel.aligned_rows),
    aligned_start: nullableString(panel.aligned_start),
    aligned_end: nullableString(panel.aligned_end),
    schema_version_ok: panel.schema_version_ok === true,
    closed_candles_only: panel.closed_candles_only === true,
  }
}

function upsertDataset(db: Database, dataset: Record<string, unknown>): void {
  db.query(`
    INSERT INTO dataset(dataset_id, kind, symbol, timeframe, source, first_ts, last_ts, rows, content_hash, manifest_path, created_at)
    VALUES ($dataset_id, $kind, $symbol, $timeframe, $source, $first_ts, $last_ts, $rows, $content_hash, $manifest_path, $created_at)
    ON CONFLICT(dataset_id) DO UPDATE SET
      kind = excluded.kind,
      symbol = excluded.symbol,
      timeframe = excluded.timeframe,
      source = excluded.source,
      first_ts = excluded.first_ts,
      last_ts = excluded.last_ts,
      rows = excluded.rows,
      content_hash = excluded.content_hash,
      manifest_path = excluded.manifest_path
  `).run(bind(dataset))
}

function upsertRunFromArtifact(db: Database, artifactID: string, path: string, json: JSONRecord | null, now: Date): { runs: number; refs: number } {
  if (!json) return { runs: 0, refs: 0 }
  const relPath = displayPath(path)
  const file = relPath.split("/").pop() || ""
  const track = file.startsWith("slow-track-") ? "slow_track" : file.startsWith("fast-track-") ? "fast_track" : ""
  if (!track) return { runs: 0, refs: 0 }
  const runID = stringField(json.run_id) || file.replace(/\.json$/, "")
  upsertRun(db, {
    run_id: runID,
    kind: track,
    status: stringField(json.status) || "completed",
    started_at: stringField(json.generated_at) || now.toISOString(),
    ended_at: stringField(json.generated_at) || now.toISOString(),
    input_hash: null,
    summary_json: JSON.stringify({
      track: stringField(json.track),
      mode: stringField(json.mode),
      active_flow_count: nullableNumber(json.active_flow_count),
    }),
  })
  upsertArtifactRef(db, "run", runID, artifactID, "output", now)
  return { runs: 1, refs: 1 }
}

function upsertRndLedger(db: Database, path: string, now: Date): { runs: number; runRows: number; refs: number } {
  let runs = 0
  let runRows = 0
  let refs = 0
  for (const record of readJsonLines(path)) {
    const artifactID = artifactIDForPath(db, stringField(record.artifact_ref))
    const { artifactRefInserted } = upsertStrategyRndRunRecord(db, record, artifactID, now)
    runRows += 1
    runs += 1
    refs += artifactRefInserted
  }
  return { runs, runRows, refs }
}

function upsertRndLedgerRecordFromArtifact(db: Database, artifactID: string, path: string, json: JSONRecord | null, now: Date): { runs: number; runRows: number; refs: number } {
  const record = asRecord(json?.ledger_record)
  if (!stringField(record.run_id)) {
    return { runs: 0, runRows: 0, refs: 0 }
  }
  upsertStrategyRndRunRecord(db, {
    ...record,
    artifact_ref: displayPath(path),
  }, artifactID, now)
  return { runs: 1, runRows: 1, refs: 1 }
}

function upsertEvidenceLedger(db: Database, path: string, now: Date): { evidence: number; refs: number } {
  let evidence = 0
  let refs = 0
  for (const record of readJsonLines(path)) {
    const artifactID = artifactIDForPath(db, stringField(record.source_ref))
    upsertStrategyEvidenceRecord(db, record, artifactID, now)
    refs += artifactID ? 1 : 0
    evidence += 1
  }
  return { evidence, refs }
}

function upsertStrategyRndRunRecord(db: Database, record: JSONRecord, artifactID: string | null, now: Date): { runID: string; artifactRefInserted: number } {
  const runID = stringField(record.run_id)
  if (!runID) {
    throw new Error("strategy R&D record requires run_id")
  }
  upsertRun(db, {
    run_id: runID,
    kind: "rnd",
    status: "completed",
    started_at: stringField(record.created_at) || now.toISOString(),
    ended_at: stringField(record.created_at) || now.toISOString(),
    input_hash: null,
    summary_json: JSON.stringify({
      outcome: stringField(record.outcome),
      trial_count: nullableNumber(record.trial_count),
      accepted_count: nullableNumber(record.accepted_count),
    }),
  })
  db.query(`
    INSERT INTO strategy_rnd_run(run_id, strategy_id, candidate_id, family, stage, accepted, holdout_key, artifact_id, record_json)
    VALUES ($run_id, $strategy_id, $candidate_id, $family, $stage, $accepted, $holdout_key, $artifact_id, $record_json)
    ON CONFLICT(run_id) DO UPDATE SET
      strategy_id = excluded.strategy_id,
      candidate_id = excluded.candidate_id,
      family = excluded.family,
      stage = excluded.stage,
      accepted = excluded.accepted,
      holdout_key = excluded.holdout_key,
      artifact_id = excluded.artifact_id,
      record_json = excluded.record_json
  `).run({
    $run_id: runID,
    $strategy_id: nullableString(record.strategy_id),
    $candidate_id: nullableString(record.winner_candidate_id),
    $family: nullableString(record.candidate_source),
    $stage: nullableString(record.stage),
    $accepted: Number(record.accepted_count) > 0 ? 1 : 0,
    $holdout_key: nullableString(record.holdout_key),
    $artifact_id: artifactID,
    $record_json: JSON.stringify(record),
  })
  if (artifactID) {
    upsertArtifactRef(db, "run", runID, artifactID, "ledger_record", now)
  }
  return { runID, artifactRefInserted: artifactID ? 1 : 0 }
}

function upsertStrategyEvidenceRecord(db: Database, record: JSONRecord, artifactID: string | null, now: Date): string {
  const evidenceID = stringField(record.evidence_id) || stableID("evidence", JSON.stringify(record))
  const strategyID = stringField(record.strategy_id)
  if (!strategyID) {
    throw new Error("strategy evidence record requires strategy_id")
  }
  db.query(`
    INSERT INTO strategy_evidence(evidence_id, strategy_id, setup_id, kind, policy_hash, source_ref, artifact_id, created_at, summary_json, record_json)
    VALUES ($evidence_id, $strategy_id, $setup_id, $kind, $policy_hash, $source_ref, $artifact_id, $created_at, $summary_json, $record_json)
    ON CONFLICT(evidence_id) DO UPDATE SET
      strategy_id = excluded.strategy_id,
      setup_id = excluded.setup_id,
      kind = excluded.kind,
      policy_hash = excluded.policy_hash,
      source_ref = excluded.source_ref,
      artifact_id = excluded.artifact_id,
      created_at = excluded.created_at,
      summary_json = excluded.summary_json,
      record_json = excluded.record_json
  `).run({
    $evidence_id: evidenceID,
    $strategy_id: strategyID,
    $setup_id: nullableString(record.setup_id),
    $kind: stringField(record.kind) || "unknown",
    $policy_hash: nullableString(record.policy_hash),
    $source_ref: stringField(record.source_ref) || "unknown",
    $artifact_id: artifactID,
    $created_at: stringField(record.created_at) || now.toISOString(),
    $summary_json: JSON.stringify({
      stats: asRecord(record.stats),
      gate: asRecord(record.gate),
      qualification: asRecord(record.qualification),
    }),
    $record_json: JSON.stringify({ ...record, evidence_id: evidenceID }),
  })
  if (artifactID) {
    upsertArtifactRef(db, "evidence", evidenceID, artifactID, "proof", now)
  }
  return evidenceID
}

function artifactIDForPath(db: Database, path: string): string | null {
  if (!path) return null
  const relPath = displayPath(path)
  const row = db.query(`
    SELECT artifact_id
    FROM artifact
    WHERE path = $path OR path = $rel_path
    LIMIT 1
  `).get({ $path: path, $rel_path: relPath }) as { artifact_id?: string } | null
  return row?.artifact_id || null
}

function recordFromStoredRow(row: JSONRecord): JSONRecord {
  const record = parseJsonObject(row.record_json)
  if (Object.keys(record).length > 0) return record
  const summary = parseJsonObject(row.summary_json)
  return {
    ...row,
    ...(Object.keys(summary).length > 0 ? summary : {}),
  }
}

function upsertCronLogRuns(db: Database, artifactID: string, path: string, now: Date): { runs: number; refs: number } {
  let runs = 0
  let refs = 0
  for (const record of readJsonLines(path)) {
    const runID = stringField(record.run_id)
    if (!runID) continue
    upsertRun(db, {
      run_id: runID,
      kind: stringField(record.track) ? `${stringField(record.track)}_track` : "cron",
      status: stringField(record.status) || "completed",
      started_at: stringField(record.triggered_at) || now.toISOString(),
      ended_at: null,
      input_hash: null,
      summary_json: JSON.stringify({
        duration_ms: nullableNumber(record.duration_ms),
        chains_processed: nullableNumber(record.chains_processed),
        actions_taken: asArray(record.actions_taken),
        errors: asArray(record.errors),
      }),
    })
    upsertArtifactRef(db, "run", runID, artifactID, "log", now)
    runs += 1
    refs += 1
  }
  return { runs, refs }
}

function upsertRun(db: Database, run: Record<string, unknown>): void {
  db.query(`
    INSERT INTO run(run_id, kind, status, started_at, ended_at, input_hash, summary_json)
    VALUES ($run_id, $kind, $status, $started_at, $ended_at, $input_hash, $summary_json)
    ON CONFLICT(run_id) DO UPDATE SET
      kind = excluded.kind,
      status = excluded.status,
      ended_at = excluded.ended_at,
      input_hash = excluded.input_hash,
      summary_json = excluded.summary_json
  `).run(bind(run))
}

function upsertArtifactRef(db: Database, referrerType: string, referrerID: string, artifactID: string, role: string, now: Date): void {
  db.query(`
    INSERT INTO artifact_ref(referrer_type, referrer_id, artifact_id, role, created_at)
    VALUES ($referrer_type, $referrer_id, $artifact_id, $role, $created_at)
    ON CONFLICT(referrer_type, referrer_id, artifact_id, role) DO UPDATE SET
      created_at = excluded.created_at
  `).run({
    $referrer_type: referrerType,
    $referrer_id: referrerID,
    $artifact_id: artifactID,
    $role: role,
    $created_at: now.toISOString(),
  })
}

function walkFiles(root: string): string[] {
  const files: string[] = []
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    if (SKIP_DIRS.has(entry.name)) continue
    const path = join(root, entry.name)
    if (entry.isSymbolicLink()) continue
    if (entry.isDirectory()) {
      files.push(...walkFiles(path))
    } else if (entry.isFile()) {
      files.push(path)
    }
  }
  return files
}

function readJsonIfSmall(path: string): JSONRecord | null {
  if (!path.endsWith(".json") || statSync(path).size > DEFAULT_MAX_PARSE_BYTES) return null
  try {
    return asRecord(JSON.parse(readFileSync(path, "utf8")))
  } catch {
    return null
  }
}

function readJsonLines(path: string): JSONRecord[] {
  return readFileSync(path, "utf8")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => asRecord(JSON.parse(line)))
}

function sha256File(path: string): string {
  return createHash("sha256").update(readFileSync(path)).digest("hex")
}

function stableID(prefix: string, value: string): string {
  return `${prefix}_${createHash("sha256").update(value).digest("hex").slice(0, 24)}`
}

function artifactType(path: string): string {
  const ext = extname(path).toLowerCase()
  if (ext === ".json") return "json"
  if (ext === ".jsonl") return "jsonl"
  if (ext === ".csv") return "csv"
  if (ext === ".db" || ext === ".sqlite" || ext === ".sqlite3") return "db"
  if (ext === ".log") return "log"
  return ext.replace(/^\./, "") || "file"
}

function retentionClassFor(path: string): string {
  if (path.includes("/tmp/") || path.startsWith("tmp/") || path.includes("/cache/")) return "ephemeral"
  if (path.endsWith(".db") || path.endsWith(".jsonl") || path.includes("/ledger/")) return "durable"
  if (path.includes("data/artifacts/") || path.includes("strategy-evidence")) return "evidence"
  return "reproducible"
}

function schemaIDFor(path: string): string | null {
  if (path.endsWith("cron.log")) return "trade-flow.cron-log-entry.v1"
  if (path.endsWith("strategy-evidence.jsonl")) return "trade-flow.strategy-evidence-record.v1"
  return null
}

function listArtifactsForQuery(db: Database, query: CatalogQueryResult["query"], limit: number): JSONRecord[] {
  const path = query.path || ""
  const artifactID = query.artifact_id || ""
  if (artifactID) {
    return db.query(`
      SELECT artifact_id, path, type, bytes, content_hash, schema_id, retention_class, created_at, summary_json
      FROM artifact
      WHERE artifact_id = $artifact_id
      LIMIT $limit
    `).all({ $artifact_id: artifactID, $limit: limit }) as JSONRecord[]
  }
  if (path) {
    return db.query(`
      SELECT artifact_id, path, type, bytes, content_hash, schema_id, retention_class, created_at, summary_json
      FROM artifact
      WHERE path = $path OR path LIKE $path_like
      ORDER BY created_at DESC
      LIMIT $limit
    `).all({ $path: path, $path_like: `%${path}%`, $limit: limit }) as JSONRecord[]
  }
  if (query.symbol) {
    return db.query(`
      SELECT DISTINCT a.artifact_id, a.path, a.type, a.bytes, a.content_hash, a.schema_id, a.retention_class, a.created_at, a.summary_json
      FROM artifact a
      LEFT JOIN dataset d ON d.manifest_path = a.path
      LEFT JOIN feature_report f ON f.artifact_id = a.artifact_id
      LEFT JOIN panel_member pm ON pm.artifact_id = a.artifact_id
      WHERE upper(replace(replace(replace(replace(coalesce(d.symbol, ''), '/', ''), ':', ''), '-', ''), '_', '')) LIKE $symbol_like
         OR upper(replace(replace(replace(replace(coalesce(f.symbol, ''), '/', ''), ':', ''), '-', ''), '_', '')) LIKE $symbol_like
         OR upper(replace(replace(replace(replace(coalesce(pm.symbol, ''), '/', ''), ':', ''), '-', ''), '_', '')) LIKE $symbol_like
         OR upper(replace(replace(replace(replace(coalesce(a.path, ''), '/', ''), ':', ''), '-', ''), '_', '')) LIKE $symbol_like
      ORDER BY a.created_at DESC
      LIMIT $limit
    `).all({ $symbol_like: `%${normalizeSymbol(query.symbol)}%`, $limit: limit }) as JSONRecord[]
  }
  if (query.strategy_id) {
    return db.query(`
      SELECT DISTINCT a.artifact_id, a.path, a.type, a.bytes, a.content_hash, a.schema_id, a.retention_class, a.created_at, a.summary_json
      FROM artifact a
      JOIN strategy_evidence e ON e.artifact_id = a.artifact_id
      WHERE e.strategy_id = $strategy_id
      ORDER BY a.created_at DESC
      LIMIT $limit
    `).all({ $strategy_id: query.strategy_id, $limit: limit }) as JSONRecord[]
  }
  if (query.report_kind) {
    return db.query(`
      SELECT DISTINCT a.artifact_id, a.path, a.type, a.bytes, a.content_hash, a.schema_id, a.retention_class, a.created_at, a.summary_json
      FROM artifact a
      JOIN research_report rr ON rr.artifact_id = a.artifact_id
      WHERE rr.report_kind = $report_kind
      ORDER BY a.created_at DESC
      LIMIT $limit
    `).all({ $report_kind: query.report_kind, $limit: limit }) as JSONRecord[]
  }
  return db.query(`
    SELECT artifact_id, path, type, bytes, content_hash, schema_id, retention_class, created_at, summary_json
    FROM artifact
    ORDER BY created_at DESC
    LIMIT $limit
  `).all({ $limit: limit }) as JSONRecord[]
}

function listDatasetsForQuery(db: Database, query: CatalogQueryResult["query"], limit: number): JSONRecord[] {
  if (query.report_kind) return []
  if (query.symbol) {
    return db.query(`
      SELECT dataset_id, kind, symbol, timeframe, source, first_ts, last_ts, rows, content_hash, manifest_path, created_at
      FROM dataset
      WHERE upper(replace(replace(replace(replace(coalesce(symbol, ''), '/', ''), ':', ''), '-', ''), '_', '')) LIKE $symbol_like
         OR upper(replace(replace(replace(replace(coalesce(manifest_path, ''), '/', ''), ':', ''), '-', ''), '_', '')) LIKE $symbol_like
      ORDER BY last_ts DESC, created_at DESC
      LIMIT $limit
    `).all({ $symbol_like: `%${normalizeSymbol(query.symbol)}%`, $limit: limit }) as JSONRecord[]
  }
  if (query.path) {
    return db.query(`
      SELECT dataset_id, kind, symbol, timeframe, source, first_ts, last_ts, rows, content_hash, manifest_path, created_at
      FROM dataset
      WHERE manifest_path = $path OR manifest_path LIKE $path_like
      ORDER BY last_ts DESC, created_at DESC
      LIMIT $limit
    `).all({ $path: query.path, $path_like: `%${query.path}%`, $limit: limit }) as JSONRecord[]
  }
  return db.query(`
    SELECT dataset_id, kind, symbol, timeframe, source, first_ts, last_ts, rows, content_hash, manifest_path, created_at
    FROM dataset
    ORDER BY created_at DESC
    LIMIT $limit
  `).all({ $limit: limit }) as JSONRecord[]
}

function listFeatureReportsForQuery(db: Database, query: CatalogQueryResult["query"], limit: number): JSONRecord[] {
  if (query.report_kind) return []
  if (query.symbol) {
    return db.query(`
      SELECT artifact_id, symbol, exchange, source_manifest, generated_at, indicator_count, timeframe_count, has_market_events, summary_json
      FROM feature_report
      WHERE upper(replace(replace(replace(replace(coalesce(symbol, ''), '/', ''), ':', ''), '-', ''), '_', '')) LIKE $symbol_like
         OR upper(replace(replace(replace(replace(coalesce(source_manifest, ''), '/', ''), ':', ''), '-', ''), '_', '')) LIKE $symbol_like
      ORDER BY generated_at DESC
      LIMIT $limit
    `).all({ $symbol_like: `%${normalizeSymbol(query.symbol)}%`, $limit: limit }) as JSONRecord[]
  }
  if (query.path) {
    return db.query(`
      SELECT artifact_id, symbol, exchange, source_manifest, generated_at, indicator_count, timeframe_count, has_market_events, summary_json
      FROM feature_report
      WHERE artifact_id IN (SELECT artifact_id FROM artifact WHERE path = $path OR path LIKE $path_like)
         OR source_manifest = $path
         OR source_manifest LIKE $path_like
      ORDER BY generated_at DESC
      LIMIT $limit
    `).all({ $path: query.path, $path_like: `%${query.path}%`, $limit: limit }) as JSONRecord[]
  }
  return db.query(`
    SELECT artifact_id, symbol, exchange, source_manifest, generated_at, indicator_count, timeframe_count, has_market_events, summary_json
    FROM feature_report
    ORDER BY generated_at DESC
    LIMIT $limit
  `).all({ $limit: limit }) as JSONRecord[]
}

function listResearchReportsForQuery(db: Database, query: CatalogQueryResult["query"], limit: number): JSONRecord[] {
  if (query.report_kind) {
    return db.query(`
      SELECT rr.artifact_id, rr.report_kind, rr.report_id, rr.status, rr.generated_at, rr.summary_json, a.path
      FROM research_report rr
      JOIN artifact a ON a.artifact_id = rr.artifact_id
      WHERE rr.report_kind = $report_kind
      ORDER BY rr.generated_at DESC
      LIMIT $limit
    `).all({ $report_kind: query.report_kind, $limit: limit }) as JSONRecord[]
  }
  if (query.path) {
    return db.query(`
      SELECT rr.artifact_id, rr.report_kind, rr.report_id, rr.status, rr.generated_at, rr.summary_json, a.path
      FROM research_report rr
      JOIN artifact a ON a.artifact_id = rr.artifact_id
      WHERE a.path = $path OR a.path LIKE $path_like
      ORDER BY rr.generated_at DESC
      LIMIT $limit
    `).all({ $path: query.path, $path_like: `%${query.path}%`, $limit: limit }) as JSONRecord[]
  }
  if (query.strategy_id) {
    return db.query(`
      SELECT rr.artifact_id, rr.report_kind, rr.report_id, rr.status, rr.generated_at, rr.summary_json, a.path
      FROM research_report rr
      JOIN artifact a ON a.artifact_id = rr.artifact_id
      WHERE rr.report_id LIKE $strategy_like OR rr.summary_json LIKE $strategy_like
      ORDER BY rr.generated_at DESC
      LIMIT $limit
    `).all({ $strategy_like: `%${query.strategy_id}%`, $limit: limit }) as JSONRecord[]
  }
  if (query.symbol) {
    return db.query(`
      SELECT rr.artifact_id, rr.report_kind, rr.report_id, rr.status, rr.generated_at, rr.summary_json, a.path
      FROM research_report rr
      JOIN artifact a ON a.artifact_id = rr.artifact_id
      WHERE upper(replace(replace(replace(replace(coalesce(a.path, ''), '/', ''), ':', ''), '-', ''), '_', '')) LIKE $symbol_like
         OR upper(replace(replace(replace(replace(coalesce(rr.summary_json, ''), '/', ''), ':', ''), '-', ''), '_', '')) LIKE $symbol_like
      ORDER BY rr.generated_at DESC
      LIMIT $limit
    `).all({ $symbol_like: `%${normalizeSymbol(query.symbol)}%`, $limit: limit }) as JSONRecord[]
  }
  return db.query(`
    SELECT rr.artifact_id, rr.report_kind, rr.report_id, rr.status, rr.generated_at, rr.summary_json, a.path
    FROM research_report rr
    JOIN artifact a ON a.artifact_id = rr.artifact_id
    ORDER BY rr.generated_at DESC
    LIMIT $limit
  `).all({ $limit: limit }) as JSONRecord[]
}

function listPanelsForQuery(db: Database, query: CatalogQueryResult["query"], limit: number): JSONRecord[] {
  if (query.report_kind) return []
  if (query.symbol) {
    return db.query(`
      SELECT p.panel_id, p.purpose, p.timeframe, p.dataset_count, p.symbol_count, p.manifest_path, p.created_at, pm.dataset_id, pm.symbol, pm.artifact_id
      FROM panel p
      JOIN panel_member pm ON pm.panel_id = p.panel_id
      WHERE upper(replace(replace(replace(replace(coalesce(pm.symbol, ''), '/', ''), ':', ''), '-', ''), '_', '')) LIKE $symbol_like
         OR upper(replace(replace(replace(replace(coalesce(pm.manifest_path, ''), '/', ''), ':', ''), '-', ''), '_', '')) LIKE $symbol_like
      ORDER BY p.created_at DESC
      LIMIT $limit
    `).all({ $symbol_like: `%${normalizeSymbol(query.symbol)}%`, $limit: limit }) as JSONRecord[]
  }
  if (query.path) {
    return db.query(`
      SELECT p.panel_id, p.purpose, p.timeframe, p.dataset_count, p.symbol_count, p.manifest_path, p.created_at, pm.dataset_id, pm.symbol, pm.artifact_id
      FROM panel p
      LEFT JOIN panel_member pm ON pm.panel_id = p.panel_id
      WHERE p.manifest_path = $path OR p.manifest_path LIKE $path_like OR pm.manifest_path LIKE $path_like
      ORDER BY p.created_at DESC
      LIMIT $limit
    `).all({ $path: query.path, $path_like: `%${query.path}%`, $limit: limit }) as JSONRecord[]
  }
  return db.query(`
    SELECT panel_id, purpose, timeframe, dataset_count, symbol_count, manifest_path, created_at, summary_json
    FROM panel
    ORDER BY created_at DESC
    LIMIT $limit
  `).all({ $limit: limit }) as JSONRecord[]
}

function listStrategyEvidenceForQuery(db: Database, query: CatalogQueryResult["query"], limit: number): JSONRecord[] {
  if (query.report_kind) return []
  if (query.strategy_id) {
    return db.query(`
      SELECT evidence_id, strategy_id, kind, source_ref, artifact_id, created_at, summary_json
      FROM strategy_evidence
      WHERE strategy_id = $strategy_id
      ORDER BY created_at DESC
      LIMIT $limit
    `).all({ $strategy_id: query.strategy_id, $limit: limit }) as JSONRecord[]
  }
  if (query.path) {
    return db.query(`
      SELECT e.evidence_id, e.strategy_id, e.kind, e.source_ref, e.artifact_id, e.created_at, e.summary_json
      FROM strategy_evidence e
      LEFT JOIN artifact a ON a.artifact_id = e.artifact_id
      WHERE a.path = $path OR a.path LIKE $path_like OR e.source_ref = $path OR e.source_ref LIKE $path_like
      ORDER BY e.created_at DESC
      LIMIT $limit
    `).all({ $path: query.path, $path_like: `%${query.path}%`, $limit: limit }) as JSONRecord[]
  }
  return []
}

function artifactsByPath(db: Database, path: string, limit: number): JSONRecord[] {
  if (!path) return []
  const relPath = displayPath(path)
  return db.query(`
    SELECT artifact_id, path
    FROM artifact
    WHERE path = $path OR path = $rel_path
    LIMIT $limit
  `).all({ $path: path, $rel_path: relPath, $limit: limit }) as JSONRecord[]
}

function listRefsForArtifacts(db: Database, artifactIDs: string[], limit: number): JSONRecord[] {
  if (artifactIDs.length === 0) return []
  const refs: JSONRecord[] = []
  for (const artifactID of artifactIDs.slice(0, limit)) {
    refs.push(...db.query(`
      SELECT referrer_type, referrer_id, artifact_id, role, created_at
      FROM artifact_ref
      WHERE artifact_id = $artifact_id
      ORDER BY created_at DESC
      LIMIT $limit
    `).all({ $artifact_id: artifactID, $limit: limit }) as JSONRecord[])
    if (refs.length >= limit) break
  }
  return refs.slice(0, limit)
}

function staleDecision(
  row: JSONRecord,
  now: Date,
  retentionHours: number,
  ephemeralRetentionHours: number,
  roots: string[],
): { candidate: boolean; record: JSONRecord } {
  const path = stringField(row.path)
  const retentionClass = stringField(row.retention_class) || "reproducible"
  const refCount = Number(row.ref_count) || 0
  const exists = path ? existsSync(resolve(path)) : false
  const ageHours = roundHours((now.getTime() - artifactMtime(row).getTime()) / 3_600_000)
  const rootMatched = roots.length === 0 || roots.some((root) => path === root || path.startsWith(`${root}/`))
  const record = {
    artifact_id: stringField(row.artifact_id),
    path,
    type: stringField(row.type),
    bytes: Number(row.bytes) || 0,
    age_hours: ageHours,
    retention_class: retentionClass,
    ref_count: refCount,
    exists,
    reason: "",
  }

  if (!rootMatched) {
    return { candidate: false, record: { ...record, reason: "outside_requested_roots" } }
  }
  if (!exists) {
    return { candidate: true, record: { ...record, reason: "missing_on_disk_catalog_row" } }
  }
  const pinReason = catalogPinReason(path)
  if (pinReason) {
    return { candidate: false, record: { ...record, reason: pinReason } }
  }
  if (retentionClass === "durable" || retentionClass === "evidence") {
    return { candidate: false, record: { ...record, reason: "protected_retention_class" } }
  }
  if (refCount > 0) {
    return { candidate: false, record: { ...record, reason: "referenced" } }
  }

  const effectiveRetention = retentionClass === "ephemeral" ? ephemeralRetentionHours : retentionHours
  if (ageHours < effectiveRetention) {
    return { candidate: false, record: { ...record, reason: "fresh" } }
  }
  return {
    candidate: true,
    record: {
      ...record,
      reason: retentionClass === "ephemeral" ? "stale_ephemeral_artifact" : "stale_unreferenced_artifact",
    },
  }
}

function artifactMtime(row: JSONRecord): Date {
  const summary = parseJsonObject(row.summary_json)
  const mtime = stringField(summary.mtime) || stringField(row.created_at)
  const date = new Date(mtime)
  return Number.isFinite(date.getTime()) ? date : new Date(0)
}

function catalogPinReason(path: string): string {
  const resolved = resolve(path)
  if (path.endsWith(".pin") || existsSync(`${resolved}.pin`)) {
    return "pinned"
  }
  let current = dirname(resolved)
  const cwd = resolve(process.cwd())
  while (current.startsWith(cwd)) {
    if (existsSync(resolve(current, ".pin"))) {
      return "pinned"
    }
    if (current === cwd) break
    current = dirname(current)
  }
  return ""
}

function boundedLimit(value: unknown, defaultLimit = 50): number {
  const limit = Math.floor(Number(value ?? defaultLimit))
  if (!Number.isFinite(limit) || limit <= 0) return defaultLimit
  return Math.min(limit, 1000)
}

function normalizeSymbol(value: string): string {
  return value.toUpperCase().replace(/[^A-Z0-9]/g, "")
}

function roundHours(value: number): number {
  return Math.max(0, Math.round(value * 1000) / 1000)
}

function parseJsonObject(value: unknown): JSONRecord {
  if (typeof value !== "string" || !value.trim()) return {}
  try {
    return asRecord(JSON.parse(value))
  } catch {
    return {}
  }
}

function bind(record: Record<string, unknown>): Record<string, SQLiteBindingValue> {
  return Object.fromEntries(Object.entries(record).map(([key, value]) => [`$${key}`, sqliteBinding(value)]))
}

function sqliteBinding(value: unknown): SQLiteBindingValue {
  if (value === null || typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
    return value
  }
  return String(value)
}

function asRecord(value: unknown): JSONRecord {
  return value && typeof value === "object" && !Array.isArray(value) ? value as JSONRecord : {}
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : []
}

function stringField(value: unknown): string {
  return typeof value === "string" ? value.trim() : ""
}

function nullableString(value: unknown): string | null {
  const text = stringField(value)
  return text || null
}

function displayMaybePath(value: unknown): string {
  const text = stringField(value)
  return text ? displayPath(text) : ""
}

function nullableNumber(value: unknown): number | null {
  const number = Number(value)
  return Number.isFinite(number) ? number : null
}

export {
  ensureDataCatalogSchema,
  defaultCatalogDbPathForGeneratedPath,
  initDataCatalog,
  listCatalogStrategyEvidence,
  listCatalogStrategyRndRuns,
  listStaleCatalogArtifacts,
  queryDataCatalog,
  registerCatalogArtifact,
  upsertCatalogStrategyEvidence,
  upsertCatalogStrategyRndRun,
  type CatalogRegisterArtifactInput,
  type CatalogRegisterArtifactResult,
  scanDataCatalog,
  type CatalogQueryInput,
  type CatalogQueryResult,
  type CatalogScanInput,
  type CatalogScanResult,
  type CatalogStaleInput,
  type CatalogStaleResult,
}
