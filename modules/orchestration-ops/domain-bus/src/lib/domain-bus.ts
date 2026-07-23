import { Database } from "bun:sqlite"
import { buildDomainEnvelope, validateRailRoute } from "../../../../contracts/protocol-fabric/src/protocol-fabric"
import { asRecord, stringField, type JSONRecord } from "../../../../contracts/runtime-core/src/json"
import { buildDomainMessage, buildIncident, readDomainMessages, recordIncident, upsertDomainMessage, type DomainMessage } from "../../../ops-runtime-store/src/lib/ops-runtime-store"

export interface PublishDomainMessageInput extends JSONRecord {
  direction: "inbox" | "outbox"
}

export function publishDomainMessage(db: Database, input: PublishDomainMessageInput): DomainMessage {
  const createdAt = stringField(input.created_at) || new Date().toISOString()
  const messageId = stringField(input.message_id) || buildMessageId(input, createdAt)
  const rail = requiredString(input.rail, "rail")
  try {
    validateRailRoute({
      rail,
      source_domain: stringField(input.source_domain) || undefined,
      target_domain: stringField(input.target_domain) || undefined,
    })
  } catch (error) {
    recordIncident(db, buildIncident({
      incident_id: `incident-${messageId}-rail-rejected`,
      cycle_id: stringField(input.cycle_id) || undefined,
      source: "domain_bus",
      severity: "critical",
      title: "domain bus rail route rejected",
      refs: [stringField(input.payload_ref) || messageId],
      detail: {
        message_id: messageId,
        direction: input.direction,
        rail,
        source_domain: stringField(input.source_domain),
        target_domain: stringField(input.target_domain),
        error: error instanceof Error ? error.message : String(error),
      },
      first_seen_at: createdAt,
    }))
    throw error
  }
  const envelope = buildDomainEnvelope({
    direction: input.direction,
    message_id: messageId,
    source_domain: stringField(input.source_domain) || undefined,
    target_domain: stringField(input.target_domain) || undefined,
    rail,
    interaction: requiredInteraction(input.interaction),
    payload_ref: requiredString(input.payload_ref, "payload_ref"),
    idempotency_key: stringField(input.idempotency_key) || undefined,
    created_at: createdAt,
  })
  const message = buildDomainMessage({
    ...input,
    message_id: messageId,
    created_at: createdAt,
    envelope,
    status: stringField(input.status) || "published",
  })
  upsertDomainMessage(db, message)
  return message
}

function requiredInteraction(value: unknown): "command" | "query" | "fact" | "intent" | "authorization" | "result" | "ref" {
  const interaction = requiredString(value, "interaction")
  const allowed = ["command", "query", "fact", "intent", "authorization", "result", "ref"] as const
  if (!allowed.includes(interaction as typeof allowed[number])) {
    throw new Error(`unsupported interaction: ${interaction}`)
  }
  return interaction as typeof allowed[number]
}

export function listDomainMessages(db: Database, input: JSONRecord = {}): DomainMessage[] {
  return readDomainMessages(db, asRecord(input))
}

function buildMessageId(input: JSONRecord, createdAt: string): string {
  const cycle = stringField(input.cycle_id) || "cycle"
  const job = stringField(input.job_id) || "domain"
  const direction = stringField(input.direction) || "message"
  const suffix = stringField(input.idempotency_key) || createdAt
  return `${cycle}:${job}:${direction}:${suffix}`.replace(/[^a-zA-Z0-9_.:-]+/g, "-")
}

function requiredString(value: unknown, name: string): string {
  const text = stringField(value)
  if (!text) {
    throw new Error(`${name} is required`)
  }
  return text
}
