// Shared Trade-owned Owner projection contract consumed by both adapters.
export const RESEARCH_CONSUMER_OPERATION_V1 = "research_goal.consumer_projection.v1"
export const RESEARCH_OWNER_OPERATION_V2 = "research_goal.submit_or_resolve.v2"
export const ARTIFACT_CONSUMER_OPERATION_V1 = "artifact_build.consumer_projection.v1"
export const ARTIFACT_OWNER_OPERATION_V1 = "artifact_build.submit_or_resolve.v1"

type Json = Record<string, any>

import { verifyProviderInvocationCustodyV1 } from "./provider_invocation_custody_v1.ts"

export type VerifiedS1ConsumerContextV1 = {
  schema_version: 1
  request_identity: string
  intent_identity: string
  intent_semantic_digest: string
  trial_family_identity: string
  trial_family_root_digest: string
  census_frontier_identity: string
  census_frontier_digest: string
  valid_through_epoch_ms: number
}

const object = (value: unknown): value is Json => !!value && typeof value === "object" && !Array.isArray(value)
const text = (value: unknown): value is string => typeof value === "string" && value.length > 0
const epoch = (value: unknown): value is number => Number.isSafeInteger(value) && Number(value) >= 0
const integer = (value: unknown): value is number => Number.isSafeInteger(value) && Number(value) >= 0
const sha256Digest = (value: unknown): value is string => typeof value === "string"
  && /^sha256:[0-9a-f]{64}$/.test(value)
const version = (value: unknown, expected = 1): value is Json => object(value) && value.schema_version === expected
const texts = (value: unknown): value is string[] => Array.isArray(value) && value.every(text)

function exactKeys(value: Json, expected: string[]): boolean {
  const actual = Object.keys(value).sort()
  const wanted = [...expected].sort()
  return actual.length === wanted.length && actual.every((key, index) => key === wanted[index])
}

function stamp(operation: string, ownerOperation: string, ownerSchema: string) {
  return { schema_version: 1, operation, owner_operation: ownerOperation, owner_schema: ownerSchema }
}

const researchStamp = stamp(RESEARCH_CONSUMER_OPERATION_V1, RESEARCH_OWNER_OPERATION_V2, "sourced-research-goal-v2")
const artifactStamp = stamp(ARTIFACT_CONSUMER_OPERATION_V1, ARTIFACT_OWNER_OPERATION_V1, "rd-artifact-build-request-v1")

function exactStamp(value: unknown, expected: ReturnType<typeof stamp>): boolean {
  return object(value) && exactKeys(value, ["schema_version", "operation", "owner_operation", "owner_schema"])
    && value.schema_version === expected.schema_version && value.operation === expected.operation
    && value.owner_operation === expected.owner_operation && value.owner_schema === expected.owner_schema
}

export function unknownResearchProjectionV1(requestIdentity: string) {
  return {
    schema_version: 2, consumer_projection: researchStamp, resolution: "SUBMITTED_OR_UNKNOWN",
    request_identity: requestIdentity, owner_receipt: null, research_view: null,
    independence_basis: null, protected_feedback: null, trial_family_resolution: "UNAVAILABLE",
    trial_family: null, next_legal_action: "RESOLVE_SAME_REQUEST_IDENTITY",
  }
}

function validSource(value: unknown): value is Json {
  return object(value) && exactKeys(value, [
    "locator", "content_digest", "observed_at", "source_cut", "license_basis", "interpretation",
  ]) && [value.locator, value.content_digest, value.observed_at, value.source_cut,
    value.license_basis, value.interpretation].every(text)
}

async function validResearchReceipt(
  value: unknown,
  requestIdentity: string,
  disposition: string,
): Promise<boolean> {
  if (!version(value) || !exactKeys(value, [
    "schema_version", "receipt_identity", "request_identity", "semantic_digest", "disposition",
    "resulting_research_intent_identity", "committed_at_epoch_ms", "rejection_code",
  ]) || !text(value.receipt_identity) || value.request_identity !== requestIdentity
    || !text(value.semantic_digest) || value.disposition !== disposition || !epoch(value.committed_at_epoch_ms)) return false
  const suffix = await sha256Text(`v2:${requestIdentity}:${value.semantic_digest}`)
  if (value.receipt_identity !== `rd-research-request-receipt-v2-${suffix}`) return false
  return disposition === "ACCEPTED"
    ? value.resulting_research_intent_identity === `rd-research-intent-v2-${suffix}`
      && value.rejection_code === null
    : disposition === "REJECTED_NO_WRITE" && value.resulting_research_intent_identity === null
      && text(value.rejection_code)
}

function validResearchView(
  value: unknown, requestIdentity: string, intentIdentity: string, phase: string, allowStale = false,
): value is Json {
  const base = [
    "schema_version", "projection_identity", "request_identity", "trusted_principal", "authorized_scope",
    "authorization_policy_cut", "source_owner", "source_cut", "observed_at_epoch_ms",
    "projection_at_epoch_ms", "valid_through_epoch_ms", "availability", "phase", "intent_identity",
    "source_frontier", "next_legal_action",
  ]
  const artifact = ["attempt_identity", "artifact_identity", "build_receipt_identity", "artifact_review_identity"]
  if (!version(value) || !exactKeys(value, phase === "ARTIFACT_AVAILABLE" ? [...base, ...artifact] : base)) return false
  const available = value.availability === "AVAILABLE"
    && value.projection_at_epoch_ms < value.valid_through_epoch_ms
  const stale = allowStale && value.availability === "STALE"
    && value.next_legal_action === "RESOLVE_SAME_REQUEST_IDENTITY"
  return value.request_identity === requestIdentity && value.intent_identity === intentIdentity
    && text(value.projection_identity) && text(value.trusted_principal) && texts(value.authorized_scope)
    && text(value.authorization_policy_cut) && value.source_owner === "R_AND_D"
    && text(value.source_cut) && epoch(value.observed_at_epoch_ms) && epoch(value.projection_at_epoch_ms)
    && epoch(value.valid_through_epoch_ms) && (available || stale) && value.phase === phase
    && Array.isArray(value.source_frontier) && value.source_frontier.every(validSource)
    && (phase !== "ARTIFACT_AVAILABLE" || artifact.every((key) => text(value[key])))
}

async function validBasis(value: unknown, requestIdentity: string): Promise<boolean> {
  if (!version(value) || !exactKeys(value, [
    "schema_version", "basis_identity", "request_identity", "principal", "request_scope",
    "rationale_digest", "independence_disposition", "lineage_resolution",
    "semantic_predecessor_frontier", "lineage_digest", "basis_digest", "receipt",
  ])) return false
  const receipt = value.receipt
  if (value.request_identity !== requestIdentity || !text(value.basis_identity) || !text(value.principal)
    || !texts(value.request_scope) || !sha256Digest(value.rationale_digest)
    || !sha256Digest(value.lineage_digest) || !sha256Digest(value.basis_digest)
    || !["INDEPENDENT", "RELATED"].includes(value.independence_disposition)
    || !["GENESIS_EMPTY", "COMPLETE_FRONTIER"].includes(value.lineage_resolution)
    || !texts(value.semantic_predecessor_frontier)
    || (value.lineage_resolution === "GENESIS_EMPTY" && value.semantic_predecessor_frontier.length !== 0)
    || (value.lineage_resolution === "COMPLETE_FRONTIER" && value.semantic_predecessor_frontier.length === 0)
    || (value.independence_disposition === "INDEPENDENT")
      !== (value.semantic_predecessor_frontier.length === 0)
    || !version(receipt) || !exactKeys(receipt, [
      "schema_version", "receipt_identity", "basis_identity", "basis_digest", "committed_at_epoch_ms",
    ]) || !text(receipt.receipt_identity) || receipt.basis_identity !== value.basis_identity
    || receipt.basis_digest !== value.basis_digest || !epoch(receipt.committed_at_epoch_ms)) return false
  const lineageDigest = await canonicalDigest("rd.semantic-predecessor-frontier.v1", [
    value.principal, value.request_scope, value.lineage_resolution, value.semantic_predecessor_frontier,
  ])
  const basisDigest = await canonicalDigest("rd.independence-basis.v1", {
    schema_version: 1,
    request_identity: value.request_identity,
    principal: value.principal,
    request_scope: value.request_scope,
    rationale_digest: value.rationale_digest,
    independence_disposition: value.independence_disposition,
    lineage_resolution: value.lineage_resolution,
    semantic_predecessor_frontier: value.semantic_predecessor_frontier,
    lineage_digest: value.lineage_digest,
  })
  const basisIdentity = canonicalIdentity("rd-independence-basis-v1", basisDigest)
  const receiptDigest = await canonicalDigest("rd.independence-basis-receipt.v1", {
    schema_version: 1,
    basis_identity: basisIdentity,
    basis_digest: basisDigest,
    committed_at_epoch_ms: receipt.committed_at_epoch_ms,
  })
  return value.lineage_digest === lineageDigest && value.basis_digest === basisDigest
    && value.basis_identity === basisIdentity
    && receipt.receipt_identity === canonicalIdentity("rd-independence-basis-receipt-v1", receiptDigest)
}

