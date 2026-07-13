import { buildDomainJobResult, validateDomainJobResult } from "../../../../contracts/domain-runtime/src/domain-runtime"
import { scanDataCatalog, type CatalogScanResult } from "./data-catalog"

type JSONRecord = Record<string, unknown>

export interface CatalogHygieneJobInput {
  cycle_id: string
  ticket_no?: string
  job_id?: string
  catalog_db_path: string
  roots: string[]
  now?: string
  idempotency_key?: string
}

export interface CatalogHygieneJobResult extends JSONRecord {
  scan: CatalogScanResult
  runtime_result: JSONRecord
}

export function runCatalogHygieneJob(input: CatalogHygieneJobInput): CatalogHygieneJobResult {
  const jobId = input.job_id || "catalog_hygiene_scan"
  const ticketNo = input.ticket_no || "J06"
  const idempotencyKey = input.idempotency_key || `${input.cycle_id}:${ticketNo}`
  const scan = scanDataCatalog({
    catalogDbPath: input.catalog_db_path,
    roots: input.roots,
    now: input.now,
  })
  const outputRefs = [`artifact_catalog:scan/${input.cycle_id}`]
  const runtimeResult = buildDomainJobResult({
    domain: "artifact-knowledge",
    job_id: jobId,
    idempotency_key: idempotencyKey,
    status: "ok",
    input_refs: scan.roots.map((root) => `artifact-root:${root}`),
    output_refs: outputRefs,
    writes: { artifact_catalog: true },
    incidents: [],
    audit: {
      cycle_id: input.cycle_id,
      ticket_no: ticketNo,
      catalog_db_path: scan.catalog_db_path,
      scanned_files: scan.scanned_files,
      artifacts_upserted: scan.artifacts_upserted,
    },
  })
  validateDomainJobResult(runtimeResult, ["artifact_catalog"])
  return {
    scan,
    runtime_result: runtimeResult,
  }
}
