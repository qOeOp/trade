const SHA256 = /^sha256:[0-9a-f]{64}$/
const ADMISSION_IDENTITY = /^product-edge-request-admission-v1-[0-9a-f]{64}$/
const INVOCATION_ADMISSION_RECEIPT_IDENTITY =
  /^product-edge-provider-invocation-admission-receipt-v1-[0-9a-f]{64}$/
const CLAIM_IDENTITY = /^product-edge-provider-invocation-claim-v1-[0-9a-f]{64}$/

const encoder = new TextEncoder()

function u64(value: number): Uint8Array {
  const bytes = new Uint8Array(8)
  new DataView(bytes.buffer).setBigUint64(0, BigInt(value))
  return bytes
}

async function framedSha256(domain: string, parts: Uint8Array[]): Promise<string> {
  const domainBytes = encoder.encode(domain)
  const size = 8 + domainBytes.length
    + parts.reduce((sum, part) => sum + 8 + part.length, 0)
  const framed = new Uint8Array(size)
  let offset = 0
  framed.set(u64(domainBytes.length), offset)
  offset += 8
  framed.set(domainBytes, offset)
  offset += domainBytes.length
  for (const part of parts) {
    framed.set(u64(part.length), offset)
    offset += 8
    framed.set(part, offset)
    offset += part.length
  }
  const digest = await crypto.subtle.digest("SHA-256", framed)
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("")
}

async function canonicalDigest(domain: string, value: unknown): Promise<string> {
  return `sha256:${await framedSha256(domain, [encoder.encode(JSON.stringify(value))])}`
}

export async function providerInvocationClaimIdentityV1(
  admissionIdentity: string,
  attemptIdentity: string,
  invocationAdmissionReceiptIdentity: string,
): Promise<string> {
  return `product-edge-provider-invocation-claim-v1-${await framedSha256(
    "product-edge-provider-invocation-claim-v1",
    [admissionIdentity, attemptIdentity, invocationAdmissionReceiptIdentity].map((value) => encoder.encode(value)),
  )}`
}

export async function providerInvocationClaimDigestV1(value: {
  schema_version: number
  claim_identity: string
  admission_identity: string
  attempt_identity: string
  invocation_admission_receipt_identity: string
  invocation_admission_receipt_digest: string
  committed_at_epoch_ms: number
}): Promise<string> {
  return canonicalDigest("product-edge.provider-invocation-claim.v1", {
    schema_version: value.schema_version,
    claim_identity: value.claim_identity,
    admission_identity: value.admission_identity,
    attempt_identity: value.attempt_identity,
    invocation_admission_receipt_identity: value.invocation_admission_receipt_identity,
    invocation_admission_receipt_digest: value.invocation_admission_receipt_digest,
    claim_digest: "",
    committed_at_epoch_ms: value.committed_at_epoch_ms,
  })
}

export async function providerInvocationStateDigestV1(value: {
  schema_version: number
  claim_identity: string
  admission_identity: string
  attempt_identity: string
  claim_digest: string
  state: "CLAIMED" | "INVOCATION_STARTED"
  updated_at_epoch_ms: number
}): Promise<string> {
  return canonicalDigest("product-edge.provider-invocation-state.v1", {
    schema_version: value.schema_version,
    claim_identity: value.claim_identity,
    admission_identity: value.admission_identity,
    attempt_identity: value.attempt_identity,
    claim_digest: value.claim_digest,
    state: value.state,
    state_digest: "",
    updated_at_epoch_ms: value.updated_at_epoch_ms,
  })
}

export async function verifyProviderInvocationCustodyV1(value: {
  schema_version: number
  claim_identity: string
  admission_identity: string
  attempt_identity: string
  invocation_admission_receipt_identity: string
  invocation_admission_receipt_digest: string
  claim_digest: string
  state_digest: string
  committed_at_epoch_ms: number
  state_updated_at_epoch_ms: number
  state: "CLAIMED" | "INVOCATION_STARTED"
}): Promise<boolean> {
  if (!ADMISSION_IDENTITY.test(value.admission_identity)
    || !INVOCATION_ADMISSION_RECEIPT_IDENTITY.test(value.invocation_admission_receipt_identity)
    || !CLAIM_IDENTITY.test(value.claim_identity)
    || !SHA256.test(value.invocation_admission_receipt_digest)
    || !SHA256.test(value.claim_digest)
    || !SHA256.test(value.state_digest)) return false
  const claimIdentity = await providerInvocationClaimIdentityV1(
    value.admission_identity,
    value.attempt_identity,
    value.invocation_admission_receipt_identity,
  )
  if (value.claim_identity !== claimIdentity) return false
  const claimDigest = await providerInvocationClaimDigestV1(value)
  if (value.claim_digest !== claimDigest) return false
  return value.state_digest === await providerInvocationStateDigestV1({
    schema_version: value.schema_version,
    claim_identity: value.claim_identity,
    admission_identity: value.admission_identity,
    attempt_identity: value.attempt_identity,
    claim_digest: value.claim_digest,
    state: value.state,
    updated_at_epoch_ms: value.state_updated_at_epoch_ms,
  })
}