async function validFeedback(value: unknown, basis: Json): Promise<boolean> {
  if (!version(value) || !exactKeys(value, [
    "schema_version", "projection_identity", "projection_digest", "resolution", "principal",
    "request_scope", "basis_identity", "basis_digest", "source_sequence", "source_cut",
    "source_frontier_identity", "source_frontier_digest", "clock_epoch", "projection_at_epoch_ms",
    "valid_through_epoch_ms", "receipt",
  ])) return false
  const receipt = value.receipt
  const validFrontier = value.resolution === "GENESIS_EMPTY"
    ? value.source_frontier_identity === null && value.source_frontier_digest === null && value.source_sequence === 0
      && value.source_cut === "qualification-protected-feedback-cut-v1-0"
    : value.resolution === "FRONTIER" && text(value.source_frontier_identity)
      && sha256Digest(value.source_frontier_digest)
  if (value.basis_identity !== basis.basis_identity || value.basis_digest !== basis.basis_digest
    || value.principal !== basis.principal
    || JSON.stringify(value.request_scope) !== JSON.stringify(basis.request_scope)
    || !text(value.projection_identity) || !sha256Digest(value.projection_digest) || !integer(value.source_sequence)
    || !validFrontier || !text(value.source_cut) || value.clock_epoch !== "unix-epoch-ms-v1"
    || !epoch(value.projection_at_epoch_ms) || !epoch(value.valid_through_epoch_ms)
    || value.valid_through_epoch_ms !== value.projection_at_epoch_ms + 600_000
    || !version(receipt) || !exactKeys(receipt, [
      "schema_version", "receipt_identity", "projection_identity", "projection_digest", "committed_at_epoch_ms",
    ]) || !text(receipt.receipt_identity) || receipt.projection_identity !== value.projection_identity
    || receipt.projection_digest !== value.projection_digest || !epoch(receipt.committed_at_epoch_ms)
    || receipt.committed_at_epoch_ms !== value.projection_at_epoch_ms) return false
  const projectionDigest = await canonicalDigest("qualification.protected-feedback-frontier.v1", {
    schema_version: 1,
    resolution: value.resolution,
    principal: value.principal,
    request_scope: value.request_scope,
    basis_identity: value.basis_identity,
    basis_digest: value.basis_digest,
    source_sequence: value.source_sequence,
    source_cut: value.source_cut,
    source_frontier_identity: value.source_frontier_identity,
    source_frontier_digest: value.source_frontier_digest,
    clock_epoch: value.clock_epoch,
    projection_at_epoch_ms: value.projection_at_epoch_ms,
    valid_through_epoch_ms: value.valid_through_epoch_ms,
  })
  const projectionIdentity = canonicalIdentity("qualification-protected-feedback-frontier-v1", projectionDigest)
  const receiptDigest = await canonicalDigest("qualification.protected-feedback-frontier-receipt.v1", {
    schema_version: 1,
    projection_identity: projectionIdentity,
    projection_digest: projectionDigest,
    committed_at_epoch_ms: receipt.committed_at_epoch_ms,
  })
  return validFrontier && value.principal === basis.principal
    && JSON.stringify(value.request_scope) === JSON.stringify(basis.request_scope)
    && value.projection_digest === projectionDigest && value.projection_identity === projectionIdentity
    && receipt.receipt_identity === canonicalIdentity(
      "qualification-protected-feedback-frontier-receipt-v1", receiptDigest,
    )
}

const replayParserDigestV2 = [
  115, 95, 189, 134, 43, 39, 33, 97, 136, 227, 16, 45, 162, 186, 0, 134,
  81, 189, 82, 202, 128, 188, 148, 64, 57, 245, 220, 142, 112, 185, 12, 185,
]

function bytes(value: unknown, length?: number): value is number[] {
  return Array.isArray(value) && (length === undefined || value.length === length)
    && value.every((entry) => Number.isInteger(entry) && entry >= 0 && entry <= 255)
}

function validReplayPolicyBindingV2(value: unknown): value is Json {
  return object(value) && exactKeys(value, [
    "catalog_record_id", "catalog_version", "policy_grammar_parser_id",
    "policy_grammar_parser_digest", "policy_canonical_bytes", "policy_digest",
    "catalog_record_digest",
  ]) && ownerIdentity(value.catalog_record_id) && integer(value.catalog_version)
    && value.catalog_version > 0
    && value.policy_grammar_parser_id === "rd.replay-execution-policy.fixed-record-le.v2"
    && JSON.stringify(value.policy_grammar_parser_digest) === JSON.stringify(replayParserDigestV2)
    && bytes(value.policy_canonical_bytes) && value.policy_canonical_bytes.length > 0
    && bytes(value.policy_grammar_parser_digest, 32) && bytes(value.policy_digest, 32)
    && bytes(value.catalog_record_digest, 32)
}

function validPolicy(value: unknown, basis?: Json, feedback?: Json): value is Json {
  const keys = [
    "trial_budget", "stop_rule", "pit_rule_identity", "cost_model_identity", "slippage_model_identity",
    "capacity_model_identity", "semantic_predecessor_frontier", "protected_feedback_frontier",
    "independence_disposition", "independence_basis_identity", "frozen_falsifier_binding",
  ]
  if (!object(value) || !exactKeys(value,
    "replay_execution_policy_v2" in value ? [...keys, "replay_execution_policy_v2"] : keys)
    || ("replay_execution_policy_v2" in value
      && !validReplayPolicyBindingV2(value.replay_execution_policy_v2))
    || !integer(value.trial_budget) || Number(value.trial_budget) === 0
    || ![value.stop_rule, value.pit_rule_identity, value.cost_model_identity, value.slippage_model_identity,
      value.capacity_model_identity, value.protected_feedback_frontier, value.independence_basis_identity,
      value.frozen_falsifier_binding].every(text)
    || !texts(value.semantic_predecessor_frontier)
    || !["INDEPENDENT", "RELATED"].includes(value.independence_disposition)) return false
  return !basis || !feedback || (
    JSON.stringify(value.semantic_predecessor_frontier) === JSON.stringify(basis.semantic_predecessor_frontier)
    && value.protected_feedback_frontier === feedback.projection_identity
    && value.independence_disposition === basis.independence_disposition
    && value.independence_basis_identity === basis.basis_identity
  )
}

