export type JSONRecord = Record<string, unknown>

export function validateExecutionCapability(capability: JSONRecord, input: {
  target_action: string
  idempotency_key: string
  source_intent_ref: string
  now?: string
}): string[] {
  const issues: string[] = []
  if (capability.schema_version !== "trade.execution.capability.v1") issues.push("schema_version")
  if (!text(capability.capability_ref) || !text(capability.content_hash)) issues.push("capability_ref")
  if (text(capability.target_action) !== input.target_action) issues.push("target_action")
  if (text(capability.idempotency_key) !== input.idempotency_key) issues.push("idempotency_key")
  if (text(capability.source_intent_ref) !== input.source_intent_ref) issues.push("source_intent_ref")
  if (!text(capability.account_ref) || !text(capability.account_scope)) issues.push("account_scope")
  if (!text(capability.policy_authorization_ref) || !text(capability.account_fact_ref) || !text(capability.portfolio_projection_ref)) issues.push("source_refs")
  const now = Date.parse(input.now || new Date().toISOString())
  const expiresAt = Date.parse(text(capability.expires_at))
  if (!Number.isFinite(now) || !Number.isFinite(expiresAt) || expiresAt <= now) issues.push("expires_at")
  return issues
}

function text(value: unknown): string {
  return typeof value === "string" ? value.trim() : ""
}
