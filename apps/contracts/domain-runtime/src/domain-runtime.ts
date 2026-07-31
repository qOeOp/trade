import { TOP_LEVEL_DOMAINS, type TopLevelDomain } from "../../protocol-fabric/src/protocol-fabric"

const DOMAIN_RUNTIME_SCHEMA_IDS = {
  hookContext: "trade.domain-runtime.hook-context.v1",
  domainJobResult: "trade.domain-runtime.domain-job-result.v1",
} as const

const DOMAIN_HOOK_ORDER = ["pre_accept", "pre_handle", "handler", "post_handle", "post_commit", "outbox"] as const
const DOMAIN_HOOKS = [...DOMAIN_HOOK_ORDER, "on_error"] as const
const DOMAIN_RESULT_STATUSES = ["ok", "skipped", "blocked", "failed", "retryable", "needs_review"] as const

type JSONRecord = Record<string, unknown>
type DomainHook = typeof DOMAIN_HOOKS[number]
type DomainResultStatus = typeof DOMAIN_RESULT_STATUSES[number]
type DomainRuntimeSchemaId = typeof DOMAIN_RUNTIME_SCHEMA_IDS[keyof typeof DOMAIN_RUNTIME_SCHEMA_IDS]

interface BuildHookContextInput {
  domain: TopLevelDomain | string
  job_id: string
  idempotency_key: string
  hook: DomainHook | string
  ticket_no?: string
  stage?: string
  input_refs?: string[]
  allowed_writes?: string[]
  trading_mode_ref?: string
  audit?: JSONRecord
}

interface BuildDomainJobResultInput {
  domain: TopLevelDomain | string
  job_id: string
  idempotency_key: string
  status: DomainResultStatus | string
  ok?: boolean
  input_refs?: string[]
  output_refs?: string[]
  writes?: JSONRecord
  incidents?: string[]
  audit?: JSONRecord
}

function buildHookContext(input: BuildHookContextInput): JSONRecord {
  const hook = parseDomainHook(input.hook)
  assertTopLevelDomain(input.domain)
  if (!input.job_id || !input.idempotency_key) {
    throw new Error("job_id and idempotency_key are required")
  }
  return compactRecord({
    schema_id: DOMAIN_RUNTIME_SCHEMA_IDS.hookContext,
    domain: input.domain,
    job_id: input.job_id,
    ticket_no: input.ticket_no,
    stage: input.stage,
    hook,
    idempotency_key: input.idempotency_key,
    input_refs: input.input_refs ?? [],
    allowed_writes: input.allowed_writes ?? [],
    trading_mode_ref: input.trading_mode_ref,
    audit: input.audit ?? {},
  })
}

function buildDomainJobResult(input: BuildDomainJobResultInput): JSONRecord {
  const status = parseDomainResultStatus(input.status)
  assertTopLevelDomain(input.domain)
  if (!input.job_id || !input.idempotency_key) {
    throw new Error("job_id and idempotency_key are required")
  }
  const ok = input.ok ?? status === "ok"
  if (ok !== (status === "ok")) {
    throw new Error("ok must be true only when status is ok")
  }
  return {
    schema_id: DOMAIN_RUNTIME_SCHEMA_IDS.domainJobResult,
    ok,
    status,
    domain: input.domain,
    job_id: input.job_id,
    idempotency_key: input.idempotency_key,
    input_refs: input.input_refs ?? [],
    output_refs: input.output_refs ?? [],
    writes: input.writes ?? {},
    incidents: input.incidents ?? [],
    audit: input.audit ?? {},
  }
}

function validateDomainJobResult(result: JSONRecord, allowedWrites: string[] = []): void {
  if (result.schema_id !== DOMAIN_RUNTIME_SCHEMA_IDS.domainJobResult) {
    throw new Error("unsupported domain job result schema_id")
  }
  assertTopLevelDomain(stringField(result.domain))
  parseDomainResultStatus(stringField(result.status))
  if (!stringField(result.job_id) || !stringField(result.idempotency_key)) {
    throw new Error("job_id and idempotency_key are required")
  }
  const ok = result.ok === true
  if (ok !== (result.status === "ok")) {
    throw new Error("ok must be true only when status is ok")
  }
  assertStringArray(result.input_refs, "input_refs")
  assertStringArray(result.output_refs, "output_refs")
  assertStringArray(result.incidents, "incidents")
  if (allowedWrites.length > 0) {
    const disallowed = Object.keys(asRecord(result.writes)).filter((write) => !allowedWrites.includes(write))
    if (disallowed.length > 0) {
      throw new Error(`writes outside allowed scope: ${disallowed.join(",")}`)
    }
  }
}

function parseDomainHook(value: unknown): DomainHook {
  const hook = stringField(value)
  if (!DOMAIN_HOOKS.includes(hook as DomainHook)) {
    throw new Error(`unsupported domain hook: ${hook}`)
  }
  return hook as DomainHook
}

function parseDomainResultStatus(value: unknown): DomainResultStatus {
  const status = stringField(value)
  if (!DOMAIN_RESULT_STATUSES.includes(status as DomainResultStatus)) {
    throw new Error(`unsupported domain result status: ${status}`)
  }
  return status as DomainResultStatus
}

function assertTopLevelDomain(value: unknown): void {
  const domain = stringField(value)
  if (!TOP_LEVEL_DOMAINS.includes(domain as TopLevelDomain)) {
    throw new Error(`unsupported domain: ${domain}`)
  }
}

function assertStringArray(value: unknown, field: string): void {
  if (!Array.isArray(value) || value.some((item) => typeof item !== "string")) {
    throw new Error(`${field} must be an array of strings`)
  }
}

function compactRecord(record: JSONRecord): JSONRecord {
  for (const [key, value] of Object.entries(record)) {
    if (value === undefined || value === "" || (Array.isArray(value) && value.length === 0)) {
      delete record[key]
    }
  }
  return record
}

function asRecord(value: unknown): JSONRecord {
  return value && typeof value === "object" && !Array.isArray(value) ? value as JSONRecord : {}
}

function stringField(value: unknown): string {
  return typeof value === "string" ? value.trim() : ""
}

export {
  DOMAIN_HOOK_ORDER,
  DOMAIN_HOOKS,
  DOMAIN_RESULT_STATUSES,
  DOMAIN_RUNTIME_SCHEMA_IDS,
  buildDomainJobResult,
  buildHookContext,
  parseDomainHook,
  parseDomainResultStatus,
  validateDomainJobResult,
  type BuildDomainJobResultInput,
  type BuildHookContextInput,
  type DomainHook,
  type DomainResultStatus,
  type DomainRuntimeSchemaId,
}