function validTrialFamily(
  value: unknown,
  intentIdentity: string,
  intentDigest: string,
  basis?: Json,
  feedback?: Json,
): value is Json {
  if (!object(value) || !exactKeys(value, [
    "root", "root_receipt", "initial_intent_member", "membership_receipt", "census_frontier",
  ])) return false
  const root = value.root
  const rootReceipt = value.root_receipt
  const member = value.initial_intent_member
  const membership = value.membership_receipt
  const census = value.census_frontier
  const rootReceiptKeys = [
    "schema_version", "receipt_identity", "trial_family_identity", "intent_identity", "root_digest", "committed_at_epoch_ms",
  ]
  const censusKeys = [
    "schema_version", "frontier_identity", "trial_family_identity", "root_digest", "member_digests",
    "consumed_trial_budget", "frontier_digest",
  ]
  if (!version(root) || !exactKeys(root, [
    "schema_version", "trial_family_identity", "policy", "policy_digest", "root_digest", "created_at_epoch_ms",
  ]) || !version(rootReceipt) || !exactKeys(rootReceipt,
    "replay_execution_policy_v2" in rootReceipt
      ? [...rootReceiptKeys, "replay_execution_policy_v2"] : rootReceiptKeys)
  || !version(member) || !exactKeys(member, [
    "schema_version", "member_identity", "trial_family_identity", "member_kind", "fact_identity",
    "fact_digest", "ordinal", "member_digest",
  ]) || !version(membership) || !exactKeys(membership, [
    "schema_version", "receipt_identity", "trial_family_identity", "member_identity", "member_digest",
    "committed_at_epoch_ms",
  ]) || !version(census) || !exactKeys(census,
    "replay_execution_policy_v2" in census
      ? [...censusKeys, "replay_execution_policy_v2"] : censusKeys)) return false
  const policyValid = validPolicy(root.policy, basis, feedback)
  const replayPolicy = root.policy.replay_execution_policy_v2
  const replayBindingsValid = replayPolicy === undefined
    ? rootReceipt.replay_execution_policy_v2 === undefined
      && census.replay_execution_policy_v2 === undefined
    : validReplayPolicyBindingV2(replayPolicy)
      && sameReplayPolicyBindingV2(rootReceipt.replay_execution_policy_v2, replayPolicy)
      && sameReplayPolicyBindingV2(census.replay_execution_policy_v2, replayPolicy)
  return policyValid && replayBindingsValid
    && text(root.trial_family_identity) && text(root.policy_digest) && text(root.root_digest)
    && epoch(root.created_at_epoch_ms) && text(rootReceipt.receipt_identity)
    && rootReceipt.trial_family_identity === root.trial_family_identity
    && rootReceipt.intent_identity === intentIdentity && rootReceipt.root_digest === root.root_digest
    && rootReceipt.committed_at_epoch_ms === root.created_at_epoch_ms && text(member.member_identity)
    && member.trial_family_identity === root.trial_family_identity && member.member_kind === "INTENT"
    && member.fact_identity === intentIdentity && member.fact_digest === intentDigest && member.ordinal === 0
    && text(member.member_digest) && text(membership.receipt_identity)
    && membership.trial_family_identity === root.trial_family_identity
    && membership.member_identity === member.member_identity && membership.member_digest === member.member_digest
    && membership.committed_at_epoch_ms === root.created_at_epoch_ms && text(census.frontier_identity)
    && census.trial_family_identity === root.trial_family_identity && census.root_digest === root.root_digest
    && Array.isArray(census.member_digests) && census.member_digests.length === 1
    && census.member_digests[0] === member.member_digest && census.consumed_trial_budget === 1
    && text(census.frontier_digest)
}

const researchOwnerKeys = [
  "schema_version", "resolution", "request_identity", "owner_receipt", "research_view",
  "independence_basis", "protected_feedback", "trial_family_resolution", "trial_family", "next_legal_action",
]

function rawEnvelope(value: unknown, keys: string[], expectedStamp: ReturnType<typeof stamp>): Json | null {
  if (!object(value)) return null
  if (!("consumer_projection" in value)) return exactKeys(value, keys) ? value : null
  if (!exactStamp(value.consumer_projection, expectedStamp) || !exactKeys(value, [...keys, "consumer_projection"])) return null
  const { consumer_projection: _stamp, ...raw } = value
  return raw
}

export async function deriveResearchConsumerProjectionV1(value: unknown, requestIdentity: string) {
  const unknown = unknownResearchProjectionV1(requestIdentity)
  const raw = rawEnvelope(value, researchOwnerKeys, researchStamp)
  if (!raw || raw.schema_version !== 2 || raw.request_identity !== requestIdentity) return unknown
  if (raw.resolution === "REJECTED_NO_WRITE") {
    if (!await validResearchReceipt(raw.owner_receipt, requestIdentity, raw.resolution)
      || raw.research_view !== null || raw.independence_basis !== null || raw.protected_feedback !== null
      || raw.trial_family_resolution !== "UNAVAILABLE" || raw.trial_family !== null
      || raw.next_legal_action !== "CORRECT_INPUT_AND_CREATE_SUCCESSOR_REQUEST") return unknown
    return { ...unknown, resolution: raw.resolution, owner_receipt: raw.owner_receipt,
      next_legal_action: raw.next_legal_action }
  }
  if (raw.resolution !== "ACCEPTED"
    || !await validResearchReceipt(raw.owner_receipt, requestIdentity, raw.resolution)) return unknown
  const intent = raw.owner_receipt.resulting_research_intent_identity
  const basisValid = await validBasis(raw.independence_basis, requestIdentity)
  const feedbackValid = basisValid && await validFeedback(raw.protected_feedback, raw.independence_basis)
  const researchSuffix = await sha256Text(`v2:${requestIdentity}:${raw.owner_receipt.semantic_digest}`)
  const stale = raw.research_view?.availability === "STALE"
  const artifactAvailable = raw.research_view?.phase === "ARTIFACT_AVAILABLE"
  const viewPhase = artifactAvailable ? "ARTIFACT_AVAILABLE" : "INTENT_FROZEN"
  const sourceCutValid = artifactAvailable
    ? raw.research_view?.source_cut === `rd-artifact-cut-v1-${raw.research_view?.artifact_identity}`
    : raw.research_view?.source_cut === `rd-source-cut-v2-${researchSuffix}`
  const viewWindowValid = artifactAvailable
    ? (stale
      ? raw.research_view.projection_at_epoch_ms >= raw.research_view.observed_at_epoch_ms
      : raw.research_view.projection_at_epoch_ms === raw.research_view.observed_at_epoch_ms)
      && raw.research_view.observed_at_epoch_ms >= raw.owner_receipt.committed_at_epoch_ms
      && raw.research_view.valid_through_epoch_ms
        === raw.research_view.observed_at_epoch_ms + 600_000
    : (stale
      ? raw.research_view.projection_at_epoch_ms >= raw.owner_receipt.committed_at_epoch_ms
      : raw.research_view.projection_at_epoch_ms === raw.owner_receipt.committed_at_epoch_ms)
      && raw.research_view.observed_at_epoch_ms === raw.owner_receipt.committed_at_epoch_ms
      && raw.research_view.valid_through_epoch_ms === Math.min(
        raw.owner_receipt.committed_at_epoch_ms + 600_000,
        raw.protected_feedback?.valid_through_epoch_ms,
      )
  const nextLegalActionValid = stale
    ? raw.research_view?.next_legal_action === "RESOLVE_SAME_REQUEST_IDENTITY"
      && raw.next_legal_action === "RESOLVE_SAME_REQUEST_IDENTITY"
    : artifactAvailable
      ? raw.research_view?.next_legal_action === "REVIEW_ARTIFACT"
        && raw.next_legal_action === "REVIEW_ARTIFACT"
      : raw.research_view?.next_legal_action === "WAIT_FOR_R_AND_D_EXECUTION"
        && raw.next_legal_action === "WAIT_FOR_R_AND_D_EXECUTION"
  if (!validResearchView(raw.research_view, requestIdentity, intent, viewPhase, true)
    || raw.research_view.projection_identity !== await canonicalResearchViewIdentityV2(raw.research_view)
    || !sourceCutValid || !viewWindowValid || !nextLegalActionValid
    || raw.research_view.trusted_principal !== raw.independence_basis?.principal
    || JSON.stringify(raw.research_view.authorized_scope) !== JSON.stringify(raw.independence_basis?.request_scope)
    || !basisValid || !feedbackValid
    || raw.trial_family_resolution !== "AVAILABLE"
    || !validTrialFamily(raw.trial_family, intent, raw.owner_receipt.semantic_digest,
      raw.independence_basis, raw.protected_feedback)) return unknown
  if (raw.independence_basis.receipt.committed_at_epoch_ms > raw.owner_receipt.committed_at_epoch_ms
    || raw.protected_feedback.receipt.committed_at_epoch_ms > raw.owner_receipt.committed_at_epoch_ms
    || raw.protected_feedback.projection_at_epoch_ms > raw.owner_receipt.committed_at_epoch_ms
    || raw.owner_receipt.committed_at_epoch_ms >= raw.protected_feedback.valid_through_epoch_ms
    || (!artifactAvailable
      && raw.research_view.valid_through_epoch_ms > raw.protected_feedback.valid_through_epoch_ms)
    || raw.trial_family.root.created_at_epoch_ms !== raw.owner_receipt.committed_at_epoch_ms
    || !await canonicalTrialFamilyV1(
      raw.trial_family, intent, raw.owner_receipt.semantic_digest,
    )) return unknown
  return {
    schema_version: 2, consumer_projection: researchStamp, resolution: "ACCEPTED",
    request_identity: requestIdentity, owner_receipt: raw.owner_receipt, research_view: raw.research_view,
    independence_basis: raw.independence_basis, protected_feedback: raw.protected_feedback,
    trial_family_resolution: "AVAILABLE", trial_family: raw.trial_family,
    next_legal_action: raw.next_legal_action,
  }
}

export async function verifyResearchConsumerProjectionV1(value: unknown, requestIdentity: string) {
  return object(value) && "consumer_projection" in value && exactStamp(value.consumer_projection, researchStamp)
    ? await deriveResearchConsumerProjectionV1(value, requestIdentity)
    : unknownResearchProjectionV1(requestIdentity)
}

function validUnknownResearchOwnerResultV1(value: unknown, requestIdentity: string): boolean {
  const raw = rawEnvelope(value, researchOwnerKeys, researchStamp)
  return !!raw && raw.schema_version === 2 && raw.resolution === "SUBMITTED_OR_UNKNOWN"
    && raw.request_identity === requestIdentity && raw.owner_receipt === null
    && raw.research_view === null && raw.independence_basis === null
    && raw.protected_feedback === null && raw.trial_family_resolution === "UNAVAILABLE"
    && raw.trial_family === null && raw.next_legal_action === "RESOLVE_SAME_REQUEST_IDENTITY"
}

export async function projectResearchOwnerResultWithEvidenceV1(
  value: unknown,
  requestIdentity: string,
) {
  const projection = await verifyResearchConsumerProjectionV1(
    await deriveResearchConsumerProjectionV1(value, requestIdentity),
    requestIdentity,
  )
  return {
    projection,
    verified: projection.resolution !== "SUBMITTED_OR_UNKNOWN"
      || validUnknownResearchOwnerResultV1(value, requestIdentity),
  }
}

export async function projectResearchOwnerResultV1(value: unknown, requestIdentity: string) {
  return (await projectResearchOwnerResultWithEvidenceV1(value, requestIdentity)).projection
}

export async function deriveVerifiedS1ConsumerContextV1(
  value: unknown,
  requestIdentity: string,
): Promise<VerifiedS1ConsumerContextV1 | null> {
  const projected = await deriveResearchConsumerProjectionV1(value, requestIdentity)
  if (projected.resolution !== "ACCEPTED"
    || !["AVAILABLE", "STALE"].includes(projected.research_view?.availability)
    || projected.request_identity !== requestIdentity || !projected.owner_receipt
    || !projected.trial_family || projected.trial_family_resolution !== "AVAILABLE") return null
  return {
    schema_version: 1,
    request_identity: requestIdentity,
    intent_identity: projected.owner_receipt.resulting_research_intent_identity,
    intent_semantic_digest: projected.owner_receipt.semantic_digest,
    trial_family_identity: projected.trial_family.root.trial_family_identity,
    trial_family_root_digest: projected.trial_family.root.root_digest,
    census_frontier_identity: projected.trial_family.census_frontier.frontier_identity,
    census_frontier_digest: projected.trial_family.census_frontier.frontier_digest,
    valid_through_epoch_ms: projected.research_view.valid_through_epoch_ms,
  }
}

function validS1Context(value: unknown): value is VerifiedS1ConsumerContextV1 {
  return version(value) && exactKeys(value, [
    "schema_version", "request_identity", "intent_identity", "intent_semantic_digest",
    "trial_family_identity", "trial_family_root_digest", "census_frontier_identity",
    "census_frontier_digest", "valid_through_epoch_ms",
  ]) && [value.request_identity, value.intent_identity, value.intent_semantic_digest,
    value.trial_family_identity, value.trial_family_root_digest, value.census_frontier_identity,
    value.census_frontier_digest].every(text) && epoch(value.valid_through_epoch_ms)
}

export function unknownArtifactProjectionV1(
  buildRequestIdentity: string,
  attemptIdentity: string,
  providerInvocation: Json | null = null,
) {
  const next = providerInvocation?.state === "CLAIMED" ? "RUN_BOUNDED_EXECUTION_AGENT"
    : providerInvocation?.state === "INVOCATION_STARTED" ? "MANUALLY_RECONCILE_PROVIDER_INVOCATION"
      : "RESOLVE_SAME_ATTEMPT_IDENTITY"
  return {
    schema_version: 1, consumer_projection: artifactStamp, resolution: "SUBMITTED_OR_UNKNOWN",
    build_request_identity: buildRequestIdentity, attempt_identity: attemptIdentity, owner_receipt: null,
    research_view: null, artifact_review: null, artifact_review_actions: null,
    trial_family_resolution: null, artifact_trial_family: null, provider_invocation: providerInvocation,
    next_legal_action: next,
  }
}

async function validInvocation(
  value: unknown,
  build: string,
  attempt: string,
  state: "CLAIMED" | "INVOCATION_STARTED",
): Promise<boolean> {
  return version(value) && exactKeys(value, [
    "schema_version", "request_identity", "claim_identity", "admission_identity", "attempt_identity",
    "invocation_admission_receipt_identity", "invocation_admission_receipt_digest", "claim_digest",
    "state_digest", "committed_at_epoch_ms", "state_updated_at_epoch_ms", "disposition", "state",
    "next_legal_action",
  ]) && value.request_identity === build && value.attempt_identity === attempt
    && [value.claim_identity, value.admission_identity, value.invocation_admission_receipt_identity,
      value.invocation_admission_receipt_digest, value.claim_digest, value.state_digest].every(text)
    && epoch(value.committed_at_epoch_ms) && epoch(value.state_updated_at_epoch_ms)
    && Number(value.state_updated_at_epoch_ms) >= Number(value.committed_at_epoch_ms)
    && (state === "CLAIMED"
      ? ["CLAIMED_NEW", "ALREADY_CLAIMED"].includes(value.disposition)
      : value.disposition === "ALREADY_CLAIMED")
    && value.state === state
    && value.next_legal_action === (state === "INVOCATION_STARTED"
      ? "MANUALLY_RECONCILE_PROVIDER_INVOCATION" : "RUN_BOUNDED_EXECUTION_AGENT")
    && await verifyProviderInvocationCustodyV1(value as Parameters<
      typeof verifyProviderInvocationCustodyV1
    >[0])
}

function validLegacyArtifactReceipt(value: unknown, build: string, attempt: string, intent: string): value is Json {
  if (!version(value) || !exactKeys(value, [
    "schema_version", "receipt_identity", "build_request_identity", "attempt_identity",
    "request_semantic_digest", "intent_identity", "intent_semantic_digest", "disposition",
    "artifact_identity", "build_receipt_identity", "failure_code", "committed_at_epoch_ms",
  ]) || !text(value.receipt_identity) || value.build_request_identity !== build
    || value.attempt_identity !== attempt || !text(value.request_semantic_digest)
    || !["SUCCESS", "FAILED_NO_ARTIFACT", "REJECTED_NO_WRITE", "OUTCOME_UNKNOWN"].includes(value.disposition)
    || !epoch(value.committed_at_epoch_ms)) return false
  const completeIntent = value.intent_identity === intent && text(value.intent_semantic_digest)
  const sparseIntent = value.intent_identity === null && value.intent_semantic_digest === null
  if (!completeIntent && !sparseIntent) return false
  return value.disposition === "SUCCESS"
    ? completeIntent && text(value.artifact_identity) && text(value.build_receipt_identity) && value.failure_code === null
    : value.artifact_identity === null && value.build_receipt_identity === null && text(value.failure_code)
}

const failedCodes = new Set([
  "NOT_CONFIGURED", "POLICY_UNAVAILABLE", "PROVIDER_EMPTY", "PROVIDER_ERROR", "CANDIDATE_MALFORMED",
  "DEVELOPMENT_SANDBOX_FAILED", "ARTIFACT_SECURITY_ADMISSION_REJECTED",
])

function validArtifactReceipt(
  value: unknown,
  build: string,
  attempt: string,
  disposition: string,
  intent: string,
  intentSemanticDigest: string,
): value is Json {
  if (!version(value) || !exactKeys(value, [
    "schema_version", "receipt_identity", "build_request_identity", "attempt_identity",
    "request_semantic_digest", "intent_identity", "intent_semantic_digest", "disposition",
    "artifact_identity", "build_receipt_identity", "failure_code", "committed_at_epoch_ms",
  ]) || !text(value.receipt_identity) || value.build_request_identity !== build
    || value.attempt_identity !== attempt || !text(value.request_semantic_digest)
    || value.intent_identity !== intent || value.intent_semantic_digest !== intentSemanticDigest
    || value.disposition !== disposition || !epoch(value.committed_at_epoch_ms)) return false
  if (disposition === "SUCCESS") return text(value.artifact_identity)
    && text(value.build_receipt_identity) && value.failure_code === null
  return value.artifact_identity === null && value.build_receipt_identity === null
    && text(value.failure_code) && (disposition === "FAILED_NO_ARTIFACT"
      ? failedCodes.has(value.failure_code) : disposition === "OUTCOME_UNKNOWN"
        && value.failure_code === "ATTEMPT_CUSTODY_EXPIRED")
}

function validBuildReceipt(value: unknown, receipt: Json, intent: string): value is Json {
  return version(value) && exactKeys(value, [
    "schema_version", "build_receipt_identity", "attempt_identity", "intent_identity", "candidate_digest",
    "source_capsule_digest", "wasm_digest", "build_recipe_digest", "dependency_identity", "rustc_release",
    "rustc_commit", "target", "sandbox_policy", "deterministic_double_build", "artifact_security_admission",
  ]) && value.build_receipt_identity === receipt.build_receipt_identity
    && value.attempt_identity === receipt.attempt_identity && value.intent_identity === intent
    && [value.candidate_digest, value.source_capsule_digest, value.wasm_digest, value.build_recipe_digest,
      value.dependency_identity, value.rustc_release, value.rustc_commit, value.target,
      value.sandbox_policy].every(text) && value.deterministic_double_build === true
    && value.artifact_security_admission === "ADMITTED"
}

function validArtifactIdentity(
  value: unknown,
  receipt: Json,
  build: Json,
  parametersIdentity: string,
): value is Json {
  const keys = [
    "schema_version", "intent_digest", "wasm_digest", "guest_source_locator", "guest_source_digest",
    "build_recipe_locator", "build_recipe_digest", "rustc_release", "rustc_commit", "target",
    "program_profile", "artifact_digest", "trial_id", "parameters_digest", "strategy_spec_digest",
  ]
  if (!version(value, 2) || !exactKeys(value, keys)) return false
  return value.artifact_digest === receipt.artifact_identity && text(value.intent_digest)
    && value.trial_id === receipt.attempt_identity
    && value.parameters_digest === parametersIdentity
    && value.strategy_spec_digest === parametersIdentity
    && value.wasm_digest === build.wasm_digest && value.guest_source_digest === build.source_capsule_digest
    && value.build_recipe_digest === build.build_recipe_digest && value.rustc_release === build.rustc_release
    && value.rustc_commit === build.rustc_commit && value.target === build.target
    && text(value.guest_source_locator) && text(value.build_recipe_locator)
    && version(value.program_profile) && exactKeys(value.program_profile, ["schema_version", "profile_digest"])
    && text(value.program_profile.profile_digest)
}

function validLogic(value: unknown): value is Json {
  return object(value) && exactKeys(value, [
    "signal", "direction", "lookback_bars", "entry_threshold_bps", "exit_threshold_bps",
  ]) && ["MOMENTUM", "MEAN_REVERSION", "BREAKOUT"].includes(value.signal)
    && ["LONG_ONLY", "SHORT_ONLY", "LONG_SHORT"].includes(value.direction)
    && [value.lookback_bars, value.entry_threshold_bps, value.exit_threshold_bps].every(integer)
}

function validActions(value: unknown, allowed: string[]): value is Json {
  return version(value) && exactKeys(value, ["schema_version", "actions"])
    && Array.isArray(value.actions) && value.actions.length === allowed.length
    && new Set(allowed).size === allowed.length
    && value.actions.every((entry: unknown, index: number) => object(entry)
      && exactKeys(entry, ["action", "admission"])
      && entry.action === allowed[index] && entry.admission === "ADMITTED")
}

function validArtifactFamily(
  value: unknown,
  receipt: Json,
  context: VerifiedS1ConsumerContextV1,
): value is Json {
  if (!object(value) || !exactKeys(value, ["trial_family", "binding", "binding_receipt"])
    || !validTrialFamily(value.trial_family, context.intent_identity, context.intent_semantic_digest)) return false
  const binding = value.binding
  const bindingReceipt = value.binding_receipt
  return version(binding) && exactKeys(binding, [
    "schema_version", "binding_identity", "artifact_identity", "build_receipt_identity", "intent_identity",
    "trial_family_identity", "census_frontier_identity", "census_frontier_digest", "binding_digest",
  ]) && version(bindingReceipt) && exactKeys(bindingReceipt, [
    "schema_version", "receipt_identity", "binding_identity", "binding_digest", "committed_at_epoch_ms",
  ]) && text(binding.binding_identity) && binding.artifact_identity === receipt.artifact_identity
    && binding.build_receipt_identity === receipt.build_receipt_identity
    && binding.intent_identity === context.intent_identity
    && value.trial_family.root.trial_family_identity === context.trial_family_identity
    && value.trial_family.root.root_digest === context.trial_family_root_digest
    && value.trial_family.census_frontier.frontier_identity === context.census_frontier_identity
    && value.trial_family.census_frontier.frontier_digest === context.census_frontier_digest
    && binding.trial_family_identity === context.trial_family_identity
    && binding.census_frontier_identity === value.trial_family.census_frontier.frontier_identity
    && binding.census_frontier_digest === value.trial_family.census_frontier.frontier_digest
    && text(binding.binding_digest) && text(bindingReceipt.receipt_identity)
    && bindingReceipt.binding_identity === binding.binding_identity
    && bindingReceipt.binding_digest === binding.binding_digest
    && epoch(bindingReceipt.committed_at_epoch_ms)
    && bindingReceipt.committed_at_epoch_ms === receipt.committed_at_epoch_ms
}

async function validSuccess(
  raw: Json,
  build: string,
  attempt: string,
  context: VerifiedS1ConsumerContextV1,
): Promise<boolean> {
  const expectedRequest = context.request_identity
  const intent = context.intent_identity
  const stale = raw.research_view?.availability === "STALE"
  if (!validArtifactReceipt(
    raw.owner_receipt, build, attempt, "SUCCESS", intent, context.intent_semantic_digest,
  )
    || !validResearchView(raw.research_view, expectedRequest, intent, "ARTIFACT_AVAILABLE", true)
    || raw.research_view.projection_identity !== await canonicalResearchViewIdentityV2(raw.research_view)
    || raw.research_view.attempt_identity !== attempt
    || (stale
      ? raw.next_legal_action !== "RESOLVE_SAME_ATTEMPT_IDENTITY" || raw.artifact_review_actions !== null
      : raw.research_view.next_legal_action !== "REVIEW_ARTIFACT"
        || raw.next_legal_action !== "REVIEW_ARTIFACT")
    || !version(raw.artifact_review)
    || !exactKeys(raw.artifact_review, [
      "schema_version", "review_identity", "artifact_identity", "intent_identity", "intent_semantic_digest",
      "request_identity", "source_lineage", "structured_logic", "structured_logic_summary",
      "parameters_identity", "dependency_identity", "build_receipt", "build_security_state",
      "agent_change_explanation", "agent_change_explanation_authority", "allowed_next_actions",
    ])) return false
  const receipt = raw.owner_receipt
  const review = raw.artifact_review
  const buildReceipt = review.build_receipt
  const allowed = ["REVIEW_ARTIFACT", "CREATE_SUCCESSOR_BUILD_REQUEST"]
  return text(review.review_identity) && review.intent_identity === intent
    && review.intent_semantic_digest === context.intent_semantic_digest
    && review.intent_semantic_digest === receipt.intent_semantic_digest && review.request_identity === expectedRequest
    && texts(review.source_lineage) && review.source_lineage.length > 0 && validLogic(review.structured_logic)
    && text(review.structured_logic_summary) && text(review.parameters_identity) && text(review.dependency_identity)
    && validBuildReceipt(buildReceipt, receipt, intent)
    && validArtifactIdentity(review.artifact_identity, receipt, buildReceipt, review.parameters_identity)
    && review.dependency_identity === buildReceipt.dependency_identity && review.build_security_state === "ADMITTED"
    && text(review.agent_change_explanation)
    && review.agent_change_explanation_authority === "NON_AUTHORITATIVE_AGENT_EXPLANATION"
    && JSON.stringify(review.allowed_next_actions) === JSON.stringify(allowed)
    && (stale || validActions(raw.artifact_review_actions, allowed))
    && raw.research_view.artifact_identity === receipt.artifact_identity
    && raw.research_view.build_receipt_identity === receipt.build_receipt_identity
    && raw.research_view.artifact_review_identity === review.review_identity
    && raw.research_view.observed_at_epoch_ms === receipt.committed_at_epoch_ms
    && JSON.stringify(review.source_lineage) === JSON.stringify(
      raw.research_view.source_frontier.map((entry: Json) => `${entry.locator}#${entry.content_digest}`),
    )
    && raw.trial_family_resolution === "AVAILABLE"
    && validArtifactFamily(raw.artifact_trial_family, receipt, context)
}

const artifactOwnerKeys = [
  "schema_version", "resolution", "build_request_identity", "attempt_identity", "owner_receipt",
  "research_view", "artifact_review", "artifact_review_actions", "trial_family_resolution",
  "artifact_trial_family", "provider_invocation", "next_legal_action",
]

const legacyArtifactOwnerKeys = [
  "schema_version", "resolution", "build_request_identity", "attempt_identity", "owner_receipt",
  "research_view", "artifact_review", "artifact_review_actions", "trial_family_resolution",
  "next_legal_action",
]

function legacyArtifactRawEnvelope(value: unknown): Json | null {
  if (!object(value)) return null
  if (!("consumer_projection" in value)) {
    return exactKeys(value, legacyArtifactOwnerKeys) ? value : null
  }
  if (!exactStamp(value.consumer_projection, artifactStamp)
    || !exactKeys(value, [...artifactOwnerKeys, "consumer_projection"])
    || value.provider_invocation !== null || value.artifact_trial_family !== null) return null
  const { consumer_projection: _stamp, provider_invocation: _invocation,
    artifact_trial_family: _family, ...raw } = value
  return exactKeys(raw, legacyArtifactOwnerKeys) ? raw : null
}

function artifactRawEnvelope(value: unknown): Json | null {
  if (!object(value)) return null
  if ("consumer_projection" in value) {
    return rawEnvelope(value, artifactOwnerKeys, artifactStamp)
  }
  const optional = ["provider_invocation", "trial_family_resolution", "artifact_trial_family"]
  for (const omitted of [[], [optional[0]], optional.slice(1), optional]) {
    const keys = artifactOwnerKeys.filter((key) => !omitted.includes(key))
    if (exactKeys(value, keys)) return {
      ...value,
      provider_invocation: "provider_invocation" in value ? value.provider_invocation : null,
      trial_family_resolution: "trial_family_resolution" in value ? value.trial_family_resolution : null,
      artifact_trial_family: "artifact_trial_family" in value ? value.artifact_trial_family : null,
    }
  }
  return null
}

export async function deriveArtifactConsumerProjectionV1(
  value: unknown, build: string, attempt: string, context: VerifiedS1ConsumerContextV1 | null,
) {
  const unknown = unknownArtifactProjectionV1(build, attempt)
  const legacy = legacyArtifactRawEnvelope(value)
  if (legacy && !validS1Context(context)) return unknown
  const request = context?.request_identity ?? ""
  const intent = context?.intent_identity ?? ""
  if (legacy?.schema_version === 1 && legacy.resolution === "LEGACY_TERMINAL_QUARANTINED") {
    if (legacy.build_request_identity !== build || legacy.attempt_identity !== attempt
      || !validLegacyArtifactReceipt(legacy.owner_receipt, build, attempt, intent)
      || legacy.research_view !== null || legacy.artifact_review !== null
      || legacy.artifact_review_actions !== null
      || legacy.trial_family_resolution !== "TRIAL_FAMILY_UNAVAILABLE_LEGACY"
      || legacy.next_legal_action !== "RESOLVE_SAME_ATTEMPT_IDENTITY") return unknown
    return {
      ...unknown, resolution: "LEGACY_TERMINAL_QUARANTINED", owner_receipt: legacy.owner_receipt,
      trial_family_resolution: "TRIAL_FAMILY_UNAVAILABLE_LEGACY",
    }
  }
  const raw = artifactRawEnvelope(value)
  if (!raw || raw.schema_version !== 1 || raw.build_request_identity !== build
    || raw.attempt_identity !== attempt) return unknown

  if (raw.owner_receipt === null) {
    if (await validInvocation(raw.provider_invocation, build, attempt, "INVOCATION_STARTED")) {
      return unknownArtifactProjectionV1(build, attempt, raw.provider_invocation)
    }
    if (await validInvocation(raw.provider_invocation, build, attempt, "CLAIMED")) {
      return unknownArtifactProjectionV1(build, attempt, raw.provider_invocation)
    }
    return unknown
  }
  if (!validS1Context(context)) return unknown

  // Complete terminal Owner custody wins over any invocation representation.
  if (["FAILED_NO_ARTIFACT", "OUTCOME_UNKNOWN"].includes(raw.resolution)) {
    if (!validArtifactReceipt(
      raw.owner_receipt, build, attempt, raw.resolution, intent, context.intent_semantic_digest,
    )
      || raw.artifact_review !== null || raw.artifact_review_actions !== null
      || raw.artifact_trial_family != null
      || !["CREATE_SUCCESSOR_BUILD_REQUEST", "RESOLVE_SAME_ATTEMPT_IDENTITY"].includes(raw.next_legal_action)
      || !await canonicalArtifactReceiptIdentityV1(raw.owner_receipt)) return unknown
    const expectedRequest = request || raw.research_view?.request_identity
    if (!text(expectedRequest)
      || !validResearchView(raw.research_view, expectedRequest, intent, "INTENT_FROZEN", true)
      || raw.research_view.projection_identity !== await canonicalResearchViewIdentityV2(raw.research_view)
      || (raw.research_view.availability === "STALE"
        ? raw.next_legal_action !== "RESOLVE_SAME_ATTEMPT_IDENTITY"
        : raw.research_view.next_legal_action !== "WAIT_FOR_R_AND_D_EXECUTION"
          || raw.next_legal_action !== "CREATE_SUCCESSOR_BUILD_REQUEST")) return unknown
    return { ...unknown, resolution: raw.resolution, owner_receipt: raw.owner_receipt,
      research_view: raw.research_view,
      next_legal_action: raw.next_legal_action }
  }
  if (raw.resolution === "SUCCESS") {
    const artifactSuffix = raw.owner_receipt?.artifact_identity?.replace(/^blake3:/, "")
    if (!await validSuccess(raw, build, attempt, context)
      || !await canonicalArtifactReceiptIdentityV1(raw.owner_receipt)
      || raw.artifact_review.review_identity !== `rd-artifact-review-v1-${artifactSuffix}`) return unknown
    return {
      schema_version: 1, consumer_projection: artifactStamp, resolution: "SUCCESS",
      build_request_identity: build, attempt_identity: attempt, owner_receipt: raw.owner_receipt,
      research_view: raw.research_view, artifact_review: raw.artifact_review,
      artifact_review_actions: raw.artifact_review_actions, trial_family_resolution: "AVAILABLE",
      artifact_trial_family: raw.artifact_trial_family, provider_invocation: null,
      next_legal_action: raw.next_legal_action,
    }
  }
  return unknown
}

export async function verifyArtifactConsumerProjectionV1(
  value: unknown, build: string, attempt: string, context: VerifiedS1ConsumerContextV1 | null,
) {
  return object(value) && "consumer_projection" in value && exactStamp(value.consumer_projection, artifactStamp)
    ? await deriveArtifactConsumerProjectionV1(value, build, attempt, context)
    : unknownArtifactProjectionV1(build, attempt)
}

async function validUnknownArtifactOwnerResultV1(
  value: unknown,
  build: string,
  attempt: string,
): Promise<boolean> {
  const raw = artifactRawEnvelope(value)
  if (!raw || raw.schema_version !== 1 || raw.resolution !== "SUBMITTED_OR_UNKNOWN"
    || raw.build_request_identity !== build || raw.attempt_identity !== attempt
    || raw.owner_receipt !== null || raw.research_view !== null || raw.artifact_review !== null
    || raw.artifact_review_actions !== null || raw.trial_family_resolution !== null
    || raw.artifact_trial_family !== null) return false
  if (raw.provider_invocation === null) {
    return raw.next_legal_action === "RESOLVE_SAME_ATTEMPT_IDENTITY"
  }
  if (await validInvocation(raw.provider_invocation, build, attempt, "CLAIMED")) {
    return raw.next_legal_action === "RUN_BOUNDED_EXECUTION_AGENT"
  }
  return await validInvocation(raw.provider_invocation, build, attempt, "INVOCATION_STARTED")
    && raw.next_legal_action === "MANUALLY_RECONCILE_PROVIDER_INVOCATION"
}

export async function projectArtifactOwnerResultWithEvidenceV1(
  value: unknown,
  build: string,
  attempt: string,
  context: VerifiedS1ConsumerContextV1 | null,
) {
  const projection = await verifyArtifactConsumerProjectionV1(
    await deriveArtifactConsumerProjectionV1(value, build, attempt, context),
    build,
    attempt,
    context,
  )
  return {
    projection,
    verified: projection.resolution !== "SUBMITTED_OR_UNKNOWN"
      || await validUnknownArtifactOwnerResultV1(value, build, attempt),
  }
}

export async function projectArtifactOwnerResultV1(
  value: unknown,
  build: string,
  attempt: string,
  context: VerifiedS1ConsumerContextV1 | null,
) {
  return (await projectArtifactOwnerResultWithEvidenceV1(value, build, attempt, context)).projection
}

async function canonicalDigest(domain: string, value: unknown): Promise<string> {
  const bytes = new TextEncoder().encode(JSON.stringify({ domain, value }))
  const digest = await crypto.subtle.digest("SHA-256", bytes)
  return `sha256:${Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("")}`
}

function canonicalResearchSourceV1(source: Json): Json {
  return {
    locator: source.locator,
    content_digest: source.content_digest,
    observed_at: source.observed_at,
    source_cut: source.source_cut,
    license_basis: source.license_basis,
    interpretation: source.interpretation,
  }
}

function orderedReplayPolicyBindingV2(value: Json): Json {
  return {
    catalog_record_id: value.catalog_record_id,
    catalog_version: value.catalog_version,
    policy_grammar_parser_id: value.policy_grammar_parser_id,
    policy_grammar_parser_digest: value.policy_grammar_parser_digest,
    policy_canonical_bytes: value.policy_canonical_bytes,
    policy_digest: value.policy_digest,
    catalog_record_digest: value.catalog_record_digest,
  }
}

function sameReplayPolicyBindingV2(left: unknown, right: unknown): boolean {
  if (left === undefined || right === undefined) {
    return left === undefined && right === undefined
  }
  return object(left) && object(right)
    && JSON.stringify(orderedReplayPolicyBindingV2(left))
      === JSON.stringify(orderedReplayPolicyBindingV2(right))
}

function canonicalTrialFamilyPolicyV1(policy: Json): Json {
  const canonical = {
    trial_budget: policy.trial_budget,
    stop_rule: policy.stop_rule,
    pit_rule_identity: policy.pit_rule_identity,
    cost_model_identity: policy.cost_model_identity,
    slippage_model_identity: policy.slippage_model_identity,
    capacity_model_identity: policy.capacity_model_identity,
    semantic_predecessor_frontier: policy.semantic_predecessor_frontier,
    protected_feedback_frontier: policy.protected_feedback_frontier,
    independence_disposition: policy.independence_disposition,
    independence_basis_identity: policy.independence_basis_identity,
    frozen_falsifier_binding: policy.frozen_falsifier_binding,
  }
  return policy.replay_execution_policy_v2 === undefined ? canonical : {
    ...canonical,
    replay_execution_policy_v2: orderedReplayPolicyBindingV2(policy.replay_execution_policy_v2),
  }
}

async function canonicalResearchViewIdentityV2(view: Json): Promise<string> {
  const digest = await canonicalDigest("rd.research-view.identity.v2", {
    schema_version: view.schema_version,
    request_identity: view.request_identity,
    trusted_principal: view.trusted_principal,
    authorized_scope: view.authorized_scope,
    authorization_policy_cut: view.authorization_policy_cut,
    source_owner: view.source_owner,
    source_cut: view.source_cut,
    phase: view.phase,
    intent_identity: view.intent_identity,
    source_frontier: view.source_frontier.map(canonicalResearchSourceV1),
    attempt_identity: view.attempt_identity ?? null,
    artifact_identity: view.artifact_identity ?? null,
    build_receipt_identity: view.build_receipt_identity ?? null,
    artifact_review_identity: view.artifact_review_identity ?? null,
  })
  const prefix = view.phase === "ARTIFACT_AVAILABLE"
    ? "rd-research-view-terminal-v2"
    : "rd-research-view-v2"
  return canonicalIdentity(prefix, digest)
}

async function sha256Text(value: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value))
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("")
}

function concatenateBytes(parts: Uint8Array[]): Uint8Array {
  const output = new Uint8Array(parts.reduce((size, part) => size + part.length, 0))
  let offset = 0
  for (const part of parts) { output.set(part, offset); offset += part.length }
  return output
}

function littleEndianLength(value: number): Uint8Array {
  const bytes = new Uint8Array(4)
  new DataView(bytes.buffer).setUint32(0, value, true)
  return bytes
}

function littleEndianU64(value: number): Uint8Array {
  const bytes = new Uint8Array(8)
  new DataView(bytes.buffer).setBigUint64(0, BigInt(value), true)
  return bytes
}

function lengthPrefixed(value: Uint8Array): Uint8Array {
  return concatenateBytes([littleEndianLength(value.length), value])
}

async function sha256Array(value: Uint8Array): Promise<number[]> {
  const owned = new Uint8Array(value)
  return Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", owned.buffer)))
}

async function canonicalReplayPolicyBindingV2(value: Json): Promise<boolean> {
  if (!validReplayPolicyBindingV2(value)) return false
  const encoder = new TextEncoder()
  const canonicalPolicy = Uint8Array.from(value.policy_canonical_bytes)
  const policyDigest = await sha256Array(concatenateBytes([
    encoder.encode("rd.replay-execution-policy.v2\0"), canonicalPolicy,
  ]))
  if (JSON.stringify(policyDigest) !== JSON.stringify(value.policy_digest)) return false
  const record = concatenateBytes([
    lengthPrefixed(encoder.encode(value.catalog_record_id)),
    littleEndianU64(value.catalog_version),
    lengthPrefixed(encoder.encode(value.policy_grammar_parser_id)),
    Uint8Array.from(value.policy_grammar_parser_digest),
    lengthPrefixed(canonicalPolicy),
    Uint8Array.from(policyDigest),
  ])
  const recordDigest = await sha256Array(concatenateBytes([
    encoder.encode("rd.replay-policy-catalog-record.v2\0"), record,
  ]))
  return JSON.stringify(recordDigest) === JSON.stringify(value.catalog_record_digest)
}

function frameBytes(value: Uint8Array): Uint8Array {
  const framed = new Uint8Array(4 + value.length)
  new DataView(framed.buffer).setUint32(0, value.length, false)
  framed.set(value, 4)
  return framed
}

async function canonicalArtifactReceiptIdentityV1(receipt: Json): Promise<boolean> {
  if (receipt.disposition === "SUCCESS") {
    const suffix = receipt.artifact_identity?.replace(/^blake3:/, "")
    return text(suffix)
      && receipt.receipt_identity === `rd-artifact-build-receipt-v1-${suffix}`
      && receipt.build_receipt_identity === `rd-build-receipt-v1-${suffix}`
  }
  const encoder = new TextEncoder()
  const frames: Uint8Array[] = []
  for (const [field, value] of [
    ["domain", "rd.artifact-build.no-artifact-receipt.v1"],
    ["schema_version", "1"],
    ["build_request_identity", receipt.build_request_identity],
    ["attempt_identity", receipt.attempt_identity],
    ["request_semantic_digest", receipt.request_semantic_digest],
    ["intent_identity", receipt.intent_identity],
    ["intent_semantic_digest", receipt.intent_semantic_digest],
    ["disposition", receipt.disposition],
    ["artifact_identity", "NULL"],
    ["build_receipt_identity", "NULL"],
    ["failure_code", receipt.failure_code],
  ]) {
    frames.push(frameBytes(encoder.encode(field)), frameBytes(encoder.encode(value)))
  }
  const epochBytes = new Uint8Array(8)
  new DataView(epochBytes.buffer).setBigUint64(0, BigInt(receipt.committed_at_epoch_ms), false)
  frames.push(frameBytes(encoder.encode("committed_at_epoch_ms")), frameBytes(epochBytes))
  const size = frames.reduce((total, frame) => total + frame.length, 0)
  const payload = new Uint8Array(size)
  let offset = 0
  for (const frame of frames) { payload.set(frame, offset); offset += frame.length }
  const digest = await crypto.subtle.digest("SHA-256", payload)
  const suffix = Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("")
  return receipt.receipt_identity === `rd-artifact-build-receipt-v1-${suffix}`
}

function canonicalIdentity(prefix: string, digest: string): string {
  return `${prefix}-${digest.slice("sha256:".length)}`
}

function ownerIdentity(value: unknown): value is string {
  return typeof value === "string" && value.length >= 4 && value.length <= 256
    && /^[A-Za-z0-9_.:-]+$/.test(value)
}

async function canonicalTrialFamilyV1(
  family: Json,
  intentIdentity: string,
  intentDigest: string,
): Promise<{ familyIdentity: string; frontierIdentity: string; frontierDigest: string } | null> {
  const root = family.root
  const rootReceipt = family.root_receipt
  const member = family.initial_intent_member
  const membership = family.membership_receipt
  const frontier = family.census_frontier
  if (!ownerIdentity(intentIdentity) || member.fact_identity !== intentIdentity
    || member.fact_digest !== intentDigest || ![member.fact_digest, intentDigest].every(
    (digest) => typeof digest === "string" && /^sha256:[0-9a-f]{64}$/.test(digest),
  )) return null
  const policy = canonicalTrialFamilyPolicyV1(root.policy)
  const replayPolicy = policy.replay_execution_policy_v2
  if (replayPolicy !== undefined && !await canonicalReplayPolicyBindingV2(replayPolicy)) return null
  const policyDigest = await canonicalDigest("rd.trial-family.policy.v1", policy)
  const familyIdentityDigest = await canonicalDigest("rd.trial-family.identity.v1", {
    intent_identity: intentIdentity,
    intent_digest: intentDigest,
    policy_digest: policyDigest,
  })
  const familyIdentity = canonicalIdentity("rd-trial-family-v1", familyIdentityDigest)
  const rootDigest = await canonicalDigest("rd.trial-family.root.v1", {
    schema_version: 1,
    trial_family_identity: familyIdentity,
    policy,
    policy_digest: policyDigest,
    created_at_epoch_ms: root.created_at_epoch_ms,
  })
  const memberDigest = await canonicalDigest("rd.trial-family.census-member.v1", {
    schema_version: 1,
    trial_family_identity: familyIdentity,
    member_kind: "INTENT",
    fact_identity: intentIdentity,
    fact_digest: intentDigest,
    ordinal: 0,
  })
  const frontierDigest = await canonicalDigest("rd.trial-family.census-frontier.v1", {
    schema_version: 1,
    trial_family_identity: familyIdentity,
    root_digest: rootDigest,
    member_digests: [memberDigest],
    consumed_trial_budget: 1,
    ...(replayPolicy === undefined ? {} : { replay_execution_policy_v2: replayPolicy }),
  })
  const frontierIdentity = canonicalIdentity("rd-trial-family-frontier-v1", frontierDigest)
  const valid = root.policy_digest === policyDigest
    && root.trial_family_identity === familyIdentity && root.root_digest === rootDigest
    && rootReceipt.receipt_identity === canonicalIdentity("rd-trial-family-root-receipt-v1", rootDigest)
    && sameReplayPolicyBindingV2(rootReceipt.replay_execution_policy_v2, replayPolicy)
    && member.member_identity === canonicalIdentity("rd-trial-family-member-v1", memberDigest)
    && member.member_digest === memberDigest
    && membership.receipt_identity === canonicalIdentity("rd-trial-family-membership-receipt-v1", memberDigest)
    && sameReplayPolicyBindingV2(frontier.replay_execution_policy_v2, replayPolicy)
    && frontier.frontier_identity === frontierIdentity && frontier.frontier_digest === frontierDigest
  return valid ? { familyIdentity, frontierIdentity, frontierDigest } : null
}

async function canonicalArtifactFamilyV1(value: Json, receipt: Json): Promise<boolean> {
  if (![receipt.artifact_identity, receipt.build_receipt_identity, receipt.intent_identity].every(ownerIdentity)) {
    return false
  }
  const family = await canonicalTrialFamilyV1(
    value.trial_family, receipt.intent_identity, receipt.intent_semantic_digest,
  )
  if (!family) return false
  const { familyIdentity, frontierIdentity, frontierDigest } = family
  const binding = value.binding
  const bindingReceipt = value.binding_receipt
  const bindingDigest = await canonicalDigest("rd.artifact-trial-family-binding.v1", {
    schema_version: 1,
    artifact_identity: receipt.artifact_identity,
    build_receipt_identity: receipt.build_receipt_identity,
    intent_identity: receipt.intent_identity,
    trial_family_identity: familyIdentity,
    census_frontier_identity: frontierIdentity,
    census_frontier_digest: frontierDigest,
  })
  const bindingIdentity = canonicalIdentity("rd-artifact-trial-family-binding-v1", bindingDigest)
  const bindingReceiptDigest = await canonicalDigest("rd.artifact-trial-family-binding-receipt.v1", {
    schema_version: 1,
    binding_identity: bindingIdentity,
    binding_digest: bindingDigest,
    committed_at_epoch_ms: bindingReceipt.committed_at_epoch_ms,
  })
  return binding.binding_identity === bindingIdentity && binding.binding_digest === bindingDigest
    && bindingReceipt.receipt_identity === canonicalIdentity(
      "rd-artifact-family-binding-receipt-v1", bindingReceiptDigest,
    )
}

export async function deriveVerifiedArtifactS1ContextV1(
  value: unknown,
  build: string,
  attempt: string,
  researchRequestIdentity: string,
): Promise<VerifiedS1ConsumerContextV1 | null> {
  const raw = artifactRawEnvelope(value)
  const receipt = raw?.owner_receipt
  const view = raw?.research_view
  const family = raw?.artifact_trial_family?.trial_family
  const candidate = {
    schema_version: 1,
    request_identity: view?.request_identity,
    intent_identity: receipt?.intent_identity,
    intent_semantic_digest: receipt?.intent_semantic_digest,
    trial_family_identity: family?.root?.trial_family_identity,
    trial_family_root_digest: family?.root?.root_digest,
    census_frontier_identity: family?.census_frontier?.frontier_identity,
    census_frontier_digest: family?.census_frontier?.frontier_digest,
    valid_through_epoch_ms: view?.valid_through_epoch_ms,
  }
  if (raw?.resolution !== "SUCCESS" || view?.request_identity !== researchRequestIdentity
    || !validS1Context(candidate) || !validArtifactFamily(raw.artifact_trial_family, receipt, candidate)
    || !await canonicalArtifactFamilyV1(raw.artifact_trial_family, receipt)) return null
  const projected = await deriveArtifactConsumerProjectionV1(raw, build, attempt, candidate)
  return projected.resolution === "SUCCESS" && projected.owner_receipt !== null ? candidate : null
}

// Compatibility names remain narrow aliases for the canonical projector.
export const projectResearchConsumerV1 = deriveResearchConsumerProjectionV1
export const projectArtifactConsumerV1 = deriveArtifactConsumerProjectionV1
